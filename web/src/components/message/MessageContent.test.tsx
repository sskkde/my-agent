import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageContent } from './MessageContent'

/**
 * Tests for MessageContent component - role/mode dispatcher
 * 
 * Verifies that:
 * - MessageContent dispatches to correct subcomponent based on role
 * - Static vs streaming mode behavior
 * - contentType and allowMarkdown props work correctly
 */

describe('MessageContent - Role/Mode Dispatcher', () => {
  describe('Role-based dispatching', () => {
    it('renders assistant role content with MarkdownContent by default', () => {
      render(
        <MessageContent 
          text="Hello **world**!" 
          role="assistant" 
          mode="static" 
        />
      )

      // Should render bold text (markdown processed)
      const element = screen.getByTestId('message-content-assistant')
      expect(element.innerHTML).toContain('<strong>world</strong>')
      expect(element.innerHTML).not.toContain('**world**')
    })

    it('renders assistant content with full markdown (heading, list, code) with [md] tags', () => {
      render(
        <MessageContent
          text={`[md]## 结论

1. 第一项

\`\`\`ts
const a = 1
\`\`\`[/md]`}
          role="assistant"
          mode="static"
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      // Should render heading
      expect(element.innerHTML).toContain('<h2>')
      expect(element.innerHTML).toContain('结论')
      // Should render ordered list
      expect(element.innerHTML).toContain('<ol>')
      expect(element.innerHTML).toContain('<li>')
      expect(element.innerHTML).toContain('第一项')
      // Should render code block with CodeBlock component
      const codeBlockContainer = screen.getByTestId('code-block-container')
      expect(codeBlockContainer).toBeInTheDocument()
      // Should contain language label
      expect(screen.getByTestId('code-language-label')).toHaveTextContent('ts')
      // Should NOT contain raw [md] tags
      expect(element.innerHTML).not.toContain('[md]')
    })

    it('renders user role content with PlainTextContent by default', () => {
      render(
        <MessageContent 
          text="Hello **world**!" 
          role="user" 
          mode="static" 
        />
      )

      // Should render as plain text (no markdown)
      const element = screen.getByTestId('message-content-user')
      expect(element.innerHTML).toContain('**world**')
      expect(element.innerHTML).not.toContain('<strong>world</strong>')
    })

    it('escapes XSS in user messages - renders as plain text', () => {
      render(
        <MessageContent
          text="<img src=x onerror=alert(1)>"
          role="user"
          mode="static"
        />
      )

      const element = screen.getByTestId('message-content-user')
      // Should display as escaped text, not render as HTML
      expect(element.innerHTML).toContain('&lt;img')
      expect(element.innerHTML).not.toContain('<img src')
      // Verify no actual img element in DOM
      expect(element.querySelector('img')).toBeNull()
    })

    it('renders system role content with PlainTextContent', () => {
      render(
        <MessageContent 
          text="System message **bold**" 
          role="system" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-system')
      expect(element.innerHTML).toContain('**bold**')
      expect(element.innerHTML).not.toContain('<strong>bold</strong>')
    })

    it('renders error role content with PlainTextContent', () => {
      render(
        <MessageContent 
          text="Error: **Failed**" 
          role="error" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-error')
      expect(element.innerHTML).toContain('**Failed**')
      expect(element.innerHTML).not.toContain('<strong>Failed</strong>')
    })
  })

  describe('Mode-based behavior', () => {
    it('renders static mode content without streaming cursor', () => {
      render(
        <MessageContent 
          text="Static content" 
          role="assistant" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element.innerHTML).not.toContain('streaming-cursor')
    })

    it('renders streaming mode with streaming cursor for assistant', () => {
      render(
        <MessageContent 
          text="Streaming content..." 
          role="assistant" 
          mode="streaming" 
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element.querySelector('.streaming-cursor')).toBeTruthy()
    })

    it('renders streaming mode without cursor for user/system/error', () => {
      const { unmount } = render(
        <MessageContent 
          text="User content" 
          role="user" 
          mode="streaming" 
        />
      )

      let element = screen.getByTestId('message-content-user')
      expect(element.querySelector('.streaming-cursor')).toBeFalsy()

      unmount()

      render(
        <MessageContent 
          text="System content" 
          role="system" 
          mode="streaming" 
        />
      )

      element = screen.getByTestId('message-content-system')
      expect(element.querySelector('.streaming-cursor')).toBeFalsy()
    })
  })

  describe('contentType prop', () => {
    it('forces markdown rendering when contentType="markdown"', () => {
      render(
        <MessageContent 
          text="[md]# Title

**bold**[/md]" 
          role="user" 
          mode="static"
          contentType="markdown"
        />
      )

      const element = screen.getByTestId('message-content-user')
      expect(element.innerHTML).toContain('<h1>')
      expect(element.innerHTML).toContain('<strong>bold</strong>')
    })

    it('forces plain text when contentType="text"', () => {
      render(
        <MessageContent 
          text="**bold** and *italic*" 
          role="assistant" 
          mode="static"
          contentType="text"
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element.innerHTML).toContain('**bold**')
      expect(element.innerHTML).toContain('*italic*')
    })
  })

  describe('allowMarkdown prop', () => {
    it('respects allowMarkdown=true for user role', () => {
      render(
        <MessageContent 
          text="Hello **world**!" 
          role="user" 
          mode="static"
          allowMarkdown={true}
        />
      )

      const element = screen.getByTestId('message-content-user')
      expect(element.innerHTML).toContain('<strong>world</strong>')
    })

    it('respects allowMarkdown=false for assistant role', () => {
      render(
        <MessageContent 
          text="Hello **world**!" 
          role="assistant" 
          mode="static"
          allowMarkdown={false}
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element.innerHTML).toContain('**world**')
      expect(element.innerHTML).not.toContain('<strong>world</strong>')
    })

    it('contentType takes precedence over allowMarkdown', () => {
      render(
        <MessageContent 
          text="**bold**" 
          role="assistant" 
          mode="static"
          contentType="text"
          allowMarkdown={true}
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element.innerHTML).toContain('**bold**')
      expect(element.innerHTML).not.toContain('<strong>bold</strong>')
    })
  })

  describe('Edge cases', () => {
    it('handles empty string content', () => {
      render(
        <MessageContent 
          text="" 
          role="assistant" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element).toBeInTheDocument()
    })

    it('handles null content', () => {
      render(
        <MessageContent 
          text={null as any} 
          role="assistant" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element).toBeInTheDocument()
    })

    it('handles undefined content', () => {
      render(
        <MessageContent 
          text={undefined as any} 
          role="assistant" 
          mode="static" 
        />
      )

      const element = screen.getByTestId('message-content-assistant')
      expect(element).toBeInTheDocument()
    })

    it('handles long content efficiently', () => {
      const longContent = 'word '.repeat(1000)
      const start = Date.now()
      
      render(
        <MessageContent 
          text={longContent} 
          role="assistant" 
          mode="static" 
        />
      )

      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(500)
      expect(screen.getByTestId('message-content-assistant')).toBeInTheDocument()
    })
  })

  describe('CSS classes', () => {
    it('applies role-specific class names', () => {
      const roles: Array<'assistant' | 'user' | 'system' | 'error'> = 
        ['assistant', 'user', 'system', 'error']

      roles.forEach(role => {
        const { unmount } = render(
          <MessageContent 
            text="Test" 
            role={role} 
            mode="static" 
          />
        )

        const element = screen.getByTestId(`message-content-${role}`)
        expect(element).toHaveClass(`message-content--${role}`)
        expect(element).toHaveClass('message-content')
        
        unmount()
      })
    })

    it('applies mode-specific class names', () => {
      const { unmount } = render(
        <MessageContent 
          text="Test" 
          role="assistant" 
          mode="streaming" 
        />
      )

      let element = screen.getByTestId('message-content-assistant')
      expect(element).toHaveClass('message-content--streaming')

      unmount()

      render(
        <MessageContent 
          text="Test" 
          role="assistant" 
          mode="static" 
        />
      )

      element = screen.getByTestId('message-content-assistant')
      expect(element).toHaveClass('message-content--static')
    })
  })
})
