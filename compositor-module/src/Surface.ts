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

import {
  WlBufferResource,
  WlCallbackResource,
  WlOutputTransform,
  WlRegionResource,
  WlSurfaceError,
  WlSurfaceRequests,
  WlSurfaceResource
} from 'westfield-runtime-server'
import BufferContents from './BufferContents'
import BufferImplementation from './BufferImplementation'
import Callback from './Callback'
import Mat4 from './math/Mat4'
import Point from './math/Point'
import Rect from './math/Rect'
import {
  _180,
  _270,
  _90,
  FLIPPED,
  FLIPPED_180,
  FLIPPED_270,
  FLIPPED_90,
  NORMAL
} from './math/Transformations'
import Region from './Region'
import H264BufferContentDecoder from './render/H264BufferContentDecoder'
import Renderer from './render/Renderer'
import Scene from './render/Scene'
import Session from './Session'
import Size from './Size'
import Subsurface from './Subsurface'
import { createSurfaceChild, SurfaceChild } from './SurfaceChild'
import SurfaceRole from './SurfaceRole'

import View from './View'

export interface SurfaceState {
  damageRects: Rect[]
  bufferDamageRects: Rect[]
  readonly opaquePixmanRegion: number
  readonly inputPixmanRegion: number
  dx: number
  dy: number
  bufferTransform: number
  bufferScale: number

  bufferResourceDestroyListener: () => void
  buffer?: WlBufferResource
  bufferContents?: BufferContents<any>

  subsurfaceChildren: SurfaceChild[]

  frameCallbacks: Callback[]
}

export function mergeSurfaceState(targetState: SurfaceState, sourceState: SurfaceState) {
  targetState.dx = sourceState.dx
  targetState.dy = sourceState.dy

  Region.fini(targetState.inputPixmanRegion)
  Region.init(targetState.inputPixmanRegion)
  Region.copyTo(targetState.inputPixmanRegion, sourceState.inputPixmanRegion)

  Region.fini(targetState.opaquePixmanRegion)
  Region.init(targetState.opaquePixmanRegion)
  Region.copyTo(targetState.opaquePixmanRegion, sourceState.opaquePixmanRegion)

  targetState.bufferDamageRects = [...sourceState.bufferDamageRects]

  targetState.bufferTransform = sourceState.bufferTransform
  targetState.bufferScale = sourceState.bufferScale

  targetState.buffer?.removeDestroyListener(targetState.bufferResourceDestroyListener)
  targetState.buffer = sourceState.buffer
  targetState.buffer?.addDestroyListener(targetState.bufferResourceDestroyListener)

  targetState.bufferContents = sourceState.bufferContents

  targetState.subsurfaceChildren = [...sourceState.subsurfaceChildren]

  targetState.frameCallbacks = [...sourceState.frameCallbacks, ...targetState.frameCallbacks]
}

/**
 * @type {{transformation: Mat4, inverseTransformation:Mat4}[]}
 */
const bufferTransformations = [
  { transformation: NORMAL, inverseTransformation: NORMAL.invert() }, // 0
  { transformation: _90, inverseTransformation: _90.invert() }, // 1
  { transformation: _180, inverseTransformation: _180.invert() }, // 2
  { transformation: _270, inverseTransformation: _270.invert() }, // 3
  { transformation: FLIPPED, inverseTransformation: FLIPPED.invert() }, // 4
  { transformation: FLIPPED_90, inverseTransformation: FLIPPED_90.invert() }, // 5
  { transformation: FLIPPED_180, inverseTransformation: FLIPPED_180.invert() }, // 6
  { transformation: FLIPPED_270, inverseTransformation: FLIPPED_270.invert() } // 7
]

let surfaceH264DecodeId = 0

