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
  XdgToplevelRequests,
  XdgToplevelResizeEdge,
  XdgToplevelResource,
  XdgToplevelState,
  XdgWmBaseError
} from 'westfield-runtime-server'
import { setCursor } from './browser/cursor'
import { CompositorSurface, CompositorSurfaceState } from './index'
import Mat4 from './math/Mat4'
import Point from './math/Point'
import Rect from './math/Rect'
import Seat from './Seat'
import Session from './Session'
import Size from './Size'
import Surface from './Surface'
import { makeSurfaceActive } from './UserShellApi'
import { UserShellSurfaceRole } from './UserShellSurfaceRole'
import View from './View'
import XdgSurface from './XdgSurface'

const {
  none,
  bottom,
  bottomLeft,
  bottomRight,
  left,
  right,
  top,
  topLeft,
  topRight
} = XdgToplevelResizeEdge
const { fullscreen, activated, maximized, resizing } = XdgToplevelState

interface ConfigureState {
  serial: number,
  state: number[],
  width: number,
  height: number,
  resizeEdge: number
}

/**
 *
 *      This interface defines an xdg_surface role which allows a surface to,
 *      among other things, set window-like properties such as maximize,
 *      fullscreen, and minimize, set application-specific metadata like title and
 *      id, and well as trigger user interactive operations such as interactive
 *      resize and move.
 *
 *      Unmapping an xdg_toplevel means that the surface cannot be shown
 *      by the compositor until it is explicitly mapped again.
 *      All active operations (e.g., move, resize) are canceled and all
 *      attributes (e.g. title, state, stacking, ...) are discarded for
 *      an xdg_toplevel surface when it is unmapped.
 *
 *      Attaching a null buffer to a toplevel unmaps the surface.
 *
 */
