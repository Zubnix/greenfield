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
  WlSeatResource, XdgPopupError,
  XdgPopupRequests,
  XdgPopupResource,
  XdgPositionerConstraintAdjustment,
  XdgSurfaceResource,
  XdgWmBaseError
} from 'westfield-runtime-server'
import { clientHeight, clientWidth } from './browser/attributes'

import Point from './math/Point'
import Seat from './Seat'
import Surface from './Surface'
import SurfaceRole from './SurfaceRole'
import View from './View'
import { XdgPositionerState } from './XdgPositioner'
import XdgSurface from './XdgSurface'

const { none, slideX, slideY, flipX, flipY, resizeX, resizeY } = XdgPositionerConstraintAdjustment

interface InverseY {
  0: 0
  1: 2
  2: 1
  3: 3
  4: 4
  5: 6
  6: 5
  7: 8
  8: 7
}

const inverseY: InverseY = {
  /**
   * none
   */
  0: 0,
  /**
   * top
   */
  1: 2,
  /**
   * bottom
   */
  2: 1,
  /**
   * left
   */
  3: 3,
  /**
   * right
   */
  4: 4,
  /**
   * topLeft
   */
  5: 6,
  /**
   * bottomLeft
   */
  6: 5,
  /**
   * topRight
   */
  7: 8,
  /**
   * bottomRight
   */
  8: 7
}

interface InverseX {
  0: 0
  1: 1
  2: 2
  3: 4;
  4: 3;
  5: 7;
  6: 8;
  7: 5;
  8: 6
}

const inverseX: InverseX = {
  /**
   * none
   */
  0: 0,
  /**
   * top
   */
  1: 1,
  /**
   * bottom
   */
  2: 2,
  /**
   * left
   */
  3: 4,
  /**
   * right
   */
  4: 3,
  /**
   * topLeft
   */
  5: 7,
  /**
   * bottomLeft
   */
  6: 8,
  /**
   * topRight
   */
  7: 5,
  /**
   * bottomRight
   */
  8: 6
}

/**
 *
 *      A popup surface is a short-lived, temporary surface. It can be used to
 *      implement for example menus, popovers, tooltips and other similar user
 *      interface concepts.
 *
 *      A popup can be made to take an explicit grab. See xdg_popup.grab for
 *      details.
 *
 *      When the popup is dismissed, a popup_done event will be sent out, and at
 *      the same time the surface will be unmapped. See the xdg_popup.popup_done
 *      event for details.
 *
 *      Explicitly destroying the xdg_popup object will also dismiss the popup and
 *      unmap the surface. Clients that want to dismiss the popup when another
 *      surface of their own is clicked should dismiss the popup using the destroy
 *      request.
 *
 *      The parent surface must have either the xdg_toplevel or xdg_popup surface
 *      role.
 *
 *      A newly created xdg_popup will be stacked on top of all previously created
 *      xdg_popup surfaces associated with the same xdg_toplevel.
 *
 *      The parent of an xdg_popup must be mapped (see the xdg_surface
 *      description) before the xdg_popup itself.
 *
 *      The x and y arguments passed when creating the popup object specify
 *      where the top left of the popup should be placed, relative to the
 *      local surface coordinates of the parent surface. See
 *      xdg_surface.get_popup. An xdg_popup must intersect with or be at least
 *      partially adjacent to its parent surface.
 *
 *      The client must call wl_surface.commit on the corresponding wl_surface
 *      for the xdg_popup state to take effect.
 *
 */
export default class XdgPopup implements XdgPopupRequests, SurfaceRole {
  readonly resource: XdgPopupResource
  readonly xdgSurface: XdgSurface
  readonly parent: XdgSurfaceResource
  readonly positionerState: XdgPositionerState
  mapped: boolean = false
  dismissed: boolean = false
  private _seat: Seat

  static create(xdgPopupResource: XdgPopupResource, xdgSurface: XdgSurface, parent: XdgSurfaceResource, positionerState: XdgPositionerState, seat: Seat): XdgPopup {
    const xdgPopup = new XdgPopup(xdgPopupResource, xdgSurface, parent, positionerState, seat)
    xdgPopupResource.implementation = xdgPopup
    const surface = xdgSurface.wlSurfaceResource.implementation as Surface
    surface.role = xdgPopup
    xdgPopup.ensureGeometryConstraints(parent, positionerState)
    xdgSurface.emitConfigureDone()
    return xdgPopup
  }

  private constructor(xdgPopupResource: XdgPopupResource, xdgSurface: XdgSurface, parent: XdgSurfaceResource, positionerState: XdgPositionerState, seat: Seat) {
    this.resource = xdgPopupResource
    this.xdgSurface = xdgSurface
    this.parent = parent
    this.positionerState = positionerState
    this._seat = seat
  }

