import {
  display,
  GrWebShmProtocolName,
  GrWebShmProxy,
  WlBufferProxy,
  WlCompositorProtocolName,
  WlCompositorProxy,
  WlKeyboardProxy,
  WlOutputEvents,
  WlOutputMode,
  WlOutputProtocolName,
  WlOutputProxy,
  WlPointerEvents,
  WlPointerProxy,
  WlRegistryProxy,
  WlSeatCapability,
  WlSeatEvents,
  WlSeatProtocolName,
  WlSeatProxy,
  WlSurfaceEvents,
  WlSurfaceProxy,
  WlTouchProxy
} from 'westfield-runtime-client'
import { Fixed } from 'westfield-runtime-common'

class Output implements WlOutputEvents {
  x: number = 0
  y: number = 0
  width: number = 0
  height: number = 0
  scale_: number = 1
  initialized: boolean = false

  constructor(public wlOutput: WlOutputProxy) {
  }

  done(): void {
    this.initialized = true
  }

  geometry(x: number, y: number, physicalWidth: number, physicalHeight: number, subpixel: number, make: string, model: string, transform: number): void {
    this.x = x
    this.y = y
  }

  mode(flags: number, width: number, height: number, refresh: number): void {
    if (flags & WlOutputMode._current) {
      this.width = width
      this.height = height
    }
  }

  scale(factor: number): void {
    this.scale_ = factor
  }
}

type TestBuffer = {
  proxy: WlBufferProxy
  // size_t len;
  // pixman_image_t *image;
}

class Surface implements WlSurfaceEvents {
  output?: Output
  x: number = 0
  y: number = 0
  width: number = 0
  height: number = 0
  buffer?: TestBuffer

  constructor(public wlSurface: WlSurfaceProxy) {
  }

  enter(output: WlOutputProxy): void {
    this.output = output.listener as Output

    console.log(`test-client: got surface enter output ${this.output.wlOutput.id}`)
  }

  leave(output: WlOutputProxy): void {
    this.output = undefined

    console.log(`test-client: got surface leave output ${output.id}`)
  }
}

class Pointer implements WlPointerEvents {
  focus?: Surface
  x: number = 0
  y: number = 0
  button_: number = 0
  state: number = 0
  axis_: number = 0
  axisValue: number = 0
  motionTimeMsec: number = 0
  buttonTimeMsec: number = 0
  axisTimeMsec: number = 0
  axisStopTimeMsec: number = 0
  inputTimestamp: DOMHighResTimeStamp = 0
  motionTimeTimespec: DOMHighResTimeStamp = 0
  buttonTimeTimespec: DOMHighResTimeStamp = 0
  axisTimeTimespec: DOMHighResTimeStamp = 0
  axisStopTimeTimespec: DOMHighResTimeStamp = 0

  constructor(public wlPointer: WlPointerProxy) {
  }

  axis(time: number, axis: number, value: Fixed): void {
    this.axis_ = axis
    this.axisValue = value.asDouble()
    this.axisTimeMsec = time
    this.axisTimeTimespec = this.inputTimestamp
    this.inputTimestamp = 0

    console.log(`test-client: got pointer axis ${axis} ${value.asDouble()}`)
  }

  axisDiscrete(axis: number, discrete: number): void {
    console.log(`test-client: got pointer axis discrete ${axis} ${discrete}`)
  }

  axisSource(axisSource: number): void {
    console.log(`test-client: got pointer axis source ${axisSource}`)
  }

  axisStop(time: number, axis: number): void {
    this.axis_ = axis
    this.axisStopTimeMsec = time
    this.axisStopTimeTimespec = this.inputTimestamp
    this.inputTimestamp = 0

    console.log(`test-client: got pointer axis stop ${axis}`)
  }

