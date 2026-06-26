import type { API } from '../../../preload'
import { socket } from './wsClient'

// WebSocket-backed implementation of the exact same `API` shape the
// Electron preload bridge exposes (desktop/src/preload/index.ts) — built
// with `satisfies API` so the compiler enforces every field is present.
// Channels not yet ported to server/ (decisions, memory, search,
// taskPlanner, github, agent, archDoc, and a few settings/fs extras) return
// safe empty defaults rather than throwing, clearly marked below, so the
// rest of the app keeps working while those phases land.
const notPortedWarned = new Set<string>()
function notPorted<T>(label: string, fallback: T): T {
  if (!notPortedWarned.has(label)) {
    notPortedWarned.add(label)
    console.warn(`[meshflow-web] "${label}" has no server-side handler yet — returning a stub.`)
  }
  return fallback
}

export function createWebApi(): API {
  return {
    decisions: {
      list: () => Promise.resolve(notPorted('decisions.list', [])),
      search: () => Promise.resolve(notPorted('decisions.search', [])),
      stats: () => Promise.resolve(notPorted('decisions.stats', {
        total: 0, withRetry: 0, retryRatePct: 0, verdictCounts: {}, topFindings: [], topFiles: [], agents: [],
      })),
      log: () => Promise.resolve(notPorted('decisions.log', { ok: false, error: 'not ported' })),
      export: () => Promise.resolve(notPorted('decisions.export', null)),
    },

    fs: {
      readFile: (p) => socket.invoke('fs:readFile', { path: p }),
      writeFile: (p, c) => socket.invoke('fs:writeFile', { path: p, content: c }),
      readDir: (p) => socket.invoke('fs:readDir', { path: p }),
      createDir: (p) => socket.invoke('fs:createDir', { path: p }),
      deleteEntry: (p) => socket.invoke('fs:deleteEntry', { path: p }),
      rename: (o, n) => socket.invoke('fs:rename', { oldPath: o, newPath: n }),
      exists: (p) => socket.invoke('fs:exists', { path: p }),
      openDialog: () => Promise.resolve(notPorted('fs.openDialog', null)),
      openFile: () => Promise.resolve(notPorted('fs.openFile', null)),
      watchDir: () => Promise.resolve(notPorted('fs.watchDir', undefined)),
      unwatchDir: () => Promise.resolve(notPorted('fs.unwatchDir', undefined)),
      searchInFiles: (p, q, cs, rx) => socket.invoke('fs:searchInFiles', { dirPath: p, query: q, caseSensitive: cs ?? false, regex: rx ?? false }),
      replaceInFiles: (p, q, r, cs, rx) => socket.invoke('fs:replaceInFiles', { dirPath: p, query: q, replacement: r, caseSensitive: cs ?? false, regex: rx ?? false }),
      onFileChange: () => () => {},
      findFiles: () => Promise.resolve(notPorted('fs.findFiles', [] as string[])),
      isGitignored: () => Promise.resolve(notPorted('fs.isGitignored', false)),
      findEnvFiles: () => Promise.resolve(notPorted('fs.findEnvFiles', [] as string[])),
    },

    terminal: {
      create: (opts) => socket.invoke('terminal:create', opts),
      write: (id, data) => socket.invoke('terminal:write', { id, data }),
      resize: (id, cols, rows) => socket.invoke('terminal:resize', { id, cols, rows }),
      kill: (id) => socket.invoke('terminal:kill', { id }),
      onData: (id, cb) => socket.on(`terminal:data:${id}`, (payload) => cb(payload as string)),
      onExit: (id, cb) => socket.on(`terminal:exit:${id}`, (payload) => cb(payload as number)),
      runCommand: (command, cwd) => socket.invoke('terminal:runCommand', { command, cwd }),
      logRun: () => Promise.resolve(notPorted('terminal.logRun', undefined)),
    },

    monitor: {
      start: () => Promise.resolve(notPorted('monitor.start', { error: 'not available in web mode' })),
      stop: () => Promise.resolve(notPorted('monitor.stop', undefined)),
      listAlerts: () => Promise.resolve(notPorted('monitor.listAlerts', [])),
      clearAlerts: () => Promise.resolve(notPorted('monitor.clearAlerts', undefined)),
      onData: () => () => {},
      onAlert: () => () => {},
      onExit: () => () => {},
    },

    git: {
      branch: (cwd) => socket.invoke('git:branch', cwd),
      status: (cwd) => socket.invoke('git:status', cwd),
      log: (cwd) => socket.invoke('git:log', cwd),
      add: (cwd, paths) => socket.invoke('git:add', { cwd, paths }),
      commit: (cwd, message) => socket.invoke('git:commit', { cwd, message }),
      diff: (cwd, filePath) => socket.invoke('git:diff', { cwd, path: filePath }),
      statusFiles: (cwd) => socket.invoke('git:statusFiles', cwd),
      pull: (cwd) => socket.invoke('git:pull', { cwd }),
      push: (cwd, opts) => socket.invoke('git:push', { cwd, ...opts }),
      aheadBehind: () => Promise.resolve({ ahead: 0, behind: 0 }),
      createBranch: (cwd, branch) => socket.invoke('git:createBranch', { cwd, branch }),
      checkoutBranch: (cwd, branch) => socket.invoke('git:checkoutBranch', { cwd, branch }),
      listBranches: (cwd) => socket.invoke('git:listBranches', cwd),
      blame: () => Promise.resolve([]),
      show: () => Promise.resolve(''),
      diffFile: () => Promise.resolve(''),
      stagedDiff: () => Promise.resolve(''),
      headDiff: () => Promise.resolve(''),
      diffBranches: () => Promise.resolve(notPorted('git.diffBranches', '')),
      fileAtRevision: () => Promise.resolve(''),
      commitFiles: () => Promise.resolve([]),
      stashCreate: () => Promise.resolve(notPorted('git.stashCreate', { success: false })),
      stashList: () => Promise.resolve(notPorted('git.stashList', [] as Array<{ ref: string; name: string; age: string }>)),
      stashShow: () => Promise.resolve(notPorted('git.stashShow', '')),
      stashApply: () => Promise.resolve(notPorted('git.stashApply', { success: false })),
      stashDrop: () => Promise.resolve(notPorted('git.stashDrop', { success: false })),
      discardFile: () => Promise.resolve(notPorted('git.discardFile', { success: false })),
      undoLastCommit: () => Promise.resolve(notPorted('git.undoLastCommit', { success: false })),
      merge: () => Promise.resolve(notPorted('git.merge', { success: false })),
    },

    ai: {
      streamChat: (opts) => socket.invoke('ai:streamChat', opts),
      abortStream: (id) => socket.invoke('ai:abortStream', id),
      listOllamaModels: () => socket.invoke('ai:listOllamaModels'),
      complete: (opts) => socket.invoke('ai:complete', opts),
      predictNextEdit: () => Promise.resolve(null),
      onChunk: (streamId, cb) => socket.on('ai:chunk', (payload) => {
        const data = payload as { streamId: string; delta: string }
        if (data.streamId === streamId) cb(data.delta)
      }),
      onDone: (streamId, cb) => socket.on('ai:done', (payload) => {
        const data = payload as { streamId: string }
        if (data.streamId === streamId) cb()
      }),
      onError: (streamId, cb) => socket.on('ai:error', (payload) => {
        const data = payload as { streamId: string; error: string }
        if (data.streamId === streamId) cb(data.error)
      }),
      buildContext: (opts) => socket.invoke('ai:buildContext', opts),
      exportChat: () => Promise.resolve(notPorted('ai.exportChat', null)),
      onUsage: (cb) => socket.on('ai:usage', (payload) => {
        cb(payload as { streamId: string; inputTokens: number; outputTokens: number; model: string })
      }),
    },

    memory: {
      list: () => Promise.resolve(notPorted('memory.list', [])),
      query: () => Promise.resolve(notPorted('memory.query', [])),
      write: () => Promise.resolve(notPorted('memory.write', false)),
      delete: () => Promise.resolve(notPorted('memory.delete', false)),
    },

    search: {
      bm25: (query) => socket.invoke('search:bm25', query),
      web: () => Promise.resolve(notPorted('search.web', [])),
      docs: () => Promise.resolve(notPorted('search.docs', null)),
      tfidf: (query) => socket.invoke('search:tfidf', query),
      vector: (query, hybrid) => socket.invoke('search:vector', { query, hybrid: hybrid ?? false }),
      browse: () => Promise.resolve(notPorted('search.browse', { url: '', task: '', result: '', success: false })),
      assembleContext: (query, manualPaths) => socket.invoke('context:assemble', { query, manualPaths }),
      buildIndex: () => socket.invoke('search:buildIndex'),
      screenshot: () => Promise.resolve(notPorted('search.screenshot', null)),
      callers: () => Promise.resolve(notPorted('search.callers', [] as Array<{ file: string; line: number }>)),
      dependsOn: () => Promise.resolve(notPorted('search.dependsOn', [] as string[])),
      dependentsOf: () => Promise.resolve(notPorted('search.dependentsOf', [] as string[])),
    },

    taskPlanner: {
      list: () => Promise.resolve(notPorted('taskPlanner.list', [])),
      show: () => Promise.resolve(notPorted('taskPlanner.show', null)),
      markDone: () => Promise.resolve(notPorted('taskPlanner.markDone', null)),
      create: () => Promise.resolve(notPorted('taskPlanner.create', null)),
      delete: () => Promise.resolve(notPorted('taskPlanner.delete', { deleted: false })),
      revise: () => Promise.resolve(notPorted('taskPlanner.revise', null)),
    },

    ideation: {
      saveSpec: () => Promise.resolve(notPorted('ideation.saveSpec', null)),
      listSpecs: () => Promise.resolve(notPorted('ideation.listSpecs', [])),
      readSpec: () => Promise.resolve(notPorted('ideation.readSpec', null)),
      generateComponent: () => Promise.resolve(notPorted('ideation.generateComponent', null)),
    },

    lsp: {
      python: {
        didOpen: (uri, text) => socket.invoke('lsp:python:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:python:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:python:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:python:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:python:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:python:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:python:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:python:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:python:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:python:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:python:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:python:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:python:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:python:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:python:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:python:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:python:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:python:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:python:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:python:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:python:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:python:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:python:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:python:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:python:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:python:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:python:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:python:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      ts: {
        didOpen: (uri, text) => socket.invoke('lsp:ts:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:ts:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:ts:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:ts:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:ts:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:ts:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:ts:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:ts:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:ts:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:ts:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:ts:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:ts:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:ts:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:ts:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:ts:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:ts:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:ts:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:ts:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:ts:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:ts:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:ts:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:ts:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:ts:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:ts:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:ts:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:ts:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:ts:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:ts:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      go: {
        didOpen: (uri, text) => socket.invoke('lsp:go:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:go:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:go:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:go:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:go:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:go:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:go:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:go:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:go:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:go:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:go:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:go:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:go:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:go:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:go:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:go:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:go:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:go:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:go:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:go:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:go:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:go:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:go:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:go:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:go:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:go:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:go:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:go:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      rust: {
        didOpen: (uri, text) => socket.invoke('lsp:rust:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:rust:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:rust:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:rust:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:rust:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:rust:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:rust:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:rust:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:rust:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:rust:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:rust:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:rust:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:rust:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:rust:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:rust:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:rust:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:rust:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:rust:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:rust:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:rust:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:rust:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:rust:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:rust:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:rust:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:rust:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:rust:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:rust:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:rust:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      java: {
        didOpen: (uri, text) => socket.invoke('lsp:java:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:java:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:java:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:java:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:java:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:java:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:java:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:java:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:java:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:java:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:java:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:java:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:java:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:java:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:java:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:java:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:java:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:java:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:java:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:java:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:java:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:java:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:java:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:java:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:java:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:java:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:java:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:java:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      c: {
        didOpen: (uri, text) => socket.invoke('lsp:c:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:c:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:c:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:c:definition', { uri, line, character }),
        references: (uri, line, character) => socket.invoke('lsp:c:references', { uri, line, character }),
        codeAction: (uri, range, diagnostics) => socket.invoke('lsp:c:codeAction', { uri, range, diagnostics }),
        executeCommand: (command, args) => socket.invoke('lsp:c:executeCommand', { command, args }),
        rename: (uri, line, character, newName) => socket.invoke('lsp:c:rename', { uri, line, character, newName }),
        format: (uri, tabSize, insertSpaces) => socket.invoke('lsp:c:format', { uri, tabSize, insertSpaces }),
        signatureHelp: (uri, line, character) => socket.invoke('lsp:c:signatureHelp', { uri, line, character }),
        completion: (uri, line, character) => socket.invoke('lsp:c:completion', { uri, line, character }),
        inlayHint: (uri, startLine, endLine) => socket.invoke('lsp:c:inlayHint', { uri, startLine, endLine }),
        foldingRange: (uri) => socket.invoke('lsp:c:foldingRange', { uri }),
        typeDefinition: (uri, line, character) => socket.invoke('lsp:c:typeDefinition', { uri, line, character }),
        implementation: (uri, line, character) => socket.invoke('lsp:c:implementation', { uri, line, character }),
        documentHighlight: (uri, line, character) => socket.invoke('lsp:c:documentHighlight', { uri, line, character }),
        prepareRename: (uri, line, character) => socket.invoke('lsp:c:prepareRename', { uri, line, character }),
        codeLens: (uri) => socket.invoke('lsp:c:codeLens', { uri }),
        codeLensResolve: (item) => socket.invoke('lsp:c:codeLensResolve', item),
        workspaceSymbol: (query) => socket.invoke('lsp:c:workspaceSymbol', { query }),
        semanticTokens: (uri) => socket.invoke('lsp:c:semanticTokens', { uri }),
        documentSymbol: (uri) => socket.invoke('lsp:c:documentSymbol', { uri }),
        selectionRange: (uri, positions) => socket.invoke('lsp:c:selectionRange', { uri, positions }),
        onTypeFormatting: (uri, line, character, ch, tabSize, insertSpaces) => socket.invoke('lsp:c:onTypeFormatting', { uri, line, character, ch, tabSize, insertSpaces }),
        linkedEditingRange: (uri, line, character) => socket.invoke('lsp:c:linkedEditingRange', { uri, line, character }),
        documentLink: (uri) => socket.invoke('lsp:c:documentLink', { uri }),
        documentLinkResolve: (item) => socket.invoke('lsp:c:documentLinkResolve', item),
        onDiagnostics: (cb) => socket.on('lsp:c:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
    },

    github: {
      fetchIssue: () => Promise.resolve(notPorted('github.fetchIssue', null)),
      fetchPr: () => Promise.resolve(notPorted('github.fetchPr', null)),
      createPr: () => Promise.resolve(notPorted('github.createPr', null)),
      listPrs: () => Promise.resolve(notPorted('github.listPrs', [])),
      listIssues: () => Promise.resolve(notPorted('github.listIssues', [])),
      commentOnPr: () => Promise.resolve(notPorted('github.commentOnPr', false)),
      reviewPr: () => Promise.resolve(notPorted('github.reviewPr', false)),
      getPrDiff: () => Promise.resolve(notPorted('github.getPrDiff', '')),
      postReviewComments: () => Promise.resolve(notPorted('github.postReviewComments', false)),
      listWorkflowRuns: () => Promise.resolve(notPorted('github.listWorkflowRuns', [] as import('../../../main/ipc/github.handlers').WorkflowRun[])),
      getRunStatus: () => Promise.resolve(notPorted('github.getRunStatus', null)),
    },

    linear: {
      getIssue: () => Promise.resolve(notPorted('linear.getIssue', null)),
    },

    jira: {
      getIssue: () => Promise.resolve(notPorted('jira.getIssue', null)),
    },

    voice: {
      transcribe: () => Promise.resolve(notPorted('voice.transcribe', null)),
    },

    data: {
      analyze: () => Promise.resolve(notPorted('data.analyze', null)),
    },

    design: {
      extract: () => Promise.resolve(notPorted('design.extract', null)),
    },

    wizard: {
      scaffold: () => Promise.resolve(notPorted('wizard.scaffold', { success: false, error: 'not ported' })),
      onDone: () => () => {},
    },

    notifications: {
      send: () => Promise.resolve(notPorted('notifications.send', false)),
    },

    handoff: {
      set: () => Promise.resolve(notPorted('handoff.set', undefined)),
      get: () => Promise.resolve(notPorted('handoff.get', null)),
      list: () => Promise.resolve(notPorted('handoff.list', [] as Array<{ key: string; preview: string; writtenByRole: string | null; ts: number }>)),
      clear: () => Promise.resolve(notPorted('handoff.clear', false)),
    },

    webhook: {
      start: () => Promise.resolve(notPorted('webhook.start', { success: false, error: 'not available in web mode' })),
      stop: () => Promise.resolve(notPorted('webhook.stop', false)),
      status: () => Promise.resolve(notPorted('webhook.status', { running: false, port: 0 })),
    },

    collab: {
      getInviteLink: () => Promise.resolve(notPorted('collab.getInviteLink', '')),
    },

    agent: {
      createShadow: () => Promise.resolve(notPorted('agent.createShadow', null)),
      getShadowDiff: () => Promise.resolve(notPorted('agent.getShadowDiff', null)),
      getShadowDiffVsBase: () => Promise.resolve(notPorted('agent.getShadowDiffVsBase', null)),
      promoteShadow: () => Promise.resolve(notPorted('agent.promoteShadow', false)),
      discardShadow: () => Promise.resolve(notPorted('agent.discardShadow', false)),
      startAutonomous: () => Promise.resolve(notPorted('agent.startAutonomous', null)),
      planRoles: () => Promise.resolve(notPorted('agent.planRoles', [] as string[])),
      stopAutonomous: () => Promise.resolve(notPorted('agent.stopAutonomous', false)),
      runTestFixLoop: () => Promise.resolve(notPorted('agent.runTestFixLoop', null)),
      getActiveSessions: () => Promise.resolve(notPorted('agent.getActiveSessions', [] as string[])),
      listEventSessions: () => Promise.resolve(notPorted('agent.listEventSessions', [] as Array<{ id: string; branch?: string; startedAt: number }>)),
      getEventLog: () => Promise.resolve(notPorted('agent.getEventLog', [] as Array<Record<string, unknown>>)),
      verifyEventLog: () => Promise.resolve(notPorted('agent.verifyEventLog', { valid: true, totalEvents: 0 })),
      replay: () => Promise.resolve(notPorted('agent.replay', false)),
      approve: () => Promise.resolve(notPorted('agent.approve', false)),
      getSessionDiff: () => Promise.resolve(notPorted('agent.getSessionDiff', '')),
      getComplianceSummary: () => Promise.resolve(notPorted('agent.getComplianceSummary', {
        totalSessions: 0, totalBlockedEvents: 0, totalErrorEvents: 0, totalApprovalRequests: 0, totalApproved: 0, totalRejected: 0,
      })),
      exportReportHtml: () => Promise.resolve(notPorted('agent.exportReportHtml', null)),
      exportReportPdf: () => Promise.resolve(notPorted('agent.exportReportPdf', null)),
      getComplianceJson: () => Promise.resolve(notPorted('agent.getComplianceJson', null)),
      mergeSession: () => Promise.resolve(notPorted('agent.mergeSession', { success: false, conflicts: [] as string[] })),
      onProgress: () => () => {},
    },

    deploy: {
      detect: () => Promise.resolve(notPorted('deploy.detect', null)),
      run: () => Promise.resolve(notPorted('deploy.run', { success: false, error: 'not supported in web mode' })),
      runWithChecks: () => Promise.resolve(notPorted('deploy.runWithChecks', { success: false, error: 'not supported in web mode' })),
      history: () => Promise.resolve(notPorted('deploy.history', [])),
      promote: () => Promise.resolve(notPorted('deploy.promote', { success: false, error: 'not supported in web mode' })),
      rollback: () => Promise.resolve(notPorted('deploy.rollback', { success: false, error: 'not supported in web mode' })),
    },

    policy: {
      test: () => Promise.resolve(notPorted('policy.test', null)),
    },

    archDoc: {
      generate: () => Promise.resolve(notPorted('archDoc.generate', null)),
    },

    context: {
      cacheStats: () => Promise.resolve(notPorted('context.cacheStats', { total: 0, bytes: 0 })),
      evictCache: () => Promise.resolve(notPorted('context.evictCache', { deleted: 0 })),
      orientation: () => Promise.resolve(notPorted('context.orientation', { text: '', cached: false })),
      withDiff: () => Promise.resolve(notPorted('context.withDiff', { text: '' })),
    },

    dap: {
      launch: (opts) => socket.invoke('dap:launch', opts),
      setBreakpoints: (opts) => socket.invoke('dap:setBreakpoints', opts),
      continue: (opts) => socket.invoke('dap:continue', opts),
      next: (opts) => socket.invoke('dap:next', opts),
      stepIn: (opts) => socket.invoke('dap:stepIn', opts),
      stepOut: (opts) => socket.invoke('dap:stepOut', opts),
      threads: () => socket.invoke('dap:threads'),
      stackTrace: (opts) => socket.invoke('dap:stackTrace', opts),
      variables: (opts) => socket.invoke('dap:variables', opts),
      evaluate: (opts) => socket.invoke('dap:evaluate', opts),
      disconnect: () => socket.invoke('dap:disconnect'),
      onStopped: (cb) => socket.on('dap:stopped', (payload) => cb(payload as { reason: string; threadId?: number; allThreadsStopped?: boolean })),
      onContinued: (cb) => socket.on('dap:continued', () => cb()),
      onTerminated: (cb) => socket.on('dap:terminated', () => cb()),
      onOutput: (cb) => socket.on('dap:output', (payload) => cb(payload as { output: string; category?: string })),
    },

    settings: {
      checkEngine: () => Promise.resolve(notPorted('settings.checkEngine', {
        repoRoot: '', pythonFound: false, pytestFound: false, ruffFound: false,
      })),
      pythonBridgeCheck: () => Promise.resolve(notPorted('settings.pythonBridgeCheck', { ok: false, error: 'not ported' })),
      runTests: () => Promise.resolve(notPorted('settings.runTests', { stdout: '', stderr: 'not ported', exitCode: 1 })),
      get: (key) => socket.invoke('settings:get', key),
      set: (key, value) => socket.invoke('settings:set', { key, value }),
      getAll: () => socket.invoke('settings:getAll'),
      validateKey: (provider, key) => socket.invoke('settings:validateKey', { provider, key }),
      exportSettings: () => Promise.resolve(notPorted('settings.exportSettings', null)),
      importSettings: () => Promise.resolve(notPorted('settings.importSettings', null)),
      setSecret: () => Promise.resolve(notPorted('settings.setSecret', { success: false })),
      getSecret: () => Promise.resolve(notPorted('settings.getSecret', '')),
    },

    window: {
      // Window chrome controls have no meaning in a browser tab.
      minimize: () => {},
      maximize: () => {},
      close: () => {},
    },

    mcp: {
      listServers: () => Promise.resolve(notPorted('mcp.listServers', [])),
      addServer: () => Promise.resolve(notPorted('mcp.addServer', { id: '', name: '', command: '', args: [] })),
      removeServer: () => Promise.resolve(notPorted('mcp.removeServer', undefined)),
      connect: () => Promise.resolve(notPorted('mcp.connect', { success: false })),
      disconnect: () => Promise.resolve(notPorted('mcp.disconnect', undefined)),
    },
  } satisfies API
}
