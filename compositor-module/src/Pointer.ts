// Copyright 2019 Erik De Rijcke
//
// This file is part of Greenfield.
//
// Greenfield is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Greenfield is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with Greenfield.  If not, see <https://www.gnu.org/licenses/>.

import { Fixed } from 'westfield-runtime-common'
import {
  WlPointerAxis,
  WlPointerAxisSource,
  WlPointerButtonState,
  WlPointerError,
  WlPointerRequests,
  WlPointerResource,
  WlSurfaceResource
} from 'westfield-runtime-server'
import { AxisEvent } from './AxisEvent'
import { ButtonEvent } from './ButtonEvent'
import DataDevice from './DataDevice'

import Point from './math/Point'
import Rect from './math/Rect'
import Region from './Region'
import Scene from './render/Scene'
import Seat from './Seat'
import Session from './Session'
import Surface from './Surface'
import SurfaceRole from './SurfaceRole'
import { isUserShellSurface, makeSurfaceActive } from './UserShellApi'
import View from './View'

const { pressed, released } = WlPointerButtonState
const { horizontalScroll, verticalScroll } = WlPointerAxis
const { wheel } = WlPointerAxisSource

// translates between browser button codes & kernel code as expected by wayland protocol
const linuxInput = {
  // left
  0: 0x110,
  // middle
  1: 0x112,
  // right
  2: 0x111,
  // browser back
  3: 0x116,
  // browser forward
  4: 0x115
}

/**
 *
 *            The wl_pointer interface represents one or more input devices,
 *            such as mice, which control the pointer location and pointer_focus
 *            of a seat.
 *
 *            The wl_pointer interface generates motion, enter and leave
 *            events for the surfaces that the pointer is located over,
 *            and button and axis events for button presses, button releases
 *            and scrolling.
 *            @implements {SurfaceRole}
 *            @implements {WlPointerRequests}
 *
 */
export default class Pointer implements WlPointerRequests, SurfaceRole {
  session: Session
  scrollFactor: number = 1
  resources: WlPointerResource[] = []
  focus?: View
  x: number = 0
  y: number = 0
  scene?: Scene
  hotspotX: number = 0
  hotspotY: number = 0
  // @ts-ignore set in create of Seat
  seat: Seat
  buttonsPressed: number = 0
  private _lineScrollAmount: number = 12
  private _dataDevice: DataDevice
  private _grab?: View
  private readonly _popupStack: { popup: WlSurfaceResource, resolve: (value?: (void | PromiseLike<void> | undefined)) => void, promise: Promise<void> }[] = []
  private _cursorSurface?: WlSurfaceResource
  private readonly _cursorDestroyListener: () => void
  private _mouseMoveListeners: (() => void)[] = []
  private _buttonPressResolve?: (value: ButtonEvent | PromiseLike<ButtonEvent>) => void
  private _buttonPressPromise?: Promise<ButtonEvent>
  private _buttonReleaseResolve?: (value: ButtonEvent | PromiseLike<ButtonEvent>) => void
  private _buttonReleasePromise?: Promise<ButtonEvent>
  private focusDisabled: boolean = false

  static create(session: Session, dataDevice: DataDevice): Pointer {
    return new Pointer(session, dataDevice)
  }

  private constructor(session: Session, dataDevice: DataDevice) {
    this.session = session
    this._dataDevice = dataDevice
    this._cursorDestroyListener = () => {
      this._cursorSurface = undefined
      this.setDefaultCursor()
    }
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
  }

  get grab() {
    return this._grab
  }

  set grab(grab) {
    if (grab !== this._grab) {
      this._grab = grab
      if (this._grab && isUserShellSurface(this._grab?.surface)) {
        makeSurfaceActive(this._grab.surface)
        this.seat.keyboard.focusGained(this._grab.surface)
      }
    }
  }

  onButtonPress(): Promise<ButtonEvent> {
    if (this._buttonPressPromise === undefined) {
      this._buttonPressPromise = new Promise<ButtonEvent>(resolve => this._buttonPressResolve = resolve)
      this._buttonPressPromise.then(() => {
        this._buttonPressPromise = undefined
        this._buttonPressResolve = undefined
      })
    }
    return this._buttonPressPromise
  }

