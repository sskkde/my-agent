import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamingMarkdownContent } from './StreamingMarkdownContent'

/**
 * Tests for StreamingMarkdownContent component
 *
 * Verifies that streaming markdown content is rendered safely:
 * - Incomplete fenced code blocks render without crashing
 * - Incomplete links don't create unsafe clickable anchors
 * - Streaming cursor is displayed
 * - XSS payloads are sanitized
 * - Complete markdown renders normally
 */

describe('StreamingMarkdownContent', () => {
  describe('incomplete fenced code blocks', () => {
    it('renders incomplete code block without throwing', () => {
      const text = '```ts\nconst a ='
      expect(() => {
        render(<StreamingMarkdownContent text={text} isStreaming />)
      }).not.toThrow()
    })

    it('renders incomplete code block with visible code text', () => {
      const text = '```ts\nconst a ='
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.textContent).toContain('const a =')
    })

    it('renders incomplete code block without unsafe HTML', () => {
      const text = '```ts\nconst a ='
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      // Should not contain raw script tags or event handlers
      expect(container.innerHTML).not.toContain('<script')
      expect(container.innerHTML).not.toContain('onerror')
      expect(container.innerHTML).not.toContain('onclick')
    })

    it('renders complete code block normally', () => {
      const text = '[md]```ts\nconst a = 1\n```[/md]'
      render(<StreamingMarkdownContent text={text} isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.innerHTML).toContain('<pre>')
      expect(container.innerHTML).toContain('<code')
      expect(container.innerHTML).toContain('const a = 1')
    })
  })

  describe('incomplete links', () => {
    it('renders incomplete link without broken unsafe anchor', () => {
      const text = '[OpenAI](https://example'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      // Should NOT have a clickable link with the incomplete URL
      const links = container.querySelectorAll('a')
      links.forEach(link => {
        expect(link.getAttribute('href')).not.toBe('https://example')
      })
    })

    it('renders incomplete link as visible text', () => {
      const text = '[OpenAI](https://example'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      // The text content should still be visible
      expect(container.textContent).toContain('OpenAI')
    })

    it('renders complete link normally', () => {
      const text = '[md][OpenAI](https://openai.com)[/md]'
      render(<StreamingMarkdownContent text={text} isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      const link = container.querySelector('a')
      expect(link).toBeTruthy()
      expect(link?.getAttribute('href')).toBe('https://openai.com')
    })
  })

  describe('streaming cursor', () => {
    it('displays streaming cursor when isStreaming is true', () => {
      render(<StreamingMarkdownContent text="Hello" isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      const cursor = container.querySelector('.streaming-cursor')
      expect(cursor).toBeTruthy()
    })

    it('does not display streaming cursor when isStreaming is false', () => {
      render(<StreamingMarkdownContent text="Hello" isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      const cursor = container.querySelector('.streaming-cursor')
      expect(cursor).toBeFalsy()
    })

    it('displays streaming cursor with empty text', () => {
      render(<StreamingMarkdownContent text="" isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      const cursor = container.querySelector('.streaming-cursor')
      expect(cursor).toBeTruthy()
    })
  })

  describe('XSS protection', () => {
    it('sanitizes script tags during streaming', () => {
      const text = '<script>alert("xss")</script>Hello'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.querySelector('script')).toBeFalsy()
      expect(container.innerHTML).not.toContain('<script')
    })

    it('sanitizes img onerror during streaming', () => {
      const text = '<img src=x onerror=alert(1)>Hello'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.querySelector('img')).toBeFalsy()
    })

    it('sanitizes javascript: URLs in links', () => {
      const text = '[md][Click](javascript:alert(1))[/md]'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.innerHTML).not.toContain('javascript:')
    })

    it('sanitizes event handler attributes', () => {
      const text = '[md]<div onclick="alert(1)">Click</div>[/md]'
      render(<StreamingMarkdownContent text={text} isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.innerHTML).not.toContain('onclick')
    })
  })

  describe('empty/null content', () => {
    it('renders empty container for empty string', () => {
      render(<StreamingMarkdownContent text="" isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container).toBeInTheDocument()
    })

    it('renders empty container for null', () => {
      render(<StreamingMarkdownContent text={null as any} isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container).toBeInTheDocument()
    })

    it('renders empty container for undefined', () => {
      render(<StreamingMarkdownContent text={undefined as any} isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container).toBeInTheDocument()
    })
  })

  describe('CSS classes', () => {
    it('applies streaming class when isStreaming', () => {
      render(<StreamingMarkdownContent text="Test" isStreaming />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container).toHaveClass('streaming-markdown-content')
      expect(container).toHaveClass('streaming-markdown-content--streaming')
    })

    it('does not apply streaming class when not streaming', () => {
      render(<StreamingMarkdownContent text="Test" isStreaming={false} />)

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container).toHaveClass('streaming-markdown-content')
      expect(container).not.toHaveClass('streaming-markdown-content--streaming')
    })
  })

  describe('performance', () => {
    it('handles large streaming content without hanging', () => {
      const largeText = 'word '.repeat(5000) + '```ts\nconst a ='
      const start = Date.now()

      render(<StreamingMarkdownContent text={largeText} isStreaming />)

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('combined incomplete patterns', () => {
    it('handles text with incomplete code block and incomplete link', () => {
      const text = 'Check [this](https://example\n\n```ts\nconst a ='
      expect(() => {
        render(<StreamingMarkdownContent text={text} isStreaming />)
      }).not.toThrow()

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.textContent).toContain('const a =')
    })

    it('handles incremental streaming updates', () => {
      const { rerender } = render(
        <StreamingMarkdownContent text="Hello" isStreaming />
      )

      const container = screen.getByTestId('streaming-markdown-content')
      expect(container.textContent).toContain('Hello')

      rerender(<StreamingMarkdownContent text="Hello world" isStreaming />)
      expect(container.textContent).toContain('Hello world')

      rerender(<StreamingMarkdownContent text="Hello world ```ts\nconst a =" isStreaming />)
      expect(container.textContent).toContain('const a =')
    })
  })
})
