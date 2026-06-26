import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

// Must run before app.whenReady() — enables CDP for Playwright E2E (Electron 32+
// requires commandLine, not a CLI flag). Gated on MESHFLOW_CDP_PORT alone (not
// NODE_ENV) because electron-vite preview overwrites NODE_ENV to 'production'
// before spawning Electron, clobbering any 'test' value. Mirrors legacyai-ide's
// src/main/index.ts pattern.
if (process.env.MESHFLOW_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.MESHFLOW_CDP_PORT)
}

// Redirect userData to an isolated temp dir during E2E runs so test runs never
// touch the developer's real settings.
if (process.env.MESHFLOW_E2E_USER_DATA_DIR) {
  app.setPath('userData', process.env.MESHFLOW_E2E_USER_DATA_DIR)
}

import { createWindow } from './window'
import { registerAllIPC } from './ipc'

app.whenReady().then(() => {
  app.setAppUserModelId('com.meshflow.desktop')

  registerAllIPC()

  const mainWindow = createWindow()
  mainWindow.setTitle('Meshflow')

  // Check for updates after the window is ready; no-op in dev / unsigned builds.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
