// Copyright 2020 Erik De Rijcke
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

import {
  WlOutputResource,
  WlSeatResource,
  WlShellSurfaceRequests,
  WlShellSurfaceResize,
  WlShellSurfaceResource,
  WlShellSurfaceTransient,
  WlSurfaceResource
} from 'westfield-runtime-server'
import { CompositorSurface, CompositorSurfaceState } from './index'

import Point from './math/Point'
import Seat from './Seat'
import Session from './Session'
import Surface from './Surface'
import { UserShellSurfaceRole } from './UserShellSurfaceRole'
import View from './View'

const {
  bottom,
  bottomLeft,
  bottomRight,
  left,
  none,
  right,
  top,
  topLeft,
  topRight
} = WlShellSurfaceResize
const { inactive } = WlShellSurfaceTransient

const SurfaceStates = {
  MAXIMIZED: 'maximized',
  FULLSCREEN: 'fullscreen',
  POPUP: 'popup',
  TRANSIENT: 'transient',
  TOP_LEVEL: 'top_level'
}

/**
 *
 *            An interface that may be implemented by a wl_surface, for
 *            implementations that provide a desktop-style user interface.
 *
 *            It provides requests to treat surfaces like toplevel, fullscreen
 *            or popup windows, move, resize or maximize them, associate
 *            metadata like title and class, etc.
 *
 *            On the server side the object is automatically destroyed when
 *            the related wl_surface is destroyed. On the client side,
 *            wl_shell_surface_destroy() must be called before destroying
 *            the wl_surface object.
 */
export default class ShellSurface implements WlShellSurfaceRequests, UserShellSurfaceRole {
  readonly userSurface: CompositorSurface
  readonly resource: WlShellSurfaceResource
  readonly wlSurfaceResource: WlSurfaceResource
  readonly session: Session
  state?: string
  private _managed: boolean = false
  private _userSurfaceState: CompositorSurfaceState
  private _pingTimeoutActive: boolean = false
  private _timeoutTimer: number = 0
  private _pingTimer: number = 0
  private _mapped: boolean = false

  static create(wlShellSurfaceResource: WlShellSurfaceResource, wlSurfaceResource: WlSurfaceResource, session: Session): ShellSurface {
    const { client, id } = wlSurfaceResource
    const userSurface: CompositorSurface = { id: `${id}`, clientId: client.id }
    const userSurfaceState: CompositorSurfaceState = {
      appId: '',
      active: false,
      mapped: false,
      minimized: false,
      title: '',
      unresponsive: false
    }
    const shellSurface = new ShellSurface(wlShellSurfaceResource, wlSurfaceResource, session, userSurface, userSurfaceState)
    wlShellSurfaceResource.implementation = shellSurface

    // destroy the shell-surface if the surface is destroyed.
    wlSurfaceResource.onDestroy().then(() => wlShellSurfaceResource.destroy());

    (wlSurfaceResource.implementation as Surface).role = shellSurface
    shellSurface._doPing(wlShellSurfaceResource)

    wlShellSurfaceResource.onDestroy().then(() => {
      clearTimeout(shellSurface._timeoutTimer)
      clearTimeout(shellSurface._pingTimer)
    })

    return shellSurface
  }

  private constructor(
    wlShellSurfaceResource: WlShellSurfaceResource,
    wlSurfaceResource: WlSurfaceResource,
    session: Session,
    userSurface: CompositorSurface,
    userSurfaceState: CompositorSurfaceState
  ) {
    this.userSurface = userSurface
    this.resource = wlShellSurfaceResource
    this.wlSurfaceResource = wlSurfaceResource
    this._userSurfaceState = userSurfaceState
    this.session = session
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
  }

  onCommit(surface: Surface) {
    const oldPosition = surface.surfaceChildSelf.position
    surface.surfaceChildSelf.position = Point.create(oldPosition.x + surface.pendingState.dx, oldPosition.y + surface.pendingState.dy)

    if (surface.pendingState.bufferContents) {
      if (!this._mapped) {
        this._map()
      }
    } else {
      if (this._mapped) {
        this._unmap()
      }
    }

    surface.commitPending()
  }

