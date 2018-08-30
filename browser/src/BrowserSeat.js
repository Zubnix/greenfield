'use strict'

import { Global } from 'westfield-runtime-server'
import { GrSeat, GrPointer, GrKeyboard, GrTouch } from './protocol/greenfield-browser-protocol'

import BrowserPointer from './BrowserPointer'
import BrowserKeyboard from './BrowserKeyboard'
import BrowserTouch from './BrowserTouch'
import BrowserDataDevice from './BrowserDataDevice'

const {keyboard, pointer, touch} = GrSeat.Capability

/**
 *
 *            A seat is a group of keyboards, pointer and touch devices. This
 *            object is published as a global during start up, or when such a
 *            device is hot plugged.  A seat typically has a pointer and
 *            maintains a keyboard focus and a pointer focus.
 *
 */
class BrowserSeat extends Global {
  /**
   * @param {BrowserSession} browserSession
   * @returns {BrowserSeat}
   */
  static create (browserSession) {
    const browserDataDevice = BrowserDataDevice.create()
    const browserKeyboard = BrowserKeyboard.create(browserSession, browserDataDevice)
    const browserPointer = BrowserPointer.create(browserSession, browserDataDevice, browserKeyboard)
    const browserTouch = BrowserTouch.create()
    const hasTouch = 'ontouchstart' in document.documentElement

    const browserSeat = new BrowserSeat(browserDataDevice, browserPointer, browserKeyboard, browserTouch, hasTouch)
    browserDataDevice.browserSeat = browserSeat

    browserKeyboard.browserSeat = browserSeat
    browserPointer.browserSeat = browserSeat
    browserTouch.browserSeat = browserSeat

    return browserSeat
  }

  /**
   * @param {BrowserDataDevice} browserDataDevice
   * @param {BrowserPointer} browserPointer
   * @param {BrowserKeyboard} browserKeyboard
   * @param {BrowserTouch} browserTouch
   * @param {boolean} hasTouch
   * @private
   */
  constructor (browserDataDevice, browserPointer, browserKeyboard, browserTouch, hasTouch) {
    super(GrSeat.name, 6)
    /**
     * @type {BrowserDataDevice}
     */
    this.browserDataDevice = browserDataDevice
    /**
     * @type {BrowserPointer}
     */
    this.browserPointer = browserPointer
    /**
     * @type {BrowserKeyboard}
     */
    this.browserKeyboard = browserKeyboard
    /**
     * @type {BrowserTouch}
     */
    this.browserTouch = browserTouch
    /**
     * @type {boolean}
     */
    this.hasTouch = hasTouch
    this.resources = []
    this._seatName = 'browser-seat0'
    /**
     * @type {number}
     */
    this.serial = 0

    /**
     * @type {number}
     */
    this.buttonPressSerial = 0
    /**
     * @type {number}
     */
    this.buttonReleaseSerial = 0
    /**
     * @type {number}
     */
    this.keyPressSerial = 0
    /**
     * @type {number}
     */
    this.keyReleaseSerial = 0
    /**
     * @type {number}
     */
    this.touchDownSerial = 0
    /**
     * @type {number}
     */
    this.touchUpSerial = 0
    /**
     * @type {number}
     */
    this.enterSerial = 0
    /**
     * @type {Array<function(GrKeyboard):void>}
     * @private
     */
    this._keyboardResourceListeners = []
  }

  /**
   * @param {Client}client
   * @param {number}id
   * @param {number}version
   */
  bindClient (client, id, version) {
    const grSeatResource = new GrSeat(client, id, version)
    grSeatResource.implementation = this
    this.resources.push(grSeatResource)

    grSeatResource.onDestroy().then((resource) => {
      const index = this.resources.indexOf(resource)
      this.resources.splice(index, 1)
    })

    this._emitCapabilities(grSeatResource)
    this._emitName(grSeatResource)
  }

  /**
   * @param {GrSeat}grSeatResource
   * @private
   */
  _emitCapabilities (grSeatResource) {
    let caps = pointer | keyboard
    if (this.hasTouch) {
      caps |= touch
    }
    grSeatResource.capabilities(caps)
  }

  /**
   * @param {GrSeat}grSeatResource
   * @private
   */
  _emitName (grSeatResource) {
    if (grSeatResource.version >= 2) {
      grSeatResource.name(this._seatName)
    }
  }

  /**
   * @return {number}
   */
  nextSerial () {
    this.serial++
    if (this.serial & (1 << 29)) {
      this.serial = 0
    }
    return this.serial
  }

  isValidInputSerial (serial) {
    return serial === this.buttonPressSerial || serial === this.buttonReleaseSerial || serial === this.keyPressSerial ||
      serial === this.keyReleaseSerial || serial === this.touchDownSerial || serial === this.touchUpSerial
  }

