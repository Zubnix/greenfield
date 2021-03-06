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

import BufferContents from '../BufferContents'
import Size from '../Size'

export type OpaqueAndAlphaPlanes = {
  opaque: { buffer: Uint8Array; width: number; height: number }
  alpha?: { buffer: Uint8Array; width: number; height: number }
}

export type DecodedPixelContent = OpaqueAndAlphaPlanes | { bitmap: ImageBitmap; blob: Blob }

// TODO use an object literal instead
class DecodedFrame implements BufferContents<DecodedPixelContent> {
  static create(mimeType: 'video/h264' | 'image/png', pixelContent: DecodedPixelContent, size: Size): DecodedFrame {
    return new DecodedFrame(mimeType, pixelContent, size)
  }

  constructor(
    public readonly mimeType: 'video/h264' | 'image/png',
    public readonly pixelContent: DecodedPixelContent,
    public readonly size: Size,
  ) {}
}

export default DecodedFrame
