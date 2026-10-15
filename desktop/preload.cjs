// Runs in the Yggltree window before the page loads. It tells the page it's inside the desktop app
// (window.yggltreeDesktop.desktop), so the page can say "menu bar" instead of "npm start". Nothing
// else from Node or Electron reaches the page.
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('yggltreeDesktop', { desktop: true })