  button(serial: number, time: number, button: number, state: number): void {
    this.button_ = button
    this.state = state
    this.buttonTimeMsec = time
    this.buttonTimeTimespec = this.inputTimestamp
    this.inputTimestamp = 0

    console.log(`test-client: got pointer button ${button} ${state}`)
  }

  enter(serial: number, surface: WlSurfaceProxy | undefined, surfaceX: Fixed, surfaceY: Fixed): void {
    if (surface?.listener) {
      this.focus = surface.listener as Surface
    } else {
      this.focus = undefined
    }

    this.x = surfaceX.asInt()
    this.y = surfaceY.asInt()

    console.log(`test-client: got pointer enter ${this.x} ${this.y}, surface ${this.focus?.wlSurface.id}`)
  }

  frame(): void {
    console.log(`test-client: got pointer frame`)
  }

  leave(serial: number, surface: WlSurfaceProxy): void {
    this.focus = undefined
    console.log(`test-client: got pointer leave, surface ${surface?.id}`)
  }

  motion(time: number, surfaceX: Fixed, surfaceY: Fixed): void {
    this.x = surfaceX.asInt()
    this.y = surfaceY.asInt()
    this.motionTimeMsec = time
    this.motionTimeTimespec = this.inputTimestamp
    this.inputTimestamp = 0

    console.log(`test-client: got pointer motion ${this.x} ${this.y}`)
  }
}

type Keyboard = {
  wlKeyboard: WlKeyboardProxy
  surface: Surface
  key: number
  state: number
  modsDepressed: number
  modsLatched: number
  modsLocked: number
  group: number
  repeatInfo: {
    rate: number
    delay: number
  }
  keyTimeMsec: number
  inputTimestamp: DOMHighResTimeStamp
  keyTimeTimespec: DOMHighResTimeStamp
}

type Touch = {
  wlTouch: WlTouchProxy
  downX: number
  downY: number
  x: number
  y: number
  id: number
  upId: number/* id of last wl_touch.up event */
  frameNo: number
  cancelNo: number
  downTimeMsec: number
  upTimeMsec: number
  motionTimeMsec: number
  inputTimestamp: DOMHighResTimeStamp
  downTimeTimespec: DOMHighResTimeStamp
  upTimeTimespec: DOMHighResTimeStamp
  motionTimeTimespec: DOMHighResTimeStamp
}

interface Global {
  name: number,
  interface_: string,
  version: number
}

class Input implements WlSeatEvents {
  pointer?: Pointer
  keyboard?: Keyboard
  touch?: Touch
  seatName?: string
  caps: WlSeatCapability = 0

  constructor(
    public client: Client,
    public globalName: number,
    public wlSeat: WlSeatProxy
  ) {
  }

  capabilities(capabilities: number): void {
    this.caps = capabilities

    /* we will create/update the devices only with the right (test) seat.
     * If we haven't discovered which seat is the test seat, just
     * store capabilities and bail out */
    this.updateDevices()

    console.log(`test-client: got seat ${this.wlSeat.id} capabilities: ${capabilities}`)
  }

  name(name: string): void {
    this.seatName = name
    this.updateDevices()
    this.client.input = this

    console.log(`test-client: got seat ${this.wlSeat.id} name: '${name}'`)
  }

  private updateDevices() {
    if ((this.caps & WlSeatCapability._pointer) && !this.pointer) {
      this.pointer = new Pointer(this.wlSeat.getPointer())
      this.pointer.wlPointer.listener = this.pointer
    }
  }

  destroy() {
    this.pointer?.wlPointer.release()
    this.keyboard?.wlKeyboard.release()
    this.touch?.wlTouch.release()

    this.client.inputs = this.client.inputs.filter(input => input !== this)
    this.wlSeat.release()

    this.pointer = undefined
    this.keyboard = undefined
    this.touch = undefined
    this.seatName = undefined
  }
}

