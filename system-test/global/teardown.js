const { teardownWebServer } = require('./web-server')
const { teardownPuppeteer } = require('./puppeteer')
const { teardownAppEndpointServer } = require('./app-endpoint-server')

module.exports = async () => {
  console.log('\n--Tearing down system test infrastructure.--\n')
  await teardownPuppeteer()
  await teardownWebServer()
  teardownAppEndpointServer()
  console.log('\n--Done tearing down system test infrastructure.--\n')
}
