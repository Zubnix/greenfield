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

import { resetCursorImage, setCursor, setCursorImage } from '../browser/cursor'
import BufferImplementation from '../BufferImplementation'
import Callback from '../Callback'
import Point from '../math/Point'
import Output from '../Output'
import Pointer from '../Pointer'
import DecodedFrame, { OpaqueAndAlphaPlanes } from '../remotestreaming/DecodedFrame'
import Session from '../Session'
import Size from '../Size'
import Surface from '../Surface'
import View from '../View'
import HTMLCanvasFrame from '../webgl/HTMLCanvasFrame'
import WebShmFrame from '../webshm/WebShmFrame'
import RenderState from './RenderState'
import SceneShader from './SceneShader'
import YUVAToRGBA from './YUVAToRGBA'

function createRenderFrame(): Promise<number> {
  return new Promise<number>(resolve => {
    requestAnimationFrame(resolve)
  })
}

class Scene {
  readonly session: Session
  readonly canvas: HTMLCanvasElement
  resolution: Size | 'auto'
  readonly gl: WebGLRenderingContext
  readonly sceneShader: SceneShader
  private readonly _yuvaToRGBA: YUVAToRGBA
  readonly output: Output
  readonly id: string
  topLevelViews: View[]
  pointerView?: View
  private _renderFrame?: Promise<void>
  // @ts-ignore
  private _destroyResolve: (value?: void | PromiseLike<void>) => void
  private readonly _destroyPromise: Promise<void>
  private frameCallbacks: Callback[] = []

  static create(session: Session, gl: WebGLRenderingContext, canvas: HTMLCanvasElement, output: Output, sceneId: string): Scene {
    const sceneShader = SceneShader.create(gl)
    const yuvaToRgba = YUVAToRGBA.create(gl)
    return new Scene(session, canvas, gl, sceneShader, yuvaToRgba, output, sceneId)
  }

  private constructor(session: Session, canvas: HTMLCanvasElement, gl: WebGLRenderingContext, sceneShader: SceneShader, yuvaToRgba: YUVAToRGBA, output: Output, sceneId: string) {
    this.session = session
    this.canvas = canvas
    this.resolution = 'auto'
    this.gl = gl
    this.sceneShader = sceneShader
    this._yuvaToRGBA = yuvaToRgba
    this.output = output
    this.id = sceneId
    this.topLevelViews = []
    this._destroyPromise = new Promise<void>(resolve => {
      this._destroyResolve = resolve
    })
  }

  private ensureResolution() {
    if (this.resolution === 'auto') {
      if (this.canvas.width !== this.canvas.clientWidth || this.canvas.height !== this.canvas.clientHeight) {
        this.canvas.width = this.canvas.clientWidth
        this.canvas.height = this.canvas.clientHeight
      }
    } else if (this.canvas.width !== this.resolution.w || this.canvas.height !== this.resolution.h) {
      this.canvas.width = this.resolution.w
      this.canvas.height = this.resolution.h
    }
  }

  hidePointer() {
    setCursor('none')
    this.destroyPointerView()
  }


  resetPointer() {
    resetCursorImage()
    this.destroyPointerView()
  }

  private preparePointerViewRenderState(view: View) {
    const pointerSurface = view.surface
    const bufferContents = pointerSurface.state.bufferContents
    if (bufferContents) {
      const { blob } = pointerSurface.state.bufferContents?.pixelContent as { blob: Blob }
      const pointer = pointerSurface.role as Pointer
      setCursorImage(blob, pointer.hotspotX, pointer.hotspotY)
    } else {
      resetCursorImage()
    }
  }

  prepareViewRenderState(view: View) {
    view.applyTransformations()
    const { buffer, bufferContents } = view.surface.state
    if (bufferContents instanceof DecodedFrame
      || bufferContents instanceof HTMLCanvasFrame
      || bufferContents instanceof WebShmFrame) {

      if (view.mapped && buffer && view.surface.damaged) {
        const bufferImplementation = buffer.implementation as BufferImplementation<any>
        if (!bufferImplementation.released) {
          if (view === this.pointerView) {
            this.preparePointerViewRenderState(view)
          } else {
            // @ts-ignore que?
            this[bufferContents.mimeType](bufferContents, view)
          }
          view.surface.damaged = false
          bufferImplementation.release()
        }
      }
    } else if (buffer !== undefined) {
      throw new Error(`BUG. Unsupported buffer type: ${typeof bufferContents}`)
    }
  }

