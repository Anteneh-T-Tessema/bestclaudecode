import { describe, it, expect } from 'vitest'
import { markdownToHtml } from './reportFormat'

describe('markdownToHtml', () => {
  it('converts h1 and h2 headings', () => {
    const html = markdownToHtml('# Title\n\n## Section', 'doc')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Section</h2>')
  })

  it('wraps consecutive bullet lines in a single ul', () => {
    const html = markdownToHtml('- one\n- two\n- three', 'doc')
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n<li>three</li>\n</ul>')
  })

  it('closes a list before a non-list line and reopens for a later one', () => {
    const html = markdownToHtml('- a\nparagraph\n- b', 'doc')
    const ulOpens = html.match(/<ul>/g) ?? []
    const ulCloses = html.match(/<\/ul>/g) ?? []
    expect(ulOpens.length).toBe(2)
    expect(ulCloses.length).toBe(2)
  })

  it('renders plain non-empty lines as paragraphs and skips blank lines', () => {
    const html = markdownToHtml('first\n\nsecond', 'doc')
    expect(html).toContain('<p>first</p>')
    expect(html).toContain('<p>second</p>')
  })

  it('escapes HTML-significant characters', () => {
    const html = markdownToHtml('- <script>alert(1)</script> & "quotes"', 'doc')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
  })

  it('escapes the title and includes it in <title>', () => {
    const html = markdownToHtml('# x', 'My <Report> & Title')
    expect(html).toContain('<title>My &lt;Report&gt; &amp; Title</title>')
  })

  it('closes a trailing list at end of input', () => {
    const html = markdownToHtml('- only item', 'doc')
    expect(html.trim().includes('</ul>\n</body>') || html.includes('</ul>')).toBe(true)
  })
})
