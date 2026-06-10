import { describe, it, expect } from 'vitest'
import { formatMessageContent } from './formatMessageContent'

/**
 * Tests for Markdown formatter with [md] tag support and XSS protection
 * 
 * These tests are currently FAILING and will pass after Task 8 implementation.
 * 
 * Requirements:
 * - Lightweight formatting outside [md]...[/md] tags (bold, italic, line breaks)
 * - Full Markdown inside [md]...[/md] tags (headings, lists, code blocks)
 * - XSS protection (script tags, event handlers, raw HTML must be escaped/removed)
 */

describe('formatMessageContent - Lightweight formatting outside [md] tags', () => {
  it('applies bold formatting with **text** outside [md] tags', () => {
    const input = 'hello **world** today'
    const result = formatMessageContent(input)
    
    // Should render bold text
    expect(result).toContain('<strong>')
    expect(result).toContain('world')
    expect(result).toContain('</strong>')
    expect(result).not.toContain('**world**')
  })

  it('applies italic formatting with *text* outside [md] tags', () => {
    const input = 'this is *important* news'
    const result = formatMessageContent(input)
    
    // Should render italic text
    expect(result).toContain('<em>')
    expect(result).toContain('important')
    expect(result).toContain('</em>')
    expect(result).not.toContain('*important*')
  })

  it('applies italic formatting with _text_ outside [md] tags', () => {
    const input = 'read the _documentation_ carefully'
    const result = formatMessageContent(input)
    
    // Should render italic text
    expect(result).toContain('<em>')
    expect(result).toContain('documentation')
    expect(result).toContain('</em>')
    expect(result).not.toContain('_documentation_')
  })

  it('preserves line breaks outside [md] tags', () => {
    const input = 'line one\nline two\nline three'
    const result = formatMessageContent(input)
    
    // Should convert line breaks to <br> or preserve them in paragraphs
    expect(result).toContain('line one')
    expect(result).toContain('line two')
    expect(result).toContain('line three')
  })

  it('handles mixed lightweight formatting outside [md] tags', () => {
    const input = '**bold** and *italic* and _underline_ text'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<strong>')
    expect(result).toContain('<em>')
    expect(result).toContain('bold')
    expect(result).toContain('italic')
  })

  it('does NOT render full Markdown features outside [md] tags', () => {
    const input = '# This is a heading\n- list item\n```code block```'
    const result = formatMessageContent(input)
    
    // Should NOT convert to heading tag
    expect(result).not.toContain('<h1>')
    // Should NOT convert to list tag
    expect(result).not.toContain('<ul>')
    expect(result).not.toContain('<li>')
    // Should NOT convert to code block
    expect(result).not.toContain('<pre>')
    expect(result).not.toContain('<code>')
  })
})

describe('formatMessageContent - Full Markdown inside [md] tags', () => {
  it('renders headings inside [md] tags', () => {
    const input = '[md]# Title\n## Subtitle\n### Sub-subtitle[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<h1>')
    expect(result).toContain('Title')
    expect(result).toContain('</h1>')
    expect(result).toContain('<h2>')
    expect(result).toContain('Subtitle')
    expect(result).toContain('</h2>')
    expect(result).toContain('<h3>')
    expect(result).toContain('Sub-subtitle')
    expect(result).toContain('</h3>')
  })

  it('renders unordered lists inside [md] tags', () => {
    const input = '[md]\n- Item one\n- Item two\n- Item three\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<ul>')
    expect(result).toContain('<li>')
    expect(result).toContain('Item one')
    expect(result).toContain('Item two')
    expect(result).toContain('Item three')
    expect(result).toContain('</li>')
    expect(result).toContain('</ul>')
  })

  it('renders ordered lists inside [md] tags', () => {
    const input = '[md]\n1. First item\n2. Second item\n3. Third item\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<ol>')
    expect(result).toContain('<li>')
    expect(result).toContain('First item')
    expect(result).toContain('Second item')
    expect(result).toContain('Third item')
    expect(result).toContain('</li>')
    expect(result).toContain('</ol>')
  })

  it('renders inline code inside [md] tags', () => {
    const input = '[md]Use the `formatMessageContent` function[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<code>')
    expect(result).toContain('formatMessageContent')
    expect(result).toContain('</code>')
  })

  it('renders code blocks inside [md] tags', () => {
    const input = '[md]\n```javascript\nconst x = 42;\n```\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<pre>')
    expect(result).toContain('<code')
    expect(result).toContain('const x = 42;')
    expect(result).toContain('</code>')
    expect(result).toContain('</pre>')
  })

  it('renders blockquotes inside [md] tags', () => {
    const input = '[md]\n> This is a quote\n> Multiple lines\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<blockquote>')
    expect(result).toContain('This is a quote')
    expect(result).toContain('</blockquote>')
  })

  it('renders links inside [md] tags', () => {
    const input = '[md]Check out [the docs](https://example.com)[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<a')
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('the docs')
    expect(result).toContain('</a>')
  })

  it('renders horizontal rules inside [md] tags', () => {
    const input = '[md]\nSection one\n\n---\n\nSection two\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('<hr')
  })

  it('removes [md] and [/md] tags from output', () => {
    const input = '[md]# Title\nContent here[/md]'
    const result = formatMessageContent(input)
    
    expect(result).not.toContain('[md]')
    expect(result).not.toContain('[/md]')
  })

  it('handles multiple [md] blocks in same message', () => {
    const input = 'Plain text [md]# First[/md] more plain [md]# Second[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('Plain text')
    expect(result).toContain('First')
    expect(result).toContain('more plain')
    expect(result).toContain('Second')
    expect(result).not.toContain('[md]')
  })
})