async function createClient() {
  const wlRegistry = display.getRegistry()
  const client = new Client(wlRegistry)
  wlRegistry.listener = {
    global: (name: number, interface_: string, version: number): void => client.handleGlobal(name, interface_, version),
    globalRemove: (name: number): void => client.handleGlobalRemove(name)
  }
  /* this roundtrip makes sure we have all globals and we bound to them */
  await client.roundtrip()

  /* this roundtrip makes sure we got all events */
  await client.roundtrip()

  if (client.output === undefined) {
    throw new Error('Client did not receive output global from compositor.')
  }
  if (!client.output.initialized) {
    throw new Error('Client did not have an initialized output from compositor.')
  }
  if (client.input === undefined) {
    throw new Error('Client did not receive a seat global from compositor.')
  }

  return client
}

class Client {
  wlCompositor?: WlCompositorProxy
  webShm?: GrWebShmProxy
  /* the seat that is actually used for input events */
  input?: Input
  /* server can have more wl_seats. We need keep them all until we
   * find the one that we need. After that, the others
   * will be destroyed, so this list will have the length of 1.
   * If some day in the future we will need the other seats,
   * we can just keep them here. */
  inputs: Input[] = []
  output?: Output
  surface?: Surface
  globalList: Global[] = []
  outputList: Output[] = []
  bufferCopyDone?: boolean

  constructor(public wlRegistry: WlRegistryProxy) {
  }

  handleGlobal(name: number, interface_: string, version: number): void {
    const global: Global = { name, interface_, version }
    this.globalList = [...this.globalList, global]

    if (interface_ === WlCompositorProtocolName) {
      this.wlCompositor = this.wlRegistry.bind(name, interface_, WlCompositorProxy, version)
    } else if (interface_ === WlSeatProtocolName) {
      const input = new Input(
        this,
        global.name,
        this.wlRegistry.bind(name, interface_, WlSeatProxy, version)
      )
      input.wlSeat.listener = input
    } else if (interface_ === GrWebShmProtocolName) {
      this.webShm = this.wlRegistry.bind(name, interface_, GrWebShmProxy, version)
      // TODO bufferpool?
    } else if (interface_ === WlOutputProtocolName) {
      this.output = new Output(this.wlRegistry.bind(name, interface_, WlOutputProxy, version))
      this.output.wlOutput.listener = this.output
      this.outputList = [...this.outputList, this.output]
    }
  }

  handleGlobalRemove(name: number): void {
    const global = this.findGlobalWithName(name)
    if (global === undefined) {
      throw new Error('Request to remove unknown global')
    }

    if (global.interface_ === WlSeatProtocolName) {
      const input = this.findInputWithName(name)
      if (input) {
        if (this.input === input) {
          this.input = undefined
        }
        input.destroy()
      }
    }

    this.globalList = this.globalList.filter(global_ => global !== global_)
  }

  private findInputWithName(name: number): Input | undefined {
    return this.inputs.find(input => input.globalName === name)
  }

  private findGlobalWithName(name: number): Global | undefined {
    return this.globalList.find(global => global.name === name)
  }

  destroy() {
    this.surface?.destroy()
    this.inputs.forEach(input => input.destroy())
    this.outputList.forEach(output => output.destroy())
    this.globalList = []

    this.webShm?.destroy()
    this.wlCompositor?.destroy()
    this.wlRegistry.destroy()
  }

  roundtrip(): Promise<number> {
    display.flush()
    return display.sync()
  }

  createTestSurface() {
    const wlSurface = this.wlCompositor?.createSurface()
    if(wlSurface === undefined){
      throw new Error('Compositor global not found.')
    }
    const surface = new Surface(wlSurface)
    wlSurface.listener = surface

    return surface
  }
}

async function createClientAndTestSurface(x: number, y: number, width: number, height: number) {
  const client = await createClient()
  const surface = client.createTestSurface()
  client.surface = surface

  surface.width = width
  surface.height = height
  surface.buffer = client.createWebShmBuffer(width, height)
// TODO more
}

function main() {

}

main()
