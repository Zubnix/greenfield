import { WlObject } from 'westfield-runtime-common'
import { Client, WlPointerButtonState, WlSurfaceResource } from 'westfield-runtime-server'
import type {
  ATOM,
  ButtonPressEvent,
  ButtonReleaseEvent,
  ClientMessageEvent,
  ConfigureNotifyEvent,
  ConfigureRequestEvent,
  CreateNotifyEvent,
  DestroyNotifyEvent,
  EnterNotifyEvent,
  FocusInEvent,
  GetPropertyReply,
  LeaveNotifyEvent,
  MapNotifyEvent,
  MapRequestEvent,
  MotionNotifyEvent,
  PropertyNotifyEvent,
  ReparentNotifyEvent,
  SCREEN,
  TIMESTAMP,
  UnmapNotifyEvent,
  WINDOW,
  XConnection,
  XFixes
} from 'xtsb'
import {
  Atom,
  chars,
  ColormapAlloc,
  Composite,
  ConfigWindow,
  Cursor,
  EventMask,
  getComposite,
  getRender,
  getXFixes,
  ImageFormat,
  InputFocus,
  marshallClientMessageEvent,
  marshallConfigureNotifyEvent,
  NotifyMode,
  PropMode,
  Render,
  StackMode,
  Time,
  Window,
  WindowClass
} from 'xtsb'
import eResize from '../assets/e-resize.png'
import leftPtr from '../assets/left_ptr.png'
import nResize from '../assets/n-resize.png'
import neResize from '../assets/ne-resize.png'
import nwResize from '../assets/nw-resize.png'
import sResize from '../assets/s-resize.png'
import seResize from '../assets/se-resize.png'
import swResize from '../assets/sw-resize.png'
import wResize from '../assets/w-resize.png'
import Rect from '../math/Rect'
import Output from '../Output'
import Region from '../Region'
import Session from '../Session'
import Surface from '../Surface'
import { XWaylandConnection } from './XWaylandConnection'
import XWaylandShell from './XWaylandShell'
import XWaylandShellSurface from './XWaylandShellSurface'
import {
  Frame,
  FrameButton,
  frameCreate,
  FrameFlag,
  FrameStatus,
  Theme,
  themeCreate,
  ThemeLocation
} from './XWindowFrame'

type ConfigureValueList = Parameters<XConnection['configureWindow']>[1]
type MwmDecor = number

const topBarHeight = 25

const SEND_EVENT_MASK = 0x80

const MWM_DECOR_ALL: 1 = 1
const MWM_DECOR_BORDER: 2 = 2
const MWM_DECOR_RESIZEH: 4 = 4
const MWM_DECOR_TITLE: 8 = 8
const MWM_DECOR_MENU: 16 = 16
const MWM_DECOR_MINIMIZE: 32 = 32
const MWM_DECOR_MAXIMIZE: 64 = 64

const MWM_DECOR_EVERYTHING: 126 = 126

const MWM_HINTS_FUNCTIONS: 1 = 1
const MWM_HINTS_DECORATIONS: 2 = 2
const MWM_HINTS_INPUT_MODE: 4 = 4
const MWM_HINTS_STATUS: 8 = 8

const MWM_FUNC_ALL: 1 = 1
const MWM_FUNC_RESIZE: 2 = 2
const MWM_FUNC_MOVE: 4 = 4
const MWM_FUNC_MINIMIZE: 8 = 8
const MWM_FUNC_MAXIMIZE: 16 = 16
const MWM_FUNC_CLOSE: 32 = 32

const MWM_INPUT_MODELESS: 0 = 0
const MWM_INPUT_PRIMARY_APPLICATION_MODAL: 1 = 1
const MWM_INPUT_SYSTEM_MODAL: 2 = 2
const MWM_INPUT_FULL_APPLICATION_MODAL: 3 = 3
const MWM_INPUT_APPLICATION_MODAL = MWM_INPUT_PRIMARY_APPLICATION_MODAL

const MWM_TEAROFF_WINDOW: 1 = 1

const _NET_WM_MOVERESIZE_SIZE_TOPLEFT: 0 = 0
const _NET_WM_MOVERESIZE_SIZE_TOP: 1 = 1
const _NET_WM_MOVERESIZE_SIZE_TOPRIGHT: 2 = 2
const _NET_WM_MOVERESIZE_SIZE_RIGHT: 3 = 3
const _NET_WM_MOVERESIZE_SIZE_BOTTOMRIGHT: 4 = 4
const _NET_WM_MOVERESIZE_SIZE_BOTTOM: 5 = 5
const _NET_WM_MOVERESIZE_SIZE_BOTTOMLEFT: 6 = 6
const _NET_WM_MOVERESIZE_SIZE_LEFT: 7 = 7
const _NET_WM_MOVERESIZE_MOVE: 8 = 8   /* movement only */
const _NET_WM_MOVERESIZE_SIZE_KEYBOARD: 9 = 9   /* size via keyboard */
const _NET_WM_MOVERESIZE_MOVE_KEYBOARD: 10 = 10   /* move via keyboard */
const _NET_WM_MOVERESIZE_CANCEL: 11 = 11   /* cancel operation */

const ICCCM_WITHDRAWN_STATE: 0 = 0
const ICCCM_NORMAL_STATE: 1 = 1
const ICCCM_ICONIC_STATE: 3 = 3

type NamedAtom = [
  name: string,
  value: number
]

/* We reuse some predefined, but otherwise useles atoms
 * as local type placeholders that never touch the X11 server,
 * to make weston_wm_window_read_properties() less exceptional.
 */
const TYPE_WM_PROTOCOLS = Atom.cutBuffer0
const TYPE_MOTIF_WM_HINTS = Atom.cutBuffer1
const TYPE_NET_WM_STATE = Atom.cutBuffer2
const TYPE_WM_NORMAL_HINTS = Atom.cutBuffer3

type Prop = [atom: ATOM, type: ATOM, propUpdater: (prop: GetPropertyReply) => void]

type XWMAtoms = {
  WM_PROTOCOLS: number
  WM_NORMAL_HINTS: number
  WM_TAKE_FOCUS: number
  WM_DELETE_WINDOW: number
  WM_STATE: number
  WM_S0: number
  WM_CLIENT_MACHINE: number
  _NET_WM_CM_S0: number
  _NET_WM_NAME: number
  _NET_WM_PID: number
  _NET_WM_ICON: number
  _NET_WM_STATE: number
  _NET_WM_STATE_MAXIMIZED_VERT: number
  _NET_WM_STATE_MAXIMIZED_HORZ: number
  _NET_WM_STATE_FULLSCREEN: number
  _NET_WM_USER_TIME: number
  _NET_WM_ICON_NAME: number
  _NET_WM_DESKTOP: number
  _NET_WM_WINDOW_TYPE: number

  _NET_WM_WINDOW_TYPE_DESKTOP: number
  _NET_WM_WINDOW_TYPE_DOCK: number
  _NET_WM_WINDOW_TYPE_TOOLBAR: number
  _NET_WM_WINDOW_TYPE_MENU: number
  _NET_WM_WINDOW_TYPE_UTILITY: number
  _NET_WM_WINDOW_TYPE_SPLASH: number
  _NET_WM_WINDOW_TYPE_DIALOG: number
  _NET_WM_WINDOW_TYPE_DROPDOWN_MENU: number
  _NET_WM_WINDOW_TYPE_POPUP_MENU: number
  _NET_WM_WINDOW_TYPE_TOOLTIP: number
  _NET_WM_WINDOW_TYPE_NOTIFICATION: number
  _NET_WM_WINDOW_TYPE_COMBO: number
  _NET_WM_WINDOW_TYPE_DND: number
  _NET_WM_WINDOW_TYPE_NORMAL: number

  _NET_WM_MOVERESIZE: number
  _NET_SUPPORTING_WM_CHECK: number
  _NET_SUPPORTED: number
  _NET_ACTIVE_WINDOW: number
  _MOTIF_WM_HINTS: number
  CLIPBOARD: number
  CLIPBOARD_MANAGER: number
  TARGETS: number
  UTF8_STRING: number
  _WL_SELECTION: number
  INCR: number
  TIMESTAMP: number
  MULTIPLE: number
  COMPOUND_TEXT: number
  TEXT: number
  STRING: number
  WINDOW: number
  'text/plain;charset=utf-8': number
  'text/plain': number
  XdndSelection: number
  XdndAware: number
  XdndEnter: number
  XdndLeave: number
  XdndDrop: number
  XdndStatus: number
  XdndFinished: number
  XdndTypeList: number
  XdndActionCopy: number
  _XWAYLAND_ALLOW_COMMITS: number
  WL_SURFACE_ID: number
}

interface XWindowManagerResources {
  xFixes: XFixes.XFixes,
  composite: Composite.Composite,
  render: Render.Render,
  xwmAtoms: XWMAtoms,
  formatRgb: Render.PICTFORMINFO,
  formatRgba: Render.PICTFORMINFO
}

interface VisualAndColormap {
  visualId: number,
  colormap: number
}

interface SizeHints {
  flags: number,
  x: number
  y: number
  width: number,
  height: number
  minWidth: number,
  minHeight: number,
  maxWidth: number,
  maxHeight: number,
  widthInc: number
  heightInc: number
  minAspect: { x: number, y: number }
  maxAspect: { x: number, y: number }
  baseWidth: number,
  baseHeight: number,
  winGravity: number
}

const USPosition = 1
const USSize = 2
const PPosition = 4
const PSize = 8
const PMinSize = 16
const PMaxSize = 32
const PResizeInc = 64
const PAspect = 128
const PBaseSize = 256
const PWinGravity = 512