export default class XdgToplevel implements XdgToplevelRequests, UserShellSurfaceRole {
  readonly userSurface: CompositorSurface
  readonly resource: XdgToplevelResource
  readonly xdgSurface: XdgSurface
  mapped: boolean = false
  _userSurfaceState: CompositorSurfaceState = {
    appId: '',
    active: false,
    mapped: false,
    minimized: false,
    title: '',
    unresponsive: false
  }
  private readonly _session: Session
  private _parent?: XdgToplevelResource
  private _pendingMaxSize: Point = Point.create(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  private _maxSize: Point = Point.create(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  private _pendingMinSize: Point = Point.create(0, 0)
  private _minSize: Point = Point.create(0, 0)
  private _pendingConfigureStates: ConfigureState[] = []
  private _unfullscreenConfigureState?: ConfigureState
  private _ackedConfigureState: ConfigureState = {
    serial: 0,
    state: [],
    width: 0,
    height: 0,
    resizeEdge: 0
  }
  private _configureState: ConfigureState = {
    serial: 0,
    state: [],
    width: 0,
    height: 0,
    resizeEdge: 0
  }
  private _previousGeometry?: Rect

  static create(xdgToplevelResource: XdgToplevelResource, xdgSurface: XdgSurface, session: Session) {
    const surface = xdgSurface.wlSurfaceResource.implementation as Surface
    const { client, id } = surface.resource
    const userSurface: CompositorSurface = { id: `${id}`, clientId: client.id }
    const xdgToplevel = new XdgToplevel(xdgToplevelResource, xdgSurface, session, userSurface)
    xdgToplevelResource.implementation = xdgToplevel
    surface.role = xdgToplevel

    xdgSurface.wlSurfaceResource.onDestroy().then(() => session.userShell.events.destroyUserSurface?.(userSurface))

    // @ts-ignore
    makeSurfaceActive(surface)
    session.userShell.events.createUserSurface?.(userSurface, xdgToplevel._userSurfaceState)

    return xdgToplevel
  }

  private constructor(xdgToplevelResource: XdgToplevelResource, xdgSurface: XdgSurface, session: Session, userSurface: CompositorSurface) {
    this._session = session
    this.userSurface = userSurface
    this.resource = xdgToplevelResource
    this.xdgSurface = xdgSurface
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
  }

  requestActive() {
    if (this._userSurfaceState.active) {
      return
    }
    if (this._configureState.state.includes(activated)) {
      this._userSurfaceState = { ...this._userSurfaceState, active: true }
      this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
    } else {
      const newState = this._configureState.state.slice()
      newState.push(activated)
      this._emitConfigure(this.resource, this._configureState.width, this._configureState.height, newState, none)
      this._session.flush()
    }
  }

  notifyInactive() {
    if (!this._userSurfaceState.active) {
      return
    }
    if (this._configureState.state.includes(activated)) {
      const newState = this._configureState.state.slice()
      const idx = newState.indexOf(activated)
      newState.splice(idx, 1)
      this._emitConfigure(this.resource, this._configureState.width, this._configureState.height, newState, none)
      this._userSurfaceState = { ...this._userSurfaceState, active: false }
      this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
      this._session.flush()
    }
  }

  private commitRoleState() {
    this._minSize = this._pendingMinSize
    this._maxSize = this._pendingMaxSize

    const { x: minWidth, y: minHeight } = this._pendingMinSize
    let { x: maxWidth, y: maxHeight } = this._pendingMaxSize
    maxWidth = maxWidth === 0 ? Number.MAX_SAFE_INTEGER : maxWidth
    maxHeight = maxHeight === 0 ? Number.MAX_SAFE_INTEGER : maxHeight

    if (minWidth < 0 || minHeight < 0 || minWidth > maxWidth || minHeight > maxHeight) {
      this.resource.postError(XdgWmBaseError.invalidSurfaceState, 'Min size can not be greater than max size.')
      console.log('[client-protocol-error] Min size can not be greater than max size.')
      return
    }
    if (maxWidth < 0 || maxHeight < 0 || maxWidth < minWidth || maxHeight < minHeight) {
      this.resource.postError(XdgWmBaseError.invalidSurfaceState, 'Max size can not be me smaller than min size.')
      console.log('[client-protocol-error] Max size can not be less than min size.')
      return
    }

    this._minSize = Point.create(minWidth, minHeight)
    this._maxSize = Point.create(maxWidth, maxHeight)

    if (this._ackedConfigureState.state.includes(activated) &&
      !this._configureState.state.includes(activated)) {
      this._userSurfaceState = { ...this._userSurfaceState, active: true }
      this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
    }

    this._configureState = this._ackedConfigureState
    this.xdgSurface.updateWindowGeometry(this.xdgSurface.pendingWindowGeometry)
  }

  /**
   * Called during commit
   * @param surface
   */
  onCommit(surface: Surface) {
    if (surface.pendingState.bufferContents) {
      if (!this.mapped) {
        this._map(surface)
      }
      if (this._ackedConfigureState.state.includes(resizing)) {
        this._resizingCommit(surface)
      } else if (this._ackedConfigureState.state.includes(maximized)) {
        this._maximizedCommit(surface)
      } else if (this._ackedConfigureState.state.includes(fullscreen)) {
        this._fullscreenCommit(surface)
      } else {
        this._normalCommit(surface)
      }
    } else if (this.mapped) {
      this._unmap()
    }

    this.commitRoleState()
    surface.commitPending()
  }

  /**
   * Called during commit
   * @param surface
   * @private
   */
  private _map(surface: Surface) {
    this.mapped = true
    this._userSurfaceState = { ...this._userSurfaceState, mapped: true }
    this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  /**
   * Called during commit
   * @private
   */
  private _unmap() {
    this.mapped = false
    this._configureState = { serial: 0, state: [], width: 0, height: 0, resizeEdge: 0 }
    this._userSurfaceState = { ...this._userSurfaceState, mapped: false }
    this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  /**
   * Called during commit
   * @param surface
   * @private
   */
  private _resizingCommit(surface: Surface) {
    const { w: newSurfaceWidth, h: newSurfaceHeight } = this.xdgSurface.pendingWindowGeometry.size
    const { w: oldSurfaceWidth, h: oldSurfaceHeight } = this.xdgSurface.windowGeometry.size

    let dx = 0
    let dy = 0
    const edges = this._configureState.resizeEdge
    switch (edges) {
      case topRight:
      case top: {
        dy = oldSurfaceHeight - newSurfaceHeight
        break
      }
      case bottomLeft:
      case left: {
        dx = oldSurfaceWidth - newSurfaceWidth
        break
      }
      case topLeft: {
        dx = oldSurfaceWidth - newSurfaceWidth
        dy = oldSurfaceHeight - newSurfaceHeight
        break
      }
      default: {
        break
      }
    }

    if (dx || dy) {
      this._findTopLevelViews(surface).forEach(topLevelView => {
        const origPosition = topLevelView.positionOffset
        topLevelView.positionOffset = Point.create(origPosition.x + dx, origPosition.y + dy)
      })
    }
  }

  private _findTopLevelViews(surface: Surface): View[] {
    return Object.values(this._session.renderer.scenes).flatMap(scene => scene.topLevelViews.filter(topLevelView => topLevelView.surface === surface))
  }

  /**
   * Called during commit
   * @param surface
   */
  _maximizedCommit(surface: Surface) {
    const { w: newSurfaceWidth, h: newSurfaceHeight } = this.xdgSurface.pendingWindowGeometry.size

    if (newSurfaceWidth !== this._ackedConfigureState.width || newSurfaceHeight !== this._ackedConfigureState.height) {
      this.resource.postError(XdgWmBaseError.invalidSurfaceState, 'Surface size does not match configure event.')
      console.log('[client-protocol-error] Surface size does not match configure event.')
      return
    }

    if (!this._previousGeometry) {
      this._storePreviousGeometry()
    }
    if (this._unfullscreenConfigureState) {
      this._unfullscreenConfigureState = undefined
    }
    const windowGeoPositionOffset = this.xdgSurface.pendingWindowGeometry.position

    const primaryView = surface.views.find(view => view.primary)
    if (primaryView) {
      const viewPositionOffset = primaryView.toViewSpaceFromSurface(windowGeoPositionOffset)
      primaryView.customTransformation = Mat4.translation(0 - viewPositionOffset.x, 0 - viewPositionOffset.y)
    }
  }

  /**
   * Called during commit
   * @param surface
   * @private
   */
  private _fullscreenCommit(surface: Surface) {
    if (surface.pendingState.bufferContents) {
      const bufferSize = surface.pendingState.bufferContents.size
      const {
        x: newSurfaceWidth,
        y: newSurfaceHeight
      } = surface.toSurfaceSpace(Point.create(bufferSize.w, bufferSize.h))
      if (newSurfaceWidth > this._configureState.width || newSurfaceHeight > this._configureState.height) {
        this.resource.postError(XdgWmBaseError.invalidSurfaceState, 'Surface size does not match configure event.')
        console.log('[client protocol error] Surface size does not match configure event.')
        return
      }

      if (!this._unfullscreenConfigureState) {
        this._unfullscreenConfigureState = this._configureState
      }
      if (!this._previousGeometry) {
        this._storePreviousGeometry()
      }

      const x = (window.innerWidth - newSurfaceWidth) / 2
      const y = (window.innerHeight - newSurfaceHeight) / 2

      surface.surfaceChildSelf.position = Point.create(x, y)
    }
    // TODO use api to nofity user shell scene canvas should be made fullscreen
  }

  /**
   * Called during commit
   * @param surface
   * @private
   */
  private _normalCommit(surface: Surface) {
    if (this._previousGeometry) {
      // restore position (we came from a fullscreen or maximize and must restore the position)
      const primaryView = surface.views.find(view => view.primary)
      if (primaryView) {
        primaryView.customTransformation = undefined
      }
      this._previousGeometry = undefined
    }
    if (this._unfullscreenConfigureState) {
      this._unfullscreenConfigureState = undefined
    }
  }

  ackConfigure(serial: number) {
    this._pendingConfigureStates = this._pendingConfigureStates.filter((pendingConfigureState) => {
      if (pendingConfigureState.serial < serial) {
        return false
      } else if (pendingConfigureState.serial === serial) {
        this._ackedConfigureState = pendingConfigureState
        return false
      }
      return true
    })
  }

  private _storePreviousGeometry() {
    this._previousGeometry = this.xdgSurface.windowGeometry
  }

  destroy(resource: XdgToplevelResource) {
    this._unmap()
    resource.destroy()
  }

  setParent(resource: XdgToplevelResource, parent: XdgToplevelResource | undefined) {
    if (this._parent) {
      const oldParentXdgToplevel = this._parent.implementation as XdgToplevel
      const oldParentXdgSurface = oldParentXdgToplevel.xdgSurface
      const oldParentSurface = oldParentXdgSurface.wlSurfaceResource.implementation as Surface
      const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface
      oldParentSurface.removeChild(surface.surfaceChildSelf)
    }

    if (parent) {
      const parentXdgToplevel = parent.implementation as XdgToplevel
      const parentXdgSurface = parentXdgToplevel.xdgSurface
      const parentSurface = parentXdgSurface.wlSurfaceResource.implementation as Surface
      const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface
      parentSurface.addToplevelChild(surface.surfaceChildSelf)
    }

    this._parent = parent
  }

  setTitle(resource: XdgToplevelResource, title: string) {
    this._userSurfaceState = { ...this._userSurfaceState, title }
    this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  setAppId(resource: XdgToplevelResource, appId: string) {
    this._userSurfaceState = { ...this._userSurfaceState, appId }
    this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  showWindowMenu(resource: XdgToplevelResource, wlSeatResource: WlSeatResource, serial: number, x: number, y: number) {
    const seat = wlSeatResource.implementation as Seat

    // Most clients don't do this correctly. So ignore this.
    // if (!seat.isValidInputSerial(serial)) {
    //   console.log('[client-protocol-warning] - showWindowMenu serial mismatch. Ignoring.')
    //   return
    // }

    this._showWindowMenuAt(Point.create(x, y))
  }

  private _showWindowMenuAt(point: Point) {
    // TODO
  }

  move(resource: XdgToplevelResource, wlSeatResource: WlSeatResource, serial: number) {
    if (this._configureState.state.includes(fullscreen) || this._configureState.state.includes(maximized)) {
      return
    }

    const seat = wlSeatResource.implementation as Seat
    // Most clients don't do this correctly. So ignore this.
    // if (!seat.isValidInputSerial(serial)) {
    //   // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Move serial mismatch. Ignoring.')
    //   return
    // }

    const pointer = seat.pointer
    const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface

    const pointerX = pointer.x
    const pointerY = pointer.y
    const scene = pointer.scene

    if (scene) {
      // FIXME Only move that view that was last interacted with instead of finding the first one that matches.
      const topLevelView = scene.topLevelViews.find(topLevelView => topLevelView.surface === surface)
      if (topLevelView) {
        const origPosition = topLevelView.positionOffset

        const moveListener = () => {
          if (!this.mapped) {
            pointer.removeMouseMoveListener(moveListener)
            return
          }

          const deltaX = pointer.x - pointerX
          const deltaY = pointer.y - pointerY

          topLevelView.positionOffset = Point.create(origPosition.x + deltaX, origPosition.y + deltaY)
          topLevelView.applyTransformations()
          topLevelView.scene.render()
        }

        pointer.onButtonRelease().then(() => {
          pointer.enableFocus()
          pointer.removeMouseMoveListener(moveListener)
          pointer.setDefaultCursor()
        })

        pointer.disableFocus()
        pointer.addMouseMoveListener(moveListener)
        window.document.body.style.cursor = 'move'
      }
    }
  }

  resize(resource: XdgToplevelResource, wlSeatResource: WlSeatResource, serial: number, edges: number) {
    if (this._configureState.state.includes(fullscreen) || this._configureState.state.includes(maximized)) {
      return
    }

    const seat = wlSeatResource.implementation as Seat
    const pointer = seat.pointer

    // Most clients don't do this correctly. So ignore this.
    // if (!seat.isValidInputSerial(serial)) {
    // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Resize serial mismatch. Ignoring.')
    // return
    // }

    // assigned in switch statement
    let sizeAdjustment: (width: number, height: number, deltaX: number, deltaY: number) => { w: number, h: number }

    switch (edges) {
      case bottomRight: {
        setCursor('nwse-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width + deltaX, h: height + deltaY }
        }
        break
      }
      case top: {
        setCursor('ns-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width, h: height - deltaY }
        }
        break
      }
      case bottom: {
        setCursor('ns-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width, h: height + deltaY }
        }
        break
      }
      case left: {
        setCursor('ew-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width - deltaX, h: height }
        }
        break
      }
      case topLeft: {
        setCursor('nwse-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width - deltaX, h: height - deltaY }
        }
        break
      }
      case bottomLeft: {
        setCursor('nesw-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width - deltaX, h: height + deltaY }
        }
        break
      }
      case right: {
        setCursor('ew-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width + deltaX, h: height }
        }
        break
      }
      case topRight: {
        setCursor('nesw-resize')
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width + deltaX, h: height - deltaY }
        }
        break
      }
      case none:
      default: {
        pointer.setDefaultCursor()
        sizeAdjustment = (width, height, deltaX, deltaY) => {
          return { w: width, h: height }
        }
        break
      }
    }

    const pointerX = pointer.x
    const pointerY = pointer.y
    const {
      width: windowGeometryWidth,
      height: windowGeometryHeight
    } = this.xdgSurface.windowGeometry

    const sizeCalculation = () => {
      const deltaX = pointer.x - pointerX
      const deltaY = pointer.y - pointerY

      const size = sizeAdjustment(windowGeometryWidth, windowGeometryHeight, deltaX, deltaY)
      // TODO min/max constraints
      const width = Math.max(this._minSize.x, Math.min(size.w, this._maxSize.x))
      const height = Math.max(this._minSize.y, Math.min(size.h, this._maxSize.y))

      return Size.create(width, height)
    }

    const resizeListener = () => {
      if (!this.mapped) {
        pointer.removeMouseMoveListener(resizeListener)
        return
      }

      const { w: width, h: height } = sizeCalculation()
      this._emitConfigure(resource, width, height, [activated, resizing], edges)
      this._session.flush()
    }

    const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface
    pointer.onButtonRelease().then(() => {
      pointer.removeMouseMoveListener(resizeListener)
      pointer.setDefaultCursor()
      pointer.enableFocus()

      const { w: width, h: height } = sizeCalculation()
      this._emitConfigure(resource, width, height, [activated], none)
      this._session.flush()
    })

    pointer.disableFocus()
    pointer.addMouseMoveListener(resizeListener)
  }

  private _emitConfigure(resource: XdgToplevelResource, width: number, height: number, states: number[], resizeEdge: number) {
    resource.configure(width, height, Uint32Array.from(states))
    this.xdgSurface.emitConfigureDone()
    this._pendingConfigureStates.push({
      serial: this.xdgSurface.configureSerial,
      state: states,
      width: width,
      height: height,
      resizeEdge: resizeEdge
    })
  }

  setMaxSize(resource: XdgToplevelResource, width: number, height: number) {
    this._pendingMaxSize = Point.create(width, height)
  }

  setMinSize(resource: XdgToplevelResource, width: number, height: number) {
    this._pendingMinSize = Point.create(width, height)
  }

  setMaximized(resource: XdgToplevelResource) {
    if (this._configureState.state.includes(resizing)) {
      return
    }
    const scene = this._session.globals.seat.pointer.scene

    if (scene) {
      // FIXME get proper size in surface coordinates instead of assume surface space === global space
      const maxWidth = scene.canvas.width
      const maxHeight = scene.canvas.height

      if (this._configureState.state.includes(fullscreen)) {
        this._unfullscreenConfigureState = {
          state: [maximized, activated],
          width: maxWidth,
          height: maxHeight,
          serial: 0,
          resizeEdge: 0
        }
      } else {
        this._emitConfigure(resource, maxWidth, maxHeight, [maximized, activated], none)
      }
    }
  }

  unsetMaximized(resource: XdgToplevelResource) {
    if (this._configureState.state.includes(resizing)) {
      return
    }

    if (this._configureState.state.includes(fullscreen) && this._previousGeometry) {
      this._unfullscreenConfigureState = {
        state: [activated],
        width: this._previousGeometry.width,
        height: this._previousGeometry.height,
        serial: 0,
        resizeEdge: 0
      }
    } else if (this._configureState.state.includes(maximized) && this._previousGeometry) {
      this._emitConfigure(resource, this._previousGeometry.width, this._previousGeometry.height, [activated], none)
    } else {
      this._emitConfigure(resource, 0, 0, [activated], none)
    }
  }

  setFullscreen(resource: XdgToplevelResource, output: WlOutputResource | undefined) {
    this._emitConfigure(resource, window.innerWidth, window.innerHeight, [fullscreen, activated], none)
  }

  unsetFullscreen(resource: XdgToplevelResource) {
    if (this._configureState.state.includes(fullscreen)) {
      if (this._unfullscreenConfigureState) {
        this._emitConfigure(resource, this._unfullscreenConfigureState.width, this._unfullscreenConfigureState.height, this._unfullscreenConfigureState.state, none)
      } else if (this._previousGeometry) {
        this._emitConfigure(resource, this._previousGeometry.width, this._previousGeometry.height, [activated], none)
      } else {
        this._emitConfigure(resource, 0, 0, [activated], none)
      }
    }
  }

  setMinimized(resource: XdgToplevelResource) {
    this._userSurfaceState = { ...this._userSurfaceState, minimized: true }
    this._session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }
}
