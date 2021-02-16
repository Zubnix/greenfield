import {
  CompositorSession,
  CompositorSurface,
  CompositorSurfaceState,
  createAxisEventFromWheelEvent,
  createButtonEventFromMouseEvent,
  createCompositorRemoteAppLauncher,
  createCompositorRemoteSocket,
  createCompositorSession,
  createCompositorWebAppLauncher,
  createCompositorWebAppSocket,
  createKeyEventFromKeyboardEvent,
  initWasm
} from 'greenfield-compositor'

function initializeCanvas(session: CompositorSession, canvas: HTMLCanvasElement, myId: string) {
  // register canvas with compositor session
  session.userShell.actions.initScene(myId, canvas)

  // make sure the canvas has focus and receives input inputs
  canvas.onmouseover = () => canvas.focus()
  canvas.tabIndex = 1
  // don't show browser context menu on right click
  canvas.oncontextmenu = (event: MouseEvent) => event.preventDefault()

  //wire up dom input events to compositor input events
  canvas.onpointermove = (event: PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    session.userShell.actions.input.pointerMove(createButtonEventFromMouseEvent(event, false, myId))
  }
  canvas.onpointerdown = (event: PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    session.userShell.actions.input.buttonDown(createButtonEventFromMouseEvent(event, false, myId))
  }
  canvas.onpointerup = (event: PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    session.userShell.actions.input.buttonUp(createButtonEventFromMouseEvent(event, true, myId))
    canvas.releasePointerCapture(event.pointerId)
  }
  canvas.onwheel = (event: WheelEvent) => {
    event.stopPropagation()
    event.preventDefault()
    session.userShell.actions.input.axis(createAxisEventFromWheelEvent(event, myId))
  }
  canvas.onkeydown = (event: KeyboardEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const keyEvent = createKeyEventFromKeyboardEvent(event, true)
    if (keyEvent) {
      session.userShell.actions.input.key(keyEvent)
    }
  }
  canvas.onkeyup = (event: KeyboardEvent) => {
    event.stopPropagation()
    event.preventDefault()
    const keyEvent = createKeyEventFromKeyboardEvent(event, false)
    if (keyEvent) {
      session.userShell.actions.input.key(keyEvent)
    }
  }
}

function linkUserShellEvents(session: CompositorSession) {
  const userShell = session.userShell

  userShell.events.notify = (variant: string, message: string) => window.alert(message)
  userShell.events.createUserSurface = (compositorSurface: CompositorSurface, compositorSurfaceState: CompositorSurfaceState) => {
    // create view on our scene for the newly created surface
    userShell.actions.createView(compositorSurface, 'myOutputId')
  }
}

async function main() {
  // load web assembly libraries
  await initWasm()

  // create new compositor context
  const session = createCompositorSession()

  // Get an HTML5 canvas for use as an output for the compositor. Multiple outputs can be used.
  const canvas: HTMLCanvasElement = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  canvas.style.width = `${canvas.width}`
  canvas.style.height = `${canvas.height}`

  // hook up the canvas to our compositor
  initializeCanvas(session, canvas, 'myOutputId')
  linkUserShellEvents(session)

  // create application launchers for web & remote applications
  const webAppSocket = createCompositorWebAppSocket(session)
  const webAppLauncher = createCompositorWebAppLauncher(webAppSocket)

  const remoteSocket = createCompositorRemoteSocket(session)
  const remoteAppLauncher = createCompositorRemoteAppLauncher(session, remoteSocket)

  // Add some HTML buttons so the user can launch applications.
  const webShmAppURLButton: HTMLButtonElement = document.createElement('button')
  webShmAppURLButton.textContent = 'WebSHM'
  const webGLURLButton: HTMLButtonElement = document.createElement('button')
  webGLURLButton.textContent = 'WebGL'
  const reactCanvasKitURLButton: HTMLButtonElement = document.createElement('button')
  reactCanvasKitURLButton.textContent = 'React-CanvasKit'
  const remoteGtk3URLButton: HTMLButtonElement = document.createElement('button')
  remoteGtk3URLButton.textContent = 'GTK3-Demo'
  const remoteKwriteURLButton: HTMLButtonElement = document.createElement('button')
  remoteKwriteURLButton.textContent = 'KWrite'
  const remoteGnomeTerminalURLButton: HTMLButtonElement = document.createElement('button')
  remoteGnomeTerminalURLButton.textContent = 'Gnome-Terminal'
  const remoteXtermURLButton: HTMLButtonElement = document.createElement('button')
  remoteXtermURLButton.textContent = 'XTerm'

  const urlInput: HTMLInputElement = document.createElement('input')
  urlInput.type = 'text'
  urlInput.style.width = '600px'
  const launchButton: HTMLButtonElement = document.createElement('button')
  launchButton.textContent = 'Launch'

  const container: HTMLDivElement = document.createElement('div')
  container.appendChild(webShmAppURLButton)
  container.appendChild(webGLURLButton)
  container.appendChild(reactCanvasKitURLButton)
  container.appendChild(remoteGtk3URLButton)
  container.appendChild(remoteKwriteURLButton)
  container.appendChild(remoteGnomeTerminalURLButton)
  container.appendChild(remoteXtermURLButton)
  container.appendChild(urlInput)
  container.appendChild(launchButton)

  webShmAppURLButton.onclick = () => urlInput.value = `${window.location.href}apps/simple-web-shm/app.js`
  webGLURLButton.onclick = () => urlInput.value = `${window.location.href}apps/simple-web-gl/app.js`
  reactCanvasKitURLButton.onclick = () => urlInput.value = `${window.location.href}apps/react-canvaskit/app.js`
  remoteGtk3URLButton.onclick = () => urlInput.value = `wss://app-endpoint.greenfield.app?launch=remote-gtk3-demo`
  remoteKwriteURLButton.onclick = () => urlInput.value = `ws://localhost:8081?launch=remote-kwrite`
  remoteGnomeTerminalURLButton.onclick = () => urlInput.value = `ws://localhost:8081?launch=remote-gnome-terminal`
  remoteXtermURLButton.onclick = () => urlInput.value = `ws://localhost:8081?launch=remote-xterm`

  launchButton.onclick = () => {
    const urlString = urlInput.value
    const url = new URL(urlString)
    if (url.protocol.startsWith('ws')) {
      remoteAppLauncher.launchURL(url)
    } else if (url.protocol.startsWith('http')) {
      webAppLauncher.launch(url)
    }
  }

  // make compositor global protocol objects available to client
  session.globals.register()

  // show the html elements on the user's screen
  document.body.appendChild(canvas)
  document.body.appendChild(container)
}

window.onload = () => main()
