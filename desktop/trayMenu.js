// The menu-bar menu, described as data. Pure: it takes the app's state and says what the menu
// shows. main.js turns each item into an Electron menu item, and calls the matching action.
//
// Items are one of:
//   { type: 'separator' }
//   { label, action, enabled?, checked? }        (checked: a checkbox item)
//   { label, submenu: [items] }
//   { label, enabled: false }                    (a status line)

const DOT = '● '

export function statusLine(hub, devices) {
  if (hub === 'running') {
    const n = typeof devices === 'number' ? devices : 0
    return `Running · ${n} ${n === 1 ? 'device' : 'devices'} connected`
  }
  if (hub === 'starting') return 'Starting Yggltree…'
  return 'Not running'
}

export function buildMenu(state) {
  const { hub = 'stopped', devices = null, relayOutdated = false, updateAvailable = null, prefs = {}, appVersion = '' } = state
  const running = hub === 'running'
  const items = [
    { label: statusLine(hub, devices), enabled: false },
    { type: 'separator' },
    { label: 'Open Yggltree', action: 'openWindow' },
    { label: 'Add a device…', action: 'addDevice', enabled: running },
    { label: relayOutdated ? `${DOT}Update the relay…` : 'Update the relay…', action: 'updateRelay', enabled: running },
    {
      label: 'Back up',
      submenu: [{ label: 'Show backups folder', action: 'showBackups' }],
    },
    { label: running ? 'Restart Yggltree' : 'Start Yggltree', action: 'restart' },
    { label: 'Reset admin PIN…', action: 'resetPin', enabled: running },
    { type: 'separator' },
    { label: 'Show data folder', action: 'showData' },
    { label: 'Show log', action: 'showLog' },
    { label: 'Help…', action: 'help', enabled: running },
    { type: 'separator' },
  ]
  if (updateAvailable) {
    items.push({ label: `${DOT}Version ${updateAvailable} is available: download`, action: 'download' })
  }
  items.push(
    { label: 'Check for updates', action: 'checkUpdates' },
    { label: 'Check for updates every day', action: 'toggleDailyUpdates', checked: prefs.dailyUpdateCheck !== false },
    { type: 'separator' },
    { label: 'Start Yggltree when I log in', action: 'toggleStartAtLogin', checked: prefs.startAtLogin !== false },
    { label: 'Keep this Mac awake while Yggltree runs', action: 'toggleKeepAwake', checked: prefs.keepAwake !== false },
    { type: 'separator' },
    { label: `About Yggltree ${appVersion}`.trim(), action: 'about' },
    { label: 'Quit Yggltree', action: 'quit' },
  )
  return items
}

// The dot on the leaf, when something needs the admin's attention.
export function needsAttention(state) {
  return state.hub !== 'running' || Boolean(state.relayOutdated) || Boolean(state.updateAvailable)
}
