export interface EditBlock {
  path: string
  content: string
}

export interface RunBlock {
  command: string
}

export interface BrowseBlock {
  url: string
  task: string
}

const EDIT_BLOCK_RE = /<<<EDIT ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_EDIT>>>/g
const RUN_BLOCK_RE = /<<<RUN>>>\n([\s\S]*?)\n<<<END_RUN>>>/g
const BROWSE_BLOCK_RE = /<<<BROWSE ([^\n>]+)>>>\n([\s\S]*?)\n<<<END_BROWSE>>>/g

export function parseEditBlocks(text: string): EditBlock[] {
  const blocks: EditBlock[] = []
  for (const m of text.matchAll(EDIT_BLOCK_RE)) {
    blocks.push({ path: m[1].trim(), content: m[2] })
  }
  return blocks
}

export function stripEditBlocks(text: string): string {
  return text.replace(EDIT_BLOCK_RE, '').trim()
}

export function parseRunBlocks(text: string): RunBlock[] {
  const blocks: RunBlock[] = []
  for (const m of text.matchAll(RUN_BLOCK_RE)) {
    blocks.push({ command: m[1].trim() })
  }
  return blocks
}

export function stripRunBlocks(text: string): string {
  return text.replace(RUN_BLOCK_RE, '').trim()
}

export function parseBrowseBlocks(text: string): BrowseBlock[] {
  const blocks: BrowseBlock[] = []
  for (const m of text.matchAll(BROWSE_BLOCK_RE)) {
    blocks.push({ url: m[1].trim(), task: m[2].trim() })
  }
  return blocks
}

export function stripBrowseBlocks(text: string): string {
  return text.replace(BROWSE_BLOCK_RE, '').trim()
}

export interface ReviewFinding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  file?: string
  line?: number
  message: string
}

export interface ReviewBlock {
  findings: ReviewFinding[]
  summary: string
}

const REVIEW_BLOCK_RE = /<<<REVIEW>>>\n([\s\S]*?)\n<<<END_REVIEW>>>/g

export function parseReviewBlocks(text: string): ReviewBlock[] {
  const blocks: ReviewBlock[] = []
  for (const m of text.matchAll(REVIEW_BLOCK_RE)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as { findings?: ReviewFinding[]; summary?: string }
      blocks.push({
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      })
    } catch {
      blocks.push({ findings: [], summary: m[1].trim().slice(0, 200) })
    }
  }
  return blocks
}

export function stripReviewBlocks(text: string): string {
  return text.replace(REVIEW_BLOCK_RE, '').trim()
}

export interface OpenEditBlock {
  path: string
  partialContent: string
}

// Matches the last open (unclosed) <<<EDIT>>> block — used for streaming live preview.
const OPEN_EDIT_RE = /<<<EDIT ([^\n>]+)>>>\n([\s\S]*)$/

export function parseOpenEditBlock(text: string): OpenEditBlock | null {
  const m = text.match(OPEN_EDIT_RE)
  if (!m) return null
  // Ensure no END_EDIT follows this EDIT header (i.e., block is still open)
  if (m[2].includes('<<<END_EDIT>>>')) return null
  return { path: m[1].trim(), partialContent: m[2] }
}
