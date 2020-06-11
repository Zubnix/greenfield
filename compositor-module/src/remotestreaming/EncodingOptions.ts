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

const ALPHA = (1 << 0)
const FULL_FRAME = (1 << 1)

class EncodingOptions {
  static splitAlpha(encodingOptions: number): boolean {
    return (encodingOptions & ALPHA) !== 0
  }

  static fullFrame(encodingOptions: number): boolean {
    return (encodingOptions & FULL_FRAME) !== 0
  }
}

export default EncodingOptions