interface MotifWmHints {
  flags: number,
  functions: number,
  decorations: number,
  inputMode: number,
  status: number
}

enum CursorType {
  XWM_CURSOR_TOP,
  XWM_CURSOR_BOTTOM,
  XWM_CURSOR_LEFT,
  XWM_CURSOR_RIGHT,
  XWM_CURSOR_TOP_LEFT,
  XWM_CURSOR_TOP_RIGHT,
  XWM_CURSOR_BOTTOM_LEFT,
  XWM_CURSOR_BOTTOM_RIGHT,
  XWM_CURSOR_LEFT_PTR,
}

const cursorImageNames = {
  [CursorType.XWM_CURSOR_BOTTOM]: { url: sResize, xhot: 15, yhot: 27, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_LEFT_PTR]: { url: leftPtr, xhot: 3, yhot: 2, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_BOTTOM_LEFT]: { url: swResize, xhot: 6, yhot: 27, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_BOTTOM_RIGHT]: {
    url: seResize,
    xhot: 27,
    yhot: 27,
    width: 32,
    height: 32
  },
  [CursorType.XWM_CURSOR_LEFT]: { url: wResize, xhot: 6, yhot: 15, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_RIGHT]: { url: eResize, xhot: 27, yhot: 15, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_TOP]: { url: nResize, xhot: 16, yhot: 6, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_TOP_LEFT]: { url: nwResize, xhot: 6, yhot: 6, width: 32, height: 32 },
  [CursorType.XWM_CURSOR_TOP_RIGHT]: { url: neResize, xhot: 27, yhot: 6, width: 32, height: 32 }
} as const

export class WmWindow {
  class = ''
  decorate = 0
  deleteWindow = false
  frameId = 0
  fullscreen = false
  hasAlpha = false
  machine = ''
  maximizedHorizontal = false
  maximizedVertical = false
  name = ''
  pid = 0
  type = 0
  propertiesDirty = true
  positionDirty = false
  mapRequestX = Number.MIN_SAFE_INTEGER /* out of range for valid positions */
  mapRequestY = Number.MIN_SAFE_INTEGER /* out of range for valid positions */
  didDouble = false
  lastButtonTime = 0
  savedHeight = 0
  savedWidth = 0

  surface?: Surface
  surfaceId?: number
  surfaceDestroyListener?: (surfaceResource: WlObject) => void
  frame?: Frame
  sizeHints?: SizeHints
  motifHints?: MotifWmHints
  shsurf?: XWaylandShellSurface
  legacyFullscreenOutput?: Output
  transientFor?: WmWindow
  configureSource?: () => void
  repaintSource?: () => void

  constructor(
    private wm: XWindowManager,
    public id: number,
    public overrideRedirect: boolean,
    public x: number,
    public y: number,
    public width: number,
    public height: number) {
  }

  wmWindowActivate(surface?: Surface) {
    if (surface === undefined) {
      this.wm.setNetActiveWindow(Window.None)
    } else {
      this.wm.setNetActiveWindow(this.id)
    }

    this.wm.sendFocusWindow(this)

    if (this.wm.focusWindow) {
      this.wm.focusWindow.frame?.unsetFlag(FrameFlag.FRAME_FLAG_ACTIVE)
      this.wm.wmWindowScheduleRepaint(this.wm.focusWindow)
    }

    this.wm.focusWindow = this
    if (this.wm.focusWindow) {
      this.wm.focusWindow.frame?.setFlag(FrameFlag.FRAME_FLAG_ACTIVE)
      this.wm.wmWindowScheduleRepaint(this.wm.focusWindow)
    }

    this.wm.xConnection.flush()
  }
}

async function setupResources(xConnection: XConnection): Promise<XWindowManagerResources> {
  const xFixesPromise = getXFixes(xConnection)
  const compositePromise = getComposite(xConnection)
  const renderPromise = getRender(xConnection)

  const atoms: NamedAtom[] = [
    ['WM_PROTOCOLS', 0],
    ['WM_NORMAL_HINTS', 0],
    ['WM_TAKE_FOCUS', 0],
    ['WM_DELETE_WINDOW', 0],
    ['WM_STATE', 0],
    ['WM_S0', 0],
    ['WM_CLIENT_MACHINE', 0],
    ['_NET_WM_CM_S0', 0],
    ['_NET_WM_NAME', 0],
    ['_NET_WM_PID', 0],
    ['_NET_WM_ICON', 0],
    ['_NET_WM_STATE', 0],
    ['_NET_WM_STATE_MAXIMIZED_VERT', 0],
    ['_NET_WM_STATE_MAXIMIZED_HORZ', 0],
    ['_NET_WM_STATE_FULLSCREEN', 0],
    ['_NET_WM_USER_TIME', 0],
    ['_NET_WM_ICON_NAME', 0],
    ['_NET_WM_DESKTOP', 0],
    ['_NET_WM_WINDOW_TYPE', 0],

    ['_NET_WM_WINDOW_TYPE_DESKTOP', 0],
    ['_NET_WM_WINDOW_TYPE_DOCK', 0],
    ['_NET_WM_WINDOW_TYPE_TOOLBAR', 0],
    ['_NET_WM_WINDOW_TYPE_MENU', 0],
    ['_NET_WM_WINDOW_TYPE_UTILITY', 0],
    ['_NET_WM_WINDOW_TYPE_SPLASH', 0],
    ['_NET_WM_WINDOW_TYPE_DIALOG', 0],
    ['_NET_WM_WINDOW_TYPE_DROPDOWN_MENU', 0],
    ['_NET_WM_WINDOW_TYPE_POPUP_MENU', 0],
    ['_NET_WM_WINDOW_TYPE_TOOLTIP', 0],
    ['_NET_WM_WINDOW_TYPE_NOTIFICATION', 0],
    ['_NET_WM_WINDOW_TYPE_COMBO', 0],
    ['_NET_WM_WINDOW_TYPE_DND', 0],
    ['_NET_WM_WINDOW_TYPE_NORMAL', 0],

    ['_NET_WM_MOVERESIZE', 0],
    ['_NET_SUPPORTING_WM_CHECK', 0],
    ['_NET_SUPPORTED', 0],
    ['_NET_ACTIVE_WINDOW', 0],
    ['_MOTIF_WM_HINTS', 0],
    ['CLIPBOARD', 0],
    ['CLIPBOARD_MANAGER', 0],
    ['TARGETS', 0],
    ['UTF8_STRING', 0],
    ['_WL_SELECTION', 0],
    ['INCR', 0],
    ['TIMESTAMP', 0],
    ['MULTIPLE', 0],
    ['COMPOUND_TEXT', 0],
    ['TEXT', 0],
    ['STRING', 0],
    ['WINDOW', 0],
    ['text/plain;charset=utf-8', 0],
    ['text/plain', 0],
    ['XdndSelection', 0],
    ['XdndAware', 0],
    ['XdndEnter', 0],
    ['XdndLeave', 0],
    ['XdndDrop', 0],
    ['XdndStatus', 0],
    ['XdndFinished', 0],
    ['XdndTypeList', 0],
    ['XdndActionCopy', 0],
    ['_XWAYLAND_ALLOW_COMMITS', 0],
    ['WL_SURFACE_ID', 0]
  ]

  const [xFixes, composite, render] = await Promise.all([xFixesPromise, compositePromise, renderPromise])
  const formatsReply = render.queryPictFormats()
  const interAtomCookies = atoms.map(([name]) => xConnection.internAtom(0, chars(name)))

  const atomReplies = await Promise.all(interAtomCookies)
  atomReplies.forEach(({ atom }, index) => atoms[index][1] = atom)

  const { formats } = await formatsReply
  let formatRgb: Render.PICTFORMINFO | undefined = undefined
  let formatRgba: Render.PICTFORMINFO | undefined = undefined
  formats.forEach(format => {
    if (format.direct.redMask != 0xff &&
      format.direct.redShift != 16) {
      return
    }
    if (format._type == Render.PictType.Direct &&
      format.depth == 24) {
      formatRgb = format
    }
    if (format._type == Render.PictType.Direct &&
      format.depth == 32 &&
      format.direct.alphaMask == 0xff &&
      format.direct.alphaShift == 24) {
      formatRgba = format
    }
  })

  if (formatRgb === undefined) {
    throw new Error('no direct RGB picture format found.')
  }
  if (formatRgba === undefined) {
    throw new Error('no direct RGBA picture format found.')
  }

  const xwmAtoms: XWMAtoms = Object.fromEntries(atoms) as XWMAtoms

  return {
    xFixes,
    composite,
    render,
    xwmAtoms,
    formatRgb,
    formatRgba
  }
}

function setupVisualAndColormap(xConnection: XConnection): VisualAndColormap {
  const visuals = xConnection.setup.roots.map(screen => {
    const depth = screen.allowedDepths.find(depth => depth.depth === 32)
    return depth?.visuals
  })?.[0]

  if (visuals === undefined) {
    throw new Error('no 32 bit visualtype\n')
  }
  const visualId = visuals[0].visualId

  const colormap = xConnection.allocateID()
  xConnection.createColormap(ColormapAlloc.None, colormap, xConnection.setup.roots[0].root, visualId)

  return {
    visualId,
    colormap
  }
}

const _NET_WM_STATE_REMOVE = 0
const _NET_WM_STATE_ADD = 1
const _NET_WM_STATE_TOGGLE = 2

