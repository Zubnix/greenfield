// Copyright 2020 Erik De Rijcke
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

import { SendMessage, WebFD } from 'westfield-runtime-common'
import { Client, WlBufferResource } from 'westfield-runtime-server'
import { CompositorRemoteSocket } from './index'
import RemoteOutOfBandChannel from './RemoteOutOfBandChannel'
import StreamingBuffer from './remotestreaming/StreamingBuffer'
import Session from './Session'
import { XWaylandConnection } from './xwayland/XWaylandConnection'
import XWaylandShell from './xwayland/XWaylandShell'
import { XWindowManager } from './xwayland/XWindowManager'

type XWaylandConectionState = {
  state: 'pending' | 'open',
  xConnection?: XWaylandConnection,
  wlClient?: Client,
  xwm?: XWindowManager
}

const xWaylandConnections: { [key: string]: XWaylandConectionState } = {}

class RemoteSocket implements CompositorRemoteSocket {
  private readonly _session: Session
  private readonly _textEncoder: TextEncoder = new TextEncoder()
  private readonly _textDecoder: TextDecoder = new TextDecoder()

  static create(session: Session): RemoteSocket {
    return new RemoteSocket(session)
  }

  private constructor(session: Session) {
    this._session = session
  }

  async ensureXWayland(appEndpointURL: URL) {
    const xWaylandBaseURL = new URL(appEndpointURL.origin)
    xWaylandBaseURL.searchParams.append('compositorSessionId', this._session.compositorSessionId)
    const xWaylandBaseURLhref = xWaylandBaseURL.href

    if (xWaylandConnections[xWaylandBaseURLhref] === undefined) {
      xWaylandConnections[xWaylandBaseURLhref] = { state: 'pending', }
      xWaylandBaseURL.searchParams.append('xwayland', 'connection')
      const xWaylandConnectionEndpointURL = xWaylandBaseURL.href

      // The backend might choose to (re)use a different websocket connection. The chosen xwayland websocket connection will receive an out-of-band opcode 7.
      try {
        const anyWaylandClientWebSocket = new WebSocket(xWaylandConnectionEndpointURL)
        await this.onWebSocket(anyWaylandClientWebSocket)
      } catch (e) {
        delete xWaylandConnections[xWaylandBaseURLhref]
        throw e
      }
    }
  }

  private async _getShmTransferable(webFD: WebFD): Promise<ArrayBuffer> {
    // TODO get all contents at once from remote endpoint and put it in an array buffer
    // TODO do this on each invocation
    // return new ArrayBuffer(0)
    throw new Error('TODO. Shm transferable from endpoint not yet implemented.')
  }

  private async _closeShmTransferable(webFD: WebFD): Promise<void> {
    // TODO signal the remote end (if any) that it should close the fd
    throw new Error('TODO. Close shm transferable from endpoint not yet implemented.')
  }

  private async _getPipeTransferable(webFD: WebFD): Promise<MessagePort> {
    // TODO setup an open connection with the remote endpoint and transfer data on demand
    // const messageChannel = new MessageChannel()
    // TODO use port1 to interface with the remote endpoint
    // TODO only do this once until the messageChannel is closed
    // return messageChannel.port2

    throw new Error('TODO. Pipe transferable from endpoint not yet implemented.')
  }

  private async _closePipeTransferable(webFD: WebFD): Promise<void> {
    // TODO signal the remote end (if any) that it should close the fd
    // TODO close the messageChannel object
    throw new Error('TODO. close pipe transferable from endpoint not yet implemented.')
  }

