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
  WlSubsurfaceError,
  WlSubsurfaceRequests,
  WlSubsurfaceResource,
  WlSurfaceResource
} from 'westfield-runtime-server'
import BufferImplementation from './BufferImplementation'

import Point from './math/Point'
import Region from './Region'
import Surface, { mergeSurfaceState, SurfaceState } from './Surface'
import SurfaceRole from './SurfaceRole'
import View from './View'

/**
 *
 *            An additional interface to a wl_surface object, which has been
 *            made a sub-surface. A sub-surface has one parent surface. A
 *            sub-surface's size and position are not limited to that of the parent.
 *            Particularly, a sub-surface is not automatically clipped to its
 *            parent's area.
 *
 *            A sub-surface becomes mapped, when a non-NULL wl_buffer is applied
 *            and the parent surface is mapped. The order of which one happens
 *            first is irrelevant. A sub-surface is hidden if the parent becomes
 *            hidden, or if a NULL wl_buffer is applied. These rules apply
 *            recursively through the tree of surfaces.
 *
 *            The behaviour of a wl_surface.commit request on a sub-surface
 *            depends on the sub-surface's mode. The possible modes are
 *            synchronized and desynchronized, see methods
 *            wl_subsurface.set_sync and wl_subsurface.set_desync. Synchronized
 *            mode caches the wl_surface state to be applied when the parent's
 *            state gets applied, and desynchronized mode applies the pending
 *            wl_surface state directly. A sub-surface is initially in the
 *            synchronized mode.
 *
 *            Sub-surfaces have also other kind of state, which is managed by
 *            wl_subsurface requests, as opposed to wl_surface requests. This
 *            state includes the sub-surface position relative to the parent
 *            surface (wl_subsurface.set_position), and the stacking order of
 *            the parent and its sub-surfaces (wl_subsurface.place_above and
 *            .place_below). This state is applied when the parent surface's
 *            wl_surface state is applied, regardless of the sub-surface's mode.
 *            As the exception, set_sync and set_desync are effective immediately.
 *
 *            The main surface can be thought to be always in desynchronized mode,
 *            since it does not have a parent in the sub-surfaces sense.
 *
 *            Even if a sub-surface is in desynchronized mode, it will behave as
 *            in synchronized mode, if its parent surface behaves as in
 *            synchronized mode. This rule is applied recursively throughout the
 *            tree of surfaces. This means, that one can set a sub-surface into
 *            synchronized mode, and then assume that all its child and grand-child
 *            sub-surfaces are synchronized, too, without explicitly setting them.
 *
 *            If the wl_surface associated with the wl_subsurface is destroyed, the
 *            wl_subsurface object becomes inert. Note, that destroying either object
 *            takes effect immediately. If you need to synchronize the removal
 *            of a sub-surface to the parent surface update, unmap the sub-surface
 *            first by attaching a NULL wl_buffer, update parent, and then destroy
 *            the sub-surface.
 *
 *            If the parent wl_surface object is destroyed, the sub-surface is
 *            unmapped.
 *
 */
export default class Subsurface implements WlSubsurfaceRequests, SurfaceRole {
  pendingPosition?: Point = Point.create(0, 0)

  private sync: boolean = true
  private cacheDirty = false
  private readonly cachedState: SurfaceState = {
    damageRects: [],
    bufferDamageRects: [],
    bufferScale: 1,
    bufferTransform: 0,
    dx: 0,
    dy: 0,
    inputPixmanRegion: Region.createPixmanRegion(),
    opaquePixmanRegion: Region.createPixmanRegion(),
    subsurfaceChildren: [],
    frameCallbacks: [],
    bufferResourceDestroyListener: () => {
      this.cachedState.buffer = undefined
      // this.cachedState.bufferContents = undefined
    }
  }
  private _inert: boolean = false

  static create(parentWlSurfaceResource: WlSurfaceResource, wlSurfaceResource: WlSurfaceResource, wlSubsurfaceResource: WlSubsurfaceResource): Subsurface {
    const subsurface = new Subsurface(parentWlSurfaceResource, wlSurfaceResource, wlSubsurfaceResource)
    wlSubsurfaceResource.implementation = subsurface

    wlSurfaceResource.onDestroy().then(() => {
      subsurface._inert = true
    })

    parentWlSurfaceResource.onDestroy().then(() => {
      // TODO unmap
    });

    // TODO sync viewable/hidden state with parent
    (wlSurfaceResource.implementation as Surface).role = subsurface

    return subsurface
  }

  private constructor(
    public readonly parentWlSurfaceResource: WlSurfaceResource,
    public readonly wlSurfaceResource: WlSurfaceResource,
    public readonly resource: WlSubsurfaceResource
  ) {
    const surface = this.wlSurfaceResource.implementation as Surface
    mergeSurfaceState(this.cachedState, surface.state)
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
  }

