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

import { GrWebGlBufferResource, WlBufferResource } from 'westfield-runtime-server'
import BufferImplementation from '../BufferImplementation'
import Surface from '../Surface'
import WebFS from '../WebFS'
import HTMLCanvasFrame from './HTMLCanvasFrame'

export default class WebGLBuffer implements BufferImplementation<HTMLCanvasFrame> {
  readonly resource: GrWebGlBufferResource
  readonly bufferResource: WlBufferResource
  private readonly _canvas: HTMLCanvasElement
  released = false

  static create(resource: GrWebGlBufferResource, bufferResource: WlBufferResource, webFS: WebFS): WebGLBuffer {
    const canvas = window.document.createElement('canvas')
    const offscreenCanvas = canvas.transferControlToOffscreen()
    resource.offscreenCanvas(webFS.fromOffscreenCanvas(offscreenCanvas))
    return new WebGLBuffer(resource, bufferResource, canvas)
  }

  constructor(resource: GrWebGlBufferResource, bufferResource: WlBufferResource, canvas: HTMLCanvasElement) {
    this.resource = resource
    this.bufferResource = bufferResource
    this._canvas = canvas
  }

  /**
   *
   *  Destroy a buffer. If and how you need to release the backing
   *  storage is defined by the buffer factory interface.
   *
   *  For possible side-effects to a surface, see wl_surface.attach.
   *
   *
   * @param {WlBufferResource} resource
   *
   * @since 1
   *
   */
  destroy(resource: WlBufferResource) {
    this.resource.destroy()
    this.bufferResource.destroy()
    // TODO what more to do here?
  }

  getContents(surface: Surface, serial: number): HTMLCanvasFrame {
    return HTMLCanvasFrame.create(this._canvas)
  }

  release() {
    if (this.released) {
      throw new Error('BUG. Buffer already released.')
    }
    this.bufferResource.release()
    this.bufferResource.client.connection.flush()
    this.released = true
  }

}
