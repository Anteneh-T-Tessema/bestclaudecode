import { useMemo } from 'react'
import { surface } from '../../design'

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const el = document.createElement('style')
  el.textContent = `
.md-preview{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.7;color:hsl(220 8% 80%)}
.md-preview h1,.md-preview h2,.md-preview h3,.md-preview h4,.md-preview h5,.md-preview h6{font-weight:600;color:hsl(220 8% 92%);margin:1.2em 0 0.5em}
.md-preview h1{font-size:1.9em;border-bottom:1px solid hsl(220 8% 22%);padding-bottom:.3em}
.md-preview h2{font-size:1.5em;border-bottom:1px solid hsl(220 8% 22%);padding-bottom:.2em}
.md-preview h3{font-size:1.25em}
.md-preview h4{font-size:1.1em}
.md-preview p{margin:.75em 0}
.md-preview ul,.md-preview ol{padding-left:1.6em;margin:.75em 0}
.md-preview li{margin:.25em 0}
.md-preview blockquote{border-left:3px solid hsl(220 8% 32%);padding:.2em 1em;margin:1em 0;color:hsl(220 8% 55%)}
.md-preview code{background:hsl(220 8% 13%);padding:1px 5px;border-radius:3px;font-size:.88em;font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace}
.md-preview pre{background:hsl(220 8% 9%);padding:14px 16px;border-radius:6px;overflow-x:auto;margin:1em 0;border:1px solid hsl(220 8% 18%)}
.md-preview pre code{background:none;padding:0;font-size:.85em}
.md-preview hr{border:none;border-top:1px solid hsl(220 8% 22%);margin:1.5em 0}
.md-preview a{color:hsl(200 85% 62%);text-decoration:none}
.md-preview a:hover{text-decoration:underline}
.md-preview strong{color:hsl(220 8% 92%);font-weight:600}
.md-preview em{font-style:italic}
.md-preview del{color:hsl(220 8% 45%)}
.md-preview img{max-width:100%;border-radius:4px}
.md-preview table{border-collapse:collapse;width:100%;margin:1em 0}
.md-preview th,.md-preview td{border:1px solid hsl(220 8% 22%);padding:6px 12px;text-align:left}
.md-preview th{background:hsl(220 8% 13%);font-weight:600}
`
  document.head.appendChild(el)
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineFmt(s: string): string {
  s = escHtml(s)
  // Images before links so ![alt](url) doesn't match the link pattern first
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  return s
}

function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = escHtml(line.slice(3).trim())
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(escHtml(lines[i]))
        i++
      }
      out.push(`<pre><code class="lang-${lang}">${codeLines.join('\n')}</code></pre>`)
      i++
      continue
    }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('<hr />')
      i++
      continue
    }

    // ATX Heading
    const hm = line.match(/^(#{1,6})\s+(.+)/)
    if (hm) {
      const lvl = hm[1].length
      out.push(`<h${lvl}>${inlineFmt(hm[2])}</h${lvl}>`)
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const bqLines: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) {
        bqLines.push(lines[i].slice(2))
        i++
      }
      out.push(`<blockquote><p>${inlineFmt(bqLines.join('\n'))}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^[*\-+] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[*\-+] /.test(lines[i])) {
        items.push(`<li>${inlineFmt(lines[i].replace(/^[*\-+] /, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inlineFmt(lines[i].replace(/^\d+\. /, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph — gather consecutive body lines
    const pLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,6} /.test(lines[i]) &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('> ') &&
      !/^[*\-+] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !/^(---+|\*\*\*+|___+)\s*$/.test(lines[i])
    ) {
      pLines.push(inlineFmt(lines[i]))
      i++
    }
    if (pLines.length > 0) {
      out.push(`<p>${pLines.join('<br />')}</p>`)
    }
  }

  return out.join('\n')
}

export function MarkdownPreview({ content }: { content: string }) {
  injectStyles()
  const html = useMemo(() => mdToHtml(content), [content])

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        background: surface.base,
        padding: '24px 32px 48px',
      }}
    >
      <div
        className="md-preview"
        style={{ maxWidth: 720, margin: '0 auto' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
