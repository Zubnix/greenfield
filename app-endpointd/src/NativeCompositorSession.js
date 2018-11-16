const { Endpoint, nativeGlobalNames } = require('westfield-endpoint')
const { Epoll } = require('epoll')

const NativeClientSession = require('./NativeClientSession')

class NativeCompositorSession {
  /**
   * @param {RtcClient}rtcClient
   * @returns {NativeCompositorSession}
   */
  static create (rtcClient) {
    const compositorSession = new NativeCompositorSession(rtcClient)

    // TODO move global create/destroy callback implementations into Endpoint.js
    compositorSession.wlDisplay = Endpoint.createDisplay(
      wlClient => compositorSession._onClientCreated(wlClient),
      globalName => compositorSession._onGlobalCreated(globalName),
      globalName => compositorSession._onGlobalDestroyed(globalName)
    )
    Endpoint.initShm(compositorSession.wlDisplay)
    compositorSession.wlDisplayName = Endpoint.addSocketAuto(compositorSession.wlDisplay)
    compositorSession.wlDisplayFd = Endpoint.getFd(compositorSession.wlDisplay)

    // TODO handle err
    const fdWatcher = new Epoll(err => Endpoint.dispatchRequests(compositorSession.wlDisplay))
    fdWatcher.add(compositorSession.wlDisplayFd, Epoll.EPOLLPRI | Epoll.EPOLLIN | Epoll.EPOLLERR)

    return compositorSession
  }

  /**
   * @param {RtcClient}rtcClient
   */
  constructor (rtcClient) {
    /**
     * @type {RtcClient}
     */
    this.rtcClient = rtcClient
    /**
     * @type {Object}
     */
    this.wlDisplay = null
    /**
     * @type {string}
     */
    this.wlDisplayName = null
    /**
     * @type {number}
     */
    this.wlDisplayFd = -1
    /**
     * @type {Array<NativeClientSession>}
     */
    this.clients = []
  }

  destroy () {
    // TODO
  }

  /**
   * @param {Object}wlClient
   * @private
   */
  _onClientCreated (wlClient) {
    process.env.DEBUG && console.log(`[app-endpoint-${this.rtcClient.appEndpointCompositorPair.appEndpointSessionId}] Native compositor session: new wayland client connected.`)

    // TODO keep track of clients
    const clientSession = NativeClientSession.create(wlClient, this)
    this.clients.push(clientSession)
    clientSession.onDestroy().then(() => {
      const idx = this.clients.indexOf(clientSession)
      if (idx > -1) {
        this.clients.splice(idx, 1)
      }
    })
  }

  /**
   * @param {number}globalName
   * @private
   */
  _onGlobalCreated (globalName) {
    nativeGlobalNames.push(globalName)
  }

  /**
   * @param {number}globalName
   * @private
   */
  _onGlobalDestroyed (globalName) {
    const idx = nativeGlobalNames.indexOf(globalName)
    if (idx > -1) {
      nativeGlobalNames.splice(idx, 1)
    }
  }
}

module.exports = NativeCompositorSession