  onWebSocket(webSocket: WebSocket): Promise<Client> {
    return new Promise((resolve, reject) => {
      // window.GREENFIELD_DEBUG && console.log('[WebSocket] - created.')

      webSocket.binaryType = 'arraybuffer'
      webSocket.onclose = () => {
        reject(new Error('Remote connection failed.'))
      }
      webSocket.onopen = () => {
        // window.GREENFIELD_DEBUG && console.log('[WebSocket] - open.')

        const client = this._session.display.createClient()
        // client.onClose().then(() => window.GREENFIELD_DEBUG && console.log('[client] - closed.'))
        client.addResourceCreatedListener(resource => {
          if (resource.id >= 0xff000000 && client.recycledIds.length === 0) {
            console.error('[client] - Ran out of reserved browser resource ids.')
            client.close()
          }
        })

        webSocket.onclose = () => {
          // window.GREENFIELD_DEBUG && console.log('[WebSocket] - closed.')
          client.close()
        }
        // webSocket.onerror = event =>  window.GREENFIELD_DEBUG && console.log(`[WebSocket] - error: ${event.message}.`)

        client.connection.onFlush = (wireMessages: SendMessage[]) => this._flushWireMessages(client, webSocket, wireMessages)

        const wsOutOfBandChannel = RemoteOutOfBandChannel.create(sendBuffer => {
          if (webSocket.readyState === 1) {
            try {
              webSocket.send(sendBuffer)
            } catch (e) {
              // TODO use centralized error reporting
              console.error('\tname: ' + e.name + ' message: ' + e.message + ' text: ' + e.text)
              console.error('error object stack: ')
              console.error(e.stack)
              client.close()
            }
          }
        })
        this._setupClientOutOfBandHandlers(webSocket, client, wsOutOfBandChannel)

        webSocket.onmessage = event => this._handleMessageEvent(client, event, wsOutOfBandChannel)

        client.onClose().then(() => {
          this._session.userShell.events.destroyApplicationClient?.({
            id: client.id,
            variant: 'remote'
          })
        })
        this._session.userShell.events.createApplicationClient?.({
          id: client.id,
          variant: 'remote'
        })
        resolve(client)
      }
    })
  }

  private _setupClientOutOfBandHandlers(webSocket: WebSocket, client: Client, outOfBandChannel: RemoteOutOfBandChannel) {
    // send out-of-band resource destroy. opcode: 1
    client.addResourceDestroyListener(resource => {
      outOfBandChannel.send(1, new Uint32Array([resource.id]).buffer)
    })

    // listen for buffer creation. opcode: 2
    outOfBandChannel.setListener(2, message => {
      if (client.connection.closed) {
        return
      }

      const wlBufferResource = new WlBufferResource(client, new Uint32Array(message.buffer, message.byteOffset)[0], 1)
      wlBufferResource.implementation = StreamingBuffer.create(wlBufferResource)
    })

    // listen for buffer contents arriving. opcode: 3
    outOfBandChannel.setListener(3, outOfBandMessage => {
      if (client.connection.closed) {
        return
      }

      const bufferContentsDataView = new DataView(outOfBandMessage.buffer, outOfBandMessage.byteOffset)
      const bufferId = bufferContentsDataView.getUint32(0, true)
      const wlBufferResource = client.connection.wlObjects[bufferId] as WlBufferResource

      // Buffer might be destroyed while waiting for it's content to arrive.
      if (wlBufferResource) {
        const streamingBuffer = wlBufferResource.implementation as StreamingBuffer

        const bufferContents = new Uint8Array(outOfBandMessage.buffer, outOfBandMessage.byteOffset + Uint32Array.BYTES_PER_ELEMENT)
        streamingBuffer.bufferStream.onBufferContents(bufferContents)
      }
    })

    // listen for file contents request. opcode: 4
    outOfBandChannel.setListener(4, async outOfBandMessage => {
      if (client.connection.closed) {
        return
      }

      const uint32Array = new Uint32Array(outOfBandMessage.buffer, outOfBandMessage.byteOffset)
      const fd = uint32Array[0]
      const webFD = this._session.webFS.getWebFD(fd)
      const transferable = await webFD.getTransferable()

      // Note that after contents have been transmitted, webfd is auto closed.
      if (transferable instanceof ArrayBuffer) {
        const serializedWebFdURL = this._textEncoder.encode(webFD.url.href)
        const webFDByteLength = serializedWebFdURL.byteLength
        const message = new Uint8Array(Uint32Array.BYTES_PER_ELEMENT + ((webFDByteLength + 3) & ~3) + transferable.byteLength) // webFdURL + fileContents
        let byteOffset = 0
        // web fd url length
        new DataView(message.buffer).setUint32(byteOffset, webFDByteLength, true)
        byteOffset += Uint32Array.BYTES_PER_ELEMENT
        // web fd url
        message.set(serializedWebFdURL, byteOffset)
        byteOffset += (webFDByteLength + 3) & ~3
        // fd contents
        message.set(new Uint8Array(transferable), byteOffset)

        // send back file contents. opcode: 4
        outOfBandChannel.send(4, message.buffer)
        webFD.close()
      }
    })

    // listen for web socket creation request. opcode: 5
    outOfBandChannel.setListener(5, outOfBandMessage => {
      if (client.connection.closed) {
        return
      }

      const uint32Array = new Uint32Array(outOfBandMessage.buffer, outOfBandMessage.byteOffset)
      const clientId = uint32Array[0]

      const webSocketURL = new URL(new URL(webSocket.url).origin)
      webSocketURL.searchParams.append('clientId', `${clientId}`)
      webSocketURL.searchParams.append('compositorSessionId', this._session.compositorSessionId)

      const newWebSocket = new WebSocket(webSocketURL.href)
      this.onWebSocket(newWebSocket)
    })

    // listen for recycled resource ids
    outOfBandChannel.setListener(6, outOfBandMessage => {
      if (client.connection.closed) {
        return
      }

      const ids = new Uint32Array(outOfBandMessage.buffer, outOfBandMessage.byteOffset)
      client.recycledIds = Array.from(ids)
    })

    // listen for XWayland XWM connection request
    outOfBandChannel.setListener(7, async outOfBandMessage => {
      const wmFD = new Uint32Array(outOfBandMessage.buffer, outOfBandMessage.byteOffset)[0]

      const xWaylandBaseURL = new URL(new URL(webSocket.url).origin)
      xWaylandBaseURL.searchParams.append('compositorSessionId', this._session.compositorSessionId)
      const xWaylandBaseURLhref = xWaylandBaseURL.href

      const xWaylandConnection = xWaylandConnections[xWaylandBaseURLhref]
      if (xWaylandConnection !== undefined) {
        xWaylandConnection.state = 'open'
        xWaylandConnection.wlClient = client
        xWaylandBaseURL.searchParams.append('xwmFD', `${wmFD}`)
        const xConnection = await XWaylandConnection.create(new WebSocket(xWaylandBaseURL.href))
        client.onClose().then(() => xConnection.destroy())
        xConnection.onDestroy().then(() => delete xWaylandConnections[xWaylandBaseURLhref])
        xWaylandConnection.xConnection = xConnection
        try {
          xWaylandConnection.xwm = await XWindowManager.create(this._session, xConnection, client, XWaylandShell.create(this._session))
        } catch (e) {
          console.error('Failed to create X Window Manager.', e)
        }
      }
    })
  }

  private _handleMessageEvent(client: Client, event: MessageEvent, wsOutOfBandChannel: RemoteOutOfBandChannel) {
    if (client.connection.closed) {
      return
    }

    try {
      const arrayBuffer = event.data as ArrayBuffer
      const dataView = new DataView(arrayBuffer)
      const outOfBand = dataView.getUint32(0, true)
      if (outOfBand) {
        wsOutOfBandChannel.message(arrayBuffer)
      } else {
        let offset = 0
        const receiveBuffer = new Uint32Array(arrayBuffer, Uint32Array.BYTES_PER_ELEMENT)
        const fdsInCount = receiveBuffer[offset++]
        const webFDs = new Array(fdsInCount)
        for (let i = 0; i < fdsInCount; i++) {
          const { read, webFd } = this._deserializeWebFD(receiveBuffer.subarray(offset))
          offset += read
          webFDs[i] = webFd
        }
        const buffer = receiveBuffer.subarray(offset)
        client.connection.message({ buffer, fds: webFDs }).catch((e: Error) => {
          // TODO use centralized error reporting
          // @ts-ignore
          console.error('\tname: ' + e.name + ' message: ' + e.message + ' text: ' + e.text)
          console.error('error object stack: ')
          console.error(e.stack)
        })
      }
    } catch (e) {
      // TODO use centralized error reporting
      console.error('\tname: ' + e.name + ' message: ' + e.message + ' text: ' + e.text)
      console.error('error object stack: ')
      console.error(e.stack)
    }
  }

