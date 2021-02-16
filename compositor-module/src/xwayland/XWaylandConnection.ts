import { connect, webConnectionSetup, XConnection } from 'xtsb'

export class XWaylandConnection {
  static create(webSocket: WebSocket): Promise<XWaylandConnection> {
    return new Promise<XWaylandConnection>((resolve, reject) => {
      webSocket.onopen = async _ => {
        webSocket.onerror = ev => console.log(`XWM connection ${webSocket.url} error: ${ev}`)
        const xwm = new XWaylandConnection(webSocket)
        webSocket.onclose = _ => xwm.destroy()
        resolve(xwm)
      }
      webSocket.onerror = ev => {
        if (webSocket.readyState === WebSocket.CONNECTING) {
          reject(new Error(`XWM connection ${webSocket.url} failed: ${ev}`))
        }
      }
    })
  }

  // @ts-ignore assigned in constructor in promise cb
  private destroyResolve: (value?: (PromiseLike<void> | void)) => void
  private readonly destroyPromise: Promise<void>

  // @ts-ignore assigned in constructor in promise cb
  private setupPromise?: Promise<XConnection>

  xConnection?: XConnection
  readonly webSocket: WebSocket

  constructor(webSocket: WebSocket) {
    this.webSocket = webSocket
    this.destroyPromise = new Promise<void>(resolve => this.destroyResolve = resolve)
  }

  destroy() {
    this.webSocket.close()
    this.destroyResolve()
  }

  onDestroy() {
    return this.destroyPromise
  }

  setup(): Promise<XConnection> {
    if (this.setupPromise === undefined) {
      this.setupPromise = new Promise<XConnection>(async resolve => {
        this.xConnection = await connect(webConnectionSetup(this.webSocket))
        resolve(this.xConnection)
      })
    }
    return this.setupPromise
  }
}
