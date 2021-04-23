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

import appEndpointNative from './app-endpoint-encoding'
import { EncodedFrame } from './EncodedFrame'
import { EncodedFrameFragment } from './EncodedFrameFragment'
import { enableFullFrame } from './EncodingOptions'
import { png } from './EncodingTypes'
import { FrameEncoder, FrameEncoderFactory, SupportedWlShmFormat } from './FrameEncoder'
import { WlShmFormat } from './WlShmFormat'

const gstFormats = {
  [WlShmFormat.argb8888]: 'BGRA',
  [WlShmFormat.xrgb8888]: 'BGRx',
} as const

export const createPNGEncoder: FrameEncoderFactory = (
  width: number,
  height: number,
  wlShmFormat: SupportedWlShmFormat,
): FrameEncoder => new PNGEncoder(width, height, wlShmFormat)

class PNGEncoder implements FrameEncoder {
  private readonly _encodingContext: unknown
  private _pngImage?: Buffer
  private _encodingResolve?: (value: void | PromiseLike<void>) => void

  constructor(width: number, height: number, wlShmFormat: keyof typeof gstFormats) {
    const gstBufferFormat = gstFormats[wlShmFormat]
    this._encodingContext = appEndpointNative.createEncoder(
      'png',
      gstBufferFormat,
      width,
      height,
      (pngImage: Buffer) => {
        this._pngImage = pngImage
        this._encodingResolve?.()
      },
      null,
    )
  }

  private async _encodeFragment(
    pixelBuffer: unknown,
    wlShmFormat: keyof typeof gstFormats,
    x: number,
    y: number,
    width: number,
    height: number,
    stride: number,
  ): Promise<EncodedFrameFragment> {
    const gstBufferFormat = gstFormats[wlShmFormat]

    const encodingPromise = new Promise<void>((resolve) => {
      this._pngImage = undefined
      this._encodingResolve = resolve
      appEndpointNative.encodeBuffer(this._encodingContext, pixelBuffer, gstBufferFormat, width, height, stride)
    })

    await encodingPromise

    if (this._pngImage === undefined) {
      throw new Error('BUG. Expected a png image to be present after encoding.')
    }
    return EncodedFrameFragment.create(x, y, width, height, this._pngImage, Buffer.allocUnsafe(0))
  }

  async encodeBuffer(
    pixelBuffer: unknown,
    wlShmFormat: SupportedWlShmFormat,
    bufferWidth: number,
    bufferHeight: number,
    bufferStride: number,
    serial: number,
  ): Promise<EncodedFrame> {
    const encodingOptions = enableFullFrame(0)
    const encodedFrameFragment = await this._encodeFragment(
      pixelBuffer,
      wlShmFormat,
      0,
      0,
      bufferWidth,
      bufferHeight,
      bufferStride,
    )
    return EncodedFrame.create(serial, png, encodingOptions, bufferWidth, bufferHeight, [encodedFrameFragment])
  }
}