function updateState(action: number, state: number | boolean): { newState: number | boolean, changed: boolean } {
  let newState, changed

  switch (action) {
    case _NET_WM_STATE_REMOVE:
      newState = 0
      break
    case _NET_WM_STATE_ADD:
      newState = 1
      break
    case _NET_WM_STATE_TOGGLE:
      newState = !state
      break
    default:
      return { changed: false, newState: state }
  }

  changed = (state !== newState)

  return { changed, newState }
}

function getCursorForLocation(location: ThemeLocation | undefined): CursorType {
  switch (location) {
    case ThemeLocation.THEME_LOCATION_RESIZING_TOP:
      return CursorType.XWM_CURSOR_TOP
    case ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM:
      return CursorType.XWM_CURSOR_BOTTOM
    case ThemeLocation.THEME_LOCATION_RESIZING_LEFT:
      return CursorType.XWM_CURSOR_LEFT
    case ThemeLocation.THEME_LOCATION_RESIZING_RIGHT:
      return CursorType.XWM_CURSOR_RIGHT
    case ThemeLocation.THEME_LOCATION_RESIZING_TOP_LEFT:
      return CursorType.XWM_CURSOR_TOP_LEFT
    case ThemeLocation.THEME_LOCATION_RESIZING_TOP_RIGHT:
      return CursorType.XWM_CURSOR_TOP_RIGHT
    case ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM_LEFT:
      return CursorType.XWM_CURSOR_BOTTOM_LEFT
    case ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM_RIGHT:
      return CursorType.XWM_CURSOR_BOTTOM_RIGHT
    case ThemeLocation.THEME_LOCATION_EXTERIOR:
    case ThemeLocation.THEME_LOCATION_TITLEBAR:
    default:
      return CursorType.XWM_CURSOR_LEFT_PTR
  }
}

function selectionInit() {
  //TODO see weston's selection.c file
}

function dndInit() {
  // TODO see weston's dnd.c
}

function setNetActiveWindow(xConnection: XConnection, screen: SCREEN, xwmAtoms: XWMAtoms, window: WINDOW) {
  xConnection.changeProperty(PropMode.Replace, screen.root, xwmAtoms._NET_ACTIVE_WINDOW, xwmAtoms.WINDOW, 32, new Uint32Array([window]))
}

function createWMWindow(xConnection: XConnection, screen: SCREEN, xwmAtoms: XWMAtoms): number {
  const wmWindow = xConnection.allocateID()
  xConnection.createWindow(
    WindowClass.CopyFromParent,
    wmWindow,
    screen.root,
    0,
    0,
    10,
    10,
    0,
    WindowClass.InputOutput,
    screen.rootVisual,
    {}
  )

  xConnection.changeProperty(
    PropMode.Replace,
    wmWindow,
    xwmAtoms._NET_SUPPORTING_WM_CHECK,
    Atom.WINDOW,
    32,
    new Uint32Array([wmWindow])
  )

  xConnection.changeProperty(
    PropMode.Replace,
    wmWindow,
    xwmAtoms._NET_WM_NAME,
    xwmAtoms.UTF8_STRING,
    8,
    chars('Greenfield WM')
  )

  xConnection.changeProperty(
    PropMode.Replace,
    screen.root,
    xwmAtoms._NET_SUPPORTING_WM_CHECK,
    Atom.WINDOW,
    32,
    new Uint32Array([wmWindow])
  )

  xConnection.setSelectionOwner(wmWindow, xwmAtoms.WM_S0, Time.CurrentTime)
  xConnection.setSelectionOwner(wmWindow, xwmAtoms._NET_WM_CM_S0, Time.CurrentTime)

  return wmWindow
}

export class XWindowManager {
  static async create(session: Session, xWaylandConnetion: XWaylandConnection, client: Client, xWaylandShell: XWaylandShell) {
    const xConnection = await xWaylandConnetion.setup()
    xConnection.onPostEventLoop = () => {
      xConnection.flush()
    }
    // TODO expand error information in xtsb so we know which call the error originated from
    xConnection.defaultExceptionHandler = (error: Error) => {
      console.error(JSON.stringify(error))
    }

    // TODO listen for any event here
    // TODO see weston weston_wm_handle_selection_event
    // xConnection.onEvent = xWindowManager.handleSelectionEvent(event)
    // TODO see weston weston_wm_handle_dnd_event
    // xConnection.onEvent = xWindowManager.handleDndEvent(event)

    xConnection.onButtonPressEvent = async event => await xWindowManager.handleButton(event)
    xConnection.onButtonReleaseEvent = async event => await xWindowManager.handleButton(event)
    xConnection.onEnterNotifyEvent = async event => await xWindowManager.handleEnter(event)
    xConnection.onLeaveNotifyEvent = async event => await xWindowManager.handleLeave(event)
    xConnection.onMotionNotifyEvent = async event => await xWindowManager.handleMotion(event)
    xConnection.onCreateNotifyEvent = async event => await xWindowManager.handleCreateNotify(event)
    xConnection.onMapRequestEvent = async event => await xWindowManager.handleMapRequest(event)
    xConnection.onMapNotifyEvent = async event => await xWindowManager.handleMapNotify(event)
    xConnection.onUnmapNotifyEvent = async event => await xWindowManager.handleUnmapNotify(event)
    xConnection.onReparentNotifyEvent = async event => await xWindowManager.handleReparentNotify(event)
    xConnection.onConfigureRequestEvent = async event => await xWindowManager.handleConfigureRequest(event)
    xConnection.onConfigureNotifyEvent = async event => await xWindowManager.handleConfigureNotify(event)
    xConnection.onDestroyNotifyEvent = async event => await xWindowManager.handleDestroyNotify(event)
    // xConnection.onMappingNotifyEvent = async event => console.log('XCB_MAPPING_NOTIFY')
    xConnection.onPropertyNotifyEvent = async event => await xWindowManager.handlePropertyNotify(event)
    xConnection.onClientMessageEvent = async event => await xWindowManager.handleClientMessage(event)
    xConnection.onFocusInEvent = async event => await xWindowManager.handleFocusIn(event)

    const xWmResources = await setupResources(xConnection)
    const visualAndColormap = setupVisualAndColormap(xConnection)

    xConnection.changeWindowAttributes(xConnection.setup.roots[0].root, { eventMask: EventMask.SubstructureNotify | EventMask.SubstructureRedirect | EventMask.PropertyChange })
    const { composite, xwmAtoms } = xWmResources
    composite.redirectSubwindows(xConnection.setup.roots[0].root, Composite.Redirect.Manual)

    // An immediately invoked lambda that uses function argument destructuring to filter out elements and return them as an array.
    const supported = (({
                          _NET_WM_MOVERESIZE,
                          _NET_WM_STATE,
                          _NET_WM_STATE_FULLSCREEN,
                          _NET_WM_STATE_MAXIMIZED_VERT,
                          _NET_WM_STATE_MAXIMIZED_HORZ,
                          _NET_ACTIVE_WINDOW
                        }: XWMAtoms) => [
      _NET_WM_MOVERESIZE,
      _NET_WM_STATE,
      _NET_WM_STATE_FULLSCREEN,
      _NET_WM_STATE_MAXIMIZED_VERT,
      _NET_WM_STATE_MAXIMIZED_HORZ,
      _NET_ACTIVE_WINDOW
    ])(xwmAtoms)

    xConnection.changeProperty(PropMode.Replace, xConnection.setup.roots[0].root, xwmAtoms._NET_SUPPORTED, Atom.ATOM, 32, new Uint32Array(supported))

    setNetActiveWindow(xConnection, xConnection.setup.roots[0], xwmAtoms, Window.None)

    // TODO
    selectionInit()
    // TODO
    dndInit()
    // TODO

    xConnection.flush()

    const wmWindow = createWMWindow(xConnection, xConnection.setup.roots[0], xwmAtoms)

    const xWindowManager = new XWindowManager(session, xConnection, client, xWaylandShell, xConnection.setup.roots[0], xWmResources, visualAndColormap, wmWindow)

    // FIXME causes connection to hang
    await xWindowManager.createCursors()
    xWindowManager.wmWindowSetCursor(xWindowManager.screen.root, CursorType.XWM_CURSOR_LEFT_PTR)

    session.globals.compositor.addSurfaceCreationListener(async surface => await xWindowManager.handleCreateSurface(surface))

    return xWindowManager
  }

  private readonly session: Session
  readonly xConnection: XConnection
  private readonly client: Client
  private readonly xWaylandShell: XWaylandShell
  private readonly atoms: XWMAtoms
  private readonly composite: Composite.Composite
  private readonly render: Render.Render
  private readonly xFixes: XFixes.XFixes
  private readonly formatRgb: Render.PICTFORMINFO
  private readonly formatRgba: Render.PICTFORMINFO
  private readonly visualId: number
  private readonly colormap: number
  private readonly screen: SCREEN
  private readonly wmWindow: WINDOW
  readonly windowHash: { [key: number]: WmWindow } = {}
  private unpairedWindowList: WmWindow[] = []
  private readonly theme: Theme = themeCreate()
  private readonly imageDecodingCanvas: HTMLCanvasElement = document.createElement('canvas')
  private readonly imageDecodingContext: CanvasRenderingContext2D = this.imageDecodingCanvas.getContext('2d', {
    alpha: true,
    desynchronized: true
  })!!

