import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface StoreSchema {
  anthropicApiKey: string
  googleApiKey: string
  openaiApiKey: string
  ollamaUrl: string
  activeModel: string
  theme: 'dark' | 'light'
  fontSize: number
  sidebarWidth: number
  rightPanelWidth: number
  bottomPanelHeight: number
  projectPath: string
  recentProjects: string[]
  globalRules: string
  wordWrap: boolean
  minimap: boolean
  tabSize: 2 | 4
  autoSave: boolean
  stickyScroll: boolean
  recentFiles: string[]
  [key: string]: unknown
}

const DEFAULTS: StoreSchema = {
  anthropicApiKey: '',
  googleApiKey: '',
  openaiApiKey: '',
  ollamaUrl: 'http://localhost:11434',
  activeModel: 'claude-sonnet-4-6',
  theme: 'dark',
  fontSize: 14,
  sidebarWidth: 280,
  rightPanelWidth: 360,
  bottomPanelHeight: 220,
  projectPath: '',
  recentProjects: [],
  globalRules: '',
  wordWrap: false,
  minimap: true,
  tabSize: 2,
  autoSave: true,
  stickyScroll: true,
  recentFiles: [],
}

function getStorePath(): string {
  let userDataPath: string
  try {
    userDataPath = app.getPath('userData')
  } catch {
    userDataPath = path.join(
      process.env.HOME || '',
      'Library',
      'Application Support',
      'lakoora'
    )
  }
  return path.join(userDataPath, 'lakoora-settings.json')
}

function readData(): StoreSchema {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

function writeData(data: StoreSchema): void {
  try {
    const storePath = getStorePath()
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('Failed to write settings:', e)
  }
}

let _cache: StoreSchema | null = null

function getCache(): StoreSchema {
  if (!_cache) _cache = readData()
  return _cache
}

export const store = {
  get(key: string): unknown {
    return getCache()[key]
  },
  set(key: string, value: unknown): void {
    const data = getCache()
    data[key] = value
    writeData(data)
  },
}
