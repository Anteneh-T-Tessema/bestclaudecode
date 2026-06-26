import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runPythonJson } from '../pythonBridge'

export function registerVoiceHandlers(): void {
  ipcMain.handle(
    'voice:transcribe',
    async (_event, audioBase64: string, _mimeType: string): Promise<{ text: string } | null> => {
      const tempPath = path.join(os.tmpdir(), `meshflow-voice-${Date.now()}.webm`)
      try {
        const buf = Buffer.from(audioBase64, 'base64')
        fs.writeFileSync(tempPath, buf)

        const result = await runPythonJson(['-m', 'src.transcribe', tempPath, '--json'])
        if (!result.ok) return null
        const data = result.stats as { success: boolean; text?: string }
        if (!data?.success || !data.text) return null
        return { text: data.text }
      } catch {
        return null
      } finally {
        try { fs.unlinkSync(tempPath) } catch { /* ignore */ }
      }
    },
  )
}