describe('formatMessageContent - XSS protection', () => {
  it('escapes script tags outside [md] blocks', () => {
    const input = 'Hello <script>alert("XSS")</script> world'
    const result = formatMessageContent(input)
    
    // Script tag should be escaped or removed
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
    expect(result).toContain('Hello')
    expect(result).toContain('world')
  })

  it('escapes script tags inside [md] blocks', () => {
    const input = '[md]# Title\n<script>alert("XSS")</script>\n[/md]'
    const result = formatMessageContent(input)
    
    // Script tag should be escaped or removed even in [md] blocks
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
    expect(result).toContain('Title')
  })

  it('removes event handler attributes from HTML outside [md]', () => {
    const input = 'Click <img src="x" onerror="alert(\'XSS\')"> here'
    const result = formatMessageContent(input)
    
    // Event handlers should be removed
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('alert')
    expect(result).toContain('Click')
    expect(result).toContain('here')
  })

  it('removes event handler attributes inside [md] blocks', () => {
    const input = '[md]\n<img src="valid.jpg" onerror="alert(\'XSS\')">\n[/md]'
    const result = formatMessageContent(input)
    
    // Event handlers should be removed even in [md] blocks
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('alert')
  })

  it('escapes onclick and other event handlers', () => {
    const input = '<div onclick="malicious()">Content</div>'
    const result = formatMessageContent(input)
    
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('malicious')
  })

  it('escapes javascript: URLs in links outside [md]', () => {
    const input = 'Click <a href="javascript:alert(\'XSS\')">here</a>'
    const result = formatMessageContent(input)
    
    // javascript: URLs should be removed or sanitized
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('alert')
  })

  it('escapes javascript: URLs in [md] link syntax', () => {
    const input = '[md][Click me](javascript:alert(\'XSS\'))[/md]'
    const result = formatMessageContent(input)
    
    // javascript: URLs should be removed even in [md] link syntax
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('alert')
  })

  it('escapes data: URLs that could execute code', () => {
    const input = '<a href="data:text/html,<script>alert(\'XSS\')</script>">link</a>'
    const result = formatMessageContent(input)
    
    expect(result).not.toContain('data:text/html')
    expect(result).not.toContain('<script>')
  })

  it('removes iframe tags', () => {
    const input = '<iframe src="https://evil.com"></iframe>'
    const result = formatMessageContent(input)
    
    expect(result).not.toContain('<iframe')
    expect(result).not.toContain('evil.com')
  })

  it('removes object and embed tags', () => {
    const input = '<object data="malicious.swf"><embed src="malicious.swf"></object>'
    const result = formatMessageContent(input)
    
    expect(result).not.toContain('<object')
    expect(result).not.toContain('<embed')
  })

  it('escapes HTML entities in plain text', () => {
    const input = 'Use &lt;script&gt; to create tags'
    const result = formatMessageContent(input)
    
    // Should preserve or properly encode HTML entities
    expect(result).toContain('script')
  })

  it('allows safe HTML attributes in [md] blocks', () => {
    const input = '[md]\n<img src="image.jpg" alt="Safe image">\n[/md]'
    const result = formatMessageContent(input)
    
    // Safe attributes should be preserved
    expect(result).toContain('src="image.jpg"')
    expect(result).toContain('alt="Safe image"')
  })

  it('removes style attributes that could be malicious', () => {
    const input = '<div style="background:url(javascript:alert(\'XSS\'))">Content</div>'
    const result = formatMessageContent(input)
    
    // Malicious style should be removed
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('alert')
  })
})

