'use strict'

import greenfield from './protocol/greenfield-browser-protocol'

import BrowserRtcBlobTransfer from './BrowserRtcBlobTransfer'

export default class BrowserRtcPeerConnection {
  /**
   * @param {RtcPeerConnection}rtcPeerConnectionResource
   * @returns {BrowserRtcPeerConnection}
   */
  static create (rtcPeerConnectionResource) {
    const browserRtcPeerConnection = new BrowserRtcPeerConnection(rtcPeerConnectionResource)
    rtcPeerConnectionResource.implementation = browserRtcPeerConnection
    return browserRtcPeerConnection
  }

  /**
   * Use BrowserRtcPeerConnection.create(..)
   * @param {RtcPeerConnection}rtcPeerConnectionResource
   * @private
   */
  constructor (rtcPeerConnectionResource) {
    /**
     * @type {RtcPeerConnection}
     */
    this.rtcPeerConnectionResource = rtcPeerConnectionResource
    this._delegate = null
    this._peerConnectionResolve = null
    this._peerConnectionPromise = new Promise((resolve) => {
      this._peerConnectionResolve = resolve
    })
  }

  /**
   *
   * @param {RtcPeerConnection} resource
   * @param {*} id Returns new blob transfer object who's data will be send over the given rtc peer connection
   * @param {string} descriptor blob transfer descriptor
   *
   * @since 1
   *
   */
  createBlobTransfer (resource, id, descriptor) {
    // TODO check if the descriptor label matches one we send out earlier and notify whoever created that descriptor
    // that there is now a blob transfer object available
    const blobTransferResource = new greenfield.GrBlobTransfer(resource.client, id, resource.version)
    BrowserRtcBlobTransfer._create(blobTransferResource, descriptor, this)
  }

  /**
   * @return {Promise<RTCPeerConnection>}
   */
  onPeerConnection () {
    return this._peerConnectionPromise
  }

  /**
   * Setup the peer connection for client (local) to server (browser) communication.
   */
  async ensureP2S () {
    if (this._delegate && this._delegate._peerConnection) {
      // already initialized as p2s, return early.
      return
    } else if (this._delegate && !this._delegate._peerConnection) {
      // TODO we probably want to report this error to the client.
      throw new Error('Rtc peer connection already initialized in P2P mode.')
    }

    this._delegate = {
      _peerConnection: new window.RTCPeerConnection(
        {
          'iceServers': [
            {
              'url': 'stun:stun.l.google.com:19302'
            },
            {
              'url': 'turn:badger.pfoe.be',
              'username': 'greenfield',
              'credential': 'water'
            }
          ]
        }
      ),

      clientIceCandidates: async (resource, description) => {
        const signal = JSON.parse(description)
        await this._delegate._peerConnection.addIceCandidate(new window.RTCIceCandidate(signal.candidate))
      },

      clientSdpReply: async (resource, description) => {
        const signal = JSON.parse(description)
        await this._delegate._peerConnection.setRemoteDescription(new window.RTCSessionDescription(signal.sdp))
      },

      clientSdpOffer: async (resource, description) => {
        const signal = JSON.parse(description)
        await this._delegate._peerConnection.setRemoteDescription(new window.RTCSessionDescription(signal.sdp))
        const desc = await this._delegate._peerConnection.createAnswer()
        await this._delegate._peerConnection.setLocalDescription(desc)
        await this.rtcPeerConnectionResource.serverSdpReply(JSON.stringify({'sdp': this._delegate._peerConnection.localDescription}))
      }
    }

    this._delegate._peerConnection.onicecandidate = (evt) => {
      if (evt.candidate !== null) {
        this.rtcPeerConnectionResource.serverIceCandidates(JSON.stringify({'candidate': evt.candidate}))
      }
    }
    this._delegate._peerConnection.onnegotiationneeded = async () => {
      this._sendOffer()
    }

    this._peerConnectionResolve(this._delegate._peerConnection)
  }

  async _sendOffer () {
    const desc = await this._delegate._peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
      voiceActivityDetection: false,
      iceRestart: false
    })
    await this._delegate._peerConnection.setLocalDescription(desc)
    this.rtcPeerConnectionResource.serverSdpOffer(JSON.stringify({'sdp': this._delegate._peerConnection.localDescription}))
  }

  /**
   * Setup the peer connection for client (local) to client (local) communication.
   * @param otherRtcPeerConnectionResource
   */
  ensureP2P (otherRtcPeerConnectionResource) {
    if (this._delegate && this._delegate._peerConnection) {
      // TODO we probably want to report this error to the client.
      throw new Error('Rtc peer connection already initialized in P2S mode.')
    } else if (this._delegate && this._delegate.otherRtcPeerConnectionResource !== otherRtcPeerConnectionResource) {
      // TODO we probably want to report this error to the client.
      throw new Error('Rtc peer connection already initialized with another peer.')
    } else if (this._delegate && this._delegate.otherRtcPeerConnectionResource === otherRtcPeerConnectionResource) {
      return
    }

    // TODO keep track in which mode the connection is initialized
    this._delegate = {
      otherRtcPeerConnectionResource: otherRtcPeerConnectionResource,
      clientIceCandidates: (resource, description) => {
        this._delegate.otherRtcPeerConnectionResource.serverIceCandidates(description)
      },

      clientSdpReply: (resource, description) => {
        this._delegate.otherRtcPeerConnectionResource.serverSdpReply(description)
      },

      clientSdpOffer: (resource, description) => {
        this._delegate.otherRtcPeerConnectionResource.serverSdpOffer(description)
      }
    }

    this.rtcPeerConnectionResource.init()
    // in the p2p case, we will never have a peer connection as it is the client peer connections that will be linked
  }

  clientIceCandidates (resource, description) {
    this._delegate.clientIceCandidates(resource, description)
  }

  clientSdpReply (resource, description) {
    this._delegate.clientSdpReply(resource, description)
  }

  clientSdpOffer (resource, description) {
    this._delegate.clientSdpOffer(resource, description)
  }
}
