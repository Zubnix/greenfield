import { WlShellSurfaceResize } from 'westfield-runtime-server'
import { CompositorSurface, CompositorSurfaceState } from '../index'
import Point from '../math/Point'
import Output from '../Output'
import Pointer from '../Pointer'
import Scene from '../render/Scene'
import Session from '../Session'
import Surface from '../Surface'
import { UserShellSurfaceRole } from '../UserShellSurfaceRole'
import View from '../View'
import { WmWindow } from './XWindowManager'

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

const SurfaceStates = {
  MAXIMIZED: 'maximized',
  FULLSCREEN: 'fullscreen',
  TRANSIENT: 'transient',
  TOP_LEVEL: 'top_level'
}

export default class XWaylandShellSurface implements UserShellSurfaceRole {
  static create(session: Session, window: WmWindow, surface: Surface) {
    const { client, id } = surface.resource
    const userSurface: CompositorSurface = { id: `${id}`, clientId: client.id }
    const userSurfaceState: CompositorSurfaceState = {
      appId: '',
      active: false,
      mapped: false,
      minimized: false,
      title: '',
      unresponsive: false
    }

    const xWaylandShellSurface = new XWaylandShellSurface(session, window, surface, userSurface, userSurfaceState)
    surface.role = xWaylandShellSurface
    return xWaylandShellSurface
  }

  private _mapped: boolean = false
  private _managed: boolean = false

  state?: string
  sendConfigure?: (width: number, height: number) => void

  private xwayland = {
    x: 0,
    y: 0,
    isSet: false
  }

  constructor(
    private readonly session: Session,
    private readonly window: WmWindow,
    private readonly surface: Surface,
    readonly userSurface: CompositorSurface,
    private _userSurfaceState: CompositorSurfaceState) {
  }

  private _ensureUserShellSurface() {
    if (!this._managed) {
      this._managed = true
      this.surface.resource.onDestroy().then(() => this.session.userShell.events.destroyUserSurface?.(this.userSurface))
      this.session.userShell.events.createUserSurface?.(this.userSurface, this._userSurfaceState)
    }
  }

  onCommit(surface: Surface): void {
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

  prepareFrameDecoration(view: View) {
    // render frame decoration
    if (this.window.decorate && this.window.frame) {
      const { w: frameWidth, h: frameHeight } = view.renderState.size
      const {
        width: interiorWidth,
        height: interorHeight,
        x: interiorX,
        y: interiorY
      } = this.window.frame.repaint(frameWidth, frameHeight)
      const renderContext = this.window.frame.renderContext

      const top = renderContext.getImageData(interiorX, 0, interiorWidth, interiorY)
      const bottom = renderContext.getImageData(interiorX, interiorY + interorHeight, interiorWidth, frameHeight - (interiorY + interorHeight))
      const left = renderContext.getImageData(0, 0, interiorX, frameHeight)
      const right = renderContext.getImageData(interiorX + interiorWidth, 0, frameWidth - (interiorX + interiorWidth), frameHeight)

      const { gl, texture, format } = view.renderState.texture
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, interiorX, 0, format, gl.UNSIGNED_BYTE, top)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, interiorX, interiorY + interorHeight, format, gl.UNSIGNED_BYTE, bottom)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, format, gl.UNSIGNED_BYTE, left)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, interiorX + interiorWidth, 0, format, gl.UNSIGNED_BYTE, right)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
    if (view.mapped && view.surface.state.buffer) {
      this.prepareFrameDecoration(view)
    }
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

  setToplevel(): void {
    if (this.state === SurfaceStates.TRANSIENT) {
      return
    }

    this._ensureUserShellSurface()
    this.state = SurfaceStates.TOP_LEVEL
  }

  setToplevelWithPosition(x: number, y: number): void {
    if (this.state === SurfaceStates.TRANSIENT) {
      return
    }

    this._ensureUserShellSurface()
    this.state = SurfaceStates.TOP_LEVEL

    // TODO store position?
  }

  setParent(parent: Surface): void {
    // TODO set parent?
  }

  setTransient(parent: Surface, x: number, y: number): void {
    if (this.state === SurfaceStates.TOP_LEVEL) {
      return
    }

    const parentPosition = parent.surfaceChildSelf.position

    const surfaceChild = this.surface.surfaceChildSelf
    // FIXME we probably want to provide a method to translate from (abstract) surface space to global space
    surfaceChild.position = Point.create(parentPosition.x + x, parentPosition.y + y)

    this._ensureUserShellSurface()
    this.state = SurfaceStates.TRANSIENT
  }

  setFullscreen(output?: Output): void {
    this.state = SurfaceStates.FULLSCREEN
    // TODO get proper size in surface coordinates instead of assume surface space === global space
    this.surface.surfaceChildSelf.position = Point.create(0, 0)
    this.sendConfigure?.(window.innerWidth, window.innerHeight)
  }

  setXwayland(x: number, y: number): void {
    this.xwayland.x = x
    this.xwayland.y = y
    this.xwayland.isSet = true
  }

  private findTopLevelView(scene: Scene): View | undefined {
    return scene.topLevelViews.find(topLevelView => topLevelView.surface === this.surface)
  }

  move(pointer: Pointer): void {
    // if (!seat.isValidInputSerial(serial)) {
    //   // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Move serial mismatch. Ignoring.')
    //   return
    // }

    if (this.state === SurfaceStates.FULLSCREEN || this.state === SurfaceStates.MAXIMIZED) {
      return
    }

    const pointerX = pointer.x
    const pointerY = pointer.y
    const scene = pointer.scene
    if (scene) {
      // FIXME Only move that view that was last interacted with instead of finding the first one that matches.
      const topLevelView = this.findTopLevelView(scene)
      if (topLevelView) {
        const origPosition = topLevelView.positionOffset

        const moveListener = () => {
          const deltaX = pointer.x - pointerX
          const deltaY = pointer.y - pointerY

          topLevelView.positionOffset = Point.create(origPosition.x + deltaX, origPosition.y + deltaY)
          topLevelView.applyTransformations()
          topLevelView.scene.render()
        }

        pointer.onButtonRelease().then(() => {
          pointer.removeMouseMoveListener(moveListener)
          pointer.enableFocus()
        })
        pointer.disableFocus()
        pointer.addMouseMoveListener(moveListener)
      }
    }
  }

  resize(pointer: Pointer, edges: number): void {
    if (this.state === SurfaceStates.FULLSCREEN || this.state === SurfaceStates.MAXIMIZED) {
      return
    }
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
    const { w: surfaceWidth, h: surfaceHeight } = this.surface.size || {}

    if (surfaceWidth && surfaceHeight) {
      const resizeListener = () => {
        const deltaX = pointer.x - pointerX
        const deltaY = pointer.y - pointerY

        const size = sizeAdjustment(surfaceWidth, surfaceHeight, deltaX, deltaY)
        this.sendConfigure?.(size.w, size.h)
      }
      pointer.onButtonRelease().then(() => {
        pointer.removeMouseMoveListener(resizeListener)
      })
      pointer.addMouseMoveListener(resizeListener)
    }
  }

  setTitle(title: string): void {
    this._userSurfaceState = { ...this._userSurfaceState, title }
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }


  setWindowGeometry(x: number, y: number, width: number, height: number): void {
    // TODO ?
  }


  setMaximized(): void {
    this.state = SurfaceStates.MAXIMIZED

    // FIXME get proper size in surface coordinates instead of assume surface space === global space
    const scene = this.session.globals.seat.pointer.scene

    if (scene) {
      const width = scene.canvas.width
      const height = scene.canvas.height

      this.surface.views.forEach(view => view.positionOffset = Point.create(0, 0))
      this.sendConfigure?.(width, height)
    }
  }


  setPid(pid: number): void {
  }

  requestActive() {
    if (this._userSurfaceState.active) {
      return
    }
    this._userSurfaceState = { ...this._userSurfaceState, active: true }
    this.window.wmWindowActivate(this.surface)
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }

  notifyInactive() {
    if (!this._userSurfaceState.active) {
      return
    }
    this._userSurfaceState = { ...this._userSurfaceState, active: false }
    this.window.wmWindowActivate(undefined)
    this.session.userShell.events.updateUserSurface?.(this.userSurface, this._userSurfaceState)
  }
}
