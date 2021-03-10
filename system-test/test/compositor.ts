import { Browser, Page } from 'puppeteer'
import { mouseHelper, PointerHelper } from './mouse-helper'

export class TestCompositor {

  page?: Page
  pointerHelper?: PointerHelper

  constructor(public browser: Browser, public url: string) {

  }

  async start(): Promise<void> {
    if (this.page) {
      throw new Error('DisplayServer already running')
    }
    this.page = await this.browser.newPage()
    this.pointerHelper = await mouseHelper(this.page)
    await this.page.goto(this.url)
  }

  async stop(): Promise<void> {
    if (this.page === undefined) {
      throw new Error('Can\'t stop DisplayServer, not running.')
    }
    this.pointerHelper?.uninstall?.()
    await this.page.close()
  }

  /**
   * Position a window in the compositor coördinate space
   *
   * \param client   the (wayland-client-side) wl_client which owns the
   *                  surface
   * \param surface  the (wayland-client-side) wl_surface*
   * \param x         x coördinate (in compositor-space pixels) to move the
   *                  left of the window to
   * \param y         y coördinate (in compositor-space pixels) to move the
   *                  top of the window to
   */
  positionWindowAbsolute(client: any, surface: any, x: number, y: number): void {
    // TODO
  }

  /**
   * Create a fake pointer device
   */
  createPointer(): TestPointer {
    return new TestPointer(this)
  }

}

export class TestPointer {
  constructor(public displayServer: TestCompositor) {

  }

  async moveAbsolute(x: number, y: number): Promise<void> {
    await this.displayServer.page?.mouse.move(x, y)
  }

  async moveRelative(dx: number, dy: number): Promise<void> {
    if (this.displayServer.pointerHelper) {
      const { x, y } = this.displayServer.pointerHelper
      await this.displayServer.page?.mouse.move(x + dx, y + dy)
    }
  }

  async buttonUp(button: number): Promise<void> {
    await this.displayServer.page?.mouse.up()
  }

  async buttonDown(button: number): Promise<void> {
    await this.displayServer.page?.mouse.down()
  }
}
