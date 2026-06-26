import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

interface StoreSchema {
  anthropicApiKey: string
  googleApiKey: string
  openaiApiKey: string
  groqApiKey: string
  openrouterApiKey: string
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
  hitlSandboxPromote: 'always' | 'review'
  hitlCommandRun: 'always' | 'policy' | 'never'
  hitlFileEdit: 'always' | 'sandbox'
  hitlDeployment: 'always' | 'confirm'
  customModelName: string
  customModelProvider: 'anthropic' | 'openai' | 'google' | 'ollama'
  useSandboxExec: 'never' | 'no-network' | 'restrict-write' | 'docker'
  dockerSandboxImage: string
  useLocalEmbeddings: boolean
  localEmbeddingModel: string
  [key: string]: unknown
}

const DEFAULTS: StoreSchema = {
  anthropicApiKey: '',
  googleApiKey: '',
  openaiApiKey: '',
  groqApiKey: '',
  openrouterApiKey: '',
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
  hitlSandboxPromote: 'review',
  hitlCommandRun: 'policy',
  hitlFileEdit: 'sandbox',
  hitlDeployment: 'confirm',
  customModelName: '',
  customModelProvider: 'anthropic',
  useSandboxExec: 'never',
  dockerSandboxImage: 'node:22-bookworm',
  useLocalEmbeddings: false,
  localEmbeddingModel: 'nomic-embed-text',
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
      'meshflow'
    )
  }
  return path.join(userDataPath, 'meshflow-settings.json')
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

// Gap 88 — API keys encrypted at rest via Electron's OS-keychain-backed safeStorage
// (macOS Keychain / Windows DPAPI / Linux Secret Service) instead of the plain
// meshflow-settings.json field. Falls back to plaintext when no OS keychain is
// available (e.g. some headless Linux setups), and to the legacy plain field for
// keys saved before this existed.
export function getSecret(key: string): string {
  const raw = getCache()[`secret:${key}`] as string | undefined
  if (raw) {
    if (!safeStorage.isEncryptionAvailable()) return raw
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    } catch {
      return raw
    }
  }
  return (getCache()[key] as string | undefined) ?? ''
}

export function setSecret(key: string, value: string): void {
  const encoded = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString('base64')
    : value
  store.set(`secret:${key}`, encoded)
}