  private cursors: { [key in CursorType]: Cursor } = {
    [CursorType.XWM_CURSOR_BOTTOM]: Cursor.None,
    [CursorType.XWM_CURSOR_LEFT_PTR]: Cursor.None,
    [CursorType.XWM_CURSOR_BOTTOM_LEFT]: Cursor.None,
    [CursorType.XWM_CURSOR_BOTTOM_RIGHT]: Cursor.None,
    [CursorType.XWM_CURSOR_LEFT]: Cursor.None,
    [CursorType.XWM_CURSOR_RIGHT]: Cursor.None,
    [CursorType.XWM_CURSOR_TOP]: Cursor.None,
    [CursorType.XWM_CURSOR_TOP_LEFT]: Cursor.None,
    [CursorType.XWM_CURSOR_TOP_RIGHT]: Cursor.None
  }
  private lastCursor: CursorType = -1

  focusWindow?: WmWindow
  private doubleClickPeriod: number = 250

  constructor(
    session: Session,
    xConnection: XConnection,
    client: Client,
    xWaylandShell: XWaylandShell,
    screen: SCREEN,
    { xwmAtoms, composite, render, xFixes, formatRgb, formatRgba }: XWindowManagerResources,
    { visualId, colormap }: VisualAndColormap,
    wmWindow: WINDOW
  ) {
    this.session = session
    this.xConnection = xConnection
    this.client = client
    this.xWaylandShell = xWaylandShell
    this.atoms = xwmAtoms
    this.composite = composite
    this.render = render
    this.xFixes = xFixes
    this.formatRgb = formatRgb
    this.formatRgba = formatRgba
    this.visualId = visualId
    this.colormap = colormap
    this.screen = screen
    this.wmWindow = wmWindow
  }

  async createCursors() {
    // @ts-ignore
    await Promise.all(Object.entries(cursorImageNames).map(async ([name, cursorImage]) => this.cursors[name] = await this.loadCursor(cursorImage)))
    this.lastCursor = -1
  }


  private async handleButton(event: ButtonPressEvent | ButtonReleaseEvent) {
    // TODO we want event codes from xtsb
    const buttonPress = 4
    // console.log(`XCB_BUTTON_${event.responseType === buttonPress ? 'PRESS' : 'RELEASE'} (detail ${event.detail})`)

    const window = this.lookupWindow(event.event)

    if (window === undefined || !window.decorate) {
      return
    }

    if (event.detail !== 1 && event.detail !== 2) {
      return
    }

    const seat = this.session.globals.seat
    const pointer = seat.pointer

    const buttonState = event.responseType === buttonPress ?
      WlPointerButtonState.pressed :
      WlPointerButtonState.released

    // TODO constants from input.h ?
    const buttonId = event.detail === 1 ? 0x110 : 0x111

    let doubleClick = false
    if (buttonState === WlPointerButtonState.pressed) {
      if ((event.time - window.lastButtonTime) <= this.doubleClickPeriod) {
        doubleClick = true
        window.didDouble = true
      } else {
        window.didDouble = false
      }
    } else if (window.didDouble) {
      doubleClick = true
      window.didDouble = false
    }

    /* Make sure we're looking at the right location.  The frame
     * could have received a motion event from a pointer from a
     * different wl_seat, but under X it looks like our core
     * pointer moved.  Move the frame pointer to the button press
     * location before deciding what to do. */
    const windowFrame = window.frame
    if (windowFrame === undefined) {
      console.error('BUG. No window frame.')
      return
    }
    let location = windowFrame.pointerMotion(undefined, event.eventX, event.eventY)

    if (doubleClick) {
      location = windowFrame.doubleClick(undefined, buttonId, buttonState)
    } else {
      location = windowFrame.pointerButton(undefined, buttonId, buttonState)
    }

    const windowFrameStatus = windowFrame.status
    if (windowFrameStatus & FrameStatus.FRAME_STATUS_REPAINT) {
      this.wmWindowScheduleRepaint(window)
    }

    if (windowFrameStatus & FrameStatus.FRAME_STATUS_MOVE) {
      window.shsurf?.move(pointer)
      windowFrame.statusClear(FrameStatus.FRAME_STATUS_MOVE)
    }

    if (windowFrameStatus & FrameStatus.FRAME_STATUS_RESIZE) {
      window.shsurf?.resize(pointer, location)
      windowFrame.statusClear(FrameStatus.FRAME_STATUS_RESIZE)
    }

    if (windowFrameStatus & FrameStatus.FRAME_STATUS_CLOSE) {
      this.wmWindowClose(window, event.time)
      windowFrame.statusClear(FrameStatus.FRAME_STATUS_CLOSE)
    }

    if (windowFrameStatus & FrameStatus.FRAME_STATUS_MAXIMIZE) {
      window.maximizedHorizontal = !window.maximizedHorizontal
      window.maximizedVertical = !window.maximizedVertical
      if (this.wmWindowIsMaximized(window)) {
        window.savedWidth = window.width
        window.savedHeight = window.height
        window.shsurf?.setMaximized()
      } else {
        await this.wmWindowSetToplevel(window)
      }
      windowFrame.statusClear(FrameStatus.FRAME_STATUS_MAXIMIZE)
    }
  }

  private async handleEnter(event: EnterNotifyEvent) {
    const window = this.lookupWindow(event.event)

    if (window === undefined || !window.decorate) {
      return
    }

    const location = window.frame?.pointerEnter(undefined, event.eventX, event.eventY)
    if (window.frame?.status && (window.frame?.status & FrameStatus.FRAME_STATUS_REPAINT)) {
      this.wmWindowScheduleRepaint(window)
    }

    const cursor = getCursorForLocation(location)
    this.wmWindowSetCursor(window.frameId, cursor)
  }

  private async handleLeave(event: LeaveNotifyEvent) {
    const window = this.lookupWindow(event.event)

    if (window === undefined || !window.decorate) {
      return
    }

    window.frame?.pointerLeave(undefined)
    if (window.frame?.status && (window.frame?.status & FrameStatus.FRAME_STATUS_REPAINT)) {
      this.wmWindowScheduleRepaint(window)
    }

    this.wmWindowSetCursor(window.frameId, CursorType.XWM_CURSOR_LEFT_PTR)
  }

  private async handleMotion(event: MotionNotifyEvent) {
    const window = this.lookupWindow(event.event)

    if (window === undefined || !window.decorate) {
      return
    }

    const location = window.frame?.pointerMotion(undefined, event.eventX, event.eventY)
    if (window.frame?.status && (window.frame?.status & FrameStatus.FRAME_STATUS_REPAINT)) {
      this.wmWindowScheduleRepaint(window)
    }

    const cursor = getCursorForLocation(location)
    this.wmWindowSetCursor(window.frameId, cursor)
  }

  private async handleCreateNotify(event: CreateNotifyEvent) {
    // console.log(`XCB_CREATE_NOTIFY (window ${event.window}, at (${event.x}, ${event.y}), width ${event.width}, height ${event.height}${event.overrideRedirect ? 'override' : ''}${this.isOurResource(event.window) ? ', ours' : ''})`)
    if (this.isOurResource(event.window)) {
      return
    }

    await this.wmWindowCreate(event.window, event.width, event.height, event.x, event.y, event.overrideRedirect)
  }

  private async handleMapRequest(event: MapRequestEvent) {
    if (this.isOurResource(event.window)) {
      // console.log(`XCB_MAP_REQUEST (window ${event.window}, ours)`)
      return
    }

    const window = this.lookupWindow(event.window)
    if (window === undefined) {
      return
    }

    await this.wmWindowReadProperties(window)

    /* For a new Window, MapRequest happens before the Window is realized
     * in Xwayland. We do the real xcb_map_window() here as a response to
     * MapRequest. The Window will get realized (wl_surface created in
     * Wayland and WL_SURFACE_ID sent in X11) when it has been mapped for
     * real.
     *
     * MapRequest only happens for (X11) unmapped Windows. On UnmapNotify,
     * we reset shsurf to NULL, so even if X11 connection races far ahead
     * of the Wayland connection and the X11 client is repeatedly mapping
     * and unmapping, we will never have shsurf set on MapRequest.
     */
    if (window.shsurf !== undefined) {
      throw new Error('Assertion failed. X window should not have a shell surface on map request.')
    }

    window.mapRequestX = window.x
    window.mapRequestY = window.y

    if (window.frameId === Window.None) {
      await this.wmWindowCreateFrame(window) /* sets frame_id */
    }
    if (window.frameId === Window.None) {
      throw new Error('Assertion failed. X window should have a parent window.')
    }

    // console.log(`XCB_MAP_REQUEST (window ${window.id}, frame ${window.frameId}, ${window.width}x${window.height} @ ${window.mapRequestX},${window.mapRequestY})`)

    this.wmWindowSetAllowCommits(window, false)
    this.wmWindowSetWmState(window, ICCCM_NORMAL_STATE)
    this.wmWindowSetNetWmState(window)
    this.wmWindowSetVirtualDesktop(window, 0)
    const output = this.legacyFullscreen(window)
    if (output !== undefined) {
      window.fullscreen = true
      window.legacyFullscreenOutput = output
    }

    this.xConnection.mapWindow(event.window)
    this.xConnection.mapWindow(window.frameId)

    /* Mapped in the X server, we can draw immediately.
     * Cannot set pending state though, no weston_surface until
     * xserver_map_shell_surface() time. */
    this.wmWindowScheduleRepaint(window)
  }

  private handleMapNotify(event: MapNotifyEvent) {
    if (this.isOurResource(event.window)) {
      // console.log(`XCB_MAP_NOTIFY (window ${event.window}, ours)`)
      return
    }

    // console.log(`XCB_MAP_NOTIFY (window ${event.window}${event.overrideRedirect ? ', override' : ''})`)
  }

