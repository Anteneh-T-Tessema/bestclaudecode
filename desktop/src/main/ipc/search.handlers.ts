import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { repoRoot, venvPython } from '../paths'
import { runPythonJson, runCommand } from '../pythonBridge'

export interface BM25Result {
  score: number
  file: string
  line: string
  lineNumber?: number
  snippet?: string
}

export interface BM25Response {
  docCount: number
  avgDl: number
  results: BM25Result[]
  backend?: string
}

export interface WebResult {
  title: string
  url: string
  snippet: string
}

export interface DocsResult {
  name: string
  version: string
  summary: string
  description: string
  source: 'pypi' | 'npm'
  url: string
}

export interface BrowseResult {
  url: string
  task: string
  result: string
  success: boolean
}

function extractLineNumber(line: string): number | null {
  const m = line.match(/-- line (\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function readSnippet(filePath: string, lineNo: number, context = 4): string {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n')
    const start = Math.max(0, lineNo - 1 - context)
    const end = Math.min(lines.length, lineNo + context)
    return lines.slice(start, end).join('\n')
  } catch {
    return ''
  }
}

function enrichResults(rawResults: BM25Result[], root: string): BM25Result[] {
  const resolvedRoot = path.resolve(root)
  return rawResults.map((r) => {
    // Reject paths containing traversal sequences or absolute references
    // to anything other than the project root itself.
    if (!/^[\w./-]+$/.test(r.file)) return r
    // r.file is already absolute here, since repoRoot() (passed as the bm25
    // CLI's root arg) is itself absolute — path.join would silently double
    // an absolute second argument instead of resolving it correctly.
    const resolved = path.isAbsolute(r.file) ? path.resolve(r.file) : path.resolve(path.join(root, r.file))
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return r
    const lineNo = extractLineNumber(r.line)
    if (!lineNo) return r
    const snippet = readSnippet(resolved, lineNo)
    return { ...r, lineNumber: lineNo, snippet: snippet || undefined }
  })
}

export function registerSearchHandlers(): void {
  ipcMain.handle('search:bm25', async (_event, query: string): Promise<BM25Response> => {
    const result = await runPythonJson(['-m', 'src.bm25_index', query, repoRoot(), '--json'])
    if (!result.ok) return { docCount: 0, avgDl: 0, results: [] }
    const raw = result.stats as BM25Response
    return { ...raw, results: enrichResults(raw.results ?? [], repoRoot()) }
  })

  ipcMain.handle('search:web', async (_event, query: string, braveKey = ''): Promise<WebResult[]> => {
    const args = ['-m', 'src.web_fetcher', query, '--json']
    if (braveKey) args.push('--brave-key', braveKey)
    const result = await runPythonJson(args)
    if (!result.ok) return []
    return (result.stats as WebResult[]) ?? []
  })

  ipcMain.handle('search:docs', async (_event, pkg: string): Promise<DocsResult | null> => {
    const result = await runPythonJson(['-m', 'src.docs_context', pkg, '--json'])
    if (!result.ok) return null
    return (result.stats as DocsResult | null) ?? null
  })

  ipcMain.handle('search:tfidf', async (_event, query: string): Promise<BM25Response> => {
    const result = await runPythonJson(['-m', 'src.embedding_index', query, repoRoot(), '--json'])
    if (!result.ok) return { docCount: 0, avgDl: 0, results: [] }
    const raw = result.stats as BM25Response
    return { ...raw, results: enrichResults(raw.results ?? [], repoRoot()) }
  })

  ipcMain.handle('search:vector', async (_event, query: string, hybrid = false): Promise<BM25Response> => {
    const args = ['-m', 'src.vector_index', query, repoRoot(), '--json']
    if (hybrid) args.push('--hybrid')
    const result = await runPythonJson(args)
    if (!result.ok) return { docCount: 0, avgDl: 0, results: [] }
    const raw = result.stats as BM25Response
    return { ...raw, results: enrichResults(raw.results ?? [], repoRoot()) }
  })

  ipcMain.handle('search:browse', async (_event, url: string, task: string): Promise<BrowseResult> => {
    const result = await runPythonJson(['-m', 'src.browser_context', '--url', url, '--task', task, '--json'])
    if (!result.ok) return { url, task, result: 'Browse failed to start', success: false }
    return result.stats as BrowseResult
  })

  // Gap 29 — automatic hybrid retrieval for chat, deduped against manual @file/@folder mentions.
  // chat_context.py already enriches each hit with a snippet, so results only
  // need the lineNumber field derived to match BM25Result, not a re-read of the file.
  ipcMain.handle('context:assemble', async (_event, query: string, manualPaths: string[]): Promise<BM25Response> => {
    const result = await runPythonJson(['-m', 'src.chat_context', query, repoRoot(), '--json'])
    if (!result.ok) return { docCount: 0, avgDl: 0, results: [] }
    const raw = result.stats as { query: string; results: BM25Result[] }
    const root = repoRoot()
    const manualResolved = new Set(manualPaths.map((p) => path.resolve(root, p)))
    const filtered = (raw.results ?? [])
      .filter((r) => !manualResolved.has(path.resolve(root, r.file)))
      .map((r) => ({ ...r, lineNumber: extractLineNumber(r.line) ?? undefined }))
    return { docCount: filtered.length, avgDl: 0, results: filtered }
  })

  ipcMain.handle('search:buildIndex', async (): Promise<{ indexed: number; backend: string }> => {
    const result = await runPythonJson(['-m', 'src.chat_context', '--build-index', repoRoot(), '--json'])
    if (!result.ok) return { indexed: 0, backend: '' }
    return result.stats as { indexed: number; backend: string }
  })

  // Gap 49 — describe a screenshot image via the vision model.
  ipcMain.handle('search:screenshot', async (_event, imagePath: string): Promise<{ description: string } | null> => {
    const python = venvPython()
    const result = await runCommand(python, ['-m', 'src.screenshot_context', imagePath], repoRoot())
    if (result.exitCode !== 0) return null
    const description = result.stdout.trim()
    return description ? { description } : null
  })
}
