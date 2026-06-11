import { describe, it, expect } from 'vitest'
import { applyLinkPolicy } from './linkPolicy'

/**
 * Tests for link policy helper
 * 
 * Requirements:
 * - External links (https://) must have target="_blank" and rel="noopener noreferrer"
 * - Internal/same-origin relative links should not receive unsafe protocol rewrites
 * - Preserve existing target and rel attributes when safe
 * - Remove dangerous protocols (javascript:, vbscript:, data:text/html)
 */
describe('applyLinkPolicy', () => {
  describe('external links', () => {
    it('adds target="_blank" to external https links', () => {
      const input = '<a href="https://example.com">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('target="_blank"')
      expect(result).toContain('href="https://example.com"')
    })

    it('adds rel="noopener noreferrer" to external links', () => {
      const input = '<a href="https://example.com">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('rel="noopener noreferrer"')
    })

    it('adds both target and rel to external http links', () => {
      const input = '<a href="http://example.com">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('target="_blank"')
      expect(result).toContain('rel="noopener noreferrer"')
    })

    it('adds target and rel to external links with other attributes', () => {
      const input = '<a href="https://example.com" title="Example" class="link">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('target="_blank"')
      expect(result).toContain('rel="noopener noreferrer"')
      expect(result).toContain('title="Example"')
      expect(result).toContain('class="link"')
    })
  })

  describe('internal and relative links', () => {
    it('does NOT add target="_blank" to relative links', () => {
      const input = '<a href="/page">Internal Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('target="_blank"')
      expect(result).toContain('href="/page"')
    })

    it('does NOT add target="_blank" to anchor links', () => {
      const input = '<a href="#section">Jump to section</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('target="_blank"')
      expect(result).toContain('href="#section"')
    })

    it('does NOT add target="_blank" to same-origin links (no protocol)', () => {
      const input = '<a href="page.html">Local Page</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('target="_blank"')
      expect(result).toContain('href="page.html"')
    })
  })

  describe('existing target and rel attributes', () => {
    it('preserves existing target="_self" on external link', () => {
      const input = '<a href="https://example.com" target="_self">Link</a>'
      const result = applyLinkPolicy(input)
      // Should override with _blank for security
      expect(result).toContain('target="_blank"')
    })

    it('preserves existing rel="nofollow" and adds noopener noreferrer', () => {
      const input = '<a href="https://example.com" rel="nofollow">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('nofollow')
      expect(result).toContain('noopener')
      expect(result).toContain('noreferrer')
    })

    it('does not duplicate noopener noreferrer if already present', () => {
      const input = '<a href="https://example.com" rel="noopener noreferrer">Link</a>'
      const result = applyLinkPolicy(input)
      // Should not duplicate the rel values
      expect(result).toMatch(/rel="noopener noreferrer"/)
    })

    it('preserves existing target on relative link', () => {
      const input = '<a href="/page" target="_top">Internal Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('target="_top"')
      expect(result).not.toContain('_blank')
    })
  })

  describe('dangerous protocols', () => {
    it('removes javascript: protocol', () => {
      const input = '<a href="javascript:alert(\'XSS\')">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('javascript:')
      expect(result).not.toContain('alert')
    })

    it('removes vbscript: protocol', () => {
      const input = '<a href="vbscript:msgbox(\'XSS\')">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('vbscript:')
    })

    it('removes data:text/html protocol', () => {
      const input = '<a href="data:text/html,<script>alert(\'XSS\')</script>">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('data:text/html')
      expect(result).not.toContain('script')
    })

    it('removes dangerous protocol even with existing attributes', () => {
      const input = '<a href="javascript:void(0)" onclick="evil()" class="link">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('javascript:')
      expect(result).toContain('class="link"')
    })
  })

  describe('multiple links', () => {
    it('processes multiple links correctly', () => {
      const input = '<a href="https://example1.com">External 1</a><a href="/page">Internal</a><a href="https://example2.com">External 2</a>'
      const result = applyLinkPolicy(input)
      
      // External links should have target="_blank"
      const matches = result.match(/target="_blank"/g)
      expect(matches).toHaveLength(2)
      
      // All external links should have rel
      const relMatches = result.match(/rel="noopener noreferrer"/g)
      expect(relMatches).toHaveLength(2)
    })

    it('handles mixed safe and unsafe links', () => {
      const input = '<a href="https://safe.com">Safe</a><a href="javascript:evil()">Unsafe</a><a href="/relative">Relative</a>'
      const result = applyLinkPolicy(input)
      
      expect(result).toContain('href="https://safe.com"')
      expect(result).toContain('target="_blank"')
      expect(result).not.toContain('javascript:evil()')
      expect(result).toContain('href="/relative"')
    })
  })

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = applyLinkPolicy('')
      expect(result).toBe('')
    })

    it('handles text without links', () => {
      const input = '<p>Just some text without links</p>'
      const result = applyLinkPolicy(input)
      expect(result).toBe('<p>Just some text without links</p>')
    })

    it('handles malformed anchor tags gracefully', () => {
      const input = '<a href="https://example.com">Unclosed link'
      const result = applyLinkPolicy(input)
      // Should not crash
      expect(result).toBeDefined()
    })

    it('handles links with query parameters and fragments', () => {
      const input = '<a href="https://example.com/page?query=value#section">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('href="https://example.com/page?query=value#section"')
      expect(result).toContain('target="_blank"')
    })

    it('handles mailto links correctly', () => {
      const input = '<a href="mailto:test@example.com">Email</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('href="mailto:test@example.com"')
      // mailto links are not external web links, so no target="_blank"
      expect(result).not.toContain('target="_blank"')
    })

    it('handles tel links correctly', () => {
      const input = '<a href="tel:+1234567890">Call</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('href="tel:+1234567890"')
      // tel links are not external web links, so no target="_blank"
      expect(result).not.toContain('target="_blank"')
    })
  })

  describe('security edge cases', () => {
    it('handles mixed case protocol (JAVASCRIPT:)', () => {
      const input = '<a href="JAVASCRIPT:alert(\'XSS\')">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('javascript')
      expect(result).not.toContain('JAVASCRIPT')
    })

    it('handles encoded dangerous protocols', () => {
      const input = '<a href="&#106;avascript:alert(\'XSS\')">Click</a>'
      const result = applyLinkPolicy(input)
      expect(result).not.toContain('javascript')
    })

    it('handles whitespace in href', () => {
      const input = '<a href="  https://example.com  ">Link</a>'
      const result = applyLinkPolicy(input)
      expect(result).toContain('target="_blank"')
    })

    it('handles empty href', () => {
      const input = '<a href="">Empty Link</a>'
      const result = applyLinkPolicy(input)
      // Should not add target to empty href
      expect(result).not.toContain('target="_blank"')
    })
  })
})
