import path from 'path'
import fs from 'fs'

const PORT_FILE = path.resolve(__dirname, '../.e2e-cdp-port')

export default async function globalTeardown() {
  try {
    const data = fs.readFileSync(PORT_FILE, 'utf-8')
    const [pidStr] = data.split(':')
    const pid = parseInt(pidStr, 10)
    if (pid && !isNaN(pid)) {
      try { process.kill(-pid, 'SIGKILL') } catch { /* already dead */ }
      try { process.kill(pid, 'SIGKILL') } catch { /* already dead */ }
    }
    fs.unlinkSync(PORT_FILE)
  } catch {
    // nothing to clean up
  }

  try {
    const userDataDir = fs.readFileSync(PORT_FILE + '.userdata', 'utf-8')
    fs.rmSync(userDataDir, { recursive: true, force: true })
    fs.unlinkSync(PORT_FILE + '.userdata')
  } catch {
    // nothing to clean up
  }

  try {
    const decisionsDir = fs.readFileSync(PORT_FILE + '.decisions', 'utf-8')
    fs.rmSync(decisionsDir, { recursive: true, force: true })
    fs.unlinkSync(PORT_FILE + '.decisions')
  } catch {
    // nothing to clean up
  }
}