/**
 *
 *            A surface is a rectangular area that is displayed on the screen.
 *            It has a location, size and pixel contents.
 *
 *            The size of a surface (and relative positions on it) is described
 *            in surface-local coordinates, which may differ from the buffer
 *            coordinates of the pixel content, in case a buffer_transform
 *            or a buffer_scale is used.
 *
 *            A surface without a "role" is fairly useless: a compositor does
 *            not know where, when or how to present it. The role is the
 *            purpose of a wl_surface. Examples of roles are a cursor for a
 *            pointer (as set by wl_pointer.set_cursor), a drag icon
 *            (wl_data_device.start_drag), a sub-surface
 *            (wl_subcompositor.get_subsurface), and a window as defined by a
 *            shell protocol (e.g. wl_shell.get_shell_surface).
 *
 *            A surface can have only one role at a time. Initially a
 *            wl_surface does not have a role. Once a wl_surface is given a
 *            role, it is set permanently for the whole lifetime of the
 *            wl_surface object. Giving the current role again is allowed,
 *            unless explicitly forbidden by the relevant interface
 *            specification.
 *
 *            Surface roles are given by requests in other interfaces such as
 *            wl_pointer.set_cursor. The request should explicitly mention
 *            that this request gives a role to a wl_surface. Often, this
 *            request also creates a new protocol object that represents the
 *            role and adds additional functionality to wl_surface. When a
 *            client wants to destroy a wl_surface, they must destroy this 'role
 *            object' before the wl_surface.
 *
 *            Destroying the role object does not remove the role from the
 *            wl_surface, but it may stop the wl_surface from "playing the role".
 *            For instance, if a wl_subsurface object is destroyed, the wl_surface
 *            it was created for will be unmapped and forget its position and
 *            z-order. It is allowed to create a wl_subsurface for the same
 *            wl_surface again, but it is not allowed to use the wl_surface as
 *            a cursor (cursor is a different role than sub-surface, and role
 *            switching is not allowed).
 */
class Surface implements WlSurfaceRequests {
  readonly surfaceChildSelf: SurfaceChild = createSurfaceChild(this)
  destroyed: boolean = false
  damaged: boolean = false
  readonly state: SurfaceState = {
    bufferContents: undefined,
    buffer: undefined,
    damageRects: [],
    bufferDamageRects: [],
    bufferScale: 1,
    bufferTransform: 0,
    dx: 0,
    dy: 0,
    inputPixmanRegion: Region.createPixmanRegion(),
    opaquePixmanRegion: Region.createPixmanRegion(),
    subsurfaceChildren: [this.surfaceChildSelf],
    frameCallbacks: [],
    bufferResourceDestroyListener: () => {
      this.state.buffer = undefined
      this.state.bufferContents = undefined
    }
  }
  pendingState: SurfaceState = {
    bufferContents: undefined,
    buffer: undefined,
    damageRects: [],
    bufferDamageRects: [],
    bufferScale: 1,
    bufferTransform: 0,
    dx: 0,
    dy: 0,
    inputPixmanRegion: Region.createPixmanRegion(),
    opaquePixmanRegion: Region.createPixmanRegion(),
    subsurfaceChildren: [this.surfaceChildSelf],
    frameCallbacks: [],
    bufferResourceDestroyListener: () => {
      this.pendingState.buffer = undefined
      this.pendingState.bufferContents = undefined
    }
  }
  views: View[] = []
  hasKeyboardInput: boolean = true
  hasPointerInput: boolean = true
  hasTouchInput: boolean = true
  role?: SurfaceRole

  bufferTransformation: Mat4 = Mat4.IDENTITY()
  inverseBufferTransformation: Mat4 = Mat4.IDENTITY()

  readonly pixmanRegion: number = Region.createPixmanRegion()
  size?: Size

  private readonly _surfaceChildren: SurfaceChild[] = []
  private _h264BufferContentDecoder?: H264BufferContentDecoder
  private renderSource?: () => void

  static create(wlSurfaceResource: WlSurfaceResource, session: Session): Surface {
    const surface = new Surface(wlSurfaceResource, session.renderer, session)
    Region.initInfinite(surface.state.opaquePixmanRegion)
    Region.initInfinite(surface.state.inputPixmanRegion)
    Region.initInfinite(surface.pendingState.opaquePixmanRegion)
    Region.initInfinite(surface.pendingState.inputPixmanRegion)
    Region.initRect(surface.pixmanRegion, Rect.create(0, 0, 0, 0))
    wlSurfaceResource.implementation = surface

    wlSurfaceResource.onDestroy().then(() => {
      Region.fini(surface.state.opaquePixmanRegion)
      Region.fini(surface.state.inputPixmanRegion)
      Region.fini(surface.pendingState.opaquePixmanRegion)
      Region.fini(surface.pendingState.inputPixmanRegion)
      Region.fini(surface.pixmanRegion)

      Region.destroyPixmanRegion(surface.state.opaquePixmanRegion)
      Region.destroyPixmanRegion(surface.state.inputPixmanRegion)
      Region.destroyPixmanRegion(surface.pendingState.opaquePixmanRegion)
      Region.destroyPixmanRegion(surface.pendingState.inputPixmanRegion)
      Region.destroyPixmanRegion(surface.pixmanRegion)

      surface._handleDestruction()
    })

    return surface
  }

