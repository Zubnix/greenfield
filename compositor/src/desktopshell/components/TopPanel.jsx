import React from 'react'
import PropTypes from 'prop-types'

import { withStyles } from '@material-ui/core/styles/index'

import AppBar from '@material-ui/core/es/AppBar/index'
import Toolbar from '@material-ui/core/es/Toolbar/index'
import IconButton from '@material-ui/core/es/IconButton/index'

import MenuIcon from '@material-ui/icons/Menu'
import AppsIcon from '@material-ui/icons/Apps'
import AccountCircle from '@material-ui/icons/AccountCircle'

import EntriesContainer from './EntriesContainer'
import Seat from '../../Seat'
import ManagedSurface from '../ManagedSurface'

import UserMenu from './UserMenu'
import SettingsDrawer from './SettingsDrawer'
import LauncherDialog from './LauncherDialog'

const styles = {
  root: {
    flexGrow: 0
  },

  grow: {
    flexGrow: 1
  },

  menuButton: {
    marginLeft: -18,
    marginRight: 10
  }
}

class TopPanel extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      drawer: false,
      launcherDialog: false,
      userMenuAnchorEl: null
    }
  }

  /**
   * @param {boolean}open
   * @private
   */
  _toggleDrawer (open) {
    this.setState(() => ({ drawer: open }))
  }

  /**
   * @param {Event}event
   * @private
   */
  _userMenuOpen (event) {
    const userMenuAnchorEl = event.currentTarget
    this.setState(() => ({ userMenuAnchorEl }))
  }

  _userMenuClose () {
    this.setState(() => ({ userMenuAnchorEl: null }))
  }

  _toggleLauncherDialog (open) {
    this.setState(() => ({ launcherDialog: open }))
  }

  render () {
    const { classes, managedSurfaces, activeManagedSurface, seat, user } = this.props
    if (user === null) return null

    const { drawer, userMenuAnchorEl, launcherDialog } = this.state

    return (
      <AppBar className={classes.root} position='static' color='default'>
        <Toolbar variant={'dense'}>
          <IconButton
            className={classes.menuButton}
            color='inherit'
            aria-label='Menu'
            onClick={() => this._toggleDrawer(true)}>
            <MenuIcon />
          </IconButton>
          <div className={classes.grow}>
            <EntriesContainer
              managedSurfaces={managedSurfaces}
              activeManagedSurface={activeManagedSurface}
              seat={seat}
            />
          </div>
          <IconButton onClick={() => this._toggleLauncherDialog(true)}>
            <AppsIcon />
          </IconButton>
          <IconButton
            aria-owns={userMenuAnchorEl ? 'user-menu' : undefined}
            aria-haspopup='true'
            onClick={(event) => this._userMenuOpen(event)}
            color='inherit'
          >
            <AccountCircle />
          </IconButton>
        </Toolbar>
        <UserMenu
          id='user-menu'
          anchorEl={userMenuAnchorEl}
          onClose={() => this._userMenuClose()}
          user={user}
        />
        <SettingsDrawer
          open={drawer}
          onClose={() => this._toggleDrawer(false)}
        />
        <LauncherDialog
          open={launcherDialog}
          onClose={() => this._toggleLauncherDialog(false)}
        />
      </AppBar>
    )
  }
}

TopPanel.propTypes = {
  classes: PropTypes.object.isRequired,

  seat: PropTypes.instanceOf(Seat).isRequired,
  activeManagedSurface: PropTypes.instanceOf(ManagedSurface),
  managedSurfaces: PropTypes.arrayOf(ManagedSurface).isRequired,
  user: PropTypes.object
}

export default withStyles(styles)(TopPanel)