  prepareViewRenderState(view: View): void {
    view.scene.prepareViewRenderState(view)
  }

  onCommit(surface: Surface) {
    if (this.dismissed) {
      return
    }
    this.xdgSurface.updateWindowGeometry(this.xdgSurface.pendingWindowGeometry)

    if (surface.pendingState.bufferContents) {
      if (!this.mapped) {
        this._map(surface)
      }
    } else if (this.mapped) {
      this._dismiss()
    }

    surface.commitPending()
  }

  private _map(surface: Surface) {
    // TODO check if parent is mapped
    for (const surfaceChild of surface.children) {
      if (surfaceChild !== surface.surfaceChildSelf &&
        surfaceChild.surface.role instanceof XdgPopup) {
        this.resource.postError(XdgWmBaseError.notTheTopmostPopup, 'Client tried to map a non-topmost popup')
        console.log('[client-protocol-error] - Client tried to map a non-topmost popup.')
        return
      }
    }

    this.mapped = true
    const parentXdgSurface = this.parent.implementation as XdgSurface

    // set position based on positioner object
    const surfaceSpaceAnchorPoint = this.positionerState.surfaceSpaceAnchorPoint(parentXdgSurface)
    if (surfaceSpaceAnchorPoint) {
      surface.surfaceChildSelf.position = surfaceSpaceAnchorPoint.minus(this.xdgSurface.windowGeometry.position)
    }
  }

  private _dismiss() {
    if (!this.dismissed) {
      this.dismissed = true
      if (this._seat.pointer) {
        const popupGrab = this._seat.pointer.findPopupGrab(this.xdgSurface.wlSurfaceResource)
        if (popupGrab) {
          popupGrab.resolve()
        }
      }
      this.resource.popupDone()
      const parentXdgSurface = this.parent.implementation as XdgSurface
      const parentSurface = parentXdgSurface.wlSurfaceResource.implementation as Surface
      const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface
      parentSurface.removeChild(surface.surfaceChildSelf)
      this._seat.keyboard.focusGained(parentSurface)
    }
  }

  private _updatePopupKeyboardFocus() {
    this._seat.keyboard.focusGained(this.xdgSurface.wlSurfaceResource.implementation as Surface)
    // if the keyboard or focus changes to a different client, we have to dismiss the popup
    this._seat.keyboard.onKeyboardFocusChanged().then(() => {
      if (!this._seat.keyboard.focus || this._seat.keyboard.focus.resource.client !== this.resource.client) {
        this._dismiss()
      }
    })
  }

  destroy(resource: XdgPopupResource) {
    const surface = this.xdgSurface.wlSurfaceResource.implementation as Surface
    for (const surfaceChild of surface.children) {
      if (surfaceChild !== surface.surfaceChildSelf &&
        surfaceChild.surface.role instanceof XdgPopup) {
        resource.postError(XdgWmBaseError.notTheTopmostPopup, 'Client tried to destroy a non-topmost popup')
        console.log('[client-protocol-error] - Client tried to destroy a non-topmost popup.')
        return
      }
    }

    this._dismiss()
    resource.destroy()
  }

  async grab(resource: XdgPopupResource, wlSeatResource: WlSeatResource, serial: number) {
    const seat = wlSeatResource.implementation as Seat
    const pointer = seat.pointer

    // Gtk3 doesn't give us the latest input serial, but the latest button press. Other compositors seem to ignore the serial.
    // if (!seat.isValidInputSerial(serial)) {
    //   this._dismiss()
    //   // window.GREENFIELD_DEBUG && console.log('[client-protocol-warning] - Popup grab input serial mismatch. Ignoring.')
    //   return
    // }

    if (this.mapped) {
      resource.postError(XdgPopupError.invalidGrab, 'Client tried to grab popup after it being mapped.')
      console.error('[client-protocol-error] Client tried to grab popup after it being mapped.')
      return
    }

    const parentXdgSurface = this.parent.implementation as XdgSurface
    const parentWlSurfaceResource = parentXdgSurface.wlSurfaceResource
    const parentSurface = parentWlSurfaceResource.implementation as Surface
    const parentRole = parentSurface.role as SurfaceRole
    if (parentRole instanceof XdgPopup) {
      if (parentRole.dismissed) {
        this._dismiss()
        return
      } else if (!pointer.findPopupGrab(parentWlSurfaceResource)) {
        resource.postError(XdgWmBaseError.invalidPopupParent, 'Popup parent is a popup that did not take an explicit grab.')
        console.error('[client-protocol-error]  Popup parent is a popup that did not take an explicit grab.')
        return
      }
    }

    this._updatePopupKeyboardFocus()
    pointer.popupGrab(this.xdgSurface.wlSurfaceResource).then(() => this._dismiss())
  }

  /**
   * @param {number}serial
   */
  ackConfigure(serial: number) {
    // TODO what to do here?
  }

