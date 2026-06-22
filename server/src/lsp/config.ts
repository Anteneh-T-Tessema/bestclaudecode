export interface LanguageServerDef {
  command: string
  args: string[]
  languageId: string
}

// Bare commands resolve via PATH inside a properly provisioned E2B sandbox
// template. The env var overrides exist for local dev/testing, where the
// binaries live in desktop/node_modules/.bin instead of on PATH.
export const LANGUAGE_SERVERS = {
  python: {
    command: process.env.LAKOORA_PYRIGHT_BIN ?? 'pyright-langserver',
    args: ['--stdio'],
    languageId: 'python',
  },
  ts: {
    command: process.env.LAKOORA_TS_LS_BIN ?? 'typescript-language-server',
    args: ['--stdio'],
    languageId: 'typescript',
  },
  go: {
    command: process.env.LAKOORA_GOPLS_BIN ?? 'gopls',
    args: [],
    languageId: 'go',
  },
  rust: {
    command: process.env.LAKOORA_RUST_ANALYZER_BIN ?? 'rust-analyzer',
    args: [],
    languageId: 'rust',
  },
  java: {
    command: process.env.LAKOORA_JDTLS_BIN ?? 'jdtls',
    args: [],
    languageId: 'java',
  },
  c: {
    command: process.env.LAKOORA_CLANGD_BIN ?? 'clangd',
    args: ['--background-index'],
    languageId: 'c',
  },
} as const satisfies Record<string, LanguageServerDef>

export type LangKey = keyof typeof LANGUAGE_SERVERS
