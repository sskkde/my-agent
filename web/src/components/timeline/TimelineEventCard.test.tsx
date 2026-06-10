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
      expect(content.innerHTML).not.toContain('alert')
      expect(content.innerHTML).toContain('Hello')
      expect(content.innerHTML).toContain('world')
    })

    it('removes event handlers in streaming draft', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '<img src="x" onerror="alert(\'XSS\')">',
        metadata: { streamingDraft: true },
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('streaming-assistant-draft')
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

    it('renders user message with formatted content', () => {
      const event = createEvent({
        eventType: 'user_message',
        actor: 'user',
        content: 'I have a **question** about _this_',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).toContain('<strong>question</strong>')
      expect(content.innerHTML).toContain('<em>this</em>')
    })

    it('sanitizes XSS in final messages', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: 'Check this: <script>steal()</script> and <img src=x onerror=alert(1)>',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).not.toContain('<script>')
      expect(content.innerHTML).not.toContain('steal')
      expect(content.innerHTML).not.toContain('onerror')
      expect(content.innerHTML).not.toContain('alert')
      expect(content.innerHTML).toContain('Check this')
    })

    it('removes javascript: URLs in links', () => {
      const event = createEvent({
        eventType: 'assistant_message',
        content: '[md][Click me](javascript:alert(\'XSS\'))[/md]',
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

    it('renders error message with formatted content', () => {
      const event = createEvent({
        eventType: 'error',
        content: 'Error: **Failed** to process',
      })

      render(<TimelineEventCard event={event} />)

      const content = screen.getByTestId('timeline-event-test-event-1')
      expect(content.innerHTML).toContain('<strong>Failed</strong>')
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
      const content = '**Bold** and *italic* with [md]# Heading[/md]'

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
})