  ensureGeometryConstraints(parent: XdgSurfaceResource, positionerState: XdgPositionerState) {
    // TODO we can probably rewrite & make this method better using libpixman(?)
    if (positionerState.constraintAdjustment === none) {
      // we can't even
      return
    }

    const parentXdgSurface = parent.implementation as XdgSurface
    const parentSurface = parentXdgSurface.wlSurfaceResource.implementation as Surface
    const primaryParentView = parentSurface.views.find(parentView => parentView.primary)
    if (primaryParentView) {
      let violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
      if (violations && positionerState.size) {
        if (!(violations.topViolation || violations.rightViolation || violations.bottomViolation || violations.leftViolation)) {
          // all fine, no need to reconfigure
          return
        }

        const canFlipX = (positionerState.constraintAdjustment | flipX) !== 0
        const canFlipY = (positionerState.constraintAdjustment | flipY) !== 0
        const canSlideX = (positionerState.constraintAdjustment | slideX) !== 0
        const canSlideY = (positionerState.constraintAdjustment | slideY) !== 0
        const canResizeX = (positionerState.constraintAdjustment | resizeX) !== 0
        const canResizeY = (positionerState.constraintAdjustment | resizeY) !== 0

        // X-Axis:
        // we can't use slide or flip if if the height is greater than the screen height
        if ((violations.leftViolation || violations.rightViolation) &&
          positionerState.size.width < clientWidth()) {
          if (canFlipX) {
            // TODO try flipping
            const oldAnchor = positionerState.anchor
            const oldGravity = positionerState.gravity

            positionerState.anchor = inverseX[oldAnchor]
            positionerState.gravity = inverseX[oldGravity]

            violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
            if (violations && (violations.leftViolation || violations.rightViolation)) {
              // still violating, revert
              positionerState.anchor = oldAnchor
              positionerState.gravity = oldGravity
            }
          }

          // check for violations in case the flip caused the violations to disappear
          violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
          if (violations && (violations.leftViolation || violations.rightViolation) && canSlideX) {
            // try sliding
            const newXDeltaOffset = violations.rightViolation ? -violations.rightViolation : violations.leftViolation
            const oldOffset = positionerState.offset
            positionerState.offset = Point.create(oldOffset.x + newXDeltaOffset, oldOffset.y)
            // no need to check if there is still a X violation as we already ensured the width < max width
          }
        }

        // check for violations in case the flip or slide caused the violations to disappear
        violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
        if (violations && (violations.leftViolation || violations.rightViolation) && canResizeX) {
          if (violations.leftViolation) {
            const oldOffset = positionerState.offset
            positionerState.offset = Point.create(oldOffset.x + violations.leftViolation, oldOffset.y)
            positionerState.size.x1 = positionerState.size.x1 - violations.leftViolation
          }

          if (violations.rightViolation) {
            positionerState.size.x1 = positionerState.size.x1 - violations.rightViolation
          }
        }

        // Y-Axis:
        // we can't use slide or flip if if the height is greater than the screen height
        violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
        if (violations && (violations.topViolation || violations.bottomViolation) &&
          positionerState.size.height < clientHeight()) {
          if (canFlipY) {
            const oldAnchor = positionerState.anchor
            const oldGravity = positionerState.gravity

            positionerState.anchor = inverseY[oldAnchor]
            positionerState.gravity = inverseY[oldGravity]

            violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
            if (violations && (violations.topViolation || violations.bottomViolation)) {
              // still violating, revert
              positionerState.anchor = oldAnchor
              positionerState.gravity = oldGravity
            }
          }

          // check for violations in case the flip caused the violations to disappear
          violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
          if (violations && (violations.topViolation || violations.bottomViolation) && canSlideY) {
            // try sliding
            const newYDeltaOffset = violations.bottomViolation ? -violations.bottomViolation : violations.topViolation
            const oldOffset = positionerState.offset
            positionerState.offset = Point.create(oldOffset.x, oldOffset.y + newYDeltaOffset)
            // no need to check if there is still a Y violation as we already ensured the height < max height
          }
        }

        // check for violations in case the flip or slide caused the violations to disappear
        violations = positionerState.checkScreenConstraints(parentXdgSurface, primaryParentView)
        if (violations && (violations.topViolation || violations.bottomViolation) && canResizeY) {
          if (violations.topViolation) {
            const oldOffset = positionerState.offset
            positionerState.offset = Point.create(oldOffset.x, oldOffset.y + violations.topViolation)
            positionerState.size.y1 = positionerState.size.y1 - violations.topViolation
          }

          if (violations.bottomViolation) {
            positionerState.size.y1 = positionerState.size.y1 - violations.bottomViolation
          }
        }

        const { x0: x, y0: y, width, height } = positionerState.size
        this.resource.configure(x, y, width, height)
      }
    }
  }
}
