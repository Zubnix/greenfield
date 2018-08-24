'use strict'

const WlDataDeviceRequests = require('./protocol/wayland/WlDataDeviceRequests')

class ShimDataDevice extends WlDataDeviceRequests {
  /**
   * @param {GrDataDevice}grDataDeviceProxy
   * @return {ShimDataDevice}
   */
  static create (grDataDeviceProxy) {
    return new ShimDataDevice(grDataDeviceProxy)
  }

  constructor (grDataDeviceProxy) {
    super()
    this.proxy = grDataDeviceProxy
  }

  startDrag (resource, source, origin, icon, serial) {
    this.proxy.startDrag(source === null ? null : source.implementation.proxy, origin.implementation.proxy, icon === null ? null : icon.implementation.proxy, serial)
  }

  setSelection (resource, source, serial) {
    this.proxy.setSelection(source === null ? null : source.implementation.proxy, serial)
  }

  release (resource) {
    this.proxy.release()
    resource.destroy()
  }
}

module.exports = ShimDataDevice