  private _flushWireMessages(client: Client, webSocket: WebSocket, wireMessages: SendMessage[]) {
    if (client.connection.closed) {
      return
    }

    let messageSize = 1 // +1 for indicator of it's an out of band message
    const serializedWireMessages = wireMessages.map(wireMessage => {
      let size = 1 // +1 for fd length
      const serializedWebFds: Uint8Array[] = wireMessage.fds.map((webFd: WebFD) => {
        const serializedWebFD = this._textEncoder.encode(webFd.url.href)
        size += 1 + (((serializedWebFD.byteLength + 3) & ~3) / 4) // +1 for fd url length
        return serializedWebFD
      })

      messageSize += (size + (wireMessage.buffer.byteLength / 4))

      return {
        buffer: wireMessage.buffer,
        serializedWebFds
      }
    })

    const sendBuffer = new Uint32Array(messageSize)
    let offset = 0
    sendBuffer[offset++] = 0 // no out-of-band opcode

    serializedWireMessages.forEach(serializedWireMessage => {
      sendBuffer[offset++] = serializedWireMessage.serializedWebFds.length
      serializedWireMessage.serializedWebFds.forEach(serializedWebFd => {
        sendBuffer[offset++] = serializedWebFd.byteLength
        new Uint8Array(sendBuffer.buffer, sendBuffer.byteOffset + (offset * Uint32Array.BYTES_PER_ELEMENT)).set(serializedWebFd)
        offset += ((serializedWebFd.byteLength + 3) & ~3) / 4
      })

      const message = new Uint32Array(serializedWireMessage.buffer)
      sendBuffer.set(message, offset)
      offset += message.length
    })

    if (webSocket.readyState === 1) { // 1 === 'open'
      try {
        webSocket.send(sendBuffer.buffer)
      } catch (e) {
        console.log(e.message)
        client.close()
      }
    }
  }

  private _deserializeWebFD(sourceBuf: Uint32Array): { read: number, webFd: WebFD } {
    // FIXME we only need to handle fetching remote contents if the webfd does not match this compositor
    // If it does match, we simply need to lookup the WebFD from our own WebFS cache, and return that one instead.
    const webFdbyteLength = sourceBuf[0]
    const webFdBytes = new Uint8Array(sourceBuf.buffer, sourceBuf.byteOffset + Uint32Array.BYTES_PER_ELEMENT, webFdbyteLength)

    const webFdURL = new URL(this._textDecoder.decode(webFdBytes))
    const fdParam = webFdURL.searchParams.get('fd')
    if (fdParam === null) {
      throw new Error('BUG. WebFD URL does not have fd query param.')
    }
    const fd = Number.parseInt(fdParam)
    const type = webFdURL.searchParams.get('type')

    let onGetTransferable
    let onClose
    switch (type) {
      case 'ArrayBuffer':
        onGetTransferable = (webFD: WebFD) => this._getShmTransferable(webFD)
        onClose = (webFD: WebFD) => this._closeShmTransferable(webFD)
        break
      case 'MessagePort':
        onGetTransferable = (webFD: WebFD) => this._getPipeTransferable(webFD)
        onClose = (webFD: WebFD) => this._closePipeTransferable(webFD)
        break
      // case 3: 'ImageBitmap' can not be transferred to a remote
      default:
        throw new Error(`Unsupported WebFD type: ${type}`)
    }
    return {
      read: 1 + (((webFdbyteLength + 3) & ~3) / 4),
      webFd: new WebFD(fd, type, webFdURL, onGetTransferable, onClose)
    }
  }
}

export default RemoteSocket
