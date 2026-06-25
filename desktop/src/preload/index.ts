import { contextBridge, ipcRenderer } from 'electron'
import type { ParsedDecision, DecisionStats, DecisionLogOpts } from '../main/ipc/decisions.handlers'
import type { MemoryEntry } from '../main/ipc/memory.handlers'
import type { BM25Response, DocsResult, BrowseResult } from '../main/ipc/search.handlers'
import type { GithubItem, GithubListItem } from '../main/ipc/github.handlers'
import type { BlameEntry } from '../main/ipc/git.handlers'
import type { ShadowInfo } from '../main/ipc/sandbox.handlers'
import type { PlanSummary, TaskPlanDetail } from '../main/ipc/taskplanner.handlers'
import type { ArchDocResult } from '../main/ipc/archDoc.handlers'
import type { McpServerConfig, McpServerStatus } from '../main/mcp/mcpManager'
import type { SessionSummary, VerifyResult, ComplianceSummary } from '../main/agentEventLog'
import type { PolicyTestOpts } from '../main/ipc/policy.handlers'
import type { PolicyViolation } from '../main/policyEngine'

const api = {
  // ── Decisions ──────────────────────────────────────────────────────────────
  decisions: {
    list: (overrideDir?: string): Promise<ParsedDecision[]> => ipcRenderer.invoke('decisions:list', overrideDir),
    search: (query: string, overrideDir?: string): Promise<ParsedDecision[]> =>
      ipcRenderer.invoke('decisions:search', query, overrideDir),
    stats: (overrideDir?: string): Promise<DecisionStats> => ipcRenderer.invoke('decisions:stats', overrideDir),
    // Gap 74 — create a decision log entry from the UI
    log: (opts: DecisionLogOpts): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('decisions:log', opts),
    // Gap 84 — export all decisions as JSON for compliance auditors
    export: (overrideDir?: string): Promise<{ filePath: string } | null> =>
      ipcRenderer.invoke('decisions:export', overrideDir),
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
    searchInFiles: (dirPath: string, query: string, caseSensitive = false, regex = false): Promise<Array<{ file: string; line: number; text: string; matchStart: number; matchEnd: number }>> =>
      ipcRenderer.invoke('fs:searchInFiles', { dirPath, query, caseSensitive, regex }),
    replaceInFiles: (dirPath: string, query: string, replacement: string, caseSensitive = false, regex = false): Promise<{ filesChanged: number; replacements: number }> =>
      ipcRenderer.invoke('fs:replaceInFiles', { dirPath, query, replacement, caseSensitive, regex }),
    onFileChange: (cb: (e: { eventType: string; filename: string; dirPath: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { eventType: string; filename: string; dirPath: string }) => cb(data)
      ipcRenderer.on('fs:change', handler)
      return (): void => { ipcRenderer.removeListener('fs:change', handler) }
    },
    findFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:findFiles', root),
    isGitignored: (relPath: string): Promise<boolean> => ipcRenderer.invoke('fs:isGitignored', relPath),
    findEnvFiles: (root: string): Promise<string[]> => ipcRenderer.invoke('fs:findEnvFiles', root),
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
    // Gap 103 — compare any two branches
    diffBranches: (cwd: string, base: string, compare: string): Promise<string> =>
      ipcRenderer.invoke('git:diffBranches', { cwd, base, compare }),
    fileAtRevision: (cwd: string, rev: string, relPath: string): Promise<string> =>
      ipcRenderer.invoke('git:fileAtRevision', { cwd, rev, relPath }),
    commitFiles: (cwd: string, hash: string): Promise<Array<{ status: string; path: string; oldPath?: string }>> =>
      ipcRenderer.invoke('git:commitFiles', { cwd, hash }),
    stashCreate: (cwd: string, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashCreate', { cwd, name }),
    stashList: (cwd: string): Promise<Array<{ ref: string; name: string; age: string }>> =>
      ipcRenderer.invoke('git:stashList', cwd),
    // Gap 99 — preview a checkpoint's diff before restoring it
    stashShow: (cwd: string, ref: string): Promise<string> => ipcRenderer.invoke('git:stashShow', { cwd, ref }),
    stashApply: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashApply', { cwd, ref }),
    stashDrop: (cwd: string, ref: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:stashDrop', { cwd, ref }),
    // Gap 85 — discard unstaged changes for one file
    discardFile: (cwd: string, filePath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:discardFile', { cwd, filePath }),
    // Gap 89 — soft-reset HEAD~1, keep changes staged
    undoLastCommit: (cwd: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:undoLastCommit', { cwd }),
    // Gap 90 — merge a local branch into the current branch
    merge: (cwd: string, branch: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:merge', { cwd, branch }),
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
    // Gap 80 — create/update and delete from IDE
    write: (key: string, content: string): Promise<boolean> => ipcRenderer.invoke('memory:write', key, content),
    delete: (key: string): Promise<boolean> => ipcRenderer.invoke('memory:delete', key),
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
    // Gap 70 — call-graph browser
    callers: (fn: string): Promise<Array<{ file: string; line: number }>> =>
      ipcRenderer.invoke('search:callers', fn),
    dependsOn: (file: string): Promise<string[]> =>
      ipcRenderer.invoke('search:dependsOn', file),
    dependentsOf: (file: string): Promise<string[]> =>
      ipcRenderer.invoke('search:dependentsOf', file),
  },

  // ── Task Planner (subprocess bridge → src.task_planner) ─────────────────────
  taskPlanner: {
    list: (): Promise<PlanSummary[]> => ipcRenderer.invoke('taskplanner:list'),
    show: (path: string): Promise<TaskPlanDetail | null> => ipcRenderer.invoke('taskplanner:show', path),
    markDone: (path: string, subtaskId: string): Promise<{ id: string; done: number; total: number } | null> =>
      ipcRenderer.invoke('taskplanner:markDone', path, subtaskId),
    create: (goal: string): Promise<TaskPlanDetail | null> => ipcRenderer.invoke('taskplanner:new', goal),
    // Gap 83 — delete a plan file from disk
    delete: (planPath: string): Promise<{ deleted: boolean }> => ipcRenderer.invoke('taskplanner:delete', planPath),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:python:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:python:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:python:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:python:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:python:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:python:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:python:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:python:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:python:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:python:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:python:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:python:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:python:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:python:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:python:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:python:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:python:documentLinkResolve', item),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:ts:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:ts:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:ts:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:ts:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:ts:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:ts:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:ts:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:ts:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:ts:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:ts:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:ts:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:ts:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:ts:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:ts:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:ts:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:ts:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:ts:documentLinkResolve', item),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:go:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:go:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:go:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:go:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:go:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:go:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:go:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:go:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:go:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:go:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:go:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:go:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:go:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:go:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:go:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:go:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:go:documentLinkResolve', item),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:rust:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:rust:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:rust:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:rust:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:rust:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:rust:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:rust:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:rust:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:rust:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:rust:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:rust:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:rust:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:rust:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:rust:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:rust:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:rust:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:rust:documentLinkResolve', item),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:java:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:java:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:java:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:java:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:java:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:java:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:java:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:java:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:java:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:java:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:java:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:java:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:java:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:java:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:java:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:java:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:java:documentLinkResolve', item),
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
      references: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:references', uri, line, character),
      codeAction: (uri: string, range: unknown, diagnostics: unknown[]) =>
        ipcRenderer.invoke('lsp:c:codeAction', uri, range, diagnostics),
      executeCommand: (command: string, args: unknown[]) =>
        ipcRenderer.invoke('lsp:c:executeCommand', command, args),
      rename: (uri: string, line: number, character: number, newName: string) =>
        ipcRenderer.invoke('lsp:c:rename', uri, line, character, newName),
      format: (uri: string, tabSize: number, insertSpaces: boolean) =>
        ipcRenderer.invoke('lsp:c:format', uri, tabSize, insertSpaces),
      signatureHelp: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:signatureHelp', uri, line, character),
      completion: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:completion', uri, line, character),
      inlayHint: (uri: string, startLine: number, endLine: number) =>
        ipcRenderer.invoke('lsp:c:inlayHint', uri, startLine, endLine),
      foldingRange: (uri: string) => ipcRenderer.invoke('lsp:c:foldingRange', uri),
      typeDefinition: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:typeDefinition', uri, line, character),
      implementation: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:implementation', uri, line, character),
      documentHighlight: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:documentHighlight', uri, line, character),
      prepareRename: (uri: string, line: number, character: number) =>
        ipcRenderer.invoke('lsp:c:prepareRename', uri, line, character),
      codeLens: (uri: string) => ipcRenderer.invoke('lsp:c:codeLens', uri),
      codeLensResolve: (item: unknown) => ipcRenderer.invoke('lsp:c:codeLensResolve', item),
      workspaceSymbol: (query: string) => ipcRenderer.invoke('lsp:c:workspaceSymbol', query),
      semanticTokens: (uri: string) => ipcRenderer.invoke('lsp:c:semanticTokens', uri),
      documentSymbol: (uri: string) => ipcRenderer.invoke('lsp:c:documentSymbol', uri),
      selectionRange: (uri: string, positions: Array<{ line: number; character: number }>) => ipcRenderer.invoke('lsp:c:selectionRange', uri, positions),
      onTypeFormatting: (uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) => ipcRenderer.invoke('lsp:c:onTypeFormatting', uri, line, character, ch, tabSize, insertSpaces),
      linkedEditingRange: (uri: string, line: number, character: number) => ipcRenderer.invoke('lsp:c:linkedEditingRange', uri, line, character),
      documentLink: (uri: string) => ipcRenderer.invoke('lsp:c:documentLink', uri),
      documentLinkResolve: (item: unknown) => ipcRenderer.invoke('lsp:c:documentLinkResolve', item),
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
    // Gap 100 — browse open PRs/issues without already knowing the number
    listPrs: (state?: 'open' | 'closed' | 'all'): Promise<GithubListItem[]> => ipcRenderer.invoke('github:listPrs', state),
    listIssues: (state?: 'open' | 'closed' | 'all'): Promise<GithubListItem[]> => ipcRenderer.invoke('github:listIssues', state),
    // Gap 101 — review a PR from the IDE
    commentOnPr: (number: number, body: string): Promise<boolean> => ipcRenderer.invoke('github:commentOnPr', { number, body }),
    reviewPr: (number: number, action: 'approve' | 'request-changes' | 'comment', body?: string): Promise<boolean> =>
      ipcRenderer.invoke('github:reviewPr', { number, action, body }),
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
    listEventSessions: (): Promise<SessionSummary[]> =>
      ipcRenderer.invoke('agent:listEventSessions'),
    getEventLog: (sessionId: string): Promise<Array<Record<string, unknown>>> =>
      ipcRenderer.invoke('agent:getEventLog', sessionId),
    verifyEventLog: (sessionId: string): Promise<VerifyResult> =>
      ipcRenderer.invoke('agent:verifyEventLog', sessionId),
    replay: (sessionId: string, speedup?: number): Promise<boolean> =>
      ipcRenderer.invoke('agent:replay', sessionId, speedup),
    approve: (sessionId: string, approved: boolean): Promise<boolean> =>
      ipcRenderer.invoke('agent:approve', sessionId, approved),
    getSessionDiff: (branch: string): Promise<string> =>
      ipcRenderer.invoke('agent:getSessionDiff', branch),
    getComplianceSummary: (): Promise<ComplianceSummary> =>
      ipcRenderer.invoke('agent:getComplianceSummary'),
    exportReportHtml: (sessionId: string): Promise<string | null> =>
      ipcRenderer.invoke('agent:exportReportHtml', sessionId),
    exportReportPdf: (sessionId: string): Promise<string | null> =>
      ipcRenderer.invoke('agent:exportReportPdf', sessionId),
    onProgress: (cb: (progress: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, progress: unknown) => cb(progress)
      ipcRenderer.on('agent:progress', handler)
      return (): void => { ipcRenderer.removeListener('agent:progress', handler) }
    },
  },

  // ── Deploy (Gap 140 — manual one-click deploy, reuses agent:progress) ──────
  deploy: {
    detect: (): Promise<string | null> => ipcRenderer.invoke('deploy:detect'),
    run: (): Promise<{ success: boolean; deployUrl?: string; error?: string }> =>
      ipcRenderer.invoke('deploy:run'),
  },

  // ── Policy (Gap 67 — dry-run governance rules against a sample value) ──────
  policy: {
    test: (opts: PolicyTestOpts): Promise<PolicyViolation | null> =>
      ipcRenderer.invoke('policy:test', opts),
  },

  // ── Arch Doc (subprocess bridge → src.arch_doc) ─────────────────────────────
  archDoc: {
    generate: (): Promise<ArchDocResult | null> => ipcRenderer.invoke('archDoc:generate'),
  },

  // ── Context cache + orientation (Gaps 72, 75, 81) ────────────────────────
  context: {
    cacheStats: (): Promise<{ total: number; bytes: number }> =>
      ipcRenderer.invoke('context:cacheStats'),
    evictCache: (maxFiles?: number): Promise<{ deleted: number }> =>
      ipcRenderer.invoke('context:evictCache', maxFiles ?? 0),
    // Gap 75 — cached repo orientation block
    orientation: (): Promise<{ text: string; cached: boolean }> =>
      ipcRenderer.invoke('context:orientation'),
    // Gap 81 — git diff context block relative to a ref
    withDiff: (ref?: string): Promise<{ text: string }> =>
      ipcRenderer.invoke('context:withDiff', ref ?? 'HEAD'),
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
    // Gap 88 — encrypted API key storage (safeStorage, OS-keychain-backed)
    setSecret: (key: string, value: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('settings:setSecret', key, value),
    getSecret: (key: string): Promise<string> => ipcRenderer.invoke('settings:getSecret', key),
  },

  // ── Debugger (DAP) ─────────────────────────────────────────────────────────
  dap: {
    launch: (opts: { program: string; language?: string; args?: string[]; stopOnEntry?: boolean }) =>
      ipcRenderer.invoke('dap:launch', opts) as Promise<{ started: boolean; error?: string }>,
    setBreakpoints: (opts: { path: string; breakpoints: Array<{ line: number; condition?: string }> }) =>
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
// Gap 139 — lets renderer code (e.g. LivePreview.tsx) pick <webview> vs <iframe>
// without depending on window.api internals for an unrelated detection signal.
contextBridge.exposeInMainWorld('isElectron', true)

export type API = typeof api
