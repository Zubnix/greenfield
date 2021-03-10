import { Page } from 'puppeteer'
const timeout = 10000;
let page: Page
beforeAll(async () => {
  // @ts-ignore
  page = await global.__BROWSER__.newPage();
}, timeout);

test('Compositor page should be loaded.', async () => {
  // @ts-ignore
  await page.goto('http://127.0.0.1:55555')
  await expect(page.title()).resolves.toMatch('Greenfield Compositor Demo')
})
