import { useRef, useEffect, useCallback } from 'react'
import Editor, { type Monaco } from '@monaco-editor/react'
import type * as MonacoNS from 'monaco-editor'
import { useEditorStore } from '../../store/useEditorStore'
import { useEditorActionsStore } from '../../store/useEditorActionsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useProblemsStore } from '../../store/useProblemsStore'
import { useDebugStore } from '../../store/useDebugStore'
import { toast } from '../../store/useToastStore'

const LAKOORA_DARK_ID = 'lakoora-dark'
const LAKOORA_LIGHT_ID = 'lakoora-light'

function fileToUri(filePath: string): string {
  return `file://${filePath}`
}

interface LspHoverResult {
  contents?: string | { value?: string } | Array<string | { value?: string }>
}

interface LspLocation {
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number
  message: string
  source?: string
}

interface LspTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  newText: string
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: Array<{ textDocument: { uri: string }; edits: LspTextEdit[] }>
}

interface LspCommand {
  title: string
  command: string
  arguments?: unknown[]
}

interface LspCodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  edit?: LspWorkspaceEdit
  command?: LspCommand
}

// Gap 102/104 — converts an LSP WorkspaceEdit (used by both code actions and
// rename) into Monaco's WorkspaceEdit shape so the editor can apply it across
// every affected open file in one operation.
function lspWorkspaceEditToMonaco(edit: LspWorkspaceEdit, monaco: Monaco): MonacoNS.languages.WorkspaceEdit {
  const perFile: Array<{ uri: string; edits: LspTextEdit[] }> = edit.documentChanges
    ? edit.documentChanges.map((dc) => ({ uri: dc.textDocument.uri, edits: dc.edits }))
    : Object.entries(edit.changes ?? {}).map(([uri, edits]) => ({ uri, edits }))

  return {
    edits: perFile.flatMap(({ uri, edits }) =>
      edits.map((e) => ({
        resource: monaco.Uri.parse(uri),
        textEdit: {
          range: {
            startLineNumber: e.range.start.line + 1,
            startColumn: e.range.start.character + 1,
            endLineNumber: e.range.end.line + 1,
            endColumn: e.range.end.character + 1,
          },
          text: e.newText,
        },
        versionId: undefined,
      }))
    ),
  }
}

// Gap 105 — converts the flat TextEdit[] returned by textDocument/formatting
// into Monaco's single-document edit shape (distinct from the cross-file
// WorkspaceEdit above, since formatting only ever touches the one document).
function lspTextEditsToMonaco(edits: LspTextEdit[]): MonacoNS.languages.TextEdit[] {
  return edits.map((e) => ({
    range: {
      startLineNumber: e.range.start.line + 1,
      startColumn: e.range.start.character + 1,
      endLineNumber: e.range.end.line + 1,
      endColumn: e.range.end.character + 1,
    },
    text: e.newText,
  }))
}

function hoverContentsToMarkdown(contents: LspHoverResult['contents']): string {
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(hoverContentsToMarkdown).join('\n\n')
  return contents.value ?? ''
}

// Provider-registration guard: keyed by Monaco language ID, so each language's
// hover/definition providers are registered exactly once across all tab switches.
const lspProvidersRegistered = new Set<string>()
let inlineCompletionProviderRegistered = false

type DiffMark = { line: number; type: 'added' | 'modified' | 'deleted' }

function parseDiffHunks(diff: string): DiffMark[] {
  const marks: DiffMark[] = []
  const lines = diff.split('\n')
  let i = 0
  while (i < lines.length) {
    const hm = lines[i].match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (!hm) { i++; continue }
    let newLine = Math.max(1, parseInt(hm[1], 10))
    i++
    const addedLines: number[] = []
    let hasRemovals = false
    while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff ')) {
      const l = lines[i]
      if (l.startsWith('+') && !l.startsWith('+++')) { addedLines.push(newLine++) }
      else if (l.startsWith('-') && !l.startsWith('---')) { hasRemovals = true }
      else if (!l.startsWith('\\')) { newLine++ }
      i++
    }
    const type = hasRemovals ? 'modified' : 'added'
    for (const line of addedLines) marks.push({ line, type })
    if (addedLines.length === 0 && hasRemovals) marks.push({ line: Math.max(1, parseInt(hm[1], 10)), type: 'deleted' })
  }
  return marks
}

