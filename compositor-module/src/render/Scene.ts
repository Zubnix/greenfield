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
import WebGLFrame from '../webgl/WebGLFrame'
import WebShmFrame from '../webshm/WebShmFrame'
import SceneShader from './SceneShader'
import YUVAToRGBA from './YUVAToRGBA'

function createRenderFrame(): Promise<number> {
  return new Promise<number>((resolve) => {
    requestAnimationFrame(resolve)
  })
}

function preparePointerViewRenderState(view: View): void {
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

function updateViewRenderStateWithTexImageSource(view: View, buffer: TexImageSource) {
  const {
    texture,
    size: { w, h },
  } = view.renderState
  if (buffer.width === w && buffer.height === h) {
    texture.subImage2d(buffer, 0, 0)
  } else {
    view.renderState.size = Size.create(buffer.width, buffer.height)
    texture.image2d(buffer)
  }
}

class Scene {
  pointerView?: View
  private _renderFrame?: Promise<void>
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private _destroyResolve: (value?: void | PromiseLike<void>) => void
  private readonly _destroyPromise: Promise<void>
  private frameCallbacks: Callback[] = []

  static create(
    session: Session,
    gl: WebGLRenderingContext,
    canvas: HTMLCanvasElement,
    output: Output,
    sceneId: string,
  ): Scene {
    const sceneShader = SceneShader.create(gl)
    const yuvaToRgba = YUVAToRGBA.create(gl)
    return new Scene(session, canvas, gl, sceneShader, yuvaToRgba, output, sceneId)
  }

  private constructor(
    public readonly session: Session,
    public readonly canvas: HTMLCanvasElement,
    public readonly gl: WebGLRenderingContext,
    public readonly sceneShader: SceneShader,
    public readonly yuvaToRGBA: YUVAToRGBA,
    public readonly output: Output,
    public readonly id: string,
    public topLevelViews: View[] = [],
  ) {
    this._destroyPromise = new Promise<void>((resolve) => {
      this._destroyResolve = resolve
    })
  }

  hidePointer(): void {
    setCursor('none')
    this.destroyPointerView()
  }

  resetPointer(): void {
    resetCursorImage()
    this.destroyPointerView()
  }

  prepareViewRenderState(view: View): void {
    view.applyTransformations()
    const { buffer, bufferContents } = view.surface.state
    if (
      bufferContents instanceof DecodedFrame ||
      bufferContents instanceof WebGLFrame ||
      bufferContents instanceof WebShmFrame
    ) {
      if (view.mapped && buffer && view.surface.damaged) {
        const bufferImplementation = buffer.implementation as BufferImplementation<any>
        if (!bufferImplementation.released) {
          if (view === this.pointerView) {
            preparePointerViewRenderState(view)
          } else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
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

  registerFrameCallbacks(frameCallbacks?: Callback[]): void {
    if (frameCallbacks) {
      this.frameCallbacks = [...this.frameCallbacks, ...frameCallbacks]
    }
  }

  render(): Promise<void> {
    if (!this._renderFrame) {
      this._renderFrame = createRenderFrame().then((time) => {
        this.renderNow()
        this.frameCallbacks.forEach((callback) => callback.done(time))
        this.frameCallbacks = []
        this.session.flush()
      })
    }
    return this._renderFrame
  }

  prepareAllViewRenderState(): void {
    const viewStack = this.viewStack()
    // update textures
    viewStack.forEach((view) => this.prepareViewRenderState(view))
  }

  private renderNow() {
    const viewStack = this.viewStack()

    // render view texture
    this.sceneShader.use()
    this.sceneShader.updateSceneData(Size.create(this.canvas.width, this.canvas.height))
    viewStack.forEach((view) => this.renderView(view))
    this.sceneShader.release()

    this._renderFrame = undefined

    this.session.userShell.events.sceneRefresh?.(this.id)
  }

  updatePointerView(surface: Surface): void {
    if (this.pointerView !== undefined && this.pointerView.surface !== surface) {
      this.pointerView.destroy()
      this.pointerView = surface.createView(this)
    } else if (this.pointerView === undefined) {
      this.pointerView = surface.createView(this)
    }
  }

  destroyPointerView(): void {
    if (this.pointerView !== undefined) {
      this.pointerView.destroy()
      this.pointerView = undefined
    }
  }

  private renderView(view: View) {
    if (view.mapped) {
      this.sceneShader.updateViewData(view)
      this.sceneShader.draw()
    }
  }

  raiseSurface(surface: Surface): void {
    const raisedViews = this.topLevelViews.filter((topLevelView) => topLevelView.surface === surface)
    const rest = this.topLevelViews.filter((topLevelView) => topLevelView.surface !== surface)
    this.topLevelViews = [...rest, ...raisedViews]
  }

  pickView(scenePoint: Point): View | undefined {
    // test views from front to back
    return this.viewStack()
      .reverse()
      .find((view) => {
        const surfacePoint = view.toSurfaceSpace(scenePoint)
        return view.surface.isWithinInputRegion(surfacePoint)
      })
  }

  destroy(): void {
    this.topLevelViews.forEach((topLevelView) => topLevelView.destroy())
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

  /**
   * Stack of all views of this scene, in-order from bottom to top.
   */
  private viewStack(): View[] {
    const stack: View[] = []
    this.topLevelViews.forEach((topLevelView) => this.addToViewStack(stack, topLevelView))
    return stack
  }

  private addToViewStack(stack: View[], view: View) {
    stack.push(view)
    view.findChildViews().forEach((view) => this.addToViewStack(stack, view))
  }

  public ['video/h264'](decodedFrame: DecodedFrame, view: View): void {
    this.yuvaToRGBA.convertInto(decodedFrame.pixelContent as OpaqueAndAlphaPlanes, decodedFrame.size, view)
  }

  public ['image/png'](decodedFrame: DecodedFrame, view: View): void {
    const { bitmap } = decodedFrame.pixelContent as { bitmap: ImageBitmap; blob: Blob }
    updateViewRenderStateWithTexImageSource(view, bitmap)
  }

  public ['image/rgba'](shmFrame: WebShmFrame, view: View): void {
    updateViewRenderStateWithTexImageSource(view, shmFrame.pixelContent)
  }

  public ['image/canvas'](webGLFrame: WebGLFrame, view: View): void {
    updateViewRenderStateWithTexImageSource(view, webGLFrame.pixelContent)
  }
}

export default Scene
