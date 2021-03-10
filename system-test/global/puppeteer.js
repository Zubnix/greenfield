const fs = require('fs')
const os = require('os')
const path = require('path')
const mkdirp = require('mkdirp')
const puppeteer = require('puppeteer')
const rimraf = require('rimraf')

const DIR = path.join(os.tmpdir(), 'jest_puppeteer_global_setup')

async function setupPuppeteer () {
  const browser = await puppeteer.launch()
  // store the browser instance so we can teardown it later
  // this global is only available in the teardown but not in TestEnvironments
  global.__BROWSER_GLOBAL__ = browser

  // use the file system to expose the wsEndpoint for TestEnvironments
  mkdirp.sync(DIR)
  fs.writeFileSync(path.join(DIR, 'wsEndpoint'), browser.wsEndpoint())
}

// teardown.js
async function teardownPuppeteer () {
  // close the browser instance
  await global.__BROWSER_GLOBAL__.close()
  // clean-up the wsEndpoint file
  rimraf.sync(DIR)
}

module.exports = {
  setupPuppeteer,
  teardownPuppeteer
}
