export interface DebugAdapterDef {
  command: string
  args: string[]
  language: 'python' | 'node'
}

// Adapter binaries resolve via PATH in a provisioned sandbox. The env var
// overrides let local dev point at a venv's debugpy without PATH surgery.
export const DEBUG_ADAPTERS = {
  python: {
    command: process.env.LAKOORA_DEBUGPY_BIN ?? 'python',
    args: ['-m', 'debugpy.adapter'],
    language: 'python' as const,
  },
  node: {
    // vscode-js-debug ships its own adapter entry point. In sandbox, it is
    // installed globally; locally the env var overrides to node_modules/.bin.
    command: process.env.LAKOORA_JSDBG_BIN ?? 'js-debug-adapter',
    args: [],
    language: 'node' as const,
  },
} as const satisfies Record<string, DebugAdapterDef>

export type DebugLang = keyof typeof DEBUG_ADAPTERS