  private async handleUnmapNotify(event: UnmapNotifyEvent) {
    // console.log(`XCB_UNMAP_NOTIFY (window ${event.window}, event ${event.event}${this.isOurResource(event.window) ? ', ours' : ''})`)
    if (this.isOurResource(event.window)) {
      return
    }

    if (event.responseType & SEND_EVENT_MASK) {
      /* We just ignore the ICCCM 4.1.4 synthetic unmap notify
       * as it may come in after we've destroyed the window. */
      return
    }

    const window = this.lookupWindow(event.window)
    if (!window) {
      return
    }

    if (window.surfaceId) {
      /* Make sure we're not on the unpaired surface list or we
       * could be assigned a surface during surface creation that
       * was mapped before this unmap request.
       */
      window.surfaceId = undefined
    }

    if (this.focusWindow === window) {
      this.focusWindow = undefined
    }
    if (window.surface && window.surfaceDestroyListener) {
      window.surface.resource.removeDestroyListener(window.surfaceDestroyListener)
    }
    window.surface = undefined
    window.shsurf = undefined

    this.wmWindowSetWmState(window, ICCCM_WITHDRAWN_STATE)
    this.wmWindowSetVirtualDesktop(window, -1)

    this.xConnection.unmapWindow(window.frameId)
  }

  private async handleReparentNotify(event: ReparentNotifyEvent) {
    // console.log(`XCB_REPARENT_NOTIFY (window ${event.window}, parent ${event.parent}, event ${event.event}${event.overrideRedirect ? ', override' : ''})`)

    if (event.parent === this.screen.root) {
      await this.wmWindowCreate(event.window, 10, 10, event.x, event.y, event.overrideRedirect)
    } else if (!this.isOurResource(event.parent)) {
      const window = this.lookupWindow(event.window)
      if (!window) {
        return
      }
      this.wmWindowDestroy(window)
    }
  }

  private async handleConfigureRequest(event: ConfigureRequestEvent) {
    const window = this.lookupWindow(event.window)
    if (window === undefined) {
      return
    }

    if (window.fullscreen) {
      this.wmWindowSendConfigureNotify(window)
      return
    }

    if (event.valueMask & ConfigWindow.Width) {
      window.width = event.width
    }
    if (event.valueMask & ConfigWindow.Height) {
      window.height = event.height
    }

    if (window.frameId) {
      this.wmWindowSetAllowCommits(window, false)
      window.frame?.resizeInside(window.width, window.height)
    }

    const { x, y } = this.wmWindowGetChildPosition(window)
    const values: ConfigureValueList = {
      x,
      y,
      width: window.width,
      height: window.height,
      borderWidth: 0
    }
    if (event.valueMask & ConfigWindow.Sibling) {
      values.sibling = event.sibling
    }
    if (event.valueMask & ConfigWindow.StackMode) {
      values.stackMode = event.stackMode
    }

    this.configureWindow(window.id, values)
    this.wmWindowConfigureFrame(window)
    this.wmWindowScheduleRepaint(window)
  }

  private async handleConfigureNotify(event: ConfigureNotifyEvent) {
    // console.log(`XCB_CONFIGURE_NOTIFY (window ${event.window}) ${event.x},${event.y} @ ${event.width}x${event.height}${event.overrideRedirect ? ', override' : ''})`)

    const window = this.lookupWindow(event.window)
    if (!window) {
      return
    }

    window.x = event.x
    window.y = event.y
    window.positionDirty = false

    if (window.overrideRedirect) {
      window.width = event.width
      window.height = event.height
      if (window.frameId) {
        window.frame?.resizeInside(window.width, window.height)

        /* We should check if shsurf has been created because sometimes
         * there are races
         * (configure_notify is sent before xserver_map_surface) */
        window.shsurf?.setXwayland(window.x, window.y)
      }
    }
  }

  private async handleDestroyNotify(event: DestroyNotifyEvent) {
    // console.log(`XCB_DESTROY_NOTIFY, win ${event.window}, event ${event.event}${event.window ? ', ours' : ''}`)

    if (this.isOurResource(event.window)) {
      return
    }

    const window = this.lookupWindow(event.window)
    if (!window) {
      return
    }

    this.wmWindowDestroy(window)
  }

  private async handlePropertyNotify(event: PropertyNotifyEvent) {
    const window = this.lookupWindow(event.window)

    if (window === undefined) {
      return
    }

    window.propertiesDirty = true

    if (event.atom === this.atoms._NET_WM_NAME || event.atom === Atom.wmName) {
      this.wmWindowScheduleRepaint(window)
    }
  }

  private async handleClientMessage(event: ClientMessageEvent) {
    // console.log(`XCB_CLIENT_MESSAGE (${await this.getAtomName(event._type)} ${event.data.data32?.[0]} ${event.data.data32?.[1]} ${event.data.data32?.[2]} ${event.data.data32?.[3]} ${event.data.data32?.[4]} win ${event.window})`)

    const window = this.lookupWindow(event.window)
    /* The window may get created and destroyed before we actually
     * handle the message.  If it doesn't exist, bail.
     */
    if (!window) {
      return
    }

    if (event._type === this.atoms._NET_WM_MOVERESIZE) {
      this.wmWindowHandleMoveResize(window, event)
    } else if (event._type === this.atoms._NET_WM_STATE) {
      this.wmWindowHandleState(window, event)
    } else if (event._type === this.atoms.WL_SURFACE_ID) {
      await this.wmWindowHandleSurfaceId(window, event)
    }
  }

  private async handleFocusIn(event: FocusInEvent) {
    /* Do not interfere with grabs */
    if (event.mode === NotifyMode.Grab || event.mode === NotifyMode.Ungrab) {
      return
    }

    /* Do not let X clients change the focus behind the compositor's
     * back. Reset the focus to the old one if it changed. */
    if (!this.focusWindow || event.event !== this.focusWindow.id) {
      this.sendFocusWindow(this.focusWindow)
    }
  }

  private isOurResource(id: number) {
    const { resourceIdMask, resourceIdBase } = this.xConnection.setup
    return (id & ~resourceIdMask) === resourceIdBase
  }

  private lookupWindow(window: WINDOW): WmWindow | undefined {
    return this.windowHash[window]
  }

  private async wmWindowReadProperties(window: WmWindow) {
    if (!window.propertiesDirty) {
      return
    }
    window.propertiesDirty = false

    const props: Prop[] = [
      [Atom.wmClass, Atom.STRING, ({ value }) => window.class = value.chars()],
      [Atom.wmName, Atom.STRING, ({ value }) => window.name = value.chars()],
      [Atom.wmTransientFor, Atom.WINDOW, ({ value }) => {
        const lookupWindow = this.lookupWindow(new Uint32Array(value.buffer)[0])
        if (lookupWindow === undefined) {
          // console.log('XCB_ATOM_WINDOW contains window id not found in hash table.')
        } else {
          window.transientFor = lookupWindow
        }
      }],
      [this.atoms.WM_PROTOCOLS, TYPE_WM_PROTOCOLS, ({ value, valueLen }) => {
        const atoms = new Uint32Array(value.buffer)
        for (let i = 0; i < valueLen; i++) {
          if (atoms[i] === this.atoms.WM_DELETE_WINDOW) {
            window.deleteWindow = true
            break
          }
        }
      }],
      [this.atoms.WM_NORMAL_HINTS, TYPE_WM_NORMAL_HINTS, ({ value }) => {
        const [flags, x, y, width, height, minWidth, minHeight, maxWidth, maxHeight, widthInc, heightInc, minAspectX, minAspectY, maxAspectX, maxAspectY, baseWidth, baseHeight, winGravity] = new Uint32Array(value.buffer)
        window.sizeHints = {
          flags,
          x,
          y,
          width,
          height,
          minWidth,
          minHeight,
          maxWidth,
          maxHeight,
          widthInc,
          heightInc,
          minAspect: { x: minAspectX, y: minAspectY },
          maxAspect: { x: maxAspectX, y: maxAspectY },
          baseWidth,
          baseHeight,
          winGravity
        }
      }],
      [this.atoms._NET_WM_STATE, TYPE_NET_WM_STATE, ({ value, valueLen }) => {
        window.fullscreen = false
        const atoms = new Uint32Array(value.buffer)
        for (let i = 0; i < valueLen; i++) {
          if (atoms[i] === this.atoms._NET_WM_STATE_FULLSCREEN) {
            window.fullscreen = true
          }
          if (atoms[i] === this.atoms._NET_WM_STATE_MAXIMIZED_VERT) {
            window.maximizedVertical = true
          }
          if (atoms[i] === this.atoms._NET_WM_STATE_MAXIMIZED_HORZ) {
            window.maximizedHorizontal = true
          }
        }
      }],
      [this.atoms._NET_WM_WINDOW_TYPE, Atom.ATOM, ({ value }) => window.type = new Uint32Array(value.buffer)[0]],
      [this.atoms._NET_WM_NAME, Atom.STRING, ({ value }) => window.name = value.chars()],
      [this.atoms._NET_WM_PID, Atom.CARDINAL, ({ value }) => window.pid = new Uint32Array(value.buffer)[0]],
      [this.atoms._MOTIF_WM_HINTS, TYPE_MOTIF_WM_HINTS, ({ value }) => {
        const [flags, functions, decorations, inputMode, status] = new Uint32Array(value.buffer)
        window.motifHints = {
          flags,
          functions,
          decorations,
          inputMode,
          status
        }
        if (window.motifHints.flags & MWM_HINTS_DECORATIONS) {
          if (window.motifHints.decorations & MWM_DECOR_ALL) {
            /* MWM_DECOR_ALL means all except the other values listed. */
            window.decorate = MWM_DECOR_EVERYTHING & (~window.motifHints.decorations)
          } else {
            window.decorate = window.motifHints.decorations
          }
        }
      }],
      [this.atoms.WM_CLIENT_MACHINE, Atom.wmClientMachine, ({ value }) => window.machine = value.chars()]
    ]

    window.decorate = window.overrideRedirect ? 0 : MWM_DECOR_EVERYTHING
    if (window.sizeHints) {
      window.sizeHints.flags = 0
    }
    if (window.motifHints) {
      window.motifHints.flags = 0
    }
    window.deleteWindow = false

    props.forEach(([atom, type, propUpdater]: Prop) =>
      this.xConnection.getProperty(0, window.id, atom, Atom.Any, 0, 2048)
        .then(property => {
          if (property._type === Atom.None) {
            /* No such property */
            return
          }
          propUpdater(property)
        })
        .catch(() => {
          /* Bad window, typically */
        }))
  }

