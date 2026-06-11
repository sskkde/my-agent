import { describe, it, expect } from 'vitest'
import { detectContentType } from './contentType'

describe('detectContentType', () => {
  describe('explicit metadata override', () => {
    it('returns explicit metadata.contentType when provided', () => {
      expect(detectContentType('any content', { contentType: 'application/json' })).toBe('application/json')
    })

    it('prefers explicit metadata over sniffing', () => {
      const jsonContent = '{"key": "value"}'
      expect(detectContentType(jsonContent, { contentType: 'text/plain' })).toBe('text/plain')
    })

    it('handles custom content types from metadata', () => {
      expect(detectContentType('data', { contentType: 'application/x-custom' })).toBe('application/x-custom')
    })
  })

  describe('JSON detection', () => {
    it('detects JSON object', () => {
      expect(detectContentType('{"name": "test"}')).toBe('application/json')
    })

    it('detects JSON array', () => {
      expect(detectContentType('[1, 2, 3]')).toBe('application/json')
    })

    it('detects nested JSON', () => {
      expect(detectContentType('{"outer": {"inner": [1, 2, 3]}}')).toBe('application/json')
    })

    it('returns text/plain for malformed JSON that starts with brace', () => {
      // Conservative: invalid JSON falls back to plain text
      expect(detectContentType('{invalid json')).toBe('text/plain')
    })

    it('JSON with markdown characters remains JSON, not markdown', () => {
      // Critical: JSON containing *, _, or backticks must stay JSON/plain
      const jsonWithMarkdown = '{"emphasis": "*italic*", "bold": "**bold**", "code": "`code`"}'
      expect(detectContentType(jsonWithMarkdown)).toBe('application/json')
    })

    it('JSON with backticks remains JSON', () => {
      const jsonWithBackticks = '{"command": "use `npm install`"}'
      expect(detectContentType(jsonWithBackticks)).toBe('application/json')
    })
  })

  describe('diff detection', () => {
    it('detects unified diff with --- header', () => {
      const diff = '--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n-old\n+new'
      expect(detectContentType(diff)).toBe('text/x-diff')
    })

    it('detects diff with +++ and @@ patterns', () => {
      const diff = '+++ new/file\n@@ -0,0 +1,5 @@\n+line1\n+line2'
      expect(detectContentType(diff)).toBe('text/x-diff')
    })

    it('detects git diff output', () => {
      const diff = 'diff --git a/file.ts b/file.ts\nindex 123..456 100644\n--- a/file.ts\n+++ b/file.ts'
      expect(detectContentType(diff)).toBe('text/x-diff')
    })

    it('returns text/plain for non-diff with single ---', () => {
      // Conservative: single --- without proper diff structure is not a diff
      expect(detectContentType('--- just a separator')).toBe('text/plain')
    })
  })

  describe('shell output detection', () => {
    it('detects shell command with $ prompt', () => {
      const shell = '$ npm install\nadded 50 packages'
      expect(detectContentType(shell)).toBe('text/x-shell')
    })

    it('detects shell command with # root prompt', () => {
      const shell = '# apt-get update\nReading package lists...'
      expect(detectContentType(shell)).toBe('text/x-shell')
    })

    it('detects common commands at line start', () => {
      expect(detectContentType('npm install --save-dev typescript')).toBe('text/x-shell')
      expect(detectContentType('git status\nOn branch main')).toBe('text/x-shell')
      expect(detectContentType('docker ps\nCONTAINER ID')).toBe('text/x-shell')
    })

    it('returns text/plain for content starting with # but not shell', () => {
      // Conservative: markdown heading should not be shell
      expect(detectContentType('# Heading')).toBe('text/markdown')
    })

    it('detects stack trace as plain text', () => {
      // Stack traces should be plain text, not shell
      const stackTrace = 'Error: Something went wrong\n    at Object.<anonymous> (test.js:1:1)\n    at Module._compile (internal/modules/cjs/loader.js:1063:30)'
      expect(detectContentType(stackTrace)).toBe('text/plain')
    })
  })

  describe('markdown detection', () => {
    it('detects markdown heading', () => {
      expect(detectContentType('# Title\n\nParagraph')).toBe('text/markdown')
    })

    it('detects markdown list', () => {
      expect(detectContentType('- Item 1\n- Item 2\n- Item 3')).toBe('text/markdown')
    })

    it('detects markdown code fence', () => {
      expect(detectContentType('```javascript\nconst x = 1\n```')).toBe('text/markdown')
    })

    it('detects markdown with links', () => {
      expect(detectContentType('[Link](https://example.com)')).toBe('text/markdown')
    })

    it('detects markdown with bold/italic', () => {
      expect(detectContentType('This is **bold** and *italic*')).toBe('text/markdown')
    })

    it('returns text/plain for ambiguous content', () => {
      // Conservative: short text without clear markers is plain text
      expect(detectContentType('Just some plain text')).toBe('text/plain')
    })
  })

  describe('conservative fallback', () => {
    it('returns text/plain for unknown content types', () => {
      expect(detectContentType('Unknown format')).toBe('text/plain')
    })

    it('returns text/plain for empty content', () => {
      expect(detectContentType('')).toBe('text/plain')
    })

    it('returns text/plain for whitespace-only content', () => {
      expect(detectContentType('   \n\t  ')).toBe('text/plain')
    })

    it('prefers JSON over shell when both patterns match', () => {
      // JSON wins over shell because it's more specific
      const jsonWithDollar = '{"price": "$100"}'
      expect(detectContentType(jsonWithDollar)).toBe('application/json')
    })

    it('returns text/plain for numbers', () => {
      expect(detectContentType('42')).toBe('text/plain')
      expect(detectContentType('3.14159')).toBe('text/plain')
    })

    it('returns text/plain for single words', () => {
      expect(detectContentType('success')).toBe('text/plain')
    })
  })

  describe('edge cases', () => {
    it('handles very long content', () => {
      const longContent = 'line\n'.repeat(1000)
      expect(detectContentType(longContent)).toBe('text/plain')
    })

    it('handles content with mixed line endings', () => {
      const mixed = 'line1\nline2\r\nline3'
      expect(detectContentType(mixed)).toBe('text/plain')
    })

    it('handles null metadata gracefully', () => {
      expect(detectContentType('{"key": "value"}', null as any)).toBe('application/json')
    })

    it('handles undefined metadata gracefully', () => {
      expect(detectContentType('{"key": "value"}', undefined)).toBe('application/json')
    })

    it('handles metadata without contentType', () => {
      expect(detectContentType('{"key": "value"}', { otherField: 'value' } as any)).toBe('application/json')
    })
  })
})
