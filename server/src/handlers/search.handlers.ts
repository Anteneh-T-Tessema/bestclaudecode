import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { HandlerRegistry } from '../router.js'
import { REPO_ROOT, runPythonJson } from '../pythonBridge.js'

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

function extractLineNumber(line: string): number | null {
  const m = line.match(/-- line (\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function readSnippet(filePath: string, lineNo: number, context = 4): string {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n')
    const start = Math.max(0, lineNo - 1 - context)
    const end = Math.min(lines.length, lineNo + context)
    return lines.slice(start, end).join('\n')
  } catch {
    return ''
  }
}

// Mirrors desktop/src/main/ipc/search.handlers.ts's enrichResults() exactly,
// including the Phase 1-D path-traversal guard (r.file comes from a Python
// subprocess — never trust it as a bare path join).
function enrichResults(rawResults: BM25Result[], root: string): BM25Result[] {
  const resolvedRoot = path.resolve(root)
  return rawResults.map((r) => {
    if (!/^[\w./-]+$/.test(r.file)) return r
    // r.file is already absolute when bm25_index.py was invoked with an
    // absolute root (always true here — REPO_ROOT is absolute) — path.join
    // would silently double an absolute second argument instead of
    // resolving it, so resolve directly when it's already absolute.
    const resolved = path.isAbsolute(r.file) ? path.resolve(r.file) : path.resolve(path.join(root, r.file))
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return r
    const lineNo = extractLineNumber(r.line)
    if (!lineNo) return r
    const snippet = readSnippet(resolved, lineNo)
    return { ...r, lineNumber: lineNo, snippet: snippet || undefined }
  })
}

export function registerSearchHandlers(registry: HandlerRegistry): void {
  registry.register('search:bm25', async (_adapter, payload) => {
    const query = payload as string
    const raw = await runPythonJson(['-m', 'src.bm25_index', query, REPO_ROOT, '--json'])
    return { ...raw, results: enrichResults(raw.results ?? [], REPO_ROOT) }
  })

  registry.register('search:tfidf', async (_adapter, payload) => {
    const query = payload as string
    const raw = await runPythonJson(['-m', 'src.embedding_index', query, REPO_ROOT, '--json'])
    return { ...raw, results: enrichResults(raw.results ?? [], REPO_ROOT) }
  })

  registry.register('search:vector', async (_adapter, payload) => {
    const { query, hybrid } = payload as { query: string; hybrid?: boolean }
    const args = ['-m', 'src.vector_index', query, REPO_ROOT, '--json']
    if (hybrid) args.push('--hybrid')
    const raw = await runPythonJson(args)
    return { ...raw, results: enrichResults(raw.results ?? [], REPO_ROOT) }
  })
}