  private commitCache(surface: Surface) {
    surface.pendingState = { ...this.cachedState }
    this.cachedState.damageRects = []
    this.cachedState.bufferDamageRects = []
    this.cachedState.frameCallbacks = []
    this.cacheDirty = false
    surface.commitPending()
  }

  onParentCommit() {
    if (this._inert) {
      return
    }

    const surface = this.wlSurfaceResource.implementation as Surface
    // sibling stacking order & position is committed by the parent itself so no need to do it here.

    if (this.effectiveSync && this.cacheDirty) {
      this.commitCache(surface)
    }
    // render triggered by parent.
  }

  private commitPendingToCache(surface: Surface) {
    const { dx, dy } = this.cachedState

    if (this.cacheDirty
      && this.cachedState.buffer
      && this.cachedState.buffer?.id !== surface.pendingState.buffer?.id) {
      const bufferImplementation = this.cachedState.buffer.implementation as BufferImplementation<any>
      if (!bufferImplementation.released) {
        bufferImplementation.release()
      }
    }
    mergeSurfaceState(this.cachedState, surface.pendingState)
    if (this.cachedState.buffer) {
      const bufferImplementation = this.cachedState.buffer.implementation as BufferImplementation<any>
      bufferImplementation.released = false
    }

    surface.pendingState.damageRects = []
    surface.pendingState.bufferDamageRects = []
    surface.pendingState.frameCallbacks = []
    this.cachedState.dx = dx + surface.pendingState.dx
    this.cachedState.dy = dy + surface.pendingState.dy
    this.cacheDirty = true
  }


  onCommit(surface: Surface) {
    if (this._inert) {
      return
    }

    if (this.effectiveSync) {
      this.commitPendingToCache(surface)
    } else if (this.cacheDirty) {
      this.commitPendingToCache(surface)
      this.commitCache(surface)
    } else {
      surface.commitPending()
    }
  }

  destroy(resource: WlSubsurfaceResource) {
    resource.destroy()
  }

  setPosition(resource: WlSubsurfaceResource, x: number, y: number) {
    if (this._inert) {
      return
    }

    this.pendingPosition = Point.create(x, y)
  }

  placeAbove(resource: WlSubsurfaceResource, sibling: WlSurfaceResource) {
    const parentSurface = this.parentWlSurfaceResource.implementation as Surface
    const siblingSurface = sibling.implementation as Surface
    const siblingSurfaceChildSelf = siblingSurface.surfaceChildSelf
    if (!parentSurface.state.subsurfaceChildren.includes(siblingSurfaceChildSelf) ||
      siblingSurface === parentSurface) {
      resource.postError(WlSubsurfaceError.badSurface, 'Surface is not a sibling or the parent.')
      console.log('[client-protocol-error] - Surface is not a sibling or the parent.')
      return
    }

    if (this._inert) {
      return
    }

    const surface = this.wlSurfaceResource.implementation as Surface

    const currentIdx = parentSurface.pendingState.subsurfaceChildren.indexOf(surface.surfaceChildSelf)
    parentSurface.pendingState.subsurfaceChildren.splice(currentIdx, 1)

    const siblingIdx = parentSurface.pendingState.subsurfaceChildren.indexOf(siblingSurfaceChildSelf)
    const newIdx = siblingIdx + 1
    parentSurface.pendingState.subsurfaceChildren.splice(newIdx, 0, surface.surfaceChildSelf)
  }

  placeBelow(resource: WlSubsurfaceResource, sibling: WlSurfaceResource) {
    if (this._inert) {
      return
    }

    const parentSurface = this.parentWlSurfaceResource.implementation as Surface
    const surface = this.wlSurfaceResource.implementation as Surface

    const currentIdx = parentSurface.pendingState.subsurfaceChildren.indexOf(surface.surfaceChildSelf)
    parentSurface.pendingState.subsurfaceChildren.splice(currentIdx, 1)

    const siblingSurface = sibling.implementation as Surface
    const newIdx = parentSurface.pendingState.subsurfaceChildren.indexOf(siblingSurface.surfaceChildSelf)
    parentSurface.pendingState.subsurfaceChildren.splice(newIdx, 0, surface.surfaceChildSelf)
  }

  private get effectiveSync(): boolean {
    return this.sync || this._parentEffectiveSync
  }

  private get _parentEffectiveSync(): boolean {
    let parentEffectiveSync = false

    const parentSurface = this.parentWlSurfaceResource.implementation as Surface
    const parentRole = parentSurface.role
    if (parentRole && parentRole instanceof Subsurface) {
      parentEffectiveSync = parentRole.effectiveSync
    }

    return parentEffectiveSync
  }

  setSync(resource: WlSubsurfaceResource) {
    if (this._inert) {
      return
    }

    this.sync = true
  }

  setDesync(resource: WlSubsurfaceResource) {
    if (this._inert) {
      return
    }

    this.sync = false
    this.onCommit(this.wlSurfaceResource.implementation as Surface)
  }
}