  nextEnterSerial () {
    this.enterSerial = this.nextSerial()
    return this.enterSerial
  }

  /**
   * @param {boolean}down
   * @return {number}
   */
  nextButtonSerial (down) {
    if (down) {
      const mask = 1 << 29
      this.buttonPressSerial = this.nextSerial() | mask
      return this.buttonPressSerial
    } else {
      const mask = 2 << 29
      this.buttonReleaseSerial = this.nextSerial() | mask
      return this.buttonReleaseSerial
    }
  }

  /**
   * @param {boolean}down
   * @return {number}
   */
  nextKeySerial (down) {
    if (down) {
      const mask = 3 << 29
      this.keyPressSerial = this.nextSerial() | mask
      return this.keyPressSerial
    } else {
      const mask = 4 << 29
      this.keyReleaseSerial = this.nextSerial() | mask
      return this.keyReleaseSerial
    }
  }

  /**
   * @param {boolean}down
   * @return {number}
   */
  nextTouchSerial (down) {
    if (down) {
      const mask = 5 << 29
      this.touchDownSerial = this.nextSerial() | mask
      return this.touchDownSerial
    } else {
      const mask = 6 << 29
      this.touchUpSerial = this.nextSerial() | mask
      return this.touchUpSerial
    }
  }

  /**
   *
   *                The ID provided will be initialized to the gr_pointer interface
   *                for this seat.
   *
   *                This request only takes effect if the seat has the pointer
   *                capability, or has had the pointer capability in the past.
   *                It is a protocol violation to issue this request on a seat that has
   *                never had the pointer capability.
   *
   *
   * @param {GrSeat} resource
   * @param {number} id seat pointer
   *
   * @since 1
   *
   */
  getPointer (resource, id) {
    const grPointerResource = new GrPointer(resource.client, id, resource.version)
    grPointerResource.implementation = this.browserPointer
    this.browserPointer.resources.push(grPointerResource)
    grPointerResource.onDestroy().then(() => {
      const idx = this.browserPointer.resources.indexOf(grPointerResource)
      if (idx > -1) {
        this.browserPointer.resources.splice(idx, 1)
      }
    })
  }

  /**
   *
   *                The ID provided will be initialized to the gr_keyboard interface
   *                for this seat.
   *
   *                This request only takes effect if the seat has the keyboard
   *                capability, or has had the keyboard capability in the past.
   *                It is a protocol violation to issue this request on a seat that has
   *                never had the keyboard capability.
   *
   *
   * @param {GrSeat} resource
   * @param {number} id seat keyboard
   *
   * @since 1
   *
   */
  getKeyboard (resource, id) {
    const grKeyboardResource = new GrKeyboard(resource.client, id, resource.version)
    grKeyboardResource.implementation = this.browserKeyboard
    this.browserKeyboard.resources.push(grKeyboardResource)
    grKeyboardResource.onDestroy().then(() => {
      const idx = this.browserKeyboard.resources.indexOf(grKeyboardResource)
      if (idx > -1) {
        this.browserKeyboard.resources.splice(idx, 1)
      }
    })

    this.browserKeyboard.emitKeymap(grKeyboardResource)
    this.browserKeyboard.emitKeyRepeatInfo(grKeyboardResource)
    this._keyboardResourceListeners.forEach((listener) => listener(grKeyboardResource))
  }

  /**
   * @param {function(GrKeyboard):void}listener
   */
  addKeyboardResourceListener (listener) {
    this._keyboardResourceListeners.push(listener)
  }

  removeKeyboardResourceListener (listener) {
    const idx = this._keyboardResourceListeners.indexOf(listener)
    if (idx > -1) {
      this._keyboardResourceListeners.splice(idx, 1)
    }
  }

  /**
   *
   *                The ID provided will be initialized to the gr_touch interface
   *                for this seat.
   *
   *                This request only takes effect if the seat has the touch
   *                capability, or has had the touch capability in the past.
   *                It is a protocol violation to issue this request on a seat that has
   *                never had the touch capability.
   *
   *
   * @param {GrSeat} resource
   * @param {number} id seat touch interface
   *
   * @since 1
   *
   */
  getTouch (resource, id) {
    const grTouchResource = new GrTouch(resource.client, id, resource.version)
    this.browserTouch.resources.push(grTouchResource)

    if (this.hasTouch) {
      grTouchResource.implementation = this.browserTouch
    }
  }

  /**
   *
   *                Using this request a client can tell the server that it is not going to
   *                use the seat object anymore.
   *
   *
   * @param {GrSeat} resource
   *
   * @since 5
   *
   */
  release (resource) {
    resource.destroy()
    const index = this.resources.indexOf(resource)
    if (index > -1) {
      this.resources.splice(index, 1)
    }
  }
}

export default BrowserSeat
