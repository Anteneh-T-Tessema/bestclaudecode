import * as path from 'path'
import { repoRoot, venvPython } from '../paths'
import { LspClient, type LanguageServerConfig } from './lspClient'

// TypeScript/JS derives the languageId from the file extension — the same
// mapping that tsclient.ts used before the consolidation.
const TS_LANG_IDS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact',
  js: 'javascript', jsx: 'javascriptreact',
  mjs: 'javascript', cjs: 'javascript',
}
function tsLangId(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? ''
  return TS_LANG_IDS[ext] ?? 'typescript'
}

// C and C++ both use clangd; the languageId distinguishes them in Monaco.
function cLangId(uri: string): string {
  return uri.endsWith('.cpp') || uri.endsWith('.cc') || uri.endsWith('.cxx') || uri.endsWith('.hpp')
    ? 'cpp' : 'c'
}

function root(): string { return `file://${repoRoot()}` }

// Per-language server configurations.
// - command/args: how to spawn the LSP binary. Bare names rely on PATH in a
//   provisioned sandbox; desktop/local overrides come from env vars.
// - languageId: the LSP languageId sent in textDocument/didOpen. Some servers
//   need the exact id; others are lenient.
export type LangKey = 'python' | 'ts' | 'go' | 'rust' | 'java' | 'c'

const CONFIGS: Record<LangKey, LanguageServerConfig> = {
  python: {
    command: path.join(repoRoot(), 'desktop', 'node_modules', '.bin', 'pyright-langserver'),
    args: ['--stdio'],
    rootUri: root(),
    languageId: 'python',
    initializationOptions: { settings: { python: { pythonPath: venvPython() } } },
    workspaceConfiguration: { python: { pythonPath: venvPython() } },
  },
  ts: {
    command: process.env.MESHFLOW_TS_LS_BIN
      ?? path.join(repoRoot(), 'desktop', 'node_modules', '.bin', 'typescript-language-server'),
    args: ['--stdio'],
    rootUri: root(),
    languageId: tsLangId,
    initializationOptions: { tsserver: { logDirectory: null, logVerbosity: 'off' } },
  },
  go: {
    command: process.env.MESHFLOW_GOPLS_BIN ?? 'gopls',
    args: [],
    rootUri: root(),
    languageId: 'go',
  },
  rust: {
    command: process.env.MESHFLOW_RUST_ANALYZER_BIN ?? 'rust-analyzer',
    args: [],
    rootUri: root(),
    languageId: 'rust',
  },
  java: {
    command: process.env.MESHFLOW_JDTLS_BIN ?? 'jdtls',
    args: [],
    rootUri: root(),
    languageId: 'java',
  },
  c: {
    command: process.env.MESHFLOW_CLANGD_BIN ?? 'clangd',
    args: ['--background-index'],
    rootUri: root(),
    languageId: cLangId,
  },
}

// Singleton clients — one per language, shared across IPC handler calls.
const clients: Partial<Record<LangKey, LspClient>> = {}

export function getClient(lang: LangKey): LspClient {
  if (!clients[lang]) clients[lang] = new LspClient(CONFIGS[lang])
  return clients[lang]!
}

export const ALL_LANGS = Object.keys(CONFIGS) as LangKey[]
