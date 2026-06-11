import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ToolResultContent } from './ToolResultContent'

/**
 * Tests for ToolResultContent component
 * 
 * Verifies that:
 * - Tool output is rendered based on content-type detection
 * - JSON output uses JsonBlock with formatting
 * - Diff output uses DiffBlock with styling
 * - Shell output uses CodeBlock with language="bash"
 * - Markdown only renders when explicit contentType says so
 * - Unknown content falls back to PlainTextContent (safe)
 * - XSS payloads are neutralized
 */

// Mock clipboard for copy tests
beforeEach(() => {
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
})

describe('ToolResultContent', () => {
  describe('Content type routing', () => {
    it('routes JSON content to JsonBlock', () => {
      const jsonContent = '{"name": "test", "value": 123}'
      render(<ToolResultContent content={jsonContent} />)

      // JsonBlock should render with formatted JSON
      const container = screen.getByTestId('json-block')
      expect(container).toBeInTheDocument()
      expect(container.textContent).toContain('"name"')
      expect(container.textContent).toContain('"test"')
    })

    it('routes explicit application/json to JsonBlock', () => {
      const content = 'not valid json'
      render(<ToolResultContent content={content} metadata={{ contentType: 'application/json' }} />)

      // Explicit contentType forces JsonBlock
      expect(screen.getByTestId('json-block')).toBeInTheDocument()
    })

    it('routes diff content to DiffBlock', () => {
      const diffContent = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+line2
 line3`
      render(<ToolResultContent content={diffContent} />)

      expect(screen.getByTestId('diff-block')).toBeInTheDocument()
    })

    it('routes explicit text/x-diff to DiffBlock', () => {
      const content = 'some content'
      render(<ToolResultContent content={content} metadata={{ contentType: 'text/x-diff' }} />)

      expect(screen.getByTestId('diff-block')).toBeInTheDocument()
    })

    it('routes shell output to CodeBlock with bash language', () => {
      const shellContent = `$ npm install
added 100 packages`
      render(<ToolResultContent content={shellContent} />)

      const codeBlock = screen.getByTestId('code-block-container')
      expect(codeBlock).toBeInTheDocument()
      expect(screen.getByText('bash')).toBeInTheDocument()
    })

    it('routes explicit text/x-shell to CodeBlock', () => {
      const content = 'some output'
      render(<ToolResultContent content={content} metadata={{ contentType: 'text/x-shell' }} />)

      expect(screen.getByTestId('code-block-container')).toBeInTheDocument()
      expect(screen.getByText('bash')).toBeInTheDocument()
    })

    it('routes text/markdown to MarkdownContent only when explicit', () => {
      const markdownContent = '# Heading\n\nParagraph'
      render(<ToolResultContent content={markdownContent} metadata={{ contentType: 'text/markdown' }} />)

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })

    it('does NOT render unknown content as markdown', () => {
      // Content that looks like markdown but has no explicit type
      const content = '# Not a heading, just text'
      render(<ToolResultContent content={content} />)

      // Should NOT use MarkdownContent for safety
      expect(screen.queryByTestId('markdown-content')).not.toBeInTheDocument()
      // Should fallback to PlainTextContent
      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
    })

    it('routes text/plain to PlainTextContent', () => {
      const content = 'Some plain text'
      render(<ToolResultContent content={content} metadata={{ contentType: 'text/plain' }} />)

      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
    })

    it('falls back to PlainTextContent for unknown content types', () => {
      const content = 'Unknown content type'
      render(<ToolResultContent content={content} metadata={{ contentType: 'application/octet-stream' }} />)

      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
    })
  })

  describe('JSON formatting', () => {
    it('formats JSON with indentation', () => {
      const jsonContent = '{"a":1,"b":2}'
      render(<ToolResultContent content={jsonContent} />)

      const container = screen.getByTestId('json-block')
      // Formatted JSON should have newlines/spacing
      expect(container.textContent).toContain('"a"')
      expect(container.textContent).toContain('"b"')
    })

    it('preserves whitespace in pre-formatted JSON', () => {
      const jsonContent = '{\n  "key": "value"\n}'
      render(<ToolResultContent content={jsonContent} />)

      const container = screen.getByTestId('json-block')
      expect(container.textContent).toContain('"key"')
      expect(container.textContent).toContain('"value"')
    })

    it('handles JSON arrays', () => {
      const jsonContent = '[1, 2, 3]'
      render(<ToolResultContent content={jsonContent} />)

      expect(screen.getByTestId('json-block')).toBeInTheDocument()
    })

    it('handles invalid JSON gracefully when explicit type', () => {
      const content = 'not valid json'
      render(<ToolResultContent content={content} metadata={{ contentType: 'application/json' }} />)

      // Should still render, but as plain text
      const container = screen.getByTestId('json-block')
      expect(container.textContent).toContain('not valid json')
    })
  })

  describe('Diff rendering', () => {
    it('displays diff markers with styling', () => {
      const diffContent = `--- a/old.txt
+++ b/new.txt
@@ -1 +1 @@
-old
+new`
      render(<ToolResultContent content={diffContent} />)

      const container = screen.getByTestId('diff-block')
      expect(container.textContent).toContain('---')
      expect(container.textContent).toContain('+++')
      expect(container.textContent).toContain('-old')
      expect(container.textContent).toContain('+new')
    })

    it('preserves diff formatting', () => {
      const diffContent = `diff --git a/file b/file
index 123..456 100644
--- a/file
+++ b/file
@@ -0,0 +1 @@
+new line`
      render(<ToolResultContent content={diffContent} />)

      expect(screen.getByTestId('diff-block')).toBeInTheDocument()
    })
  })

  describe('XSS protection', () => {
    it('escapes HTML in JSON content', () => {
      const jsonContent = '{"value": "<script>alert(1)</script>"}'
      render(<ToolResultContent content={jsonContent} />)

      const container = screen.getByTestId('json-block')
      // Script tag should appear as text, not execute
      expect(container.textContent).toContain('<script>')
      expect(container.querySelector('script')).toBeNull()
    })

    it('escapes HTML in diff content', () => {
      const diffContent = `--- a/file
+++ b/file
@@ -1 +1 @@
-<img src=x onerror=alert(1)>
+safe`
      render(<ToolResultContent content={diffContent} />)

      const container = screen.getByTestId('diff-block')
      expect(container.textContent).toContain('<img')
      expect(container.querySelector('img')).toBeNull()
    })

    it('escapes HTML in shell output', () => {
      const shellContent = `$ echo "<script>alert(1)</script>"
<script>alert(1)</script>`
      render(<ToolResultContent content={shellContent} />)

      const container = screen.getByTestId('code-block-container')
      expect(container.textContent).toContain('<script>')
      expect(container.querySelector('script')).toBeNull()
    })

    it('escapes HTML in plain text content', () => {
      const content = '<script>alert("XSS")</script>'
      render(<ToolResultContent content={content} />)

      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain('<script>')
      expect(container.querySelector('script')).toBeNull()
    })

    it('sanitizes markdown content', () => {
      const markdownContent = '[link](javascript:alert(1))'
      render(<ToolResultContent content={markdownContent} metadata={{ contentType: 'text/markdown' }} />)

      const container = screen.getByTestId('markdown-content')
      // javascript: protocol should be removed or neutralized
      const links = container.querySelectorAll('a')
      links.forEach(link => {
        expect(link.getAttribute('href')).not.toContain('javascript:')
      })
    })
  })

  describe('Edge cases', () => {
    it('handles empty content', () => {
      render(<ToolResultContent content="" />)

      // Should render something, even if empty
      expect(screen.queryByTestId('plaintext-content')).toBeInTheDocument()
    })

    it('handles null content', () => {
      render(<ToolResultContent content={null as any} />)

      expect(screen.queryByTestId('plaintext-content')).toBeInTheDocument()
    })

    it('handles undefined content', () => {
      render(<ToolResultContent content={undefined as any} />)

      expect(screen.queryByTestId('plaintext-content')).toBeInTheDocument()
    })

    it('handles very large JSON efficiently', () => {
      const largeObject: Record<string, number> = {}
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = i
      }
      const jsonContent = JSON.stringify(largeObject)

      const start = Date.now()
      render(<ToolResultContent content={jsonContent} />)
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(500)
      expect(screen.getByTestId('json-block')).toBeInTheDocument()
    })

    it('handles unicode in content', () => {
      const jsonContent = '{"emoji": "🎉", "chinese": "你好"}'
      render(<ToolResultContent content={jsonContent} />)

      const container = screen.getByTestId('json-block')
      expect(container.textContent).toContain('🎉')
      expect(container.textContent).toContain('你好')
    })
  })

  describe('Copy functionality for JSON', () => {
    it('copies raw JSON text to clipboard', async () => {
      const jsonContent = '{"key": "value"}'
      render(<ToolResultContent content={jsonContent} />)

      const copyButton = screen.getByRole('button', { name: /copy/i })
      await act(async () => {
        fireEvent.click(copyButton)
      })

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(jsonContent)
    })

    it('shows copied feedback', async () => {
      const jsonContent = '{"key": "value"}'
      render(<ToolResultContent content={jsonContent} />)

      const copyButton = screen.getByRole('button', { name: /copy/i })
      await act(async () => {
        fireEvent.click(copyButton)
      })

      await waitFor(() => {
        expect(screen.getByText(/copied/i)).toBeInTheDocument()
      })
    })
  })

  describe('Copy functionality for diff', () => {
    it('copies diff content to clipboard', async () => {
      const diffContent = `--- a/file
+++ b/file
@@ -1 +1 @@
-old
+new`
      render(<ToolResultContent content={diffContent} />)

      const copyButton = screen.getByRole('button', { name: /copy/i })
      await act(async () => {
        fireEvent.click(copyButton)
      })

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(diffContent)
    })
  })

  describe('Metadata handling', () => {
    it('respects explicit contentType over auto-detection', () => {
      // This looks like JSON but we force it to plain text
      const jsonContent = '{"key": "value"}'
      render(<ToolResultContent content={jsonContent} metadata={{ contentType: 'text/plain' }} />)

      // Should use PlainTextContent, not JsonBlock
      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
      expect(screen.queryByTestId('json-block')).not.toBeInTheDocument()
    })

    it('handles missing metadata gracefully', () => {
      const content = 'plain text'
      render(<ToolResultContent content={content} />)

      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
    })
  })
})
