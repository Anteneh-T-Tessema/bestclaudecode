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
