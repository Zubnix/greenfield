#!/usr/bin/env node

// Copyright 2019 Erik De Rijcke
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

'use strict'

const Logger = require('pino')
const AppEndpointServer = require('./src/AppEndpointServer')

function main () {
  const logger = Logger({
    name: `app-endpoint-server`,
    prettyPrint: (process.env.DEBUG && process.env.DEBUG == true)
  })
  try {
    const appEndpointDaemon = AppEndpointServer.create()

    const cleanUp = () => {
      appEndpointDaemon.destroy()
      logger.info('Process exit.')
    }

    process.on('exit', cleanUp)
    process.on('SIGINT', () => {
      logger.info('Received SIGINT.')
      process.exit()
    })
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM.')
      process.exit()
    })
  } catch (e) {
    logger.fatal('Failed to start.')
    logger.fatal('\tname: ' + e.name + ' message: ' + e.message + ' text: ' + e.text)
    logger.fatal('error object stack: ')
    logger.fatal(e.stack)
    process.exit(-1)
  }
}

main()