  onButtonRelease(): Promise<ButtonEvent> {
    if (!this._buttonReleasePromise) {
      this._buttonReleasePromise = new Promise<ButtonEvent>(resolve => this._buttonReleaseResolve = resolve)
      this._buttonReleasePromise.then(() => {
        this._buttonReleasePromise = undefined
        this._buttonReleaseResolve = undefined
      })
    }
    return this._buttonReleasePromise
  }

  onCommit(surface: Surface) {
    if (this._cursorSurface && this._cursorSurface.implementation === surface) {
      this.hotspotX -= surface.pendingState.dx
      this.hotspotY -= surface.pendingState.dy
      surface.commitPending()
    }
  }

  setCursor(resource: WlPointerResource, serial: number, surfaceResource: WlSurfaceResource | undefined, hotspotX: number, hotspotY: number) {
    if (surfaceResource) {
      const surface = surfaceResource.implementation as Surface
      if (surface.role && surface.role !== this) {
        resource.postError(WlPointerError.role, 'Given surface has another role.')
        console.log('[client-protocol-error] - Given surface has another role')
        return
      }
    }

    if (this._dataDevice.dndSourceClient) {
      return
    }
    if (serial !== this.seat.serial) {
      return
    }
    this.setCursorInternal(surfaceResource, hotspotX, hotspotY)
  }

  popupGrab(popup: WlSurfaceResource) {
    // check if there already is an existing grab
    const popupGrab = this.findPopupGrab(popup)
    if (popupGrab) {
      // TODO return null instead? (grabbing something already grabbed is smelly)
      return popupGrab.promise
    }

    let popupGrabEndResolve: (value?: (void | PromiseLike<void> | undefined)) => void
    const popupGrabEndPromise = new Promise<void>(resolve => {
      popup.onDestroy().then(() => resolve())
      popupGrabEndResolve = resolve
    })

    const newPopupGrab = {
      popup: popup,
      // @ts-ignore
      resolve: popupGrabEndResolve,
      promise: popupGrabEndPromise
    }
    this._popupStack.push(newPopupGrab)

    popupGrabEndPromise.then(() => {
      const popupGrabIdx = this._popupStack.indexOf(newPopupGrab)
      if (popupGrabIdx > -1) {
        const nestedPopupGrabs = this._popupStack.slice(popupGrabIdx)
        // all nested popup grabs above the resolved popup grab also need to be removed
        this._popupStack.splice(popupGrabIdx)
        // nested array includes the already closed popup, shift will remove it from the array
        nestedPopupGrabs.shift()
        nestedPopupGrabs.reverse().forEach(nestedPopupGrab => nestedPopupGrab.resolve())
      }
    })

    // clear any pointer button press grab
    this.grab = undefined

    return popupGrabEndPromise
  }

  findPopupGrab(popup: WlSurfaceResource) {
    return this._popupStack.find(popupGrab => popupGrab.popup === popup)
  }

  setCursorInternal(surfaceResource: WlSurfaceResource | undefined, hotspotX: number, hotspotY: number) {
    this.hotspotX = hotspotX
    this.hotspotY = hotspotY

    if (this._cursorSurface) {
      this._cursorSurface.removeDestroyListener(this._cursorDestroyListener)
      const surface = this._cursorSurface.implementation as Surface
      surface.role = undefined
    }
    this._cursorSurface = surfaceResource

    if (this.scene) {
      if (surfaceResource) {
        const surface = surfaceResource.implementation as Surface
        surface.resource.addDestroyListener(this._cursorDestroyListener)
        surface.role = this
        Region.fini(surface.state.inputPixmanRegion)
        Region.initRect(surface.state.inputPixmanRegion, Rect.create(0, 0, 0, 0))
        this.scene.updatePointerView(surface)
      } else {
        this.scene.hidePointer()
      }
    }
  }

  release(resource: WlPointerResource) {
    resource.destroy()
    const index = this.resources.indexOf(resource)
    if (index > -1) {
      this.resources.splice(index, 1)
    }
  }