  private _map() {
    this._mapped = true
    this._userSurfaceState = { ...this._userSurfaceState, mapped: this._mapped }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  private _unmap() {
    this._mapped = false
    this._userSurfaceState = { ...this._userSurfaceState, mapped: this._mapped }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  pong(resource: WlShellSurfaceResource, serial: number) {
    if (this._pingTimeoutActive) {
      this._userSurfaceState = { ...this._userSurfaceState, unresponsive: false }
      this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
      this._pingTimeoutActive = false
    }
    clearTimeout(this._timeoutTimer)
    this._pingTimer = self.setTimeout(() => this._doPing(resource), 5000)
  }

  _doPing(resource: WlShellSurfaceResource) {
    this._timeoutTimer = self.setTimeout(() => {
      if (!this._pingTimeoutActive) {
        // ping timed out, make view gray
        this._pingTimeoutActive = true
        this._userSurfaceState = { ...this._userSurfaceState, unresponsive: true }
        this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
      }
    }, 5000)
    // FIXME use a proper serial
    resource.ping(0)
    this.session.flush()
  }

  move(resource: WlShellSurfaceResource, wlSeatResource: WlSeatResource, serial: number) {
    const seat = wlSeatResource.implementation as Seat

    // if (!seat.isValidInputSerial(serial)) {
    //   // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Move serial mismatch. Ignoring.')
    //   return
    // }

    if (this.state === SurfaceStates.FULLSCREEN || this.state === SurfaceStates.MAXIMIZED) {
      return
    }
    const pointer = seat.pointer
    const surface = this.wlSurfaceResource.implementation as Surface

    const pointerX = pointer.x
    const pointerY = pointer.y
    const scene = pointer.scene
    if (scene) {
      // FIXME Only move that view that was last interacted with instead of finding the first one that matches.
      const topLevelView = scene.topLevelViews.find(topLevelView => topLevelView.surface === surface)
      if (topLevelView) {
        const origPosition = topLevelView.positionOffset

        const moveListener = () => {
          const deltaX = pointer.x - pointerX
          const deltaY = pointer.y - pointerY

          topLevelView.positionOffset = Point.create(origPosition.x + deltaX, origPosition.y + deltaY)
          topLevelView.applyTransformations()
          topLevelView.scene.render()
        }

        pointer.onButtonRelease().then(() => pointer.removeMouseMoveListener(moveListener))
        pointer.addMouseMoveListener(moveListener)
      }
    }
  }

  resize(resource: WlShellSurfaceResource, wlSeatResource: WlSeatResource, serial: number, edges: number) {
    const seat = wlSeatResource.implementation as Seat
    if (!seat.isValidInputSerial(serial)) {
      // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Resize serial mismatch. Ignoring.')
      return
    }

    if (this.state === SurfaceStates.FULLSCREEN || this.state === SurfaceStates.MAXIMIZED) {
      return
    }

    const pointer = seat.pointer
    // assigned in switch statement
    let sizeAdjustment: (width: number, height: number, deltaX: number, deltaY: number) => { w: number, h: number }

    switch (edges) {
      case bottomRight: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({
          w: width + deltaX,
          h: height + deltaY
        })
        break
      }
      case top: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({ w: width, h: height - deltaY })
        break
      }
      case bottom: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({ w: width, h: height + deltaY })
        break
      }
      case left: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({ w: width - deltaX, h: height })
        break
      }
      case topLeft: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({
          w: width - deltaX,
          h: height - deltaY
        })
        break
      }
      case bottomLeft: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({
          w: width - deltaX,
          h: height + deltaY
        })
        break
      }
      case right: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({ w: width + deltaX, h: height })
        break
      }
      case topRight: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({
          w: width + deltaX,
          h: height - deltaY
        })
        break
      }
      case none:
      default: {
        sizeAdjustment = (width, height, deltaX, deltaY) => ({ w: width, h: height })
        break
      }
    }

    const pointerX = pointer.x
    const pointerY = pointer.y
    const {
      w: surfaceWidth,
      h: surfaceHeight
    } = (this.wlSurfaceResource.implementation as Surface).size || {}

    if (surfaceWidth && surfaceHeight) {
      const resizeListener = () => {
        const deltaX = pointer.x - pointerX
        const deltaY = pointer.y - pointerY

        const size = sizeAdjustment(surfaceWidth, surfaceHeight, deltaX, deltaY)
        this.resource.configure(edges, size.w, size.h)
        this.session.flush()
      }
      pointer.onButtonRelease().then(() => pointer.removeMouseMoveListener(resizeListener))
      pointer.addMouseMoveListener(resizeListener)
    }
  }

  private _ensureUserShellSurface() {
    if (!this._managed) {
      this._managed = true
      this.wlSurfaceResource.onDestroy().then(() => this.session.userShell.events.destroyUserSurface?.(this.userSurface))
      this.session.userShell.events.createUserSurface?.(this.userSurface, this._userSurfaceState)
    }
  }

  requestActive() {
    if (this._userSurfaceState.active) {
      return
    }
    this._userSurfaceState = { ...this._userSurfaceState, active: true }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  notifyInactive() {
    if (!this._userSurfaceState.active) {
      return
    }
    this._userSurfaceState = { ...this._userSurfaceState, active: false }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  setToplevel(resource: WlShellSurfaceResource) {
    if (this.state === SurfaceStates.POPUP || this.state === SurfaceStates.TRANSIENT) {
      return
    }

    this._ensureUserShellSurface()
    this.state = SurfaceStates.TOP_LEVEL
  }

  setTransient(resource: WlShellSurfaceResource, parent: WlSurfaceResource, x: number, y: number, flags: number) {
    if (this.state === SurfaceStates.POPUP || this.state === SurfaceStates.TOP_LEVEL) {
      return
    }

    const parentPosition = (parent.implementation as Surface).surfaceChildSelf.position

    const surface = this.wlSurfaceResource.implementation as Surface
    const surfaceChild = surface.surfaceChildSelf
    // FIXME we probably want to provide a method to translate from (abstract) surface space to global space
    surfaceChild.position = Point.create(parentPosition.x + x, parentPosition.y + y)

    surface.hasKeyboardInput = (flags & inactive) === 0

    this._ensureUserShellSurface()
    this.state = SurfaceStates.TRANSIENT
  }

  setFullscreen(resource: WlShellSurfaceResource, method: number, framerate: number, output: WlOutputResource | undefined) {
    this.state = SurfaceStates.FULLSCREEN
    const surface = this.wlSurfaceResource.implementation as Surface
    // TODO get proper size in surface coordinates instead of assume surface space === global space
    surface.surfaceChildSelf.position = Point.create(0, 0)
    this.resource.configure(none, window.innerWidth, window.innerHeight)
  }

  async setPopup(resource: WlShellSurfaceResource, wlSeatResource: WlSeatResource, serial: number, parent: WlSurfaceResource, x: number, y: number, flags: number) {
    const seat = wlSeatResource.implementation as Seat
    // if (!seat.isValidInputSerial(seat.buttonPressSerial)) {
    //   this._dismiss()
    //  // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Popup grab input serial mismatch. Ignoring.')
    //   return
    // }

    if (this.state) {
      return
    }

    const pointer = seat.pointer
    this.state = SurfaceStates.POPUP
    const surface = this.wlSurfaceResource.implementation as Surface
    const surfaceChild = surface.surfaceChildSelf
    surfaceChild.position = Point.create(x, y)

    // having added this shell-surface to a parent will have it create a view for each parent view
    const views = (parent.implementation as Surface).addChild(surfaceChild)
    // this handles the case where a view is created later on (ie if a new parent view is created)

    surface.hasKeyboardInput = (flags & inactive) === 0

    // handle popup window grab
    pointer.popupGrab(this.wlSurfaceResource).then(() => resource.popupDone())
  }

  setMaximized(resource: WlShellSurfaceResource, output: WlOutputResource) {
    this.state = SurfaceStates.MAXIMIZED
    const surface = this.wlSurfaceResource.implementation as Surface

    // FIXME get proper size in surface coordinates instead of assume surface space === global space
    const scene = this.session.globals.seat.pointer.scene

    if (scene) {
      const width = scene.canvas.width
      const height = scene.canvas.height

      surface.views.forEach(view => view.positionOffset = Point.create(0, 0))
      this.resource.configure(none, width, height)
    }
  }

  setTitle(resource: WlShellSurfaceResource, title: string) {
    this._userSurfaceState = { ...this._userSurfaceState, title }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  setClass(resource: WlShellSurfaceResource, clazz: string) {
    this._userSurfaceState = { ...this._userSurfaceState, appId: clazz }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }
}
