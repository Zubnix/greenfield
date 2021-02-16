const { nodeFDConnectionSetup } = require('xtsb')

const { Endpoint } = require('westfield-endpoint')

class AppEndpointSessionXWayland {
  /**
   * @param logger
   * @param {NativeCompositorSession}nativeCompositorSession
   * @param {string}compositorSessionId
   */
  static create (logger, nativeCompositorSession, compositorSessionId) {
    return new AppEndpointSessionXWayland(logger, nativeCompositorSession, compositorSessionId)
  }

  /**
   * @param logger
   * @param {NativeCompositorSession}nativeCompositorSession
   * @param {string}compositorSessionId
   */
  constructor (logger, nativeCompositorSession, compositorSessionId) {
    /**
     * @private
     */
    this._logger = logger
    /**
     * @type {NativeCompositorSession}
     * @private
     */
    this._nativeCompositorSession = nativeCompositorSession
    /**
     * @type {string}
     */
    this.compositorSessionId = compositorSessionId
    /**
     * @type {object|undefined}
     */
    this.nativeXWayland = undefined
    /**
     * @type {number|undefined}
     */
    this.display = undefined
    /**
     *
     * @type {{webSocketChannel: WebSocketChannel, nativeClientSession: ?NativeClientSession, id: number}|undefined}
     */
    this.xWaylandClient = undefined
    /**
     * @type {WebSocket|undefined}
     */
    this.xwmWebSocket = undefined
  }

  /**
   * @return {{onStarted: Promise<{wmFd: number, wlClient: Object}>, onDestroyed: Promise<>}}
   * @private
   */
  _listenXWayland () {
    let destroyResolve
    const onDestroyed = new Promise((resolve) => { destroyResolve = resolve})

    const onStarted = new Promise((resolve, reject) => {
      let display
      this.nativeXWayland = Endpoint.setupXWayland(
        this._nativeCompositorSession.wlDisplay,
        ((wmFd, wlClient) => {resolve({ wmFd, wlClient, display })}),
        () => {destroyResolve()}
      )

      if (this.nativeXWayland) {
        this.display = Endpoint.getXWaylandDisplay(this.nativeXWayland)
        process.env['DISPLAY'] = `:${this.display}`
      } else {
        reject(new Error('Failed to setup XWayland.'))
      }
    })

    return { onStarted, onDestroyed }
  }

  /**
   * @param {WebSocket}webSocket
   */
  async createXConnection (webSocket) {
    this._nativeCompositorSession.childSpawned(webSocket)

    // Will only continue once an XWayland server is launching which is triggered by an X client trying to connect.
    const { onStarted, onDestroyed } = this._listenXWayland()

    onDestroyed.then(() => {
      this.xWaylandClient = undefined
      this.destroy()
    })

    const { wmFd, wlClient } = await onStarted

    // SIGUSR1 is raised once Xwayland is done initializing.
    process.on('SIGUSR1', () => {
      this._logger.info(`[app-endpoint-session: ${this.compositorSessionId}] - XWayland started.`)
      process.on('SIGCHLD', () => {
        // TODO call to native code
      })

      this.xWaylandClient = this._nativeCompositorSession.clients.find(value => Endpoint.equalValueExternal(value.nativeClientSession.wlClient, wlClient))
      this.xWaylandClient.nativeClientSession.onDestroy().then(() => {
        this.destroy()
      })
      this.xWaylandClient.webSocketChannel.send(Uint32Array.from([7, wmFd]).buffer)
    })
  }

  /**
   * @param {WebSocket}webSocket
   * @param {number}wmFD
   */
  async createXWMConnection (webSocket, wmFD) {
    // initialize an X11 client connection, used by the compositor's X11 window manager.
    const { xConnectionSocket, setup } = await nodeFDConnectionSetup(wmFD)()
    this.xwmWebSocket = webSocket

    const setupJSON = JSON.stringify(setup)
    this.xwmWebSocket.send(setupJSON)

    this.xwmWebSocket.binaryType = 'arraybuffer'
    this.xwmWebSocket.onmessage = ev => xConnectionSocket.write(Buffer.from(ev.data))
    this.xwmWebSocket.onclose = _ => xConnectionSocket.close()
    this.xwmWebSocket.onerror = ev => console.error('XConnection websocket error: ' + ev)
    xConnectionSocket.onData = data => this.xwmWebSocket.send(data)
  }

  destroy () {
    if (this.xwmWebSocket) {
      this.xwmWebSocket.close()
      this.xwmWebSocket = undefined
    }

    if (this.nativeXWayland) {
      Endpoint.teardownXWayland(this.nativeXWayland)
      this.nativeXWayland = undefined
    }

    if (this.xWaylandClient) {
      this.xWaylandClient.nativeClientSession.destroy()
      this.xWaylandClient.webSocketChannel.close()
      this.xWaylandClient = undefined
    }
  }
}

module.exports = AppEndpointSessionXWayland