  addMouseMoveListener(func: () => void) {
    this._mouseMoveListeners.push(func)
  }

  removeMouseMoveListener(func: () => void) {
    const index = this._mouseMoveListeners.indexOf(func)
    if (index > -1) {
      this._mouseMoveListeners.splice(index, 1)
    }
  }

  private focusFromEvent(event: ButtonEvent): View | undefined {
    return this.session.renderer.scenes[event.sceneId].pickView(Point.create(event.x, event.y))
  }

  handleMouseMove(event: ButtonEvent) {
    this.x = event.x
    this.y = event.y
    this.scene = this.session.renderer.scenes[event.sceneId]
    if (this.scene.pointerView) {
      this.scene.pointerView.positionOffset = Point.create(this.x, this.y).minus(Point.create(this.hotspotX, this.hotspotY))
      this.scene.pointerView.applyTransformations()
      this.scene.render()
    }

    let currentFocus = this.focusFromEvent(event)

    const nroPopups = this._popupStack.length
    if (nroPopups && currentFocus &&
      currentFocus.surface.resource.client !== this._popupStack[nroPopups - 1].popup.client) {
      currentFocus = undefined
    }

    if (this._dataDevice.dndSourceClient) {
      this._dataDevice.onMouseMotion(currentFocus)
      return
    }

    // if we don't have a grab, update the focus
    if (!this.grab) {
      if (currentFocus !== this.focus) {
        this.unsetFocus()
        if (currentFocus) {
          this.setFocus(currentFocus)
        } else {
          this.setDefaultCursor()
        }
      }
    }

    this._mouseMoveListeners.forEach(listener => listener())

    if (this.focus && this.focus.surface) {
      const surfacePoint = this._calculateSurfacePoint(this.focus)
      const surfaceResource = this.focus.surface.resource
      this._doPointerEventFor(surfaceResource, pointerResource => {
        pointerResource.motion(event.timestamp, Fixed.parse(surfacePoint.x), Fixed.parse(surfacePoint.y))
        if (pointerResource.version >= 5) {
          pointerResource.frame()
        }
      })
    }
  }

  private _doPointerEventFor(surfaceResource: WlSurfaceResource, action: (pointerResource: WlPointerResource) => void) {
    this.resources.forEach(pointerResource => {
      if (pointerResource.client === surfaceResource.client) {
        action(pointerResource)
      }
    })
  }

  handleMouseUp(event: ButtonEvent) {
    this.buttonsPressed--
    if (this.buttonsPressed < 0) {
      this.buttonsPressed = 0
    }
    if (this._dataDevice.dndSourceClient) {
      this._dataDevice.onMouseUp()
      return
    }

    const nroPopups = this._popupStack.length

    if (this.focus && this.focus.surface) {
      if (this.grab || nroPopups) {
        const surfaceResource = this.focus.surface.resource
        this._doPointerEventFor(surfaceResource, pointerResource => {
          pointerResource.button(this.seat.nextSerial(), event.timestamp, linuxInput[event.buttonCode], released)
          if (pointerResource.version >= 5) {
            pointerResource.frame()
          }
        })
      }

      if (this.grab && event.buttons === 0) {
        this.grab = undefined
      }
    } else if (nroPopups) {
      const focus = this.focusFromEvent(event)
      // popup grab ends when user has clicked on another client's surface
      const popupGrab = this._popupStack[nroPopups - 1]
      if (!focus || ((popupGrab.popup.implementation as Surface).state.bufferContents && focus.surface.resource.client !== popupGrab.popup.client)) {
        popupGrab.resolve()
      }
    }

    if (this._buttonReleaseResolve) {
      this._buttonReleaseResolve(event)
    }
  }

  handleMouseDown(event: ButtonEvent) {
    this.buttonsPressed++
    this.handleMouseMove(event)

    if (this.focus && this.focus.surface) {
      if (this.grab === undefined && this._popupStack.length === 0) {
        this.grab = this.focus
      }

      const surfaceResource = this.focus.surface.resource
      this._doPointerEventFor(surfaceResource, pointerResource => {
        pointerResource.button(this.seat.nextSerial(), event.timestamp, linuxInput[event.buttonCode], pressed)
        if (pointerResource.version >= 5) {
          pointerResource.frame()
        }
      })
    }

    if (this._buttonPressResolve) {
      this._buttonPressResolve(event)
    }
  }