describe('formatMessageContent - Edge cases', () => {
  it('handles empty string', () => {
    const result = formatMessageContent('')
    expect(result).toBe('')
  })

  it('handles undefined input', () => {
    const result = formatMessageContent(undefined as any)
    expect(result).toBe('')
  })

  it('handles null input', () => {
    const result = formatMessageContent(null as any)
    expect(result).toBe('')
  })

  it('handles plain text without any formatting', () => {
    const input = 'Just plain text without any formatting'
    const result = formatMessageContent(input)
    
    expect(result).toContain('Just plain text without any formatting')
  })

  it('handles unclosed [md] tags gracefully', () => {
    const input = '[md]# Title without closing tag'
    const result = formatMessageContent(input)
    
    // Should not crash, should handle gracefully
    expect(result).toBeDefined()
    expect(result).toContain('Title')
  })

  it('handles nested [md] tags (should treat inner ones as content)', () => {
    const input = '[md]Outer [md]Inner[/md] content[/md]'
    const result = formatMessageContent(input)
    
    // Should handle gracefully, exact behavior depends on implementation
    expect(result).toBeDefined()
    expect(result).toContain('Outer')
    expect(result).toContain('Inner')
    expect(result).toContain('content')
  })

  it('preserves special characters in code blocks', () => {
    const input = '[md]\n```\nconst html = "<div>test</div>";\n```\n[/md]'
    const result = formatMessageContent(input)
    
    expect(result).toContain('&lt;div&gt;')
    expect(result).toContain('&lt;/div&gt;')
    expect(result).toContain('test')
  })

  it('handles very long content without performance issues', () => {
    const longText = 'word '.repeat(10000)
    const input = `[md]${longText}[/md]`
    
    const start = Date.now()
    const result = formatMessageContent(input)
    const elapsed = Date.now() - start
    
    // Should complete in reasonable time (< 1 second for 10k words)
    expect(elapsed).toBeLessThan(1000)
    expect(result).toContain('word')
  })
})

describe('formatMessageContent - Integration scenarios', () => {
  it('handles realistic assistant message with mixed content', () => {
    const input = `I'll help you with that.

Here's the solution:

[md]
## Steps to follow

1. First, do this
2. Then, do that
3. Finally, run \`npm test\`

\`\`\`bash
npm install
npm run build
\`\`\`
[/md]

Let me know if you have **questions**!`

    const result = formatMessageContent(input)
    
    // Should have plain text intro
    expect(result).toContain("I'll help you with that.")
    
    // Should have Markdown heading in [md] block
    expect(result).toContain('<h2>')
    expect(result).toContain('Steps to follow')
    
    // Should have ordered list
    expect(result).toContain('<ol>')
    expect(result).toContain('<li>')
    
    // Should have code block
    expect(result).toContain('<pre>')
    expect(result).toContain('npm install')
    
    // Should have bold text outside [md]
    expect(result).toContain('<strong>')
    expect(result).toContain('questions')
  })

  it('handles user message with potential XSS attempt', () => {
    const input = 'Check this out: <img src=x onerror="alert(\'hacked\')"> and <script>steal()</script>'
    const result = formatMessageContent(input)
    
    // Should remove XSS vectors
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('alert')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('steal')
    
    // Should preserve safe content
    expect(result).toContain('Check this out')
  })

  it('handles code example with HTML that should be preserved as text', () => {
    const input = `[md]
\`\`\`html
<div class="container">
  <p>Paragraph</p>
</div>
\`\`\`
[/md]`

    const result = formatMessageContent(input)
    
    expect(result).toContain('&lt;div')
    expect(result).toContain('&lt;p&gt;')
    expect(result).toContain('&lt;/p&gt;')
    expect(result).toContain('&lt;/div&gt;')
  })
})
