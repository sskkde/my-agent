import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { TimelineEventCard } from './TimelineEventCard'
import type { ConsoleTimelineEvent } from '../../api/types'

/**
 * Tests for TimelineEventCard integration with formatMessageContent
 *
 * Verifies that:
 * - Streaming drafts use the safe formatter
 * - Final messages use the safe formatter
 * - Raw HTML is sanitized (no XSS)
 * - Role-specific styling is maintained
 * - Markdown formatting works correctly
 */

const createEvent = (overrides: Partial<ConsoleTimelineEvent>): ConsoleTimelineEvent => ({
  eventId: 'test-event-1',
  sessionId: 'test-session',
  timestamp: '2025-06-10T10:00:00Z',
  eventType: 'assistant_message',
  actor: 'assistant',
  content: '',
  ...overrides,
})

describe('TimelineEventCard - Formatter Integration', () => {
  describe('Streaming draft rendering', () => {
    it('renders streaming draft with formatted content', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Hello **world**!',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      // Should render bold text
      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('<strong>world</strong>')
      expect(content.innerHTML).not.toContain('**world**')
    })

    it('renders streaming draft with [md] blocks', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '[md]# Title\n\nContent here[/md]',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('<h1>')
      expect(content.innerHTML).toContain('Title')
      expect(content.innerHTML).not.toContain('[md]')
    })

    it('sanitizes XSS in streaming draft', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Hello <script>alert("XSS")</script> world',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).not.toContain('<script>')
      expect(content.innerHTML).toContain('Hello')
      expect(content.innerHTML).toContain('world')
    })

    it('strips event handlers in streaming draft', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '<img src="x" onerror="alert(\'XSS\')">',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      // onerror handler should be stripped (XSS prevented)
      expect(content.innerHTML).not.toContain('onerror')
      expect(content.innerHTML).not.toContain('alert')
    })
  })

  describe('Final message rendering', () => {
    it('renders assistant message with formatted content', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Here is the solution:\n\n[md]\n## Steps\n1. First step\n2. Second step\n[/md]',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).toContain('Here is the solution')
      expect(content.innerHTML).toContain('<h2>')
      expect(content.innerHTML).toContain('Steps')
      expect(content.innerHTML).toContain('<ol>')
      expect(content.innerHTML).toContain('<li>')
    })

    it('renders assistant message with full markdown without [md] tags', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: `## 结论

1. 第一项

\`\`\`ts
const a = 1
\`\`\``,
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).toContain('<h2>')
      expect(content.innerHTML).toContain('结论')
      expect(content.innerHTML).toContain('<ol>')
      expect(content.innerHTML).toContain('<li>')
      expect(content.innerHTML).toContain('第一项')
      // Code blocks are rendered in a special code-block container
      expect(content.innerHTML).toContain('code-block')
      expect(content.innerHTML).toContain('<code')
      expect(content.innerHTML).toContain('const a = 1')
      expect(content.innerHTML).not.toContain('[md]')
    })

    it('renders user message as plain text (no markdown)', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: 'I have a **question** about _this_',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      // User messages should be plain text, no markdown formatting
      expect(content.innerHTML).toContain('**question**')
      expect(content.innerHTML).toContain('_this_')
      expect(content.innerHTML).not.toContain('<strong>')
      expect(content.innerHTML).not.toContain('<em>')
    })
    it('renders user message content directly inside the bubble without timeline content wrappers', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: 'Readable user message',
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('timeline-event-test-event-1')
      const bubble = card.querySelector('.message-group__bubble')
      expect(bubble).not.toBeNull()
      expect(bubble?.querySelector(':scope > .message-content--user')).not.toBeNull()
      expect(bubble?.querySelector(':scope > .timeline-event-content')).toBeNull()
      expect(screen.getByTestId('plaintext-content')).toHaveTextContent('Readable user message')
    })

    it('escapes XSS in user messages - renders as plain text', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: '<img src=x onerror=alert(1)>',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      // User messages should NOT render as HTML - must be escaped
      expect(content.innerHTML).toContain('&lt;img')
      expect(content.innerHTML).not.toContain('<img src')
      // Verify no actual img element in DOM
      expect(content.querySelector('img')).toBeNull()
    })

    it('sanitizes XSS in final messages', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Check this: <script>steal()</script> and <img src=x onerror=alert(1)>',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      // Script tag should be removed
      expect(content.innerHTML).not.toContain('<script>')
      // XSS onerror handler should be stripped (even if img tag is kept)
      expect(content.innerHTML).not.toContain('onerror')
      expect(content.innerHTML).toContain('Check this')
    })

    it('removes javascript: URLs in links', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: "[md][Click me](javascript:alert('XSS'))[/md]",
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).not.toContain('javascript:')
      expect(content.innerHTML).not.toContain('alert')
    })
  })

  describe('Role-specific styling', () => {
    it('applies user message styling', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: 'User message',
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('timeline-event-test-event-1')
      expect(card).toHaveClass('timeline-event-card')
      expect(card).toHaveClass('timeline-event-card--user_message')
    })

    it('applies assistant message styling', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Assistant message',
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('timeline-event-test-event-1')
      expect(card).toHaveClass('timeline-event-card')
      expect(card).toHaveClass('timeline-event-card--assistant_message')
    })

    it('applies streaming draft styling', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Streaming...',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('streaming-assistant-draft')
      expect(card).toHaveClass('timeline-event-card')
      expect(card).toHaveClass('timeline-event-card--streaming-draft')
    })

    it('applies assistant placeholder styling', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '',
        metadata: { assistantPlaceholder: true },
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('assistant-placeholder')
      expect(card).toHaveClass('timeline-event-card')
      expect(card).toHaveClass('timeline-event-card--assistant-placeholder')
    })
  })

  describe('Special event types', () => {
    it('renders thinking summary with formatted content when expanded', () => {
      const event = createEvent({
        eventType: 'thinking_summary',
        content: 'Thinking about **important** things',
      })

      render(<TimelineEventCard event={event} />)

      // Click to expand
      const toggle = screen.getByRole('button', { name: /thinking/i })
      act(() => {
        toggle.click()
      })

      // Should show formatted content
      const content = document.querySelector('.timeline-thinking-content')
      expect(content).not.toBeNull()
      expect(content?.innerHTML).toContain('<strong>important</strong>')
    })

    it('renders tool call fallback with formatted content', () => {
      const event = createEvent({
        eventType: 'tool_call',
        content: 'Tool output with **bold** text',
        // No toolName/parameters, so it falls back to code block
      })

      render(<TimelineEventCard event={event} />)

      // Code blocks render formatted HTML as escaped text (for display)
      const code = screen.getByText(/Tool output with/)
      expect(code).toBeInTheDocument()
      // The formatted content shows as escaped HTML entities in code blocks
      expect(code.innerHTML).toContain('&lt;strong&gt;')
    })

    it('renders error message as plain text (no markdown)', () => {
      const event = createEvent({
        eventType: 'error',
        content: 'Error: **Failed** to process',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      // Error messages should be plain text, no markdown formatting
      expect(content.innerHTML).toContain('**Failed**')
      expect(content.innerHTML).not.toContain('<strong>')
    })
  })

  describe('Edge cases', () => {
    it('handles empty content gracefully', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '',
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('timeline-event-test-event-1')
      expect(card).toBeInTheDocument()
    })

    it('handles null content gracefully', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: null as any,
      })

      render(<TimelineEventCard event={event} />)

      const card = screen.getByTestId('timeline-event-test-event-1')
      expect(card).toBeInTheDocument()
    })

    it('handles very long content', () => {
      const longContent = 'word '.repeat(1000)
      const event = createEvent({
        eventType: 'assistant_message',
        content: longContent,
      })

      const start = Date.now()
      render(<TimelineEventCard event={event} />)
      const elapsed = Date.now() - start

      // Should render in reasonable time
      expect(elapsed).toBeLessThan(500)
      expect(screen.getByTestId('timeline-event-test-event-1')).toBeInTheDocument()
    })

    it('preserves line breaks in plain text', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Line one\nLine two\nLine three',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).toContain('Line one')
      expect(content.innerHTML).toContain('Line two')
      expect(content.innerHTML).toContain('Line three')
    })
  })

  describe('Consistency between streaming and final', () => {
    it('renders identical content the same way in streaming and final', () => {
      const content = '**Bold** and *italic*\n\n# Heading'

      const streamingEvent = createEvent({
        eventType: 'assistant_message',
        content,
        metadata: { streamingDraft: true },
      })

      const finalEvent = createEvent({
        eventType: 'assistant_message',
        content,
      })

      const { unmount: unmountStreaming } = render(<TimelineEventCard event={streamingEvent} />)
      const streamingHtml = screen.getByTestId('streaming-assistant-draft').innerHTML

      unmountStreaming()

      render(<TimelineEventCard event={finalEvent} />)
      const finalHtml = screen.getByTestId('timeline-event-test-event-1').innerHTML

      // Both should render the same formatted content
      expect(streamingHtml).toContain('<strong>Bold</strong>')
      expect(finalHtml).toContain('<strong>Bold</strong>')
      expect(streamingHtml).toContain('<em>italic</em>')
      expect(finalHtml).toContain('<em>italic</em>')
      expect(streamingHtml).toContain('<h1>')
      expect(finalHtml).toContain('<h1>')
    })
  })

  describe('Tool result content type handling', () => {
    it('renders tool result with ToolCallCard component', () => {
      const event = createEvent({
        eventType: 'tool_result',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'file.read',
          parameters: { path: '/src/config.json' },
          result: '{"name": "test", "value": 123}',
          status: 'completed',
        },
      })

      render(<TimelineEventCard event={event} />)

      const toolCard = screen.getByTestId('tool-call-card')
      expect(toolCard).toBeInTheDocument()
      expect(screen.getAllByText('file.read')[0]).toBeInTheDocument()
    })

    it('renders tool parameters as JSON code block', () => {
      const event = createEvent({
        eventType: 'tool_call',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'exec',
          parameters: { command: 'npm test' },
          status: 'running',
        },
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { expanded: false }).click()
      })

      const codeBlocks = screen.getAllByTestId('code-block-container')
      expect(codeBlocks.length).toBeGreaterThan(0)
      expect(screen.getByText('json')).toBeInTheDocument()
    })

    it('renders tool result as bash code block', () => {
      const event = createEvent({
        eventType: 'tool_result',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'exec',
          parameters: { command: 'npm test' },
          result: '$ npm test\n\nPASS src/App.test.tsx\nTests: 5 passed',
          status: 'completed',
        },
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { expanded: false }).click()
      })

      const codeBlocks = screen.getAllByTestId('code-block-container')
      expect(codeBlocks.length).toBe(2)
      expect(screen.getByText('bash')).toBeInTheDocument()
    })

    it('renders tool result content safely (XSS protected via CodeBlock)', () => {
      const event = createEvent({
        eventType: 'tool_result',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'custom.tool',
          parameters: {},
          result: '<script>alert("xss")</script>',
          status: 'completed',
        },
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { expanded: false }).click()
      })

      const codeBlocks = screen.getAllByTestId('code-block-container')
      const resultBlock = codeBlocks[1]
      expect(resultBlock).toBeInTheDocument()
      expect(resultBlock.textContent).toContain('<script>')
    })

    it('renders tool result with diff content as bash code block', () => {
      const event = createEvent({
        eventType: 'tool_result',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'git.diff',
          parameters: { file: '/src/index.ts' },
          result: '--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,4 @@\n line1\n+line2\n line3',
          status: 'completed',
        },
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { expanded: false }).click()
      })

      const codeBlocks = screen.getAllByTestId('code-block-container')
      expect(codeBlocks.length).toBe(2)
    })
  })

  describe('Streaming incomplete Markdown handling', () => {
    it('renders streaming draft with incomplete code fence safely', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '```typescript\nconst x = 1\n',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('const x = 1')
    })

    it('renders streaming draft with incomplete bold syntax', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'This is **important but incomplete',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('important but incomplete')
    })

    it('renders streaming draft with incomplete link syntax', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Check out [this link](https://example',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('Check out')
    })

    it('renders streaming draft with mixed complete and incomplete syntax', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '**bold** and *italic* but **incomplete\n\n# Heading\n\n```js\ncode',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).toContain('bold')
      expect(content.innerHTML).toContain('italic')
      expect(content.innerHTML).toContain('Heading')
      expect(content.innerHTML).toContain('code')
    })

    it('shows streaming cursor indicator during streaming', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Processing...',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      const cursor = content.querySelector('.streaming-cursor')
      expect(cursor).toBeTruthy()
    })

    it('sanitizes XSS in streaming draft', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Hello <script>alert("XSS")</script> world',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
      expect(content.innerHTML).not.toContain('<script>')
      expect(content.innerHTML).toContain('Hello')
      expect(content.innerHTML).toContain('world')
    })
  })

  describe('Thinking summary with Markdown content', () => {
    it('renders thinking summary with [md] blocks when expanded', () => {
      const event = createEvent({
        eventType: 'thinking_summary',
        content:
          'Analysis:\n\n[md]\n## Key Points\n\n1. First point\n2. Second point\n\n```ts\nconst x = 1;\n```\n[/md]',
      })

      render(<TimelineEventCard event={event} />)

      // Click to expand
      const toggle = screen.getByRole('button', { name: /thinking/i })
      act(() => {
        toggle.click()
      })

      const content = document.querySelector('.timeline-thinking-content')
      expect(content).not.toBeNull()
      // Should render markdown features
      expect(content?.innerHTML).toContain('<h2>')
      expect(content?.innerHTML).toContain('Key Points')
      expect(content?.innerHTML).toContain('<ol>')
      expect(content?.innerHTML).toContain('<li>')
      // Code block should render with CodeBlock component
      expect(content?.innerHTML).toContain('code-block')
    })

    it('renders thinking summary without [md] blocks as full markdown (assistant role)', () => {
      const event = createEvent({
        eventType: 'thinking_summary',
        content: '## Analysis\n\nThinking about **important** decisions\n\n- Point one\n- Point two',
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { name: /thinking/i }).click()
      })

      const content = document.querySelector('.timeline-thinking-content')
      // Thinking summary uses assistant role, so full markdown works
      expect(content?.innerHTML).toContain('<h2>')
      expect(content?.innerHTML).toContain('<strong>important</strong>')
      expect(content?.innerHTML).toContain('<ul>')
      expect(content?.innerHTML).toContain('<li>')
    })

    it('sanitizes XSS in thinking summary content', () => {
      const event = createEvent({
        eventType: 'thinking_summary',
        content: 'Thinking about <script>evil()</script> things',
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { name: /thinking/i }).click()
      })

      const content = document.querySelector('.timeline-thinking-content')
      expect(content?.innerHTML).not.toContain('<script>')
      expect(content?.innerHTML).toContain('Thinking about')
    })

    it('collapses thinking summary by default', () => {
      const event = createEvent({
        eventType: 'thinking_summary',
        content: 'Hidden content until expanded',
      })

      render(<TimelineEventCard event={event} />)

      // Content should not be visible initially
      expect(screen.queryByText('Hidden content until expanded')).not.toBeInTheDocument()

      // Expand
      act(() => {
        screen.getByRole('button', { name: /thinking/i }).click()
      })

      // Now content should be visible
      expect(screen.getByText('Hidden content until expanded')).toBeInTheDocument()
    })
  })

  describe('Mixed [md] and plain text sections', () => {
    it('renders message with [md] blocks and plain text correctly', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content:
          'Here is some plain text with **bold**.\n\n[md]\n## Markdown Section\n\n- List item\n[/md]\n\nMore plain text with *italic*.',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // Plain text sections have lightweight formatting
      expect(content.innerHTML).toContain('<strong>bold</strong>')
      expect(content.innerHTML).toContain('<em>italic</em>')

      // [md] block has full markdown
      expect(content.innerHTML).toContain('<h2>')
      expect(content.innerHTML).toContain('Markdown Section')
      expect(content.innerHTML).toContain('<ul>')
      expect(content.innerHTML).toContain('<li>')

      // [md] tags should be stripped
      expect(content.innerHTML).not.toContain('[md]')
      expect(content.innerHTML).not.toContain('[/md]')
    })

    it('handles multiple [md] blocks separated by plain text', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '[md]# First[/md]\nPlain middle\n[md]# Second[/md]',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // Both headings should render
      expect(content.innerHTML).toContain('<h1>')
      expect(content.innerHTML).toContain('First')
      expect(content.innerHTML).toContain('Second')

      // Plain text between should be present
      expect(content.innerHTML).toContain('Plain middle')
    })
  })

  describe('REGRESSION: Role-based rendering safety', () => {
    it('REGRESSION: User message MUST NOT render full markdown - XSS safety', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: '# Not a heading\n\n**Not bold**\n\n- Not a list\n\n<script>alert("xss")</script>',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // User messages are PLAIN TEXT - no markdown rendering
      expect(content.innerHTML).not.toContain('<h1>')
      expect(content.innerHTML).not.toContain('<strong>')
      expect(content.innerHTML).not.toContain('<ul>')
      expect(content.innerHTML).not.toContain('<li>')

      // Raw syntax should be visible
      expect(content.innerHTML).toContain('# Not a heading')
      expect(content.innerHTML).toContain('**Not bold**')
      expect(content.innerHTML).toContain('- Not a list')

      // XSS should be escaped
      expect(content.innerHTML).toContain('&lt;script&gt;')
      expect(content.innerHTML).not.toContain('<script>')
    })

    it('REGRESSION: User message with XSS payload MUST be escaped, not rendered', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: '<img src=x onerror=alert(1)>',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // MUST be escaped as HTML entities
      expect(content.innerHTML).toContain('&lt;img')
      expect(content.innerHTML).not.toContain('<img')

      // No actual img element in DOM
      expect(content.querySelector('img')).toBeNull()
    })

    it('REGRESSION: Error message MUST NOT render markdown', () => {
      const event = createEvent({
        eventType: 'error',
        content: '**Error**: Something went **wrong**\n\n# Not a heading',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // Error messages are PLAIN TEXT
      expect(content.innerHTML).not.toContain('<strong>')
      expect(content.innerHTML).not.toContain('<h1>')
      expect(content.innerHTML).toContain('**Error**')
      expect(content.innerHTML).toContain('**wrong**')
      expect(content.innerHTML).toContain('# Not a heading')
    })

    it('REGRESSION: Tool result without explicit markdown type renders as bash code block (safe)', () => {
      const event = createEvent({
        eventType: 'tool_result',
        actor: 'tool',
        content: '',
        metadata: {
          toolName: 'unknown.tool',
          parameters: {},
          result: '# This is NOT a heading\n\n**Not bold** - just plain text',
          status: 'completed',
        },
      })

      render(<TimelineEventCard event={event} />)

      act(() => {
        screen.getByRole('button', { expanded: false }).click()
      })

      const codeBlocks = screen.getAllByTestId('code-block-container')
      expect(codeBlocks.length).toBeGreaterThan(0)
      expect(screen.getByText('bash')).toBeInTheDocument()
      const resultBlock = codeBlocks[1]
      expect(resultBlock.textContent).toContain('# This is NOT a heading')
      expect(resultBlock.textContent).toContain('**Not bold**')
    })

    it('REGRESSION: System message MUST NOT render markdown', () => {
      const event = createEvent({
        eventType: 'run_started',
        actor: 'system',
        content: 'Run **started** at #1\n\n- Item 1\n- Item 2',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // System messages are PLAIN TEXT (role: system)
      expect(content.innerHTML).not.toContain('<strong>')
      expect(content.innerHTML).not.toContain('<ol>')
      expect(content.innerHTML).toContain('**started**')
      expect(content.innerHTML).toContain('- Item 1')
    })

    it('REGRESSION: Assistant message renders full markdown WITHOUT [md] tags', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: `## Header

This is a paragraph with **bold** and *italic*.

1. First item
2. Second item

\`\`\`typescript
const x: number = 42;
\`\`\``,
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')

      // Assistant messages get FULL markdown without needing [md] tags
      expect(content.innerHTML).toContain('<h2>')
      expect(content.innerHTML).toContain('<strong>bold</strong>')
      expect(content.innerHTML).toContain('<em>italic</em>')
      expect(content.innerHTML).toContain('<ol>')
      expect(content.innerHTML).toContain('<li>First item</li>')

      // Code block rendered as CodeBlock component
      expect(content.innerHTML).toContain('code-block')
      expect(content.innerHTML).toContain('const x: number = 42')
    })
  })
})
