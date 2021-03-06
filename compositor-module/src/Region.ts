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

import { WlRegionRequests, WlRegionResource } from 'westfield-runtime-server'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { lib } from './lib'
import Point from './math/Point'
import Rect from './math/Rect'

// TODO write typedefinitions for libpixman

export function createPixmanRegion(): number {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const pixmanRegion = lib.pixman._malloc(20) // region struct is pointer + 4*uint32 = 5*4 = 20
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_init(pixmanRegion)
  return pixmanRegion
}

export function fini(pixmanRegion: number): void {
  // FIXME double free somewhere in the code, so disable this for now
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_fini(pixmanRegion)
}

export function init(pixmanRegion: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_init(pixmanRegion)
}

export function initInfinite(pixmanRegion: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_init_rect(pixmanRegion, -0x3fffffff, -0x3fffffff, 0x7fffffff, 0x7fffffff)
}

export function initRect(pixmanRegion: number, rect: Rect): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_init_rect(pixmanRegion, rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0)
}

export function union(result: number, left: number, right: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_union(result, left, right)
}

export function intersect(result: number, left: number, right: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_intersect(result, left, right)
}

export function unionRect(result: number, left: number, x: number, y: number, width: number, height: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_union_rect(result, left, x, y, width, height)
}

export function destroyPixmanRegion(pixmanRegion: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._free(pixmanRegion)
}

export function contains(pixmanRegion: number, point: Point): boolean {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return lib.pixman._pixman_region32_contains_point(pixmanRegion, point.x, point.y, null) !== 0
}

export function copyTo(destination: number, source: number): void {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._pixman_region32_copy(destination, source)
}

// TODO move to stand-alone exported function
export function rectangles(pixmanRegion: number): Rect[] {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const nroRectsPtr = lib.pixman._malloc(4) // uint32
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const pixmanBoxPtr = lib.pixman._pixman_region32_rectangles(pixmanRegion, nroRectsPtr)
  const rectangles = []
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const nroRects = new Uint32Array(lib.pixman.HEAPU8.buffer, nroRectsPtr, 1)[0]
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const rectangleStructs = new Uint32Array(lib.pixman.HEAPU8.buffer, pixmanBoxPtr, 4 * nroRects)
  for (let i = 0; i < nroRects; i++) {
    const x0 = rectangleStructs[i * 4]
    const y0 = rectangleStructs[i * 4 + 1]
    const x1 = rectangleStructs[i * 4 + 2]
    const y1 = rectangleStructs[i * 4 + 3]
    rectangles.push(Rect.create(x0, y0, x1, y1))
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  lib.pixman._free(nroRectsPtr)

  return rectangles
}

class Region implements WlRegionRequests {
  readonly resource: WlRegionResource
  readonly pixmanRegion: number

  static create(wlRegionResource: WlRegionResource): Region {
    const pixmanRegion = createPixmanRegion()
    const region = new Region(wlRegionResource, pixmanRegion)
    wlRegionResource.implementation = region
    wlRegionResource.onDestroy().then(() => {
      fini(pixmanRegion)
      destroyPixmanRegion(pixmanRegion)
    })
    return region
  }

  private constructor(wlRegionResource: WlRegionResource, pixmanRegion: number) {
    this.resource = wlRegionResource
    this.pixmanRegion = pixmanRegion
  }

  destroy(resource: WlRegionResource): void {
    resource.destroy()
  }

  add(resource: WlRegionResource, x: number, y: number, width: number, height: number): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    lib.pixman._pixman_region32_union_rect(this.pixmanRegion, this.pixmanRegion, x, y, width, height)
  }

  subtract(resource: WlRegionResource, x: number, y: number, width: number, height: number): void {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const deltaPixmanRegion = lib.pixman._malloc(20)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    lib.pixman._pixman_region32_init_rect(deltaPixmanRegion, x, y, width, height)
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    lib.pixman._pixman_region32_subtract(this.pixmanRegion, this.pixmanRegion, deltaPixmanRegion)
    fini(deltaPixmanRegion)
    destroyPixmanRegion(deltaPixmanRegion)
  }
}

export default Region
