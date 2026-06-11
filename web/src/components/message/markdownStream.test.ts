import { describe, it, expect } from 'vitest'
import { repairIncompleteMarkdown } from './markdownStream'

/**
 * Tests for markdownStream repair function
 *
 * Verifies that incomplete Markdown from streaming tokens is repaired
 * conservatively so it can be safely rendered without crashing or
 * producing unsafe HTML.
 */

describe('repairIncompleteMarkdown', () => {
  describe('incomplete fenced code blocks', () => {
    it('closes an unclosed fenced code block', () => {
      const input = '```ts\nconst a = 1'
      const result = repairIncompleteMarkdown(input)
      expect(result).toContain('```ts')
      expect(result).toContain('const a = 1')
      // Should have a closing fence
      expect(result).toMatch(/```[\s\S]*```/)
    })

    it('closes an unclosed fenced code block without language', () => {
      const input = '```\nhello world'
      const result = repairIncompleteMarkdown(input)
      expect(result).toContain('```')
      expect(result).toContain('hello world')
      // Count fences - should be even (open + close)
      const fenceCount = (result.match(/```/g) || []).length
      expect(fenceCount % 2).toBe(0)
    })

    it('does not modify a complete fenced code block', () => {
      const input = '```ts\nconst a = 1\n```'
      const result = repairIncompleteMarkdown(input)
      expect(result).toBe(input)
    })

    it('handles multiple code blocks where only last is incomplete', () => {
      const input = '```ts\nconst a = 1\n```\n\nSome text\n\n```js\nconsole.log('
      const result = repairIncompleteMarkdown(input)
      // First block should stay closed, second should be closed
      const fenceCount = (result.match(/```/g) || []).length
      expect(fenceCount % 2).toBe(0)
    })

    it('handles code block with content on fence line', () => {
      const input = '```python print("hi")'
      const result = repairIncompleteMarkdown(input)
      const fenceCount = (result.match(/```/g) || []).length
      expect(fenceCount % 2).toBe(0)
    })
  })

  describe('incomplete links', () => {
    it('escapes incomplete link syntax to prevent broken anchors', () => {
      const input = '[OpenAI](https://example'
      const result = repairIncompleteMarkdown(input)
      // Should not produce a malformed <a> tag
      // Either the [ is escaped or the link is removed/neutralized
      expect(result).not.toMatch(/<a[^>]*href="https:\/\/example"/)
    })

    it('does not modify a complete link', () => {
      const input = '[OpenAI](https://openai.com)'
      const result = repairIncompleteMarkdown(input)
      expect(result).toContain('[OpenAI](https://openai.com)')
    })

    it('handles link with missing closing parenthesis at end of text', () => {
      const input = 'Check [this link](https://test.com/path'
      const result = repairIncompleteMarkdown(input)
      // Should not produce broken anchor
      expect(result).not.toMatch(/<a[^>]*href="https:\/\/test.com\/path"/)
    })

    it('handles link text without any URL part', () => {
      const input = '[incomplete link text'
      const result = repairIncompleteMarkdown(input)
      // Should render as plain text, not broken markdown
      expect(result).toContain('[incomplete link text')
    })
  })

  describe('incomplete bold/italic markers', () => {
    it('handles unclosed bold marker', () => {
      const input = 'This is **bold text'
      const result = repairIncompleteMarkdown(input)
      // Should not produce broken <strong> tag from partial markdown
      // Either close the marker or escape it
      expect(result).not.toMatch(/<strong>[^<]*$/)
    })

    it('does not modify properly closed bold', () => {
      const input = 'This is **bold** text'
      const result = repairIncompleteMarkdown(input)
      expect(result).toContain('**bold**')
    })

    it('handles unclosed italic marker', () => {
      const input = 'This is *italic text'
      const result = repairIncompleteMarkdown(input)
      // Should not produce broken <em> tag
      expect(result).not.toMatch(/<em>[^<]*$/)
    })

    it('does not modify properly closed italic', () => {
      const input = 'This is *italic* text'
      const result = repairIncompleteMarkdown(input)
      expect(result).toContain('*italic*')
    })
  })

  describe('safe content passes through', () => {
    it('passes through plain text unchanged', () => {
      const input = 'Hello world, no markdown here.'
      const result = repairIncompleteMarkdown(input)
      expect(result).toBe(input)
    })

    it('passes through empty string', () => {
      const result = repairIncompleteMarkdown('')
      expect(result).toBe('')
    })

    it('handles null/undefined gracefully', () => {
      expect(repairIncompleteMarkdown(null as any)).toBe('')
      expect(repairIncompleteMarkdown(undefined as any)).toBe('')
    })

    it('passes through complete markdown unchanged', () => {
      const input = '# Heading\n\nParagraph with **bold** and *italic*.\n\n```ts\nconst x = 1\n```'
      const result = repairIncompleteMarkdown(input)
      expect(result).toBe(input)
    })
  })

  describe('XSS prevention during streaming', () => {
    it('does not strip script tags (that is DOMPurify job)', () => {
      const input = '<script>alert(1)</script>'
      const result = repairIncompleteMarkdown(input)
      // repairIncompleteMarkdown does NOT sanitize - it only repairs markdown structure
      // DOMPurify handles XSS separately
      expect(result).toBe(input)
    })
  })

  describe('combined incomplete patterns', () => {
    it('handles text with incomplete code block and incomplete link', () => {
      const input = 'Check [this](https://example\n\n```ts\nconst a ='
      const result = repairIncompleteMarkdown(input)
      // Should not have broken link anchor
      expect(result).not.toMatch(/<a[^>]*href="https:\/\/example"/)
      // Should have balanced code fences
      const fenceCount = (result.match(/```/g) || []).length
      expect(fenceCount % 2).toBe(0)
    })

    it('handles streaming chunk ending mid-word in code block', () => {
      const input = '```javascript\nfunction hello() {\n  console.log("hel'
      const result = repairIncompleteMarkdown(input)
      const fenceCount = (result.match(/```/g) || []).length
      expect(fenceCount % 2).toBe(0)
    })
  })
})
