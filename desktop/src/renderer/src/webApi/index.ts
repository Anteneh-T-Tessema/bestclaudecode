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
    console.warn(`[lakoora-web] "${label}" has no server-side handler yet — returning a stub.`)
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
      searchInFiles: () => Promise.resolve(notPorted('fs.searchInFiles', [])),
      replaceInFiles: () => Promise.resolve(notPorted('fs.replaceInFiles', { filesChanged: 0, replacements: 0 })),
      onFileChange: () => () => {},
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
      fileAtRevision: () => Promise.resolve(''),
      commitFiles: () => Promise.resolve([]),
    },

    ai: {
      streamChat: (opts) => socket.invoke('ai:streamChat', opts),
      abortStream: (id) => socket.invoke('ai:abortStream', id),
      listOllamaModels: () => socket.invoke('ai:listOllamaModels'),
      complete: (opts) => socket.invoke('ai:complete', opts),
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
    },

    memory: {
      list: () => Promise.resolve(notPorted('memory.list', [])),
      query: () => Promise.resolve(notPorted('memory.query', [])),
    },

    search: {
      bm25: (query) => socket.invoke('search:bm25', query),
      web: () => Promise.resolve(notPorted('search.web', [])),
      docs: () => Promise.resolve(notPorted('search.docs', null)),
      tfidf: (query) => socket.invoke('search:tfidf', query),
      vector: (query, hybrid) => socket.invoke('search:vector', { query, hybrid: hybrid ?? false }),
      browse: () => Promise.resolve(notPorted('search.browse', { url: '', task: '', result: '', success: false })),
    },

    taskPlanner: {
      list: () => Promise.resolve(notPorted('taskPlanner.list', [])),
      show: () => Promise.resolve(notPorted('taskPlanner.show', null)),
      markDone: () => Promise.resolve(notPorted('taskPlanner.markDone', null)),
      create: () => Promise.resolve(notPorted('taskPlanner.create', null)),
    },

    lsp: {
      python: {
        didOpen: (uri, text) => socket.invoke('lsp:python:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:python:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:python:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:python:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:python:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      ts: {
        didOpen: (uri, text) => socket.invoke('lsp:ts:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:ts:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:ts:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:ts:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:ts:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      go: {
        didOpen: (uri, text) => socket.invoke('lsp:go:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:go:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:go:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:go:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:go:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      rust: {
        didOpen: (uri, text) => socket.invoke('lsp:rust:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:rust:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:rust:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:rust:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:rust:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      java: {
        didOpen: (uri, text) => socket.invoke('lsp:java:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:java:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:java:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:java:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:java:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
      c: {
        didOpen: (uri, text) => socket.invoke('lsp:c:didOpen', { uri, text }),
        didChange: (uri, text) => socket.invoke('lsp:c:didChange', { uri, text }),
        hover: (uri, line, character) => socket.invoke('lsp:c:hover', { uri, line, character }),
        definition: (uri, line, character) => socket.invoke('lsp:c:definition', { uri, line, character }),
        onDiagnostics: (cb) => socket.on('lsp:c:diagnostics', (payload) => cb(payload as { uri: string; diagnostics: unknown[] })),
      },
    },

    github: {
      fetchIssue: () => Promise.resolve(notPorted('github.fetchIssue', null)),
      fetchPr: () => Promise.resolve(notPorted('github.fetchPr', null)),
      createPr: () => Promise.resolve(notPorted('github.createPr', null)),
    },

    agent: {
      createShadow: () => Promise.resolve(notPorted('agent.createShadow', null)),
      getShadowDiff: () => Promise.resolve(notPorted('agent.getShadowDiff', null)),
      getShadowDiffVsBase: () => Promise.resolve(notPorted('agent.getShadowDiffVsBase', null)),
      promoteShadow: () => Promise.resolve(notPorted('agent.promoteShadow', false)),
      discardShadow: () => Promise.resolve(notPorted('agent.discardShadow', false)),
      startAutonomous: () => Promise.resolve(notPorted('agent.startAutonomous', null)),
      stopAutonomous: () => Promise.resolve(notPorted('agent.stopAutonomous', undefined)),
      getActiveSession: () => Promise.resolve(notPorted('agent.getActiveSession', null)),
      onProgress: () => () => {},
    },

    archDoc: {
      generate: () => Promise.resolve(notPorted('archDoc.generate', null)),
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
    },

    window: {
      // Window chrome controls have no meaning in a browser tab.
      minimize: () => {},
      maximize: () => {},
      close: () => {},
    },
  } satisfies API
}
