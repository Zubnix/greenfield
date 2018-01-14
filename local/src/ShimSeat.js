'use strict'

const WlSeatRequests = require('./protocol/wayland/WlSeatRequests')

const WlPointer = require('./protocol/wayland/WlPointer')
const WlKeyboard = require('./protocol/wayland/WlKeyboard')
const WlTouch = require('./protocol/wayland/WlTouch')

const ShimPointer = require('./ShimPointer')
const ShimKeyboard = require('./ShimKeyboard')
const ShimTouch = require('./ShimTouch')

const LocalPointer = require('./LocalPointer')
const LocalKeyboard = require('./LocalKeyboard')
const LocalTouch = require('./LocalTouch')

module.exports = class ShimSeat extends WlSeatRequests {
  static create (grSeatProxy) {
    return new ShimSeat(grSeatProxy)
  }

  constructor (grSeatProxy) {
    super()
    this.proxy = grSeatProxy
  }

  /**
   *
   *  The ID provided will be initialized to the wl_pointer interface
   *  for this seat.
   *
   *  This request only takes effect if the seat has the pointer
   *  capability, or has had the pointer capability in the past.
   *  It is a protocol violation to issue this request on a seat that has
   *  never had the pointer capability.
   *
   *
   * @param {WlSeat} resource
   * @param {*} id seat pointer
   *
   * @since 1
   *
   */
  getPointer (resource, id) {
    const grPointerProxy = this.proxy.getPointer()
    const localPointer = LocalPointer.create()
    grPointerProxy.listener = localPointer

    const shimPointer = ShimPointer.create(grPointerProxy)
    localPointer.resource = WlPointer.create(resource.client, resource.version, id, shimPointer, null)
  }

  /**
   *
   *  The ID provided will be initialized to the wl_keyboard interface
   *  for this seat.
   *
   *  This request only takes effect if the seat has the keyboard
   *  capability, or has had the keyboard capability in the past.
   *  It is a protocol violation to issue this request on a seat that has
   *  never had the keyboard capability.
   *
   *
   * @param {WlSeat} resource
   * @param {*} id seat keyboard
   *
   * @since 1
   *
   */
  getKeyboard (resource, id) {
    const grKeyboardProxy = this.proxy.getKeyboard()
    const localKeyboard = LocalKeyboard.create(grKeyboardProxy)
    grKeyboardProxy.listener = localKeyboard

    const shimKeyboard = ShimKeyboard.create(grKeyboardProxy)
    localKeyboard.resource = WlKeyboard.create(resource.client, resource.version, id, shimKeyboard, null)
  }

  /**
   *
   *  The ID provided will be initialized to the wl_touch interface
   *  for this seat.
   *
   *  This request only takes effect if the seat has the touch
   *  capability, or has had the touch capability in the past.
   *  It is a protocol violation to issue this request on a seat that has
   *  never had the touch capability.
   *
   *
   * @param {WlSeat} resource
   * @param {*} id seat touch interface
   *
   * @since 1
   *
   */
  getTouch (resource, id) {
    const grTouchProxy = this.proxy.getTouch()
    const localTouch = LocalTouch.create()
    grTouchProxy.listener = localTouch

    const shimTouch = ShimTouch.create(grTouchProxy)
    localTouch.resource = WlTouch.create(resource.client, resource.version, id, shimTouch, null)
  }

  /**
   *
   *  Using this request a client can tell the server that it is not going to
   *  use the seat object anymore.
   *
   *
   * @param {WlSeat} resource
   *
   * @since 5
   *
   */
  release (resource) {
    this.proxy.release()
    resource.destroy()
  }
}