  private constructor(public readonly resource: WlSurfaceResource, public readonly renderer: Renderer, public readonly session: Session) {
  }

  get h264BufferContentDecoder(): H264BufferContentDecoder {
    if (this._h264BufferContentDecoder === undefined) {
      this._h264BufferContentDecoder = H264BufferContentDecoder.create(`${surfaceH264DecodeId++}`)
      return this._h264BufferContentDecoder
    } else {
      return this._h264BufferContentDecoder
    }
  }

  get children(): SurfaceChild[] {
    return this.state.subsurfaceChildren.concat(this._surfaceChildren)
  }

  isWithinInputRegion(surfacePoint: Point): boolean {
    const withinInput = Region.contains(this.state.inputPixmanRegion, surfacePoint)
    const withinSurface = Region.contains(this.pixmanRegion, surfacePoint)
    return withinSurface && withinInput
  }

  private _applyBufferTransformWithPositionCorrection(newBufferTransform: number, bufferTransformation: Mat4) {
    switch (newBufferTransform) {
      case 3: // 270
      case 4: { // flipped
        this.bufferTransformation = bufferTransformation.timesMat4(Mat4.translation(this.size?.w ?? 0, 0).invert())
        this.inverseBufferTransformation = this.bufferTransformation.invert()
        break
      }
      case 2: // 180
      case 5: { // 90 flipped
        this.bufferTransformation = bufferTransformation.timesMat4(Mat4.translation(this.size?.w ?? 0, this.size?.h ?? 0).invert())
        this.inverseBufferTransformation = this.bufferTransformation.invert()
        break
      }
      case 1: // 90
      case 6: { // 180 flipped
        this.bufferTransformation = bufferTransformation.timesMat4(Mat4.translation(0, this.size?.h ?? 0).invert())
        this.inverseBufferTransformation = this.bufferTransformation.invert()
        break
      }
      case 0: // normal
      case 7: { // 270 flipped
        this.bufferTransformation = bufferTransformation.timesMat4(Mat4.translation(0, 0))
        this.inverseBufferTransformation = this.bufferTransformation.invert()
        break
      }
    }
  }

  /**
   * Called during commit
   * @private
   */
  private calculateDerivedPendingState() {
    const oldBufferSize = this.state.bufferContents?.size ?? Size.create(0, 0)
    this.state.bufferContents?.validateSize?.()
    const newBufferSize = this.pendingState.bufferContents?.size ?? Size.create(0, 0)

    if (this.pendingState.bufferScale !== this.state.bufferScale ||
      this.pendingState.bufferTransform !== this.state.bufferTransform ||
      oldBufferSize.w !== newBufferSize.w ||
      oldBufferSize.h !== newBufferSize.h) {
      const transformations = bufferTransformations[this.pendingState.bufferTransform]
      const bufferTransformation = this.pendingState.bufferScale === 1 ? transformations.transformation : transformations.transformation.timesMat4(Mat4.scalar(this.pendingState.bufferScale))
      const inverseBufferTransformation = this.pendingState.bufferScale === 1 ? transformations.inverseTransformation : bufferTransformation.invert()

      const surfacePoint = inverseBufferTransformation.timesPoint(Point.create(newBufferSize.w, newBufferSize.h))
      this.size = Size.create(Math.abs(surfacePoint.x), Math.abs(surfacePoint.y))
      Region.fini(this.pixmanRegion)
      Region.initRect(this.pixmanRegion, Rect.create(0, 0, this.size.w, this.size.h))

      this._applyBufferTransformWithPositionCorrection(this.pendingState.bufferTransform, bufferTransformation)
    }
  }

  createTopLevelView(scene: Scene): View {
    const topLevelView = this.createView(scene)
    scene.topLevelViews = [...scene.topLevelViews, topLevelView]
    topLevelView.onDestroy().then(() => {
      scene.topLevelViews = scene.topLevelViews.filter(view => view !== topLevelView)
      if (scene.pointerView === topLevelView) {
        scene.pointerView = undefined
      }
      scene.render()
    })

    return topLevelView
  }

