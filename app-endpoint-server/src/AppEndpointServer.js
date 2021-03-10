// Copyright 2019 Erik De Rijcke
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

'use strict'
require('json5/lib/register')
const Logger = require('pino')

const childProcess = require('child_process')
const path = require('path')
const http = require('http')
const url = require('url')

const { serverConfig } = require('../config.json5')

// TODO Disabled for now until we have something more rigid.
// const { verifyRemoteAppLaunchClaim } = require('./CloudFunctions')

const uuidRegEx = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

class AppEndpointServer {
  /**
   * @returns {AppEndpointServer}
   */
  static create () {
    const logger = Logger({
      name: `app-endpoint-server`,
      prettyPrint: (process.env.DEBUG && process.env.DEBUG == true),
      level: (process.env.DEBUG && process.env.DEBUG == true) ? 20 : 30
    })

    const server = http.createServer((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
      }
    })
    const { timeout, hostname, port } = serverConfig.httpServer
    server.setTimeout(timeout)
    const appEndpointDaemon = new AppEndpointServer(logger)
    appEndpointDaemon.onDestroy().then(() => {
      server.close()
    })
    // TODO configure server to only accept websocket connections
    // FIXME add (websocket) cookie based auth, example: https://github.com/crossbario/autobahn-python/tree/master/examples/twisted/websocket/auth_persona
    server.on('upgrade', (request, socket, head) => {
      appEndpointDaemon.handleHttpUpgradeRequest(request, socket, head)
      appEndpointDaemon.onDestroy().then(() => socket.destroy())
    })
    server.listen(port, hostname)
    logger.info(`Listening on ${hostname}:${port}.`)

    return appEndpointDaemon
  }

  /**
   * @param {Object}logger
   */
  constructor (logger) {
    /**
     * @private
     */
    this._logger = logger
    /**
     * @type {Object.<string, ChildProcess>}
     * @private
     */
    this._appEndpointSessionForks = {}
    /**
     * @type {function():void}
     * @private
     */
    this._destroyResolve = null
    /**
     * @type {Promise<void>}
     * @private
     */
    this._destroyPromise = new Promise(resolve => { this._destroyResolve = resolve })
  }

  /**
   * @param {IncomingMessage}request
   * @param {Socket}socket
   * @param {Buffer}head
   */
  async handleHttpUpgradeRequest (request, socket, head) {
    try {
      const wsURL = url.parse(request.url, true)
      const compositorSessionId = wsURL.query['compositorSessionId']

      this._logger.info(`Received web socket upgrade request with compositor session id: ${compositorSessionId}. Delegating to a session child process.`)
      if (compositorSessionId && uuidRegEx.test(compositorSessionId)) {
        let appEndpointSessionFork = this._appEndpointSessionForks[compositorSessionId]
        if (!appEndpointSessionFork) {
          appEndpointSessionFork = this.createAppEndpointSessionFork(compositorSessionId)
          this.onDestroy().then(() => {
            this._logger.info(`Killing  app-endpoint-session::${compositorSessionId}]. Sending child ${appEndpointSessionFork.pid} SIGKILL.`)
            appEndpointSessionFork.kill('SIGKILL')
          })
        }

        appEndpointSessionFork.send(
          [{
            headers: request.headers,
            method: request.method,
            query: wsURL.query
          }, head], socket)
      } else {
        const msg = `Received web socket upgrade request with compositor session id: ${compositorSessionId}. Id is not a valid uuid.`
        this._logger.error(msg)
        this._denyWebSocket(socket, 401, new Error(msg))
      }
    } catch (e) {
      this._logger.error('\tname: ' + e.name + ' message: ' + e.message + ' text: ' + e.text)
      this._logger.error('error object stack: ')
      this._logger.error(e.stack)
      this._denyWebSocket(socket, 503, e)
    }
  }

  /**
   * @param {Socket}socket
   * @param {number}errorCode
   * @param {Error}error
   * @private
   */
  _denyWebSocket (socket, errorCode, error) {
    socket.write(`HTTP/1.1 ${errorCode} Web Socket Protocol Handshake\r\n` +
      'Upgrade: WebSocket\r\n' +
      'Connection: Upgrade\r\n' +
      '\r\n')
    socket.destroy(error)
  }

  /**
   * @param {string} compositorSessionId
   * @return {ChildProcess}
   */
  createAppEndpointSessionFork (compositorSessionId) {
    this._logger.info('Creating new session child process.')
    const configPath = process.argv[2]
    const child = childProcess.fork(path.join(__dirname, 'AppEndpointSession.js'), configPath == null ? [] : [`${configPath}`])

    const removeChild = () => {
      this._logger.info(`Session child [${child.pid}] exit.`)
      delete this._appEndpointSessionForks[compositorSessionId]
    }

    child.on('exit', removeChild)
    child.on('SIGINT', () => {
      this._logger.info(`Child ${child.pid} received SIGINT.`)
      child.exit()
    })
    child.on('SIGTERM', () => {
      this._logger.info(`Child ${child.pid} received SIGTERM.`)
      child.exit()
    })

    this._appEndpointSessionForks[compositorSessionId] = child
    return child
  }

  /**
   * @returns {Promise<void>}
   */
  onDestroy () {
    return this._destroyPromise
  }

  destroy () {
    if (this._destroyResolve) {
      this._logger.info(`Destroyed.`)
      this._destroyResolve()
      this._destroyResolve = null
    }
  }
}

module.exports = AppEndpointServer
