const { setupWebServer } = require('./web-server')
const { setupPuppeteer } = require('./puppeteer')
const { setupAppEndpointServer } = require('./app-endpoint-server')

module.exports = async () => {
  console.log('\n\n--Setting up system test infrastructure.--\n')
  setupAppEndpointServer()
  await setupWebServer()
  await setupPuppeteer()
  console.log('\n--Done setting up system test infrastructure.--\n')
}