  registerFrameCallbacks(frameCallbacks?: Callback[]) {
    if (frameCallbacks) {
      this.frameCallbacks = [...this.frameCallbacks, ...frameCallbacks]
    }
  }

  render(): Promise<void> {
    if (!this._renderFrame) {
      this._renderFrame = createRenderFrame().then((time) => {
        this.renderNow()
        this.frameCallbacks.forEach(callback => callback.done(time))
        this.frameCallbacks = []
        this.session.flush()
      })
    }
    return this._renderFrame
  }

  prepareAllViewRenderState() {
    const viewStack = this.viewStack()
    // update textures
    viewStack.forEach(view => this.prepareViewRenderState(view))
  }

  private renderNow() {
    this.ensureResolution()
    const viewStack = this.viewStack()

    // render view texture
    this.sceneShader.use()
    this.sceneShader.updateSceneData(Size.create(this.canvas.width, this.canvas.height))
    viewStack.forEach(view => this.renderView(view))
    this.sceneShader.release()

    this._renderFrame = undefined

    this.session.userShell.events.sceneRefresh?.(this.id)
  }

  updatePointerView(surface: Surface) {
    if (this.pointerView !== undefined && this.pointerView.surface !== surface) {
      this.pointerView.destroy()
      this.pointerView = surface.createView(this)
    } else if (this.pointerView === undefined) {
      this.pointerView = surface.createView(this)
    }
  }

  destroyPointerView() {
    if (this.pointerView !== undefined) {
      this.pointerView.destroy()
      this.pointerView = undefined
    }
  }

  private updateViewRenderState(renderState: RenderState, buffer: TexImageSource) {
    const { texture, size: { w, h } } = renderState
    if (buffer.width === w && buffer.height === h) {
      texture.subImage2d(buffer, 0, 0)
    } else {
      renderState.size = Size.create(buffer.width, buffer.height)
      texture.image2d(buffer)
    }
  }

  private renderView(view: View) {
    if (view.mapped) {
      this.sceneShader.updateShaderData(view.renderState, view.transformation)
      this.sceneShader.draw()
    }
  }

  raiseSurface(surface: Surface) {
    const raisedViews = this.topLevelViews.filter(topLevelView => topLevelView.surface === surface)
    const rest = this.topLevelViews.filter(topLevelView => topLevelView.surface !== surface)
    this.topLevelViews = [...rest, ...raisedViews]
  }

  pickView(scenePoint: Point): View | undefined {
    // test views from front to back
    return this.viewStack().reverse().find(view => {
      const surfacePoint = view.toSurfaceSpace(scenePoint)
      return view.surface.isWithinInputRegion(surfacePoint)
    })
  }

  destroy() {
    this.topLevelViews.forEach(topLevelView => topLevelView.destroy())
    if (this.pointerView) {
      this.pointerView.destroy()
    }
    this.topLevelViews = []
    this.pointerView = undefined
    this._destroyResolve()
  }

  onDestroy(): Promise<void> {
    return this._destroyPromise
  }

  updateResolution(width: number, height: number) {
    if (this.resolution instanceof Size && (this.resolution.w !== width || this.resolution.h !== height)) {
      this.resolution = Size.create(width, height)
      this.render()
      this.output.resources.forEach(resource => this.output.emitSpecs(resource))
    }
  }

  /**
   * Stack of all views of this scene, in-order from bottom to top.
   */
  private viewStack(): View[] {
    const stack: View[] = []
    this.topLevelViews.forEach(topLevelView => this.addToViewStack(stack, topLevelView))
    return stack
  }

  private addToViewStack(stack: View[], view: View) {
    stack.push(view)
    view.findChildViews().forEach(view => this.addToViewStack(stack, view))
  }

  public ['video/h264'](decodedFrame: DecodedFrame, view: View) {
    this._yuvaToRGBA.convertInto(decodedFrame.pixelContent as OpaqueAndAlphaPlanes, decodedFrame.size, view)
  }

  public ['image/png'](decodedFrame: DecodedFrame, view: View) {
    const { bitmap } = decodedFrame.pixelContent as { bitmap: ImageBitmap, blob: Blob }
    this.updateViewRenderState(view.renderState, bitmap)
  }

  public ['image/rgba'](shmFrame: WebShmFrame, view: View) {
    this.updateViewRenderState(view.renderState, shmFrame.pixelContent)
  }

  public ['image/canvas'](htmlCanvasFrame: HTMLCanvasFrame, view: View) {
    this.updateViewRenderState(view.renderState, htmlCanvasFrame.pixelContent)
  }
}

export default Scene
