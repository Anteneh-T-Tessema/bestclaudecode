import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface ScanFinding {
  type: 'quality' | 'security'
  file: string
  line: number
  message: string
}

// Security credentials pattern checks (reused from autonomousAgent.ts)
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key',     re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub PAT',         re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'PEM private key',    re: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'generic API secret', re: /(?:api[_-]?key|api[_-]?secret|password|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9+/]{24,}['"]/i },
]

export function scanSandboxFiles(shadowPath: string, baseRef: string): ScanFinding[] {
  const findings: ScanFinding[] = []

  // 1. Get modified/added files compared to baseRef
  let files: string[] = []
  try {
    const filesSet = new Set<string>()

    // git status --porcelain gets uncommitted changes
    try {
      const statusStdout = execSync('git status --porcelain', { cwd: shadowPath }).toString()
      statusStdout.split('\n').forEach((line) => {
        if (line.trim() && !line.startsWith('D ')) {
          const file = line.slice(3).trim()
          if (file) filesSet.add(file)
        }
      })
    } catch (e) {
      console.warn('git status failed, skipping status checks:', e)
    }

    // git diff --name-only gets committed changes
    try {
      const diffStdout = execSync(`git diff --name-only ${baseRef}`, { cwd: shadowPath }).toString()
      diffStdout.split('\n').forEach((line) => {
        const trimmed = line.trim()
        if (trimmed) filesSet.add(trimmed)
      })
    } catch (e) {
      console.warn('git diff failed, skipping diff checks:', e)
    }

    files = Array.from(filesSet)
  } catch (e) {
    console.error('Failed to get modified files in shadow workspace:', e)
    return []
  }

  // 2. Scan each file's content line-by-line
  for (const file of files) {
    const filePath = path.join(shadowPath, file)
    if (!fs.existsSync(filePath)) continue

    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) continue
    } catch {
      continue
    }

    let content = ''
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch {
      continue
    }

    const lines = content.split('\n')

    // Quality check patterns (placeholders)
    const qualityPatterns = [
      { name: 'TODO', re: /\bTODO\b/i },
      { name: 'FIXME', re: /\bFIXME\b/i },
      { name: 'placeholder', re: /\bplaceholder\b/i },
    ]

    // SQL Injection check patterns (string concatenation/template literals in queries)
    const sqlPatterns = [
      { name: 'SQL Injection: template literal query parameters', re: /\b(SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM)\s+.*\$\{/i },
      { name: 'SQL Injection: string concatenation in query', re: /\b(SELECT\s+.*\s+FROM|INSERT\s+INTO|UPDATE\s+.*\s+SET|DELETE\s+FROM)\s+.*['"]\s*\+\s*\w+/i },
    ]

    lines.forEach((lineText, idx) => {
      const lineNo = idx + 1

      // Quality scans
      for (const pattern of qualityPatterns) {
        if (pattern.re.test(lineText)) {
          findings.push({
            type: 'quality',
            file,
            line: lineNo,
            message: `Quality flaw: placeholder pattern "${pattern.name}" found in ${file}:${lineNo}`,
          })
        }
      }

      // Security credentials scans
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.re.test(lineText)) {
          findings.push({
            type: 'security',
            file,
            line: lineNo,
            message: `Security vulnerability: potential credentials leak ("${pattern.name}") found in ${file}:${lineNo}`,
          })
        }
      }

      // Security SQL injection scans
      for (const pattern of sqlPatterns) {
        if (pattern.re.test(lineText)) {
          findings.push({
            type: 'security',
            file,
            line: lineNo,
            message: `Security vulnerability: potential ${pattern.name} found in ${file}:${lineNo}`,
          })
        }
      }
    })
  }

  return findings
}