  private async wmWindowCreateFrame(window: WmWindow) {
    let buttons = FrameButton.FRAME_BUTTON_CLOSE

    if (window.decorate & MWM_DECOR_MAXIMIZE) {
      buttons |= FrameButton.FRAME_BUTTON_MAXIMIZE
    }

    window.frame = await frameCreate(this.theme, window.width, window.height, buttons, window.name)

    window.frame?.resizeInside(window.width, window.height)

    const { width, height } = this.wmWindowGetFrameSize(window)
    const { x, y } = this.wmWindowGetChildPosition(window)

    window.frameId = this.xConnection.allocateID()
    this.xConnection.createWindow(
      32,
      window.frameId,
      this.screen.root,
      0,
      0,
      width,
      height,
      0,
      WindowClass.InputOutput,
      this.visualId,
      {
        borderPixel: this.screen.blackPixel,
        eventMask: EventMask.KeyPress |
          EventMask.KeyRelease |
          EventMask.ButtonPress |
          EventMask.ButtonRelease |
          EventMask.PointerMotion |
          EventMask.EnterWindow |
          EventMask.LeaveWindow |
          EventMask.SubstructureNotify |
          EventMask.SubstructureRedirect,
        colormap: this.colormap
      })

    this.xConnection.reparentWindow(window.id, window.frameId, x, y)

    this.configureWindow(window.id, { borderWidth: 0 })

    this.windowHash[window.frameId] = window
  }

  private configureWindow(id: WINDOW, valueList: ConfigureValueList) {
    this.xConnection.configureWindow(id, valueList)
  }

  /** Control Xwayland wl_surface.commit behaviour
   *
   * This function sets the "_XWAYLAND_ALLOW_COMMITS" property of the frame window
   * (not the content window!) to allow.
   *
   * If the property is set to true, Xwayland will commit whenever it likes.
   * If the property is set to false, Xwayland will not commit.
   * If the property is not set at all, Xwayland assumes it is true.
   *
   * @param window The XWM window to control.
   * @param allow Whether Xwayland is allowed to wl_surface.commit for the window.
   */
  private wmWindowSetAllowCommits(window: WmWindow, allow: boolean) {
    if (window.frameId === undefined) {
      throw new Error('Window does not have a parent.')
    }

    this.xConnection.changeProperty(PropMode.Replace, window.frameId, this.atoms._XWAYLAND_ALLOW_COMMITS, Atom.CARDINAL, 32, new Uint32Array([allow ? 1 : 0]))
    this.xConnection.flush()
  }

  private wmWindowSetNetWmState(window: WmWindow) {
    const property: number[] = []
    if (window.fullscreen) {
      property.push(this.atoms._NET_WM_STATE_FULLSCREEN)
    }
    if (window.maximizedVertical) {
      property.push(this.atoms._NET_WM_STATE_MAXIMIZED_VERT)
    }
    if (window.maximizedVertical) {
      property.push(this.atoms._NET_WM_STATE_MAXIMIZED_HORZ)
    }

    this.xConnection.changeProperty(PropMode.Replace, window.id, this.atoms._NET_WM_STATE, Atom.ATOM, 32, new Uint32Array(property))
  }

  /*
   * Sets the _NET_WM_DESKTOP property for the window to 'desktop'.
   * Passing a <0 desktop value deletes the property.
   */
  private wmWindowSetVirtualDesktop(window: WmWindow, desktop: number) {
    if (desktop >= 0) {
      this.xConnection.changeProperty(PropMode.Replace, window.id, this.atoms._NET_WM_DESKTOP, Atom.CARDINAL, 32, new Uint32Array([desktop]))
    } else {
      this.xConnection.deleteProperty(window.id, this.atoms._NET_WM_DESKTOP)
    }
  }

  wmWindowScheduleRepaint(window: WmWindow) {
    if (window.frameId === Window.None) {
      /* Override-redirect windows go through here, but we
       * cannot assert(window->override_redirect); because
       * we do not deal with changing OR flag yet.
       * XXX: handle OR flag changes in message handlers
       */
      this.wmWindowSetPendingStateOR(window)
      return
    }

    if (window.repaintSource) {
      return
    }

    // console.log(`XWM: schedule repaint, win ${window.id}`)

    window.repaintSource = this.client.connection.addIdleHandler(() => { this.wmWindowDoRepaint(window) })
  }

  private wmWindowSetPendingStateOR(window: WmWindow) {
    /* for override-redirect windows */
    if (window.frameId !== Window.None) {
      throw new Error('Can only set pending state for windows without a parent.')
    }

    if (window.surface === undefined) {
      return
    }

    const { width, height } = this.wmWindowGetFrameSize(window)
    Region.fini(window.surface.pendingState.opaquePixmanRegion)
    if (window.hasAlpha) {
      Region.init(window.surface.pendingState.opaquePixmanRegion)
    } else {
      Region.initRect(window.surface.pendingState.opaquePixmanRegion, Rect.create(0, 0, width, height))
    }
  }

  private wmWindowGetChildPosition(window: WmWindow): { x: number, y: number } {
    if (window.fullscreen) {
      return { x: 0, y: 0 }
    }

    if (window.decorate && window.frame) {
      return window.frame.interior
    }

    return { x: this.theme.margin, y: this.theme.margin }
  }


  private wmWindowGetFrameSize(window: WmWindow): { width: number, height: number } {

    if (window.fullscreen) {
      return { width: window.width, height: window.height }
    }

    if (window.decorate && window.frame) {
      return { width: window.frame.width, height: window.frame.height }
    }

    return {
      width: window.width + this.theme.margin * 2,
      height: window.height + this.theme.margin * 2
    }
  }

  private async wmWindowDoRepaint(window: WmWindow) {
    window.repaintSource = undefined
    this.wmWindowSetAllowCommits(window, false)
    await this.wmWindowReadProperties(window)
    this.wmWindowDrawDecorations(window)
    this.wmWindowSetPendingState(window)
    this.wmWindowSetAllowCommits(window, true)
  }

  private wmWindowDrawDecorations(window: WmWindow) {
    let how: string
    if (window.fullscreen) {
      how = 'fullscreen'
      /* nothing */
    } else if (window.decorate) {
      how = 'decorate'
      window.frame?.setTitle(window.name)
      window.frame?.refreshGeometry()
    }

    // console.log(`XWM: draw decoration, win ${window.id}, ${how}`)

    // TODO do paint?

    // this.xConnection.flush()
  }

  private wmWindowSetPendingState(window: WmWindow) {
    if (window.surface === undefined) {
      return
    }

    const { width, height } = this.wmWindowGetFrameSize(window)
    const { x, y } = this.wmWindowGetChildPosition(window)

    Region.fini(window.surface.pendingState.opaquePixmanRegion)
    if (window.hasAlpha) {
      Region.init(window.surface.pendingState.opaquePixmanRegion)
    } else {
      /* We leave an extra pixel around the X window area to
       * make sure we don't sample from the undefined alpha
       * channel when filtering. */
      Region.initRect(window.surface.pendingState.opaquePixmanRegion, Rect.create(x - 1, y - 1, window.width + 2, window.height + 2))
    }

    let inputX: number
    let inputY: number
    let inputW: number
    let inputH: number
    if (window.decorate && !window.fullscreen && window.frame) {
      const { x, y, width, height } = window.frame?.inputRect()
      inputX = x
      inputY = y
      inputW = width
      inputH = height
    } else {
      inputX = x
      inputY = y
      inputW = width
      inputH = height
    }

    // console.log(`XWM: win ${window.id} geometry: ${inputX},${inputY} ${inputW}x${inputH}`)

    Region.fini(window.surface.pendingState.inputPixmanRegion)
    Region.initRect(window.surface.pendingState.inputPixmanRegion, Rect.create(inputX, inputY, inputW, inputH))

    window.shsurf?.setWindowGeometry(inputX, inputY, inputW, inputH)

    if (window.name) {
      window.shsurf?.setTitle(window.name)
    }
  }

  private wmWindowSendConfigureNotify(window: WmWindow) {
    const { x, y } = this.wmWindowGetChildPosition(window)

    const event = marshallConfigureNotifyEvent({
      // filled in when marshalled
      responseType: 0,
      event: window.id,
      window: window.id,
      aboveSibling: Window.None,
      x,
      y,
      width: window.width,
      height: window.height,
      borderWidth: 0,
      overrideRedirect: 0
    })
    this.xConnection.sendEvent(0, window.id, EventMask.StructureNotify, new Int8Array(event))
  }

  private wmWindowConfigureFrame(window: WmWindow) {
    if (!window.frameId) {
      return
    }

    const { height, width } = this.wmWindowGetFrameSize(window)
    this.configureWindow(window.frameId, { width, height })
  }

