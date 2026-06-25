export interface ConflictHunk {
  startLine: number
  endLine: number
  oursLabel: string
  theirsLabel: string
  ours: string
  theirs: string
}

export function parseConflicts(content: string): ConflictHunk[] {
  const lines = content.split('\n')
  const hunks: ConflictHunk[] = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) { i++; continue }
    const startLine = i
    const oursLabel = lines[i].replace('<<<<<<<', '').trim()
    i++
    const oursLines: string[] = []
    while (i < lines.length && !lines[i].startsWith('=======')) { oursLines.push(lines[i]); i++ }
    i++
    const theirsLines: string[] = []
    while (i < lines.length && !lines[i].startsWith('>>>>>>>')) { theirsLines.push(lines[i]); i++ }
    const theirsLabel = (lines[i] ?? '').replace('>>>>>>>', '').trim()
    hunks.push({
      startLine,
      endLine: i,
      oursLabel,
      theirsLabel,
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n'),
    })
    i++
  }
  return hunks
}

export function applyResolution(content: string, hunk: ConflictHunk, choice: 'ours' | 'theirs' | 'both'): string {
  const lines = content.split('\n')
  const pick = (text: string): string[] => (text === '' ? [] : text.split('\n'))
  const replacement = choice === 'ours' ? pick(hunk.ours)
    : choice === 'theirs' ? pick(hunk.theirs)
    : [...pick(hunk.ours), ...pick(hunk.theirs)]
  lines.splice(hunk.startLine, hunk.endLine - hunk.startLine + 1, ...replacement)
  return lines.join('\n')
}
