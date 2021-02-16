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

import { Client } from 'westfield-runtime-server'
import { CompositorRemoteAppLauncher } from './index'
import RemoteSocket from './RemoteSocket'
import Session from './Session'

export default class RemoteAppLauncher implements CompositorRemoteAppLauncher {
  private readonly _session: Session
  private readonly _remoteSocket: RemoteSocket

  static create(session: Session, remoteSocket: RemoteSocket): RemoteAppLauncher {
    return new RemoteAppLauncher(session, remoteSocket)
  }

  private constructor(session: Session, remoteSocket: RemoteSocket) {
    this._session = session
    this._remoteSocket = remoteSocket
  }

  async launch(appEndpointURL: URL, remoteAppId: string): Promise<Client> {
    appEndpointURL.searchParams.delete('launch')
    appEndpointURL.searchParams.append('launch', remoteAppId)
    return this.launchURL(appEndpointURL)
  }

  async launchURL(appEndpointURL: URL): Promise<Client> {
    appEndpointURL.searchParams.delete('compositorSessionId')
    appEndpointURL.searchParams.append('compositorSessionId', this._session.compositorSessionId)

    // make sure we listen for X connections in case the remote app is an X client
    this._remoteSocket.ensureXWayland(appEndpointURL)
    const webSocket = new WebSocket(appEndpointURL.href)
    return this._remoteSocket.onWebSocket(webSocket)
  }
}
