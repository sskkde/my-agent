import { describe, it, expect } from 'vitest'
import { sanitizeMarkdown } from './markdownSanitize'

/**
 * Tests for Markdown sanitization helper
 * 
 * Requirements:
 * - Use DOMPurify as final sanitizer
 * - Allow safe Markdown elements (h1-h6, p, ul, ol, li, blockquote, pre, code, table, a, img, hr)
 * - Remove dangerous protocols (javascript:, vbscript:, data:text/html)
 * - Prevent XSS attacks
 */
describe('sanitizeMarkdown', () => {
  describe('safe HTML elements', () => {
    it('allows headings (h1-h6)', () => {
      const input = '<h1>Title</h1><h2>Subtitle</h2><h6>Small</h6>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<h1>Title</h1>')
      expect(result).toContain('<h2>Subtitle</h2>')
      expect(result).toContain('<h6>Small</h6>')
    })

    it('allows paragraph tags', () => {
      const input = '<p>Paragraph text</p>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<p>Paragraph text</p>')
    })

    it('allows list elements (ul, ol, li)', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>First</li></ol>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<ul>')
      expect(result).toContain('<ol>')
      expect(result).toContain('<li>Item 1</li>')
    })

    it('allows blockquote tags', () => {
      const input = '<blockquote>Quote text</blockquote>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<blockquote>Quote text</blockquote>')
    })

    it('allows pre and code tags', () => {
      const input = '<pre><code>const x = 42;</code></pre>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<pre>')
      expect(result).toContain('<code>')
      expect(result).toContain('const x = 42;')
    })

    it('allows table elements', () => {
      const input = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<table>')
      expect(result).toContain('<thead>')
      expect(result).toContain('<th>Header</th>')
      expect(result).toContain('<td>Cell</td>')
    })

    it('allows anchor tags with safe attributes', () => {
      const input = '<a href="https://example.com" title="Example">Link</a>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<a')
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('title="Example"')
      expect(result).toContain('Link</a>')
    })

    it('allows img tags with safe attributes', () => {
      const input = '<img src="image.jpg" alt="Image" width="100" height="100">'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<img')
      expect(result).toContain('src="image.jpg"')
      expect(result).toContain('alt="Image"')
    })

    it('allows hr tags', () => {
      const input = '<p>Before</p><hr><p>After</p>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<hr')
    })

    it('allows strong, em, b, i tags', () => {
      const input = '<strong>Bold</strong><em>Italic</em><b>Bold</b><i>Italic</i>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('<strong>Bold</strong>')
      expect(result).toContain('<em>Italic</em>')
      expect(result).toContain('<b>Bold</b>')
      expect(result).toContain('<i>Italic</i>')
    })
  })

  describe('dangerous protocol removal', () => {
    it('removes javascript: protocol from href', () => {
      const input = '<a href="javascript:alert(\'XSS\')">Click</a>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('javascript:')
      expect(result).not.toContain('alert')
    })

    it('removes vbscript: protocol from href', () => {
      const input = '<a href="vbscript:msgbox(\'XSS\')">Click</a>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('vbscript:')
    })

    it('removes data:text/html protocol from href', () => {
      const input = '<a href="data:text/html,<script>alert(\'XSS\')</script>">Click</a>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('data:text/html')
      expect(result).not.toContain('script')
    })

    it('removes dangerous protocols from img src', () => {
      const input = '<img src="javascript:alert(\'XSS\')">'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('javascript:')
    })

    it('preserves safe protocols (https, http, mailto)', () => {
      const input = '<a href="https://example.com">HTTPS</a><a href="http://example.com">HTTP</a><a href="mailto:test@example.com">Email</a>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('href="https://example.com"')
      expect(result).toContain('href="http://example.com"')
      expect(result).toContain('href="mailto:test@example.com"')
    })
  })

  describe('XSS prevention', () => {
    it('removes script tags', () => {
      const input = '<script>alert("XSS")</script><p>Safe</p>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('alert')
      expect(result).toContain('<p>Safe</p>')
    })

    it('removes style tags', () => {
      const input = '<style>body { display: none; }</style><p>Safe</p>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('<style>')
      expect(result).toContain('<p>Safe</p>')
    })

    it('removes iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('<iframe')
      expect(result).toContain('<p>Safe</p>')
    })

    it('removes object and embed tags', () => {
      const input = '<object data="malicious.swf"></object><embed src="malicious.swf"><p>Safe</p>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('<object')
      expect(result).not.toContain('<embed')
      expect(result).toContain('<p>Safe</p>')
    })

    it('removes event handler attributes (onclick, onerror, onload, etc.)', () => {
      const input = '<img src="x" onerror="alert(\'XSS\')"><div onclick="malicious()">Click</div>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('onerror=')
      expect(result).not.toContain('onclick=')
      expect(result).not.toContain('alert')
      expect(result).not.toContain('malicious')
    })

    it('removes form-related tags', () => {
      const input = '<form action="evil.com"><input type="text"><button>Submit</button></form><p>Safe</p>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('<form')
      expect(result).not.toContain('<input')
      expect(result).not.toContain('<button')
      expect(result).toContain('<p>Safe</p>')
    })

    it('removes data attributes', () => {
      const input = '<div data-malicious="value">Content</div>'
      const result = sanitizeMarkdown(input)
      expect(result).not.toContain('data-malicious')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = sanitizeMarkdown('')
      expect(result).toBe('')
    })

    it('handles plain text without HTML', () => {
      const input = 'Just plain text'
      const result = sanitizeMarkdown(input)
      expect(result).toBe('Just plain text')
    })

    it('handles already escaped HTML', () => {
      const input = '&lt;script&gt;alert("XSS")&lt;/script&gt;'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('&lt;script&gt;')
      expect(result).not.toContain('<script>')
    })

    it('preserves valid class attribute', () => {
      const input = '<code class="language-javascript">const x = 42;</code>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('class="language-javascript"')
    })

    it('preserves valid id attribute', () => {
      const input = '<div id="myDiv">Content</div>'
      const result = sanitizeMarkdown(input)
      expect(result).toContain('id="myDiv"')
    })
  })
})