  private async wmWindowCreate(id: WINDOW, width: number, height: number, x: number, y: number, overrideRedirect: number) {
    const geometryReplyPromise = this.xConnection.getGeometry(id)

    this.xConnection.changeWindowAttributes(id, { eventMask: EventMask.PropertyChange | EventMask.FocusChange })

    const window: WmWindow = new WmWindow(this, id, overrideRedirect !== 0, x, y, width, height)

    const geometryReply = await geometryReplyPromise
    /* technically we should use XRender and check the visual format's
        alpha_mask, but checking depth is simpler and works in all known cases */
    window.hasAlpha = geometryReply.depth === 32

    this.windowHash[id] = window
  }

  private wmWindowDestroy(window: WmWindow) {
    if (window.configureSource) {
      this.client.connection.removeIdleHandler(window.configureSource)
      window.configureSource = undefined
    }
    if (window.repaintSource) {
      this.client.connection.removeIdleHandler(window.repaintSource)
      window.repaintSource = undefined
    }
    // TODO destroy canvas surface?

    if (window.frameId) {
      this.xConnection.reparentWindow(window.id, this.wmWindow, 0, 0)
      this.xConnection.destroySubwindows(window.frameId)
      this.wmWindowSetWmState(window, ICCCM_WITHDRAWN_STATE)
      this.wmWindowSetVirtualDesktop(window, -1)
      delete this.windowHash[window.frameId]
      window.frameId = Window.None
    }

    if (window.frame) {
      window.frame.destroy()
    }

    if (window.surfaceId) {
      this.unpairedWindowList = this.unpairedWindowList.filter(value => value !== window)
    }

    if (window.surface && window.surfaceDestroyListener) {
      window.surface.resource.removeDestroyListener(window.surfaceDestroyListener)
    }

    delete this.windowHash[window.id]
  }

  private wmWindowSetWmState(window: WmWindow, state: number) {
    this.xConnection.changeProperty(PropMode.Replace, window.id, this.atoms.WM_STATE, this.atoms.WM_STATE, 32, new Uint32Array([state, Window.None]))
  }

  private async getAtomName(atom: ATOM) {
    if (atom === Atom.None) {
      return 'None'
    }

    const reply = await this.xConnection.getAtomName(atom)
    return reply.name.chars()
  }

  private wmWindowHandleMoveResize(window: WmWindow, event: ClientMessageEvent) {
    const map = [
      ThemeLocation.THEME_LOCATION_RESIZING_TOP_LEFT,
      ThemeLocation.THEME_LOCATION_RESIZING_TOP,
      ThemeLocation.THEME_LOCATION_RESIZING_TOP_RIGHT,
      ThemeLocation.THEME_LOCATION_RESIZING_RIGHT,
      ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM_RIGHT,
      ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM,
      ThemeLocation.THEME_LOCATION_RESIZING_BOTTOM_LEFT,
      ThemeLocation.THEME_LOCATION_RESIZING_LEFT
    ] as const

    const pointer = this.session.globals.seat.pointer
    if (pointer.buttonsPressed !== 1
      || pointer.focus === undefined
      || pointer.focus.surface !== window.surface) {
      return
    }

    const detail = event.data.data32?.[2]
    if (detail === undefined) {
      return
    }

    switch (detail) {
      case _NET_WM_MOVERESIZE_MOVE:
        window.shsurf?.move(pointer)
        break
      case _NET_WM_MOVERESIZE_SIZE_TOPLEFT:
      case _NET_WM_MOVERESIZE_SIZE_TOP:
      case _NET_WM_MOVERESIZE_SIZE_TOPRIGHT:
      case _NET_WM_MOVERESIZE_SIZE_RIGHT:
      case _NET_WM_MOVERESIZE_SIZE_BOTTOMRIGHT:
      case _NET_WM_MOVERESIZE_SIZE_BOTTOM:
      case _NET_WM_MOVERESIZE_SIZE_BOTTOMLEFT:
      case _NET_WM_MOVERESIZE_SIZE_LEFT:
        window.shsurf?.resize(pointer, map[detail])
        break
      case _NET_WM_MOVERESIZE_CANCEL:
        break
    }
  }

  private wmWindowHandleState(window: WmWindow, event: ClientMessageEvent) {
    const maximized = this.wmWindowIsMaximized(window)

    const action = event.data.data32?.[0]
    const property1 = event.data.data32?.[1]
    const property2 = event.data.data32?.[2]

    if ((property1 === this.atoms._NET_WM_STATE_FULLSCREEN
      || property2 === this.atoms._NET_WM_STATE_FULLSCREEN)
      && action
      && ((): boolean => {
        const { changed, newState } = updateState(action, window.fullscreen)
        window.fullscreen = !!newState
        return changed
      })()) {
      this.wmWindowSetNetWmState(window)
      if (window.fullscreen) {
        window.savedWidth = window.width
        window.savedHeight = window.height

        window.shsurf?.setFullscreen()
      } else {
        window.shsurf?.setToplevel()
      }
    } else {
      if ((property1 === this.atoms._NET_WM_STATE_MAXIMIZED_VERT
        || property2 === this.atoms._NET_WM_STATE_MAXIMIZED_VERT)
        && action
        && ((): boolean => {
          const { changed, newState } = updateState(action, window.maximizedVertical)
          window.maximizedVertical = !!newState
          return changed
        })()) {
        this.wmWindowSetNetWmState(window)
      }
      if ((property1 === this.atoms._NET_WM_STATE_MAXIMIZED_HORZ
        || property2 === this.atoms._NET_WM_STATE_MAXIMIZED_HORZ)
        && action
        && ((): boolean => {
          const { changed, newState } = updateState(action, window.maximizedHorizontal)
          window.maximizedHorizontal = !!newState
          return changed
        })()) {
        this.wmWindowSetNetWmState(window)
      }

      if (maximized !== this.wmWindowIsMaximized(window)) {
        if (this.wmWindowIsMaximized(window)) {
          window.savedWidth = window.width
          window.savedHeight = window.height

          window.shsurf?.setMaximized()
        } else {
          window.shsurf?.setToplevel()
        }
      }
    }
  }

  private async wmWindowHandleSurfaceId(window: WmWindow, event: ClientMessageEvent) {
    if (window.surfaceId) {
      // console.log(`already have surface id for window ${window.id}`)
      return
    }

    /* Xwayland will send the wayland requests to create the
     * wl_surface before sending this client message.  Even so, we
     * can end up handling the X event before the wayland requests
     * and thus when we try to look up the surface ID, the surface
     * hasn't been created yet.  In that case put the window on
     * the unpaired window list and continue when the surface gets
     * created. */
    const id = event.data.data32?.[0]
    if (id === undefined) {
      return
    }

    const resource = this.client.connection.wlObjects[id] as WlSurfaceResource
    if (resource) {
      window.surfaceId = 0
      await this.xServerMapShellSurface(window, resource.implementation as Surface)
    } else {
      window.surfaceId = id
      this.unpairedWindowList.push(window)
    }
  }

  sendFocusWindow(window?: WmWindow) {
    if (window) {
      if (window.overrideRedirect) {
        return
      }

      const clientMessage = marshallClientMessageEvent({
        responseType: 0,
        format: 32,
        window: window.id,
        _type: this.atoms.WM_PROTOCOLS,
        data: {
          data32: new Uint32Array([
            this.atoms.WM_TAKE_FOCUS,
            Time.CurrentTime
          ])
        }
      })

      this.xConnection.sendEvent(0, window.id, EventMask.SubstructureRedirect, new Int8Array(clientMessage))
      this.xConnection.setInputFocus(InputFocus.PointerRoot, window.id, Time.CurrentTime)
      this.configureWindow(window.id, { stackMode: StackMode.Above })
    } else {
      this.xConnection.setInputFocus(InputFocus.PointerRoot, Window.None, Time.CurrentTime)
    }
  }

  async handleCreateSurface(surface: Surface) {
    if (surface.resource.client !== this.client) {
      return
    }

    // console.log(`XWM: create surface ${surface.resource.id}@${surface.resource.client.id}`, surface)

    const window = this.unpairedWindowList.find(window => window.surfaceId === surface.resource.id)
    if (window) {
      await this.xServerMapShellSurface(window, surface)
      window.surfaceId = 0
      this.unpairedWindowList = this.unpairedWindowList.filter(value => value !== window)
    }
  }

