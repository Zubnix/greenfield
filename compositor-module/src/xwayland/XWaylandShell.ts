import Session from '../Session'
import Surface from '../Surface'
import XWaylandShellSurface from './XWaylandShellSurface'
import { WmWindow } from './XWindowManager'

class XWaylandShell {
  static create(session: Session) {
    return new XWaylandShell(session)
  }

  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  createSurface(window: WmWindow, surface: Surface): XWaylandShellSurface {
    return XWaylandShellSurface.create(this.session, window, surface)
  }
}

export default XWaylandShell
