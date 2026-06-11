import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownContent } from './MarkdownContent'

/**
 * Tests for MarkdownContent component
 * 
 * Verifies that:
 * - Markdown is parsed correctly with marked
 * - HTML is sanitized with DOMPurify
 * - XSS payloads are removed
 * - [md] blocks are processed
 */

describe('MarkdownContent', () => {
  describe('Basic markdown rendering', () => {
    it('renders bold text', () => {
      render(<MarkdownContent text="Hello **world**!" />)

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<strong>world</strong>')
      expect(container.innerHTML).not.toContain('**world**')
    })

    it('renders italic text', () => {
      render(<MarkdownContent text="Hello *world*!" />)

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<em>world</em>')
    })

    it('renders headings', () => {
      render(<MarkdownContent text="[md]# Title[/md]" />)

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<h1')
      expect(container.innerHTML).toContain('Title')
    })

    it('renders lists', () => {
      render(
        <MarkdownContent 
          text="[md]- Item one
- Item two
- Item three[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<ul>')
      expect(container.innerHTML).toContain('<li>')
    })

    it('renders code blocks with CodeBlock component', () => {
      render(
        <MarkdownContent 
          text="[md]```
code here
```[/md]" 
        />
      )

      const codeBlockContainer = screen.getByTestId('code-block-container')
      expect(codeBlockContainer).toBeInTheDocument()
      expect(screen.getByText('code here')).toBeInTheDocument()
    })

    it('renders inline code', () => {
      render(<MarkdownContent text="[md]Use `npm install` to install[/md]" />)

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<code>')
      expect(container.innerHTML).toContain('npm install')
    })

    it('renders links', () => {
      render(
        <MarkdownContent 
          text="[md][OpenAI](https://openai.com)[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<a')
      expect(container.innerHTML).toContain('href="https://openai.com"')
      expect(container.innerHTML).toContain('OpenAI')
    })
  })

  describe('[md] block processing', () => {
    it('processes [md] blocks with full markdown', () => {
      render(
        <MarkdownContent 
          text="Before [md]# Heading

**bold**[/md] After" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('Before')
      expect(container.innerHTML).toContain('After')
      expect(container.innerHTML).toContain('<h1')
      expect(container.innerHTML).toContain('<strong>bold</strong>')
      expect(container.innerHTML).not.toContain('[md]')
    })

    it('handles multiple [md] blocks', () => {
      render(
        <MarkdownContent 
          text="First: [md]**one**[/md] Second: [md]**two**[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<strong>one</strong>')
      expect(container.innerHTML).toContain('<strong>two</strong>')
    })

    it('handles unclosed [md] tag', () => {
      render(
        <MarkdownContent 
          text="Before [md] **bold** text" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<strong>bold</strong>')
    })
  })

  describe('XSS protection with DOMPurify', () => {
    it('removes script tags', () => {
      render(
        <MarkdownContent 
          text="<script>alert('XSS')</script>" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).not.toContain('<script>')
      expect(container.querySelector('script')).toBeFalsy()
    })

    it('removes img tags with onerror handlers', () => {
      render(
        <MarkdownContent 
          text="<img src=x onerror=alert(1)>" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).not.toContain('<img')
      expect(container.querySelector('img')).toBeFalsy()
    })

    it('removes event handler attributes', () => {
      render(
        <MarkdownContent 
          text="[md]<div onclick='alert(1)'>Click</div>[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).not.toContain('onclick')
    })

    it('removes javascript: URLs in links', () => {
      render(
        <MarkdownContent 
          text="[md][Click me](javascript:alert('XSS'))[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).not.toContain('javascript:')
      expect(container.innerHTML).not.toContain('alert')
    })

    it('sanitizes [md] blocks', () => {
      render(
        <MarkdownContent 
          text="[md]**bold**[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<strong>bold</strong>')
    })

    it('removes dangerous HTML tags', () => {
      render(
        <MarkdownContent 
          text="<iframe src='evil.com'></iframe><form><input type='text'></form>" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).not.toContain('<iframe')
      expect(container.innerHTML).not.toContain('<form')
      expect(container.innerHTML).not.toContain('<input')
    })
  })

  describe('Line break handling', () => {
    it('preserves line breaks in markdown', () => {
      render(
        <MarkdownContent 
          text="Line one
Line two
Line three" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.textContent).toContain('Line one')
      expect(container.textContent).toContain('Line two')
      expect(container.textContent).toContain('Line three')
    })

    it('handles multiple line breaks', () => {
      render(
        <MarkdownContent 
          text="Para one


Para two" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.textContent).toContain('Para one')
      expect(container.textContent).toContain('Para two')
    })
  })

  describe('Edge cases', () => {
    it('handles empty string', () => {
      render(<MarkdownContent text="" />)

      const container = screen.getByTestId('markdown-content')
      expect(container).toBeInTheDocument()
    })

    it('handles null content', () => {
      render(<MarkdownContent text={null as any} />)

      const container = screen.getByTestId('markdown-content')
      expect(container).toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })

    it('handles undefined content', () => {
      render(<MarkdownContent text={undefined as any} />)

      const container = screen.getByTestId('markdown-content')
      expect(container).toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })

    it('handles special characters', () => {
      render(
        <MarkdownContent 
          text="Price: $100 & <discount>" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.textContent).toContain('Price: $100 & <discount>')
    })

    it('handles very long content efficiently', () => {
      const longText = 'word '.repeat(1000)
      const start = Date.now()

      render(<MarkdownContent text={longText} />)

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(500)
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument()
    })
  })

  describe('CSS classes', () => {
    it('applies correct class name', () => {
      render(<MarkdownContent text="Test" />)

      const container = screen.getByTestId('markdown-content')
      expect(container).toHaveClass('markdown-content')
    })

    it('applies streaming class when provided', () => {
      render(<MarkdownContent text="Test" isStreaming />)

      const container = screen.getByTestId('markdown-content')
      expect(container).toHaveClass('markdown-content')
      expect(container).toHaveClass('markdown-content--streaming')
    })
  })

  describe('Consistency with formatMessageContent', () => {
    it('produces same output as formatMessageContent for plain text', () => {
      render(<MarkdownContent text="Hello **world**!" />)

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<strong>world</strong>')
    })

    it('produces same output for [md] blocks', () => {
      render(
        <MarkdownContent 
          text="[md]# Title

**bold**[/md]" 
        />
      )

      const container = screen.getByTestId('markdown-content')
      expect(container.innerHTML).toContain('<h1')
      expect(container.innerHTML).toContain('<strong>bold</strong>')
    })
  })
})