  private _calculateSurfacePoint(view: View): Point {
    const mousePoint = Point.create(this.x, this.y)
    return view.toSurfaceSpace(mousePoint)
  }

  setFocus(newFocus: View) {
    if (this.focusDisabled) {
      return
    }

    this.focus = newFocus
    const surfaceResource = this.focus.surface.resource
    newFocus.onDestroy().then(() => {
      if (!this.focus) {
        return
      }
      if (newFocus !== this.focus) {
        return
      }
      // recalculate focus and consequently enter event
      const focus = this.scene?.pickView(Point.create(this.x, this.y))
      if (focus) {
        this.setFocus(focus)
      } else {
        this.unsetFocus()
        this.setDefaultCursor()
      }
    })

    const surfacePoint = this._calculateSurfacePoint(newFocus)
    this._doPointerEventFor(surfaceResource, pointerResource => {
      pointerResource.enter(this.seat.nextSerial(), surfaceResource, Fixed.parse(surfacePoint.x), Fixed.parse(surfacePoint.y))
    })
  }

  disableFocus() {
    this.unsetFocus()
    this.focusDisabled = true
  }

  enableFocus() {
    this.focusDisabled = false
  }

  unsetFocus() {
    if (this.focus && !this.focus.destroyed && this.focus.surface) {
      const surfaceResource = this.focus.surface.resource
      this._doPointerEventFor(surfaceResource, pointerResource => {
        pointerResource.leave(this.seat.nextSerial(), surfaceResource)
        if (pointerResource.version >= 5) {
          pointerResource.frame()
        }
      })
    }

    this.focus = undefined
    this.grab = undefined

    if (this._cursorSurface) {
      this._cursorSurface = undefined
    }
  }

  setDefaultCursor() {
    if (this.scene) {
      this.scene.resetPointer()
    }
  }

  handleWheel(event: AxisEvent) {
    const focusSurface = this.focus?.surface
    if (focusSurface !== undefined) {
      // TODO configure the scroll transform through the config menu
      let deltaTransform: (delta: number, axis?: number) => number
      switch (event.deltaMode) {
        case event.DOM_DELTA_LINE: {
          deltaTransform = delta => delta * this._lineScrollAmount
          break
        }
        case event.DOM_DELTA_PAGE: {
          deltaTransform = (delta, axis) => {
            if (axis === verticalScroll) {
              return delta * (focusSurface.size?.h ?? 0)
            } else { // horizontalScroll
              return delta * (focusSurface.size?.w ?? 0)
            }
          }
          break
        }
        case event.DOM_DELTA_PIXEL:
        default: {
          deltaTransform = delta => delta
          break
        }
      }

      this._doPointerEventFor(focusSurface.resource, pointerResource => {
        let deltaX = event.deltaX
        if (deltaX) {
          const xAxis = this._adjustWithScrollFactor(horizontalScroll)
          deltaX = this._adjustWithScrollFactor(deltaX)

          if (pointerResource.version >= 5) {
            pointerResource.axisDiscrete(xAxis, deltaX)
          }
          const scrollAmount = deltaTransform(deltaX, xAxis)
          pointerResource.axis(event.timestamp, xAxis, Fixed.parse(scrollAmount))
        }

        let deltaY = event.deltaY
        if (deltaY) {
          const yAxis = this._adjustWithScrollFactor(verticalScroll)
          deltaY = this._adjustWithScrollFactor(deltaY)

          if (pointerResource.version >= 5) {
            pointerResource.axisDiscrete(yAxis, deltaY)
          }
          const scrollAmount = deltaTransform(deltaY, yAxis)
          pointerResource.axis(event.timestamp, yAxis, Fixed.parse(scrollAmount))
        }
        if (pointerResource.version >= 5) {
          pointerResource.axisSource(wheel)
          pointerResource.frame()
        }
      })
    }
  }

  private _adjustWithScrollFactor(scroll: number) {
    return scroll * this.scrollFactor
  }
}
