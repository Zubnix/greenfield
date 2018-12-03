'use strict'

export default class H264NALDecoder {
  /**
   * @param {number}renderStateId
   * @return {Promise<H264NALDecoder>}
   */
  static async create (renderStateId) {
    const tinyH264Worker = await H264NALDecoder._tinyH264WorkerPromise
    const h264NALDecoder = new H264NALDecoder(tinyH264Worker, renderStateId)
    H264NALDecoder.h264NalDecoders[renderStateId] = h264NALDecoder
    return h264NALDecoder
  }

  /**
   * @param {Worker}tinyH264Worker
   * @param {number}renderStateId
   */
  constructor (tinyH264Worker, renderStateId) {
    this._tinyH264Worker = tinyH264Worker
    this._renderStateId = renderStateId
    this._busy = false
    this._decodeQueue = []
  }

  /**
   * @param {Uint8Array} h264Nal
   */
  decode (h264Nal) {
    if (this._busy) {
      this._decodeQueue.push(h264Nal)
      return
    }
    this._tinyH264Worker.postMessage({
      type: 'decode',
      data: h264Nal.buffer,
      renderStateId: this._renderStateId
    }, [h264Nal.buffer])
    this._busy = true
  }

  /**
   * @param {{width:number, height:number, data: ArrayBuffer}}message
   */
  onPictureReady (message) {
    const {width, height, data} = message

    if (this._decodeQueue.length > 0) {
      const h264Nal = this._decodeQueue.shift()
      this._tinyH264Worker.postMessage({
        type: 'decode',
        data: h264Nal.buffer,
        renderStateId: this._renderStateId
      }, [h264Nal.buffer])
    } else {
      this._busy = false
    }
    this.onPicture(new Uint8Array(data), width, height)
  }

  /**
   * @param {Uint8Array}buffer
   * @param {number}width
   * @param {number}height
   */
  onPicture (buffer, width, height) {}

  release () {
    if (this._tinyH264Worker) {
      this._tinyH264Worker.postMessage({type: 'release', renderStateId: this._renderStateId})
      this._tinyH264Worker = null
    }
  }
}

/**
 * @type {Object.<number,H264NALDecoder>}
 */
H264NALDecoder.h264NalDecoders = {}

/**
 * @type {Promise<Worker>}
 * @private
 */
H264NALDecoder._tinyH264WorkerPromise = new Promise((resolve) => {
  /**
   * @type {Worker}
   * @private
   */
  const tinyH264Worker = new window.Worker('TinyH264Worker.js')
  tinyH264Worker.addEventListener('message', (e) => {
    const message = /** @type {{type:string, width:number, height:number, data:ArrayBuffer, renderStateId:number}} */e.data
    switch (message.type) {
      case 'pictureReady':
        H264NALDecoder.h264NalDecoders[message.renderStateId].onPictureReady(message)
        break
      case 'decoderReady':
        resolve(tinyH264Worker)
        break
    }
  })
})
