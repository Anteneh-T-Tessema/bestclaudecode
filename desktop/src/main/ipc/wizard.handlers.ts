import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { runCommand } from '../pythonBridge'
import { store } from '../store'

const FRAMEWORK_COMMANDS: Record<string, string> = {
  next: 'npx create-next-app@latest',
  'vite-react': 'npm create vite@latest -- --template react-ts',
  fastapi: 'pip install fastapi uvicorn && mkdir -p src && printf "from fastapi import FastAPI\\napp = FastAPI()\\n" > src/main.py',
  express: 'npm init -y && npm install express',
}

export interface WizardScaffoldOpts {
  framework: string
  projectName: string
  targetDir: string
}

export function registerWizardHandlers(): void {
  ipcMain.handle(
    'wizard:scaffold',
    async (_event, opts: WizardScaffoldOpts): Promise<{ success: boolean; projectPath?: string; error?: string }> => {
      const cmdBase = FRAMEWORK_COMMANDS[opts.framework]
      if (!cmdBase) return { success: false, error: `Unknown framework: ${opts.framework}` }

      const fullCmd = `${cmdBase} ${opts.projectName}`
      try {
        const result = await runCommand('/bin/sh', ['-c', fullCmd], opts.targetDir)
        if (result.exitCode !== 0) {
          return { success: false, error: result.stderr || result.stdout }
        }
        const newProjectPath = path.join(opts.targetDir, opts.projectName)
        store.set('projectPath', newProjectPath)
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('wizard:done', { projectPath: newProjectPath })
        }
        return { success: true, projectPath: newProjectPath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}
