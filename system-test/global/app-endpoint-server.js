const { AppEndpointServer } = require('app-endpoint-server')

function setupAppEndpointServer () {
  global.__APP_ENDPOINT_SERVER__ = AppEndpointServer.create()
}

function teardownAppEndpointServer () {
  global.__APP_ENDPOINT_SERVER__.destroy()
}

module.exports = {
  setupAppEndpointServer,
  teardownAppEndpointServer
}