  createView(scene: Scene): View {
    const bufferSize = this.state.bufferContents ? this.state.bufferContents.size : Size.create(0, 0)
    const view = View.create(this, bufferSize.w, bufferSize.h, scene)
    if (this.views.length === 0) {
      view.primary = true
    }
    this.views.push(view)

    view.onDestroy().then(() => {
      const idx = this.views.indexOf(view)
      if (idx > -1) {
        this.views.splice(idx, 1)
      }
    })

    this.children.forEach(surfaceChild => this.ensureChildView(surfaceChild, view))
    return view
  }

  private ensureChildView(surfaceChild: SurfaceChild, view: View): View | undefined {
    if (surfaceChild.surface === this) {
      return undefined
    }

    const childView = surfaceChild.surface.createView(view.scene)
    childView.parent = view

    return childView
  }

  addSubsurface(surfaceChild: SurfaceChild) {
    this._addChild(surfaceChild, this.state.subsurfaceChildren)
    this.pendingState.subsurfaceChildren.push(surfaceChild)

    surfaceChild.surface.resource.onDestroy().then(() => {
      this.removeSubsurface(surfaceChild)
    })
  }

  removeSubsurface(surfaceChild: SurfaceChild) {
    this._removeChild(surfaceChild, this.state.subsurfaceChildren)
    this._removeChild(surfaceChild, this.pendingState.subsurfaceChildren)
  }

  addChild(surfaceChild: SurfaceChild): View[] {
    return this._addChild(surfaceChild, this._surfaceChildren)
  }

  addToplevelChild(surfaceChild: SurfaceChild) {
    this._surfaceChildren.push(surfaceChild)

    const primaryChildView = surfaceChild.surface.views.find(view => view.primary)
    const primaryView = this.views.find(view => view.primary)

    if (primaryChildView && primaryView) {
      primaryChildView.parent = primaryView
      surfaceChild.surface.resource.onDestroy().then(() => this.removeChild(surfaceChild))
    }
  }

  removeChild(surfaceChild: SurfaceChild) {
    this._removeChild(surfaceChild, this._surfaceChildren)
  }

  private _addChild(surfaceChild: SurfaceChild, siblings: SurfaceChild[]): View[] {
    siblings.push(surfaceChild)

    const childViews: View[] = []
    this.views.forEach(view => {
      const childView = this.ensureChildView(surfaceChild, view)
      if (childView) {
        childViews.push(childView)
      }
    })
    surfaceChild.surface.resource.onDestroy().then(() => this.removeChild(surfaceChild))
    return childViews
  }

  private _removeChild(surfaceChild: SurfaceChild, siblings: SurfaceChild[]) {
    const index = siblings.indexOf(surfaceChild)
    if (index > -1) {
      siblings.splice(index, 1)
    }
  }

  destroy(resource: WlSurfaceResource) {
    // this._handleDestruction()
    this.destroyed = true
    resource.destroy()
  }

  private _handleDestruction() {
    this.destroyed = true
    this.views.forEach(view => view.destroy())
    this._h264BufferContentDecoder?.destroy()
  }

  attach(resource: WlSurfaceResource, buffer: WlBufferResource | undefined, x: number, y: number) {
    this.pendingState.dx = x
    this.pendingState.dy = y

    this.pendingState.buffer?.removeDestroyListener(this.pendingState.bufferResourceDestroyListener)
    this.pendingState.bufferContents = undefined
    this.pendingState.buffer = buffer
    this.pendingState.buffer?.addDestroyListener(this.pendingState.bufferResourceDestroyListener)
  }

  damage(resource: WlSurfaceResource, x: number, y: number, width: number, height: number) {
    this.pendingState.damageRects.push(Rect.create(x, y, x + width, y + height))
  }

  frame(resource: WlSurfaceResource, callback: number) {
    this.pendingState.frameCallbacks.push(Callback.create(new WlCallbackResource(resource.client, callback, 1)))
  }

  setOpaqueRegion(resource: WlSurfaceResource, regionResource: WlRegionResource | undefined) {
    Region.fini(this.pendingState.opaquePixmanRegion)
    if (regionResource) {
      const region = regionResource.implementation as Region
      Region.init(this.pendingState.opaquePixmanRegion)
      Region.copyTo(this.pendingState.opaquePixmanRegion, region.pixmanRegion)
    } else {
      Region.initInfinite(this.pendingState.opaquePixmanRegion)
    }
  }