  private async xServerMapShellSurface(window: WmWindow, surface: Surface) {
    /* This should be necessary only for override-redirected windows,
     * because otherwise MapRequest handler would have already updated
     * the properties. However, if X11 clients set properties after
     * sending MapWindow, here we can still process them. The decorations
     * have already been drawn once with the old property values, so if the
     * app changes something affecting decor after MapWindow, we glitch.
     * We only hit xserver_map_shell_surface() once per MapWindow and
     * wl_surface, so better ensure we get the window type right.
     */
    await this.wmWindowReadProperties(window)

    /* A weston_wm_window may have many different surfaces assigned
     * throughout its life, so we must make sure to remove the listener
     * from the old surface signal list. */
    if (window.surface && window.surfaceDestroyListener) {
      window.surface.resource.removeDestroyListener(window.surfaceDestroyListener)
    }

    window.surface = surface
    window.surfaceDestroyListener = (surfaceResource) => {
      // console.log(`surface for xid ${window.id} destroyed`)
      /* This should have been freed by the shell.
	     * Don't try to use it later. */
      window.shsurf = undefined
      window.surface = undefined
    }
    window.surface.resource.addDestroyListener(window.surfaceDestroyListener)

    window.shsurf = this.xWaylandShell.createSurface(window, surface)
    window.shsurf.sendConfigure = (width, height) => this.sendConfigure(window, width, height)

    // console.log(`XWM: map shell surface, win ${window.id}, weston_surface ${window.surface}, xwayland surface ${window.shsurf}`)

    if (window.name) {
      window.shsurf.setTitle(window.name)
    }
    if (window.pid > 0) {
      window.shsurf.setPid(window.pid)
    }

    if (window.fullscreen && window.legacyFullscreenOutput) {
      window.savedWidth = window.width
      window.savedHeight = window.height
      window.shsurf.setFullscreen(window.legacyFullscreenOutput)
    } else if (window.overrideRedirect) {
      window.shsurf.setXwayland(window.x, window.y)
    } else if (window.transientFor && window.transientFor.surface) {
      const parent = window.transientFor
      if (parent.surface) {
        if (parent.surface && this.wmWindowTypeInactive(window)) {
          window.shsurf.setTransient(parent.surface, window.x - parent.x, window.y - parent.y)
        } else {
          window.shsurf.setToplevel()
          window.shsurf.setParent(parent.surface)
        }
      }
    } else if (this.wmWindowIsMaximized(window)) {
      window.shsurf.setMaximized()
    } else {
      if (this.wmWindowTypeInactive(window)) {
        window.shsurf.setXwayland(window.x, window.y)
      } else if (this.wmWindowIsPositioned(window)) {
        window.shsurf.setToplevelWithPosition(window.mapRequestX, window.mapRequestY)
      } else {
        window.shsurf.setToplevel()
      }
    }

    if (window.frameId === Window.None) {
      this.wmWindowSetPendingStateOR(window)
    } else {
      this.wmWindowSetPendingState(window)
      this.wmWindowSetAllowCommits(window, true)
      this.xConnection.flush()
    }
  }

  private wmWindowTypeInactive(window: WmWindow) {
    return window.type === this.atoms._NET_WM_WINDOW_TYPE_TOOLTIP ||
      window.type === this.atoms._NET_WM_WINDOW_TYPE_DROPDOWN_MENU ||
      window.type === this.atoms._NET_WM_WINDOW_TYPE_DND ||
      window.type === this.atoms._NET_WM_WINDOW_TYPE_COMBO ||
      window.type === this.atoms._NET_WM_WINDOW_TYPE_POPUP_MENU ||
      window.type === this.atoms._NET_WM_WINDOW_TYPE_UTILITY
  }

  private wmWindowIsMaximized(window: WmWindow) {
    return window.maximizedHorizontal && window.maximizedVertical
  }

  private wmWindowIsPositioned(window: WmWindow) {
    if (window.mapRequestX === Number.MIN_SAFE_INTEGER || window.mapRequestY === Number.MIN_SAFE_INTEGER) {
      // console.log(`XWM warning: win ${window.id} did not see map request`)
    }
    return window.mapRequestX !== 0 || window.mapRequestY !== 0
  }

  private legacyFullscreen(window: WmWindow) {
    const minmax = PMinSize | PMaxSize
    return this.session.globals.outputs.find(output => {
      if (output.canvas.width === window.width && output.canvas.height === window.height && window.overrideRedirect) {
        return true
      }


      let matchingSize = false
      const sizeHintsFlags = window.sizeHints?.flags ?? 0

      if (
        (sizeHintsFlags & (USSize | PSize)) &&
        window.sizeHints?.width === output.canvas.width &&
        window.sizeHints.height === output.canvas.height
      ) {
        matchingSize = true
      }

      if (
        (sizeHintsFlags & minmax) === minmax &&
        window.sizeHints?.minWidth === output.canvas.width &&
        window.sizeHints.minHeight === output.canvas.height &&
        window.sizeHints.maxWidth === output.canvas.width &&
        window.sizeHints.maxHeight === output.canvas.height
      ) {
        matchingSize = true
      }

      return !!(matchingSize && !window.decorate &&
        (sizeHintsFlags & (USPosition | PPosition)))
    })
  }

  // TODO called by compositor implementation
  sendPosition(surface: Surface, x: number, y: number) {
    const window = Object.values(this.windowHash).find(window => window.surface === surface)
    if (window === undefined) {
      return
    }

    /* We use pos_dirty to tell whether a configure message is in flight.
     * This is needed in case we send two configure events in a very
     * short time, since window->x/y is set in after a roundtrip, hence
     * we cannot just check if the current x and y are different. */
    if (window.x !== x || window.y !== y || window.positionDirty) {
      window.positionDirty = true
      this.configureWindow(window.frameId, { x, y })
      this.xConnection.flush()
    }
  }

  private wmWindowClose(window: WmWindow, time: TIMESTAMP) {
    if (window.deleteWindow) {
      const clientMessageEvent = marshallClientMessageEvent({
        responseType: 0,
        format: 32,
        window: window.id,
        _type: this.atoms.WM_PROTOCOLS,
        data: {
          data32: new Uint32Array([
            this.atoms.WM_DELETE_WINDOW,
            time
          ])
        }
      })
      this.xConnection.sendEvent(0, window.id, EventMask.NoEvent, new Int8Array(clientMessageEvent))
    } else {
      // TODO xcb kill client equivalent
      console.error('should call kill client here')
    }
  }

  private async wmWindowSetToplevel(window: WmWindow) {
    window.shsurf?.setToplevel()
    window.width = window.savedWidth
    window.height = window.savedHeight
    if (window.frame) {
      window.frame.resizeInside(window.width, window.height)
    }
    await this.wmWindowConfigure(window)
  }

  private wmWindowConfigure(window: WmWindow) {
    if (window.configureSource) {
      this.client.connection.removeIdleHandler(window.configureSource)
      window.configureSource = undefined
    }
    this.wmWindowSetAllowCommits(window, false)

    const { x, y } = this.wmWindowGetChildPosition(window)
    this.configureWindow(window.id, {
      x,
      y,
      width: window.width,
      height: window.height
    })

    this.wmWindowConfigureFrame(window)
    this.wmWindowScheduleRepaint(window)
  }

  private sendConfigure(window: WmWindow, width: number, height: number) {
    let newWidth, newHeight
    let vborder, hborder

    if (window.decorate && !window.fullscreen) {
      hborder = 2 * this.theme.borderWidth
      vborder = this.theme.titlebarHeight + this.theme.borderWidth
    } else {
      hborder = 0
      vborder = 0
    }

    if (width > hborder) {
      newWidth = width - hborder
    } else {
      newWidth = 1
    }

    if (height > vborder) {
      newHeight = height - vborder
    } else {
      newHeight = 1
    }

    if (window.width !== newWidth || window.height !== newHeight) {
      window.width = newWidth
      window.height = newHeight

      window.frame?.resizeInside(window.width, window.height)
    }

    if (window.configureSource) {
      return
    }

    window.configureSource = this.client.connection.addIdleHandler(() => { this.wmWindowConfigure(window) })
  }

  private wmWindowSetCursor(windowId: WINDOW, cursor: CursorType) {
    if (this.lastCursor === cursor) {
      return
    }

    this.lastCursor = cursor

    const newCursor = this.cursors[cursor]
    this.xConnection.changeWindowAttributes(windowId, { cursor: newCursor })
    this.xConnection.flush()
  }

  private async loadCursor(cursorImage: typeof cursorImageNames[CursorType]): Promise<Cursor> {
    // TODO check fetch response
    const { url, yhot, xhot, height, width } = cursorImage
    const response = await fetch(url)
    const cursorPNGImageData = await response.blob()
      .then(value => value.arrayBuffer())
      .then(value => new Uint8ClampedArray(value))

    const cursorImageBlob = new Blob([cursorPNGImageData], { type: 'image/png' })
    const cursorImageBitmap = await createImageBitmap(cursorImageBlob, 0, 0, width, height)
    this.imageDecodingCanvas.width = width
    this.imageDecodingCanvas.height = height
    this.imageDecodingContext.drawImage(cursorImageBitmap, 0, 0)
    const pixels = this.imageDecodingContext.getImageData(0, 0, width, height)

    return this.loadCursorImage({ pixels, xhot: xhot, yhot: yhot })
  }

  private loadCursorImage(cursorImage: { xhot: number, yhot: number, pixels: ImageData }): Cursor {
    const pix = this.xConnection.allocateID()
    this.xConnection.createPixmap(32, pix, this.screen.root, cursorImage.pixels.width, cursorImage.pixels.height)

    const pic = this.xConnection.allocateID()
    this.render.createPicture(pic, pix, this.formatRgba.id, {})

    const gc = this.xConnection.allocateID()
    this.xConnection.createGC(gc, pix, {})

    const stride = cursorImage.pixels.width * 4
    this.xConnection.putImage(ImageFormat.ZPixmap, pix, gc, cursorImage.pixels.width, cursorImage.pixels.height, 0, 0, 0, 32, stride * cursorImage.pixels.height, new Uint8Array(cursorImage.pixels.data.buffer))
    this.xConnection.freeGC(gc)

    const cursor = this.xConnection.allocateID()
    this.render.createCursor(cursor, pic, cursorImage.xhot, cursorImage.yhot)

    this.render.freePicture(pic)
    this.xConnection.freePixmap(pix)

    return cursor
  }

  setNetActiveWindow(window: Window) {
    this.xConnection.changeProperty(PropMode.Replace, this.screen.root, this.atoms._NET_ACTIVE_WINDOW, this.atoms.WINDOW, 32, new Uint32Array([window]))
  }
}
