import { contextBridge, ipcRenderer } from 'electron'
import type { ParsedDecision, DecisionStats } from '../main/ipc/decisions.handlers'
import type { MemoryEntry } from '../main/ipc/memory.handlers'
import type { BM25Response, DocsResult, BrowseResult } from '../main/ipc/search.handlers'
import type { GithubItem } from '../main/ipc/github.handlers'
import type { BlameEntry } from '../main/ipc/git.handlers'
import type { ShadowInfo } from '../main/ipc/sandbox.handlers'
import type { PlanSummary, TaskPlanDetail } from '../main/ipc/taskplanner.handlers'
import type { ArchDocResult } from '../main/ipc/archDoc.handlers'
import type { McpServerConfig, McpServerStatus } from '../main/mcp/mcpManager'

const api = {
  // ── Decisions ──────────────────────────────────────────────────────────────
  decisions: {
    list: (overrideDir?: string): Promise<ParsedDecision[]> => ipcRenderer.invoke('decisions:list', overrideDir),
    search: (query: string, overrideDir?: string): Promise<ParsedDecision[]> =>
      ipcRenderer.invoke('decisions:search', query, overrideDir),
    stats: (overrideDir?: string): Promise<DecisionStats> => ipcRenderer.invoke('decisions:stats', overrideDir),
  },

  // ── File System ────────────────────────────────────────────────────────────
  fs: {
    readFile: (p: string) => ipcRenderer.invoke('fs:readFile', p) as Promise<string>,
    writeFile: (p: string, c: string) => ipcRenderer.invoke('fs:writeFile', { filePath: p, content: c }),
    readDir: (p: string) => ipcRenderer.invoke('fs:readDir', p),
    createDir: (p: string) => ipcRenderer.invoke('fs:createDir', p),
    deleteEntry: (p: string) => ipcRenderer.invoke('fs:deleteEntry', p),
    rename: (o: string, n: string) => ipcRenderer.invoke('fs:rename', { oldPath: o, newPath: n }),
    exists: (p: string) => ipcRenderer.invoke('fs:exists', p) as Promise<boolean>,
    openDialog: () => ipcRenderer.invoke('fs:openDialog') as Promise<string | null>,
    openFile: (filters?: Electron.FileFilter[]) => ipcRenderer.invoke('fs:openFile', filters) as Promise<string | null>,
    watchDir: (p: string) => ipcRenderer.invoke('fs:watchDir', p),
    unwatchDir: (p: string) => ipcRenderer.invoke('fs:unwatchDir', p),
    searchInFiles: (dirPath: string, query: string, caseSensitive = false, regex = false) =>
      ipcRenderer.invoke('fs:searchInFiles', { dirPath, query, caseSensitive, regex }),
    replaceInFiles: (dirPath: string, query: string, replacement: string, caseSensitive = false, regex = false) =>
      ipcRenderer.invoke('fs:replaceInFiles', { dirPath, query, replacement, caseSensitive, regex }),
    onFileChange: (cb: (e: { eventType: string; filename: string; dirPath: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { eventType: string; filename: string; dirPath: string }) => cb(data)
      ipcRenderer.on('fs:change', handler)
      return (): void => { ipcRenderer.removeListener('fs:change', handler) }
    },
    findFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:findFiles', root),
  },

  // ── Terminal ───────────────────────────────────────────────────────────────
  terminal: {
    create: (opts: { cwd?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', opts) as Promise<string | { id?: string; error?: string } | null>,
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', { id, data }),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', { id, cols, rows }),
    kill: (id: string) => ipcRenderer.invoke('terminal:kill', id),
    onData: (id: string, cb: (data: string) => void) => {
      const ch = `terminal:data:${id}`
      const handler = (_: Electron.IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on(ch, handler)
      return (): void => { ipcRenderer.removeListener(ch, handler) }
    },
    onExit: (id: string, cb: (code: number) => void) => {
      const ch = `terminal:exit:${id}`
      const handler = (_: Electron.IpcRendererEvent, code: number) => cb(code)
      ipcRenderer.on(ch, handler)
      return (): void => { ipcRenderer.removeListener(ch, handler) }
    },
    runCommand: (command: string, cwd?: string) =>
      ipcRenderer.invoke('terminal:runCommand', { command, cwd }) as Promise<{ stdout: string; stderr: string; exitCode: number }>,
    logRun: (command: string, cwd: string, exitCode: number, outputSnippet: string) =>
      ipcRenderer.invoke('terminal:logRun', { command, cwd, exitCode, outputSnippet }) as Promise<void>,
  },

  // ── Git ────────────────────────────────────────────────────────────────────
  git: {
    branch: (cwd: string) => ipcRenderer.invoke('git:branch', cwd) as Promise<string | null>,
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    log: (cwd: string) => ipcRenderer.invoke('git:log', cwd),
    add: (cwd: string, paths: string[]) => ipcRenderer.invoke('git:add', { cwd, paths }),
    commit: (cwd: string, message: string) => ipcRenderer.invoke('git:commit', { cwd, message }),
    diff: (cwd: string, filePath: string) => ipcRenderer.invoke('git:diff', { cwd, path: filePath }) as Promise<string>,
    statusFiles: (cwd: string) => ipcRenderer.invoke('git:statusFiles', cwd),
    pull: (cwd: string) => ipcRenderer.invoke('git:pull', { cwd }),
    push: (cwd: string, opts?: { remote?: string; branch?: string; setUpstream?: boolean }) =>
      ipcRenderer.invoke('git:push', { cwd, ...opts }) as Promise<{ success: boolean; output?: string; error?: string }>,
    aheadBehind: (cwd: string): Promise<{ ahead: number; behind: number }> =>
      ipcRenderer.invoke('git:aheadBehind', cwd),
    createBranch: (cwd: string, branch: string) => ipcRenderer.invoke('git:createBranch', { cwd, branch }),
    checkoutBranch: (cwd: string, branch: string) => ipcRenderer.invoke('git:checkoutBranch', { cwd, branch }),
    listBranches: (cwd: string) => ipcRenderer.invoke('git:listBranches', cwd),
    blame: (cwd: string, filePath: string): Promise<BlameEntry[]> =>
      ipcRenderer.invoke('git:blame', { cwd, filePath }),
    show: (cwd: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('git:show', { cwd, relPath }),
    diffFile: (cwd: string, relPath: string, staged: boolean): Promise<string> =>
      ipcRenderer.invoke('git:diffFile', { cwd, relPath, staged }),
    stagedDiff: (cwd: string): Promise<string> =>
      ipcRenderer.invoke('git:stagedDiff', { cwd }),
    headDiff: (cwd: string): Promise<string> =>
      ipcRenderer.invoke('git:headDiff', { cwd }),
    fileAtRevision: (cwd: string, rev: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('git:fileAtRevision', { cwd, rev, relPath }),
    commitFiles: (cwd: string, hash: string): Promise<Array<{ status: string; path: string; oldPath?: string }>> =>
      ipcRenderer.invoke('git:commitFiles', { cwd, hash }),
    stashCreate: (cwd: string, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashCreate', { cwd, name }),
    stashList: (cwd: string): Promise<Array<{ ref: string; name: string; age: string }>> =>
      ipcRenderer.invoke('git:stashList', cwd),
    stashApply: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashApply', { cwd, ref }),
    stashDrop: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashDrop', { cwd, ref }),
  },

  // ── AI Chat (streaming) ────────────────────────────────────────────────────
  ai: {
    streamChat: (opts: { messages: Array<{ role: string; content: string; images?: string[] }>; model: string; systemPrompt?: string }) =>
      ipcRenderer.invoke('ai:streamChat', opts) as Promise<string>,
    abortStream: (id: string) => ipcRenderer.invoke('ai:abortStream', id),
    listOllamaModels: () => ipcRenderer.invoke('ai:listOllamaModels') as Promise<string[]>,
    complete: (opts: { prefix: string; suffix: string; language: string; model: string }) =>
      ipcRenderer.invoke('ai:complete', opts) as Promise<string | null>,
    buildContext: (opts: { query: string }) =>
      ipcRenderer.invoke('ai:buildContext', opts) as Promise<{ cached: boolean; count?: number }>,
    exportChat: (opts: { markdown: string; defaultFilename: string }) =>
      ipcRenderer.invoke('ai:exportChat', opts) as Promise<string | null>,
    onChunk: (streamId: string, cb: (delta: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { streamId: string; delta: string }) => {
        if (data.streamId === streamId) cb(data.delta)
      }
      ipcRenderer.on('ai:chunk', handler)
      return (): void => { ipcRenderer.removeListener('ai:chunk', handler) }
    },
    onDone: (streamId: string, cb: () => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { streamId: string }) => {
        if (data.streamId === streamId) cb()
      }
      ipcRenderer.on('ai:done', handler)
      return (): void => { ipcRenderer.removeListener('ai:done', handler) }
    },
    onError: (streamId: string, cb: (error: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { streamId: string; error: string }) => {
        if (data.streamId === streamId) cb(data.error)
      }
      ipcRenderer.on('ai:error', handler)
      return (): void => { ipcRenderer.removeListener('ai:error', handler) }
    },
    onUsage: (cb: (data: { streamId: string; inputTokens: number; outputTokens: number; model: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { streamId: string; inputTokens: number; outputTokens: number; model: string }) => cb(data)
      ipcRenderer.on('ai:usage', handler)
      return (): void => { ipcRenderer.removeListener('ai:usage', handler) }
    },
  },

  // ── Memory (subprocess bridge → src.agent_memory) ───────────────────────────
  memory: {
    list: (): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:list'),
    query: (query: string): Promise<MemoryEntry[]> => ipcRenderer.invoke('memory:query', query),
  },

  // ── Search (subprocess bridge → src.bm25_index / src.web_fetcher) ──────────
  search: {
    bm25: (query: string): Promise<BM25Response> => ipcRenderer.invoke('search:bm25', query),
    web: (query: string, braveKey?: string): Promise<{ title: string; url: string; snippet: string }[]> =>
      ipcRenderer.invoke('search:web', query, braveKey ?? ''),
    docs: (pkg: string): Promise<DocsResult | null> => ipcRenderer.invoke('search:docs', pkg),
    tfidf: (query: string): Promise<BM25Response> => ipcRenderer.invoke('search:tfidf', query),
    vector: (query: string, hybrid?: boolean): Promise<BM25Response> =>
      ipcRenderer.invoke('search:vector', query, hybrid ?? false),
    browse: (url: string, task: string): Promise<BrowseResult> => ipcRenderer.invoke('search:browse', url, task),
    assembleContext: (query: string, manualPaths: string[]): Promise<BM25Response> =>
      ipcRenderer.invoke('context:assemble', query, manualPaths),
    buildIndex: (): Promise<{ indexed: number; backend: string }> => ipcRenderer.invoke('search:buildIndex'),
    screenshot: (imagePath: string): Promise<{ description: string } | null> =>
      ipcRenderer.invoke('search:screenshot', imagePath),
  },

  // ── Task Planner (subprocess bridge → src.task_planner) ─────────────────────
  taskPlanner: {
    list: (): Promise<PlanSummary[]> => ipcRenderer.invoke('taskplanner:list'),
    show: (path: string): Promise<TaskPlanDetail | null> => ipcRenderer.invoke('taskplanner:show', path),
    markDone: (path: string, subtaskId: string): Promise<{ id: string; done: number; total: number } | null> =>
      ipcRenderer.invoke('taskplanner:markDone', path, subtaskId),
    create: (goal: string): Promise<TaskPlanDetail | null> => ipcRenderer.invoke('taskplanner:new', goal),
  },

  // ── LSP (subprocess bridge → pyright-langserver + typescript-language-server)
  lsp: {
    python: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:python:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:python:didChange', uri, text),
      hover: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:python:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:python:diagnostics', handler) }
      },
    },
    ts: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:ts:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:ts:didChange', uri, text),
      hover: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:ts:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:ts:diagnostics', handler) }
      },
    },
    go: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:go:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:go:didChange', uri, text),
      hover: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:go:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:go:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:go:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:go:diagnostics', handler) }
      },
    },
    rust: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:rust:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:rust:didChange', uri, text),
      hover: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:rust:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:rust:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:rust:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:rust:diagnostics', handler) }
      },
    },
    java: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:java:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:java:didChange', uri, text),
      hover: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:java:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:java:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:java:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:java:diagnostics', handler) }
      },
    },
    c: {
      didOpen: (uri: string, text: string) => ipcRenderer.invoke('lsp:c:didOpen', uri, text),
      didChange: (uri: string, text: string) => ipcRenderer.invoke('lsp:c:didChange', uri, text),
      hover: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:c:hover', uri, line, character),
      definition: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:c:definition', uri, line, character),
      onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => {
        const handler = (_: Electron.IpcRendererEvent, params: { uri: string; diagnostics: unknown[] }) => cb(params)
        ipcRenderer.on('lsp:c:diagnostics', handler)
        return (): void => { ipcRenderer.removeListener('lsp:c:diagnostics', handler) }
      },
    },
  },

  // ── GitHub (subprocess bridge → src.github_context via gh CLI) ──────────────
  github: {
    fetchIssue: (number: number): Promise<GithubItem | null> => ipcRenderer.invoke('github:fetchIssue', number),
    fetchPr: (number: number): Promise<GithubItem | null> => ipcRenderer.invoke('github:fetchPr', number),
    createPr: (opts: { title: string; body: string; base: string; head: string }): Promise<{ url: string } | null> =>
      ipcRenderer.invoke('github:createPr', opts),
  },

  // ── Agent (shadow workspace + autonomous orchestrator) ────────────────────────
  agent: {
    createShadow: (baseRef?: string): Promise<ShadowInfo | null> =>
      ipcRenderer.invoke('agent:createShadow', baseRef ?? 'HEAD'),
    getShadowDiff: (shadowId: string): Promise<string | null> =>
      ipcRenderer.invoke('agent:getShadowDiff', shadowId),
    getShadowDiffVsBase: (shadowId: string): Promise<string | null> =>
      ipcRenderer.invoke('agent:getShadowDiffVsBase', shadowId),
    promoteShadow: (shadowId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:promoteShadow', shadowId),
    discardShadow: (shadowId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:discardShadow', shadowId),
    startAutonomous: (opts: { planFile: string; model: string }): Promise<string | null> =>
      ipcRenderer.invoke('agent:startAutonomous', opts),
    stopAutonomous: (): Promise<void> =>
      ipcRenderer.invoke('agent:stopAutonomous'),
    getActiveSession: (): Promise<string | null> =>
      ipcRenderer.invoke('agent:getActiveSession'),
    listEventSessions: (): Promise<string[]> =>
      ipcRenderer.invoke('agent:listEventSessions'),
    getEventLog: (sessionId: string): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('agent:getEventLog', sessionId),
    replay: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('agent:replay', sessionId),
    approve: (sessionId: string, approved: boolean): Promise<boolean> =>
      ipcRenderer.invoke('agent:approve', sessionId, approved),
    onProgress: (cb: (progress: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: unknown) => cb(progress)
      ipcRenderer.on('agent:progress', handler)
      return (): void => { ipcRenderer.removeListener('agent:progress', handler) }
    },
  },

  // ── Arch Doc (subprocess bridge → src.arch_doc) ─────────────────────────────
  archDoc: {
    generate: (): Promise<ArchDocResult | null> => ipcRenderer.invoke('archDoc:generate'),
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  settings: {
    checkEngine: (): Promise<{ repoRoot: string; pythonFound: boolean; pytestFound: boolean; ruffFound: boolean }> =>
      ipcRenderer.invoke('settings:checkEngine'),
    pythonBridgeCheck: (): Promise<{ ok: boolean; stats?: unknown; error?: string }> =>
      ipcRenderer.invoke('settings:pythonBridgeCheck'),
    runTests: (): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
      ipcRenderer.invoke('settings:runTests'),
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    validateKey: (provider: 'anthropic' | 'openai' | 'mistral' | 'fireworks', key: string): Promise<{ valid: boolean; error?: string }> =>
      ipcRenderer.invoke('settings:validateKey', { provider, key }),
    exportSettings: (): Promise<string | null> => ipcRenderer.invoke('settings:exportSettings'),
    importSettings: (): Promise<string[] | null> => ipcRenderer.invoke('settings:importSettings'),
  },

  // ── Debugger (DAP) ─────────────────────────────────────────────────────────
  dap: {
    launch: (opts: { program: string; language?: string; args?: string[]; stopOnEntry?: boolean }) =>
      ipcRenderer.invoke('dap:launch', opts) as Promise<{ started: boolean; error?: string }>,
    setBreakpoints: (opts: { path: string; lines: number[] }) =>
      ipcRenderer.invoke('dap:setBreakpoints', opts) as Promise<{ breakpoints: Array<{ verified: boolean; line: number }> }>,
    continue: (opts?: { threadId?: number }) => ipcRenderer.invoke('dap:continue', opts),
    next: (opts?: { threadId?: number }) => ipcRenderer.invoke('dap:next', opts),
    stepIn: (opts?: { threadId?: number }) => ipcRenderer.invoke('dap:stepIn', opts),
    stepOut: (opts?: { threadId?: number }) => ipcRenderer.invoke('dap:stepOut', opts),
    threads: () => ipcRenderer.invoke('dap:threads') as Promise<Array<{ id: number; name: string }>>,
    stackTrace: (opts?: { threadId?: number; startFrame?: number; levels?: number }) =>
      ipcRenderer.invoke('dap:stackTrace', opts) as Promise<Array<{ id: number; name: string; source?: { path?: string }; line: number; column: number }>>,
    variables: (opts: { frameId: number }) =>
      ipcRenderer.invoke('dap:variables', opts) as Promise<Array<{ name: string; value: string; type?: string; variablesReference: number }>>,
    evaluate: (opts: { expression: string; frameId?: number }) =>
      ipcRenderer.invoke('dap:evaluate', opts) as Promise<string>,
    disconnect: () => ipcRenderer.invoke('dap:disconnect') as Promise<{ stopped: boolean }>,
    onStopped: (cb: (body: { reason: string; threadId?: number; allThreadsStopped?: boolean }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, body: unknown) => cb(body as { reason: string; threadId?: number; allThreadsStopped?: boolean })
      ipcRenderer.on('dap:stopped', handler)
      return (): void => { ipcRenderer.removeListener('dap:stopped', handler) }
    },
    onContinued: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('dap:continued', handler)
      return (): void => { ipcRenderer.removeListener('dap:continued', handler) }
    },
    onTerminated: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('dap:terminated', handler)
      return (): void => { ipcRenderer.removeListener('dap:terminated', handler) }
    },
    onOutput: (cb: (body: { output: string; category?: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, body: unknown) => cb(body as { output: string; category?: string })
      ipcRenderer.on('dap:output', handler)
      return (): void => { ipcRenderer.removeListener('dap:output', handler) }
    },
  },

  // ── Window Controls ────────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // ── MCP Servers ──────────────────────────────────────────────────────────
  mcp: {
    listServers: () => ipcRenderer.invoke('mcp:listServers') as Promise<McpServerStatus[]>,
    addServer: (opts: { name: string; command: string; args: string[] }) =>
      ipcRenderer.invoke('mcp:addServer', opts) as Promise<McpServerConfig>,
    removeServer: (id: string) => ipcRenderer.invoke('mcp:removeServer', id) as Promise<void>,
    connect: (id: string) =>
      ipcRenderer.invoke('mcp:connect', id) as Promise<{ success: boolean; error?: string; toolCount?: number }>,
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id) as Promise<void>,
  },
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
