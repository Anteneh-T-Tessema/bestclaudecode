import { ipcMain, BrowserWindow } from 'electron'

let browserWin: BrowserWindow | null = null
const consoleLogs: string[] = []
const MAX_LOGS = 200

function getOrCreateBrowserWin(): BrowserWindow {
  if (browserWin && !browserWin.isDestroyed()) return browserWin
  consoleLogs.length = 0
  browserWin = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  })
  browserWin.webContents.on('console-message', (_e, _level, message) => {
    consoleLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`)
    if (consoleLogs.length > MAX_LOGS) consoleLogs.shift()
  })
  return browserWin
}

export function registerBrowserHandlers(): void {
  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    try {
      const win = getOrCreateBrowserWin()
      await win.webContents.loadURL(url)
      const title = win.webContents.getTitle()
      return { ok: true, title }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('browser:screenshot', async () => {
    try {
      if (!browserWin || browserWin.isDestroyed()) return { error: 'No page loaded — navigate first' }
      const image = await browserWin.webContents.capturePage()
      return { dataUrl: image.toDataURL(), width: image.getSize().width, height: image.getSize().height }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('browser:consoleLogs', () => {
    return [...consoleLogs]
  })

  ipcMain.handle('browser:clearLogs', () => {
    consoleLogs.length = 0
  })

  ipcMain.handle('browser:close', () => {
    if (browserWin && !browserWin.isDestroyed()) { browserWin.close(); browserWin = null }
  })
}
