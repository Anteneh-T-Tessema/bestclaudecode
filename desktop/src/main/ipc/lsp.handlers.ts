import { ipcMain, BrowserWindow } from 'electron'
import { getClient, ALL_LANGS, type LangKey } from '../lsp/registry'

// Registers IPC handlers for every language server in the registry — one
// set of four channels (didOpen, didChange, hover, definition) per language,
// under the existing naming convention (lsp:{lang}:*).  Adding a new language
// server is now a one-line change in registry.ts, not a new handler file.
function registerForLang(lang: LangKey): void {
  const client = getClient(lang)

  ipcMain.handle(`lsp:${lang}:didOpen`, (_event, uri: string, text: string) =>
    client.didOpen(uri, text)
  )
  ipcMain.handle(`lsp:${lang}:didChange`, (_event, uri: string, text: string) =>
    client.didChange(uri, text)
  )
  ipcMain.handle(`lsp:${lang}:hover`, (_event, uri: string, line: number, character: number) =>
    client.hover(uri, line, character)
  )
  ipcMain.handle(`lsp:${lang}:definition`, (_event, uri: string, line: number, character: number) =>
    client.definition(uri, line, character)
  )
  ipcMain.handle(`lsp:${lang}:references`, (_event, uri: string, line: number, character: number) =>
    client.references(uri, line, character)
  )
  ipcMain.handle(`lsp:${lang}:codeAction`, (_event, uri: string, range: unknown, diagnostics: unknown[]) =>
    client.codeAction(uri, range, diagnostics)
  )
  ipcMain.handle(`lsp:${lang}:executeCommand`, (_event, command: string, args: unknown[]) =>
    client.executeCommand(command, args)
  )
  ipcMain.handle(`lsp:${lang}:rename`, (_event, uri: string, line: number, character: number, newName: string) =>
    client.rename(uri, line, character, newName)
  )
  ipcMain.handle(`lsp:${lang}:format`, (_event, uri: string, tabSize: number, insertSpaces: boolean) =>
    client.format(uri, tabSize, insertSpaces)
  )
  // Gap 109 — signature help
  ipcMain.handle(`lsp:${lang}:signatureHelp`, (_event, uri: string, line: number, character: number) =>
    client.signatureHelp(uri, line, character)
  )
  // Gap 110 — LSP completions
  ipcMain.handle(`lsp:${lang}:completion`, (_event, uri: string, line: number, character: number) =>
    client.completion(uri, line, character)
  )
  // Gap 111 — inlay hints
  ipcMain.handle(`lsp:${lang}:inlayHint`, (_event, uri: string, startLine: number, endLine: number) =>
    client.inlayHint(uri, startLine, endLine)
  )
  // Gap 112 — folding ranges
  ipcMain.handle(`lsp:${lang}:foldingRange`, (_event, uri: string) =>
    client.foldingRange(uri)
  )
  // Gap 113 — go to type definition
  ipcMain.handle(`lsp:${lang}:typeDefinition`, (_event, uri: string, line: number, character: number) =>
    client.typeDefinition(uri, line, character)
  )
  // Gap 114 — go to implementation
  ipcMain.handle(`lsp:${lang}:implementation`, (_event, uri: string, line: number, character: number) =>
    client.implementation(uri, line, character)
  )
  // Gap 116 — document highlights
  ipcMain.handle(`lsp:${lang}:documentHighlight`, (_event, uri: string, line: number, character: number) =>
    client.documentHighlight(uri, line, character)
  )
  // Gap 117 — prepare rename
  ipcMain.handle(`lsp:${lang}:prepareRename`, (_event, uri: string, line: number, character: number) =>
    client.prepareRename(uri, line, character)
  )
  // Gap 118 — code lens
  ipcMain.handle(`lsp:${lang}:codeLens`, (_event, uri: string) =>
    client.codeLens(uri)
  )
  ipcMain.handle(`lsp:${lang}:codeLensResolve`, (_event, item: unknown) =>
    client.codeLensResolve(item)
  )
  // Gap 119 — workspace symbols (query, not URI-scoped)
  ipcMain.handle(`lsp:${lang}:workspaceSymbol`, (_event, query: string) =>
    client.workspaceSymbol(query)
  )
  // Gap 120 — semantic tokens
  ipcMain.handle(`lsp:${lang}:semanticTokens`, (_event, uri: string) =>
    client.semanticTokens(uri)
  )
  // Gap 121 — document symbols
  ipcMain.handle(`lsp:${lang}:documentSymbol`, (_event, uri: string) =>
    client.documentSymbol(uri)
  )
  // Gap 122 — selection range
  ipcMain.handle(`lsp:${lang}:selectionRange`, (_event, uri: string, positions: Array<{ line: number; character: number }>) =>
    client.selectionRange(uri, positions)
  )
  // Gap 123 — on-type formatting
  ipcMain.handle(`lsp:${lang}:onTypeFormatting`, (_event, uri: string, line: number, character: number, ch: string, tabSize: number, insertSpaces: boolean) =>
    client.onTypeFormatting(uri, line, character, ch, tabSize, insertSpaces)
  )
  // Gap 124 — linked editing ranges
  ipcMain.handle(`lsp:${lang}:linkedEditingRange`, (_event, uri: string, line: number, character: number) =>
    client.linkedEditingRange(uri, line, character)
  )
  // Gap 125 — document links
  ipcMain.handle(`lsp:${lang}:documentLink`, (_event, uri: string) =>
    client.documentLink(uri)
  )
  ipcMain.handle(`lsp:${lang}:documentLinkResolve`, (_event, item: unknown) =>
    client.documentLinkResolve(item)
  )

  client.on('diagnostics', (params: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(`lsp:${lang}:diagnostics`, params)
    }
  })
}

export function registerLspHandlers(): void {
  for (const lang of ALL_LANGS) {
    registerForLang(lang)
  }
}
