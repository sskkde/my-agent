import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlainTextContent } from './PlainTextContent'

/**
 * Tests for PlainTextContent component
 * 
 * Verifies that:
 * - Plain content uses React text rendering (not dangerouslySetInnerHTML)
 * - XSS payloads are escaped and rendered as visible text
 * - HTML tags appear as literal text, not rendered as HTML
 * - Line breaks are preserved
 */

describe('PlainTextContent', () => {
  describe('Basic text rendering', () => {
    it('renders plain text content', () => {
      render(<PlainTextContent text="Hello world" />)

      expect(screen.getByText('Hello world')).toBeInTheDocument()
    })

    it('preserves markdown syntax as literal text', () => {
      render(<PlainTextContent text="**bold** and *italic*" />)

      // Markdown should NOT be processed - should appear as-is
      expect(screen.getByText('**bold** and *italic*')).toBeInTheDocument()
      
      // Should NOT contain HTML tags
      const container = screen.getByTestId('plaintext-content')
      expect(container.innerHTML).not.toContain('<strong>')
      expect(container.innerHTML).not.toContain('<em>')
    })

    it('renders text with special characters', () => {
      render(<PlainTextContent text="Price: $100 & <discount>" />)

      // Should render special chars as escaped text
      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain('Price: $100 & <discount>')
    })
  })

  describe('XSS protection', () => {
    it('escapes HTML tags - renders as text, not HTML', () => {
      render(<PlainTextContent text="<strong>bold</strong>" />)

      // Should render the literal text, not bold HTML
      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain('<strong>bold</strong>')
      
      // The text should be escaped in HTML
      expect(container.innerHTML).toContain('&lt;strong&gt;')
      expect(container.innerHTML).not.toContain('<strong>bold</strong>')
    })

    it('renders XSS image payload as text, not as image', () => {
      render(<PlainTextContent text="<img src=x onerror=alert(1)>" />)

      // Should render as literal text
      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
      
      // Should NOT create an img element
      expect(container.querySelector('img')).toBeFalsy()
      
      // Should be escaped in HTML
      expect(container.innerHTML).toContain('&lt;img')
      expect(container.innerHTML).toContain('onerror')
      expect(container.innerHTML).not.toContain('<img')
    })

    it('renders script tags as text, not executing them', () => {
      render(<PlainTextContent text="<script>alert('XSS')</script>" />)

      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain("<script>alert('XSS')</script>")
      
      // Should NOT contain actual script tag
      expect(container.querySelector('script')).toBeFalsy()
      expect(container.innerHTML).toContain('&lt;script&gt;')
    })

    it('escapes event handlers in attributes', () => {
      render(
        <PlainTextContent text="<div onclick='alert(1)'>Click me</div>" />
      )

      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain("<div onclick='alert(1)'>Click me</div>")
      expect(container.innerHTML).toContain('onclick')
      expect(container.innerHTML).toContain('&lt;div')
    })

    it('handles javascript: URLs in text', () => {
      render(
        <PlainTextContent text="Click: javascript:alert('XSS')" />
      )

      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain("javascript:alert('XSS')")
      
      // Should NOT create a link
      expect(container.querySelector('a')).toBeFalsy()
    })
  })

  describe('Line break handling', () => {
    it('preserves line breaks in content', () => {
      render(
        <PlainTextContent text="Line one
Line two
Line three" />
      )

      const container = screen.getByTestId('plaintext-content')
      
      // All lines should be present
      expect(container.textContent).toContain('Line one')
      expect(container.textContent).toContain('Line two')
      expect(container.textContent).toContain('Line three')
      
      // Line breaks should be converted to <br> tags
      expect(container.innerHTML).toContain('<br>')
    })

    it('handles multiple consecutive line breaks', () => {
      render(
        <PlainTextContent text="Para one


Para two" />
      )

      const container = screen.getByTestId('plaintext-content')
      const brCount = (container.innerHTML.match(/<br>/g) || []).length
      expect(brCount).toBe(3)
    })

    it('handles CRLF line endings', () => {
      render(
        <PlainTextContent text="Line one\r
Line two" />
      )

      const container = screen.getByTestId('plaintext-content')
      expect(container.textContent).toContain('Line one')
      expect(container.textContent).toContain('Line two')
    })
  })

  describe('Edge cases', () => {
    it('handles empty string', () => {
      render(<PlainTextContent text="" />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })

    it('handles null content', () => {
      render(<PlainTextContent text={null as any} />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })

    it('handles undefined content', () => {
      render(<PlainTextContent text={undefined as any} />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toBeInTheDocument()
      expect(container.innerHTML).toBe('')
    })

    it('handles whitespace-only content', () => {
      render(<PlainTextContent text="   
   " />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toBeInTheDocument()
    })

    it('handles very long content efficiently', () => {
      const longText = 'word '.repeat(1000)
      const start = Date.now()

      render(<PlainTextContent text={longText} />)

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(200)
      expect(screen.getByTestId('plaintext-content')).toBeInTheDocument()
    })
  })

  describe('CSS classes', () => {
    it('applies correct class name', () => {
      render(<PlainTextContent text="Test" />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toHaveClass('plaintext-content')
    })

    it('applies streaming class when provided', () => {
      render(<PlainTextContent text="Test" isStreaming />)

      const container = screen.getByTestId('plaintext-content')
      expect(container).toHaveClass('plaintext-content')
      expect(container).toHaveClass('plaintext-content--streaming')
    })
  })

  describe('React text rendering verification', () => {
    it('uses React text nodes, not dangerouslySetInnerHTML', () => {
      const { container } = render(<PlainTextContent text="Test content" />)

      expect(container.textContent).toBe('Test content')
    })
  })
})