let diffStylesInjected = false
function injectDiffStyles() {
  if (diffStylesInjected) return
  diffStylesInjected = true
  const el = document.createElement('style')
  el.textContent = [
    '.lakoora-diff-added    { margin-left: 2px; width: 3px !important; background: rgba(35,134,54,0.6); }',
    '.lakoora-diff-modified { margin-left: 2px; width: 3px !important; background: rgba(194,145,0,0.85); }',
    '.lakoora-diff-deleted  { margin-left: 2px; width: 3px !important; background: rgba(248,81,73,0.85); }',
  ].join('\n')
  document.head.appendChild(el)
}

function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`
  return `${Math.floor(diff / (86400 * 365))}y ago`
}

interface LspClientApi {
  hover: (uri: string, line: number, character: number) => Promise<unknown>
  definition: (uri: string, line: number, character: number) => Promise<unknown>
  references: (uri: string, line: number, character: number) => Promise<unknown>
  codeAction: (uri: string, range: unknown, diagnostics: unknown[]) => Promise<unknown>
  executeCommand: (command: string, args: unknown[]) => Promise<unknown>
  rename: (uri: string, line: number, character: number, newName: string) => Promise<unknown>
  format: (uri: string, tabSize: number, insertSpaces: boolean) => Promise<unknown>
  didOpen: (uri: string, text: string) => Promise<void>
  didChange: (uri: string, text: string) => Promise<void>
  onDiagnostics: (cb: (params: { uri: string; diagnostics: unknown[] }) => void) => () => void
}

// Map from Monaco language ID → { LSP api accessor, diagnostic source label }.
// C and C++ share clangd; go/rust/java each have their own server.
function resolveLsp(monacoLang: string): { api: () => LspClientApi; source: string; monacoLangs: string[] } | null {
  switch (monacoLang) {
    case 'python':
      return { api: () => window.api.lsp.python, source: 'pyright', monacoLangs: ['python'] }
    case 'typescript': case 'javascript': case 'typescriptreact': case 'javascriptreact':
      return { api: () => window.api.lsp.ts, source: 'ts-ls', monacoLangs: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'] }
    case 'go':
      return { api: () => window.api.lsp.go, source: 'gopls', monacoLangs: ['go'] }
    case 'rust':
      return { api: () => window.api.lsp.rust, source: 'rust-analyzer', monacoLangs: ['rust'] }
    case 'java':
      return { api: () => window.api.lsp.java, source: 'jdtls', monacoLangs: ['java'] }
    case 'c': case 'cpp':
      return { api: () => window.api.lsp.c, source: 'clangd', monacoLangs: ['c', 'cpp'] }
    default:
      return null
  }
}

function registerInlineCompletionProvider(monaco: Monaco): void {
  if (inlineCompletionProviderRegistered) return
  inlineCompletionProviderRegistered = true

  // Imported at call-time (not module-level) to avoid circular dependency at eval time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useChatStore } = require('../../store/useChatStore') as typeof import('../../store/useChatStore')

  monaco.languages.registerInlineCompletionsProvider(
    [
      { language: 'python' }, { language: 'typescript' }, { language: 'javascript' },
      { language: 'typescriptreact' }, { language: 'javascriptreact' },
      { language: 'go' }, { language: 'rust' }, { language: 'java' },
      { language: 'c' }, { language: 'cpp' },
      { language: 'json' }, { language: 'html' }, { language: 'css' },
    ],
    {
      async provideInlineCompletions(model, position, _context, token) {
        const textBeforeCursor = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
        if (textBeforeCursor.trim().length < 3) return { items: [] }

        const prefix = model.getValueInRange({
          startLineNumber: 1, startColumn: 1,
          endLineNumber: position.lineNumber, endColumn: position.column,
        })
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber, startColumn: position.column,
          endLineNumber: model.getLineCount(),
          endColumn: model.getLineMaxColumn(model.getLineCount()),
        })

        const activeModel: string = (useChatStore.getState() as { activeModel: string }).activeModel ?? 'claude-sonnet-4-6'
        if (token.isCancellationRequested) return { items: [] }

        // 300ms debounce — abort immediately if the user keeps typing
        await new Promise<void>((resolve, reject) => {
          const tid = setTimeout(resolve, 300)
          token.onCancellationRequested(() => { clearTimeout(tid); reject(new Error('cancelled')) })
        })
        if (token.isCancellationRequested) return { items: [] }

        try {
          const completion = await (window.api.ai.complete({
            prefix, suffix, language: model.getLanguageId(), model: activeModel,
          }) as Promise<string | null>)

          if (token.isCancellationRequested || !completion?.trim()) return { items: [] }
          return {
            items: [{
              insertText: completion,
              range: {
                startLineNumber: position.lineNumber, startColumn: position.column,
                endLineNumber: position.lineNumber, endColumn: position.column,
              },
            }],
          }
        } catch {
          return { items: [] }
        }
      },
      freeInlineCompletions() {},
    }
  )
}

// Gap 102 — one shared Monaco command that dispatches an LSP server-side
// command (workspace/executeCommand) for code actions that don't carry an
// inline edit. Registered once; `getApi` is passed through `arguments`
// rather than re-resolved, since it stays in the same JS realm (no IPC
// serialization boundary at this layer — only inside getApi() itself).
let lspExecuteCommandRegistered = false
const LSP_EXECUTE_COMMAND_ID = 'lakoora.executeLspCommand'
function registerLspExecuteCommand(monaco: Monaco): void {
  if (lspExecuteCommandRegistered) return
  lspExecuteCommandRegistered = true
  monaco.editor.registerCommand(
    LSP_EXECUTE_COMMAND_ID,
    (_accessor: unknown, getApi: () => LspClientApi, command: string, args: unknown[]) => {
      void getApi().executeCommand(command, args)
    }
  )
}

function isBareLspCommand(item: LspCodeAction | LspCommand): item is LspCommand {
  return typeof (item as LspCommand).command === 'string'
}

function registerLspProviders(monaco: Monaco, lspEntry: ReturnType<typeof resolveLsp>): void {
  if (!lspEntry) return
  // Register once per canonical Monaco language ID (the first in the list).
  const key = lspEntry.monacoLangs[0]
  if (lspProvidersRegistered.has(key)) return
  lspProvidersRegistered.add(key)
  registerLspExecuteCommand(monaco)

  for (const lang of lspEntry.monacoLangs) {
    // Close over a per-loop reference to lspEntry.api so the provider always
    // calls the right language server even after later registrations.
    const getApi = lspEntry.api
    monaco.languages.registerHoverProvider(lang, {
      async provideHover(model, position) {
        const result = (await getApi().hover(
          fileToUri(model.uri.path),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspHoverResult | null
        const value = hoverContentsToMarkdown(result?.contents)
        if (!value) return null
        return { contents: [{ value }] }
      },
    })

    monaco.languages.registerDefinitionProvider(lang, {
      async provideDefinition(model, position) {
        const result = (await getApi().definition(
          fileToUri(model.uri.path),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspLocation | LspLocation[] | null
        if (!result) return []
        const locations = Array.isArray(result) ? result : [result]
        return locations.map((loc) => ({
          uri: monaco.Uri.parse(loc.uri),
          range: {
            startLineNumber: loc.range.start.line + 1,
            startColumn: loc.range.start.character + 1,
            endLineNumber: loc.range.end.line + 1,
            endColumn: loc.range.end.character + 1,
          },
        }))
      },
    })

    // Gap 98 — "Find All References" (Shift+F12 / right-click), using Monaco's
    // built-in peek view so no custom results panel is needed.
    monaco.languages.registerReferenceProvider(lang, {
      async provideReferences(model, position) {
        const result = (await getApi().references(
          fileToUri(model.uri.path),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspLocation[] | null
        if (!result) return []
        return result.map((loc) => ({
          uri: monaco.Uri.parse(loc.uri),
          range: {
            startLineNumber: loc.range.start.line + 1,
            startColumn: loc.range.start.character + 1,
            endLineNumber: loc.range.end.line + 1,
            endColumn: loc.range.end.character + 1,
          },
        }))
      },
    })

    // Gap 102 — "Quick Fix" lightbulb (Cmd+.), backed by textDocument/codeAction.
    monaco.languages.registerCodeActionProvider(lang, {
      async provideCodeActions(model, range, context) {
        const diagnostics = context.markers.map((m) => ({
          range: {
            start: { line: m.startLineNumber - 1, character: m.startColumn - 1 },
            end: { line: m.endLineNumber - 1, character: m.endColumn - 1 },
          },
          message: m.message,
          severity: m.severity === monaco.MarkerSeverity.Error ? 1 : m.severity === monaco.MarkerSeverity.Warning ? 2 : 3,
          source: m.source,
        }))
        const result = (await getApi().codeAction(
          fileToUri(model.uri.path),
          {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
          },
          diagnostics,
        )) as Array<LspCodeAction | LspCommand> | null
        if (!result?.length) return { actions: [], dispose() {} }

        const actions: MonacoNS.languages.CodeAction[] = result.map((item) => {
          if (isBareLspCommand(item)) {
            return {
              title: item.title,
              command: { id: LSP_EXECUTE_COMMAND_ID, title: item.title, arguments: [getApi, item.command, item.arguments ?? []] },
            }
          }
          return {
            title: item.title,
            kind: item.kind,
            isPreferred: item.isPreferred,
            edit: item.edit ? lspWorkspaceEditToMonaco(item.edit, monaco) : undefined,
            command: !item.edit && item.command
              ? { id: LSP_EXECUTE_COMMAND_ID, title: item.command.title, arguments: [getApi, item.command.command, item.command.arguments ?? []] }
              : undefined,
          }
        })
        return { actions, dispose() {} }
      },
    })

    // Gap 104 — "Rename Symbol" (F2), backed by textDocument/rename.
    monaco.languages.registerRenameProvider(lang, {
      async provideRenameEdits(model, position, newName) {
        const result = (await getApi().rename(
          fileToUri(model.uri.path),
          position.lineNumber - 1,
          position.column - 1,
          newName,
        )) as LspWorkspaceEdit | null
        if (!result) return { edits: [] }
        return lspWorkspaceEditToMonaco(result, monaco)
      },
    })

    // Gap 105 — "Format Document" (default ⇧⌥F), backed by textDocument/formatting.
    monaco.languages.registerDocumentFormattingEditProvider(lang, {
      async provideDocumentFormattingEdits(model, options) {
        const result = (await getApi().format(
          fileToUri(model.uri.path),
          options.tabSize,
          options.insertSpaces,
        )) as LspTextEdit[] | null
        if (!result?.length) return []
        return lspTextEditsToMonaco(result)
      },
    })
  }
}

// Monaco's defineTheme() validates color values eagerly and only accepts hex strings
// (#rgb/#rrggbb/#rrggbbaa) — passing the design system's hsl(...) tokens throws
// "Illegal value for token color" at mount time. These are hex equivalents of the
// surface/fg/accent tokens used elsewhere in the app, kept in sync by hand.
function defineMonacoThemes(monaco: Monaco) {
  monaco.editor.defineTheme(LAKOORA_DARK_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
      { token: 'keyword', foreground: '63b3ed' },
      { token: 'string', foreground: '68d391' },
      { token: 'number', foreground: 'f6ad55' },
      { token: 'type', foreground: '76e4f7' },
      { token: 'function', foreground: 'b794f4' },
      { token: 'variable', foreground: 'e2e8f0' },
    ],
    colors: {
      'editor.background': '#08090c',
      'editor.foreground': '#f3f5f7',
      'editor.lineHighlightBackground': '#0d0f14',
      'editorLineNumber.foreground': '#464a53',
      'editorLineNumber.activeForeground': '#bcc0c8',
      'editor.selectionBackground': '#123154',
      'editor.selectionHighlightBackground': '#0b1d32',
      'editorCursor.foreground': '#368ef2',
      'editorGutter.background': '#08090c',
      'editorWidget.background': '#101319',
      'input.background': '#101319',
      'editorSuggestWidget.background': '#101319',
      'editorSuggestWidget.border': '#1d212a',
      'editorSuggestWidget.selectedBackground': '#0b1d32',
      'list.hoverBackground': '#14171f',
      'scrollbarSlider.background': '#1d212a',
      'scrollbarSlider.hoverBackground': '#262b36',
    },
  })

  monaco.editor.defineTheme(LAKOORA_LIGHT_ID, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '94a3b8', fontStyle: 'italic' },
      { token: 'keyword', foreground: '2563eb' },
      { token: 'string', foreground: '16a34a' },
      { token: 'number', foreground: 'd97706' },
      { token: 'type', foreground: '0891b2' },
      { token: 'function', foreground: '7c3aed' },
      { token: 'variable', foreground: '1e293b' },
    ],
    colors: {
      'editor.background': '#fafafa',
      'editor.foreground': '#1a2030',
      'editor.lineHighlightBackground': '#f1f5f9',
      'editorLineNumber.foreground': '#94a3b8',
      'editorLineNumber.activeForeground': '#475569',
      'editor.selectionBackground': '#bfdbfe',
      'editor.selectionHighlightBackground': '#dbeafe',
      'editorCursor.foreground': '#2563eb',
      'editorGutter.background': '#fafafa',
      'editorWidget.background': '#ffffff',
      'input.background': '#f8fafc',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e2e8f0',
      'editorSuggestWidget.selectedBackground': '#eff6ff',
      'list.hoverBackground': '#f1f5f9',
      'scrollbarSlider.background': '#cbd5e1',
      'scrollbarSlider.hoverBackground': '#94a3b8',
    },
  })
}

interface MonacoEditorProps {
  tabId: string
}

export function MonacoEditor({ tabId }: MonacoEditorProps) {
  const tab = useEditorStore((s) => s.tabs.find((t) => t.id === tabId))
  const updateContent = useEditorStore((s) => s.updateContent)
  const markSaved = useEditorStore((s) => s.markSaved)
  const setCursor = useEditorStore((s) => s.setCursor)
  const setEditorSelection = useEditorStore((s) => s.setEditorSelection)
  const { openInlineEdit } = useEditorActionsStore()
  const { openGoToLine } = useEditorActionsStore()
  const fontSize = useSettingsStore((s) => s.fontSize)
  const wordWrap = useSettingsStore((s) => s.wordWrap)
  const minimapEnabled = useSettingsStore((s) => s.minimap)
  const tabSize = useSettingsStore((s) => s.tabSize)
  const stickyScroll = useSettingsStore((s) => s.stickyScroll)
  const projectPath = useSettingsStore((s) => s.projectPath)
  const setProblems = useProblemsStore((s) => s.setProblems)

  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const decorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null)
  const gitDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null)
  const breakpointDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null)
  const diffDecorationsRef = useRef<MonacoNS.editor.IEditorDecorationsCollection | null>(null)
  const lspChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeLsp = tab?.language ? resolveLsp(tab.language) : null
  const theme = useSettingsStore((s) => s.theme)
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint)
  const fileBreakpoints = useDebugStore((s) => tab ? (s.breakpoints[tab.filePath] ?? []) : [])

  const handleMount = useCallback(
    (editor: MonacoNS.editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      defineMonacoThemes(monaco)
      monaco.editor.setTheme(useSettingsStore.getState().theme === 'light' ? LAKOORA_LIGHT_ID : LAKOORA_DARK_ID)
      registerLspProviders(monaco, activeLsp)
      registerInlineCompletionProvider(monaco)

      injectDiffStyles()
      decorationsRef.current = editor.createDecorationsCollection([])
      gitDecorationsRef.current = editor.createDecorationsCollection([])
      breakpointDecorationsRef.current = editor.createDecorationsCollection([])
      diffDecorationsRef.current = editor.createDecorationsCollection([])

      // Breakpoint gutter — click in the glyph margin to toggle a breakpoint.
      // Monaco fires onMouseDown with type GUTTER_GLYPH_MARGIN for this zone.
      editor.onMouseDown((e) => {
        if (e.target.type !== 2 /* GUTTER_GLYPH_MARGIN */ && e.target.type !== 3 /* GUTTER_LINE_NUMBERS */) return
        if (!tab) return
        const line = e.target.position?.lineNumber
        if (!line) return
        toggleBreakpoint(tab.filePath, line)
      })

      if (activeLsp && tab) {
        void activeLsp.api().didOpen(fileToUri(tab.filePath), tab.content)
      }

      // Pre-warm retrieval context for FIM completion — use the file basename
      // as the query so related symbols surface before the user types anything.
      // Fire-and-forget: completion works without it (falls back to Tier 3).
      if (tab) {
        const basename = tab.filePath.split('/').pop() ?? tab.filePath
        void window.api.ai.buildContext({ query: basename })
      }

      // Cursor tracking
      editor.onDidChangeCursorPosition((e) => {
        setCursor(tabId, e.position.lineNumber, e.position.column)
      })

      // Selection tracking for @selection in chat
      editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection()
        const model = editor.getModel()
        if (sel && model && !sel.isEmpty()) {
          setEditorSelection(model.getValueInRange(sel))
        } else {
          setEditorSelection('')
        }
      })

      // Model markers → problems store
      monaco.editor.onDidChangeMarkers(([resource]) => {
        if (!resource) return
        const markers = monaco.editor.getModelMarkers({ resource })
        if (!tab) return
        const problems = markers.map((m) => ({
          id: `${m.startLineNumber}:${m.startColumn}:${m.message}`,
          filePath: tab.filePath,
          line: m.startLineNumber,
          col: m.startColumn,
          endLine: m.endLineNumber,
          endCol: m.endColumn,
          message: m.message,
          severity: m.severity === 8 ? ('error' as const) : m.severity === 4 ? ('warning' as const) : ('info' as const),
          source: m.source,
        }))
        setProblems(tab.filePath, problems)
      })

      // Cmd+K → inline AI edit (selection) or generate (no selection)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
        const selection = editor.getSelection()
        const model = editor.getModel()
        if (!model || !selection) return
        if (selection.isEmpty()) {
          // Generate mode: pass empty selectedText; cursor line used as insert point
          const line = selection.startLineNumber
          openInlineEdit(tabId, line, line, '')
        } else {
          const selectedText = model.getValueInRange(selection)
          openInlineEdit(tabId, selection.startLineNumber, selection.endLineNumber, selectedText)
        }
      })

      // Cmd+S → format (if enabled) then save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
        if (!tab) return
        try {
          const model = editor.getModel()
          if (!model) return
          if (useSettingsStore.getState().formatOnSave) {
            await editor.getAction('editor.action.formatDocument')?.run()
          }
          await window.api.fs.writeFile(tab.filePath, model.getValue())
          markSaved(tabId)
          toast.success('Saved')
        } catch (err) {
          toast.error(`Save failed: ${(err as Error).message}`)
        }
      })

      // Cmd+G → go to line
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyG, () => {
        openGoToLine()
      })
    },
    [tabId, tab, activeLsp, updateContent, markSaved, setCursor, setEditorSelection, openInlineEdit, openGoToLine, setProblems]
  )

  // Push edits to the active language server, debounced, so hover/definition/diagnostics
  // stay current without round-tripping on every keystroke.
  // Clear pending auto-save when the active tab changes so we never write stale content to the wrong file.
  useEffect(() => {
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [tabId])

  useEffect(() => {
    const monaco = monacoRef.current
    if (!monaco) return
    monaco.editor.setTheme(theme === 'light' ? LAKOORA_LIGHT_ID : LAKOORA_DARK_ID)
  }, [theme])

  useEffect(() => {
    if (!activeLsp || !tab) return
    if (lspChangeDebounceRef.current) clearTimeout(lspChangeDebounceRef.current)
    lspChangeDebounceRef.current = setTimeout(() => {
      void activeLsp.api().didChange(fileToUri(tab.filePath), tab.content)
    }, 300)
    return () => {
      if (lspChangeDebounceRef.current) clearTimeout(lspChangeDebounceRef.current)
    }
  }, [activeLsp, tab?.filePath, tab?.content])

  // Subscribe to diagnostics from all language servers at once — each server pushes
  // per-file diagnostics asynchronously and we map them onto the matching Monaco model.
  useEffect(() => {
    const serverEntries: Array<{ api: LspClientApi; source: string }> = [
      { api: window.api.lsp.python, source: 'pyright' },
      { api: window.api.lsp.ts, source: 'ts-ls' },
      { api: window.api.lsp.go, source: 'gopls' },
      { api: window.api.lsp.rust, source: 'rust-analyzer' },
      { api: window.api.lsp.java, source: 'jdtls' },
      { api: window.api.lsp.c, source: 'clangd' },
    ]
    const unsubs = serverEntries.map(({ api, source }) =>
      api.onDiagnostics(({ uri, diagnostics }) => {
        const monaco = monacoRef.current
        if (!monaco) return
        const filePath = uri.replace(/^file:\/\//, '')
        const model = monaco.editor.getModels().find((m) => m.uri.path === filePath)
        if (!model) return
        const markers = (diagnostics as LspDiagnostic[]).map((d) => ({
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          message: d.message,
          severity:
            d.severity === 1
              ? monaco.MarkerSeverity.Error
              : d.severity === 2
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
          source: d.source ?? source,
        }))
        monaco.editor.setModelMarkers(model, source, markers)
      })
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  // Sync breakpoint decorations (red dots in the glyph margin) whenever the
  // breakpoint set for this file changes. The glyph margin is enabled below.
  useEffect(() => {
    const col = breakpointDecorationsRef.current
    const monaco = monacoRef.current
    if (!col || !monaco) return
    col.set(
      fileBreakpoints.map((bp) => ({
        range: { startLineNumber: bp.line, startColumn: 1, endLineNumber: bp.line, endColumn: 1 },
        options: {
          glyphMarginClassName: bp.condition ? 'lakoora-breakpoint-conditional' : 'lakoora-breakpoint',
          glyphMarginHoverMessage: {
            value: bp.condition ? `Breakpoint at line ${bp.line} — if: \`${bp.condition}\`` : `Breakpoint at line ${bp.line}`,
          },
        },
      }))
    )
  }, [fileBreakpoints])

  // Load and render inline git blame decorations whenever the active file changes.
  // Uses gitDecorationsRef (initialized in handleMount). Clears on unmount/file change.
  useEffect(() => {
    const filePath = tab?.filePath
    if (!filePath || !projectPath) return
    const col = gitDecorationsRef.current
    if (!col) return
    let cancelled = false
    col.set([])
    void (async () => {
      const entries = await window.api.git.blame(projectPath, filePath)
      if (cancelled) return
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      if (!model) return
      col.set(
        entries.map(({ line, sha, author, timestamp }) => ({
          range: {
            startLineNumber: line, startColumn: model.getLineMaxColumn(line),
            endLineNumber: line, endColumn: model.getLineMaxColumn(line),
          },
          options: {
            after: {
              content: `  ${author.slice(0, 22)} · ${sha} · ${relativeTime(timestamp)}`,
              inlineClassName: 'lakoora-blame',
            },
            showIfCollapsed: false,
          },
        }))
      )
    })()
    return () => { cancelled = true }
  }, [tab?.filePath, projectPath])

  // Inline git diff gutter markers — colored bars for added/modified/deleted lines vs HEAD.
  // Refreshes when the file changes or after auto-save clears isDirty.
  useEffect(() => {
    const filePath = tab?.filePath
    const col = diffDecorationsRef.current
    if (!filePath || !projectPath || !col) { col?.set([]); return }
    let cancelled = false
    col.set([])
    void window.api.git.diff(projectPath, filePath).then((raw) => {
      if (cancelled || !raw) return
      const marks = parseDiffHunks(raw)
      col.set(marks.map(({ line, type }) => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          linesDecorationsClassName: `lakoora-diff-${type}`,
          overviewRuler: {
            color: type === 'added' ? '#23863680' : type === 'modified' ? '#c2910080' : '#f8514980',
            position: 1,
          },
          stickiness: 1, // GrowsOnlyWhenTypingAfter
        },
      })))
    }).catch(() => col.set([]))
    return () => { cancelled = true }
  }, [tab?.filePath, tab?.isDirty, projectPath])

  // Sync external content changes (e.g. after inline AI edit applies)
  useEffect(() => {
    if (!tab || !editorRef.current) return
    const model = editorRef.current.getModel()
    if (!model) return
    if (model.getValue() !== tab.content) {
      model.setValue(tab.content)
    }
  }, [tab?.content])

  // Cmd+G (GoToLine.tsx) and Code Search results dispatch this event rather than
  // calling the editor directly, since only one MonacoEditor is mounted at a time
  // (CenterPane only renders the active tab) and neither caller holds a ref to it.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line: number; column?: number }>).detail
      const editor = editorRef.current
      if (!editor || !detail) return
      editor.revealLineInCenter(detail.line)
      editor.setPosition({ lineNumber: detail.line, column: detail.column ?? 1 })
      editor.focus()
    }
    window.addEventListener('lakoora:goToLine', handler)
    return () => window.removeEventListener('lakoora:goToLine', handler)
  }, [])

  if (!tab) return null

  return (
    <Editor
      height="100%"
      path={tab.filePath}
      defaultLanguage={tab.language}
      defaultValue={tab.content}
      theme={theme === 'light' ? LAKOORA_LIGHT_ID : LAKOORA_DARK_ID}
      onChange={(value) => {
        if (value === undefined) return
        updateContent(tabId, value)
        if (useSettingsStore.getState().autoSave) {
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
          const filePath = tab?.filePath
          if (filePath) {
            autoSaveTimerRef.current = setTimeout(async () => {
              try {
                await window.api.fs.writeFile(filePath, value)
                markSaved(tabId)
              } catch { /* ignore write errors silently */ }
            }, 800)
          }
        }
      }}
      onMount={handleMount}
      options={{
        fontSize,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, monospace",
        lineNumbers: 'on',
        minimap: { enabled: minimapEnabled, scale: 1 },
        stickyScroll: { enabled: stickyScroll },
        scrollBeyondLastLine: false,
        wordWrap: wordWrap ? 'on' : 'off',
        tabSize,
        insertSpaces: true,
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        overviewRulerBorder: false,
        bracketPairColorization: { enabled: true },
        glyphMargin: true,
        formatOnPaste: true,
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        automaticLayout: true,
      }}
    />
  )
}
