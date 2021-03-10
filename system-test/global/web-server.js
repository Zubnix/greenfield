const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const webpackConfig = require('../webpack.config')

function listen (compiler) {
  return new Promise((resolve, reject) => {
    const devServerOptions = Object.assign({}, webpackConfig.devServer, {
      open: false,
      hot: false
    })
    const server = new WebpackDevServer(compiler, devServerOptions)
    const port = 55555
    const hostname = '127.0.0.1'
    const url = `http://${hostname}:${port}`
    server.listen(port, hostname, (error) => {
      if (error) {
        reject(error)
      } else {
        console.log(`Starting test server on ${url}`)
        resolve({ server, url })
      }
    })
  })
}

async function setupWebServer () {
  const compiler = webpack(webpackConfig)
  const compilationPromise = new Promise(resolve => {
    compiler.hooks.compilation.tap('finishModules', () => {
      resolve()
    })
  })
  const { server, url } = await listen(compiler)
  await compilationPromise
  // @ts-ignore
  global.__WEB_SERVER__ = server
  // @ts-ignore
  global.testURL = url
}

async function teardownWebServer () {
  await new Promise((resolve, reject) => {
    // @ts-ignore
    global.__WEB_SERVER__.close(resolve)
  })
}

module.exports = {
  setupWebServer,
  teardownWebServer
}
