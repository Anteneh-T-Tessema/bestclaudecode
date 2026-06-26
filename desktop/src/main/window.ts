import { BrowserWindow, shell } from 'electron'
import { join } from 'path'

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 13 },
    backgroundColor: '#0a0c0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Intentional parity with legacyai-ide's existing tradeoff (sandbox: true is the
      // modern Electron-recommended default) — not an oversight, just inherited scope.
      sandbox: false,
      // Gap 139 — enables <webview> for the Live Preview panel, embedding the
      // user's own dev server URL in its own isolated process.
      webviewTag: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Dev-mode renderer error logging — helps diagnose blank-screen startup failures
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[RENDERER CRASH] reason=${details.reason} exitCode=${details.exitCode}`)
    })
    mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
      console.error(`[RENDERER LOAD FAIL] ${errorCode}: ${errorDescription}`)
    })
  }

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}
