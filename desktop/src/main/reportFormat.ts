/**
 * Converts the specific, constrained Markdown shape writeVerificationReport()
 * generates (h1/h2 headings, `- ` bullet lines, plain paragraphs — no tables,
 * links, or inline emphasis) into a self-contained styled HTML document, for
 * sharing a session's evidence report with a non-technical auditor without
 * requiring a Markdown renderer. Deliberately not a general Markdown parser.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function markdownToHtml(markdown: string, title: string): string {
  const out: string[] = []
  let inList = false

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimEnd()
    const isListItem = line.startsWith('- ')

    if (isListItem && !inList) { out.push('<ul>'); inList = true }
    if (!isListItem && inList) { out.push('</ul>'); inList = false }

    if (line.startsWith('## ')) out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`)
    else if (line.startsWith('# ')) out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`)
    else if (isListItem) out.push(`<li>${escapeHtml(line.slice(2))}</li>`)
    else if (line.trim() !== '') out.push(`<p>${escapeHtml(line)}</p>`)
  }
  if (inList) out.push('</ul>')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #444; margin-top: 28px; }
  li { margin-bottom: 4px; }
  p { margin: 4px 0; }
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>`
}