  setInputRegion(resource: WlSurfaceResource, regionResource: WlRegionResource | undefined) {
    Region.fini(this.pendingState.inputPixmanRegion)
    if (regionResource) {
      const region = regionResource.implementation as Region
      Region.init(this.pendingState.inputPixmanRegion)
      Region.copyTo(this.pendingState.inputPixmanRegion, region.pixmanRegion)
    } else {
      Region.initInfinite(this.pendingState.inputPixmanRegion)
    }
  }

  toSurfaceSpace(bufferPoint: Point): Point {
    return this.inverseBufferTransformation.timesPoint(bufferPoint)
  }

  async commit(resource: WlSurfaceResource, serial?: number) {
    // const startCommit = Date.now()
    const bufferImplementation = this.pendingState.buffer?.implementation as BufferImplementation<BufferContents<any> | Promise<BufferContents<any>>> | undefined
    if (bufferImplementation && this.pendingState.bufferContents === undefined) {
      try {
        // console.log('|- Awaiting buffer contents.')
        // const startBufferContents = Date.now()
        this.pendingState.bufferContents = await bufferImplementation.getContents(this, serial)
        // console.log(`|--> Buffer contents took ${Date.now() - startBufferContents}ms`)
        if (this.destroyed) {
          return
        }
      } catch (e) {
        console.warn(`[surface: ${resource.id}] - Failed to receive buffer contents.`, e.toString())
      }
    }
    this.role?.onCommit(this)
  }

  /**
   * Called during commit
   */
  commitPending(): void {
    if (this.state.subsurfaceChildren.length > 1) {
      this.state.subsurfaceChildren = this.pendingState.subsurfaceChildren.slice()

      this.state.subsurfaceChildren.map(surfaceChild => {
        const siblingSurface = surfaceChild.surface
        if (siblingSurface !== this) {
          const siblingSubsurface = siblingSurface.role as Subsurface
          // cascade scene update to subsurface children
          if (siblingSubsurface.pendingPosition) {
            surfaceChild.position = siblingSubsurface.pendingPosition
            siblingSubsurface.pendingPosition = undefined
          }
          siblingSubsurface.onParentCommit()
        }
      })
    }

    this.calculateDerivedPendingState()
    // release old buffer if we're replacing it and it hasn't been released yet
    if (this.state.buffer && this.state.buffer?.id !== this.pendingState.buffer?.id) {
      const bufferImplementation = this.state.buffer.implementation as BufferImplementation<any>
      if (!bufferImplementation.released) {
        bufferImplementation.release()
      }
    }
    mergeSurfaceState(this.state, this.pendingState)
    this.damaged = true
    if (this.state.buffer) {
      const bufferImplementation = this.state.buffer.implementation as BufferImplementation<any>
      bufferImplementation.released = false
    }
    this.pendingState.damageRects = []
    this.pendingState.bufferDamageRects = []
    this.pendingState.frameCallbacks = []
    this.renderViews()
    this.resource.client.connection.flush()
  }

  private renderViews() {
    if (this.renderSource) {
      return
    }
    this.renderSource = this.resource.client.connection.addIdleHandler(() => {
      this.renderSource = undefined
      if (this.views.length > 0) {
        new Set(this.views.map(view => {
          this.role?.prepareViewRenderState(view)
          return view.scene
        })).forEach(scene => {
          scene.registerFrameCallbacks(this.state.frameCallbacks)
          scene.render()
        })
        this.state.frameCallbacks = []
      }
    })
  }

  setBufferTransform(resource: WlSurfaceResource, transform: number) {
    if (!(transform in WlOutputTransform)) {
      resource.postError(WlSurfaceError.invalidTransform, 'Buffer transform value is invalid.')
      console.log('[client-protocol-error] - Buffer transform value is invalid.')
      return undefined
    }

    this.pendingState.bufferTransform = transform
  }

  setBufferScale(resource: WlSurfaceResource, scale: number) {
    if (scale < 1) {
      resource.postError(WlSurfaceError.invalidScale, 'Buffer scale value is invalid.')
      console.log('[client-protocol-error] - Buffer scale value is invalid.')
    }

    this.pendingState.bufferScale = scale
  }

  damageBuffer(resource: WlSurfaceResource, x: number, y: number, width: number, height: number) {
    this.pendingState.bufferDamageRects.push(Rect.create(x, y, x + width, y + height))
  }
}

export default Surface
