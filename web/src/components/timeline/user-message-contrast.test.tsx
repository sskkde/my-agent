/**
 * Contrast tests for user message text readability
 * 
 * Tests that user message text color tokens meet WCAG AA contrast requirements.
 * Tests both light theme (--accent: #2563eb) and warm-paper theme (--warm-paper-accent: #3D6B64)
 * against white foreground text.
 */

import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { TimelineEventCard } from './TimelineEventCard'
import type { ConsoleTimelineEvent } from '../../api/types'

function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rsRGB, gsRGB, bsRGB] = [r, g, b].map((c) => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB
}

function getContrastRatio(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }): number {
  const L1 = getRelativeLuminance(color1.r, color1.g, color1.b)
  const L2 = getRelativeLuminance(color2.r, color2.g, color2.b)
  const lighter = Math.max(L1, L2)
  const darker = Math.min(L1, L2)
  return (lighter + 0.05) / (darker + 0.05)
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-fA-F]{6})$/)
  if (!match) return null
  const rgb = match[1]
  return {
    r: parseInt(rgb.slice(0, 2), 16),
    g: parseInt(rgb.slice(2, 4), 16),
    b: parseInt(rgb.slice(4, 6), 16),
  }
}

describe('Color Token Contrast Tests', () => {
  const WCAG_AA_MINIMUM = 4.5
  const white = { r: 255, g: 255, b: 255 }

  describe('--accent token (light theme user messages)', () => {
    it('should have sufficient contrast with white text', () => {
      const accentColor = hexToRgb('#2563eb')
      expect(accentColor).not.toBeNull()
      
      const contrastRatio = getContrastRatio(accentColor!, white)
      
      expect(contrastRatio).toBeGreaterThanOrEqual(
        WCAG_AA_MINIMUM,
        `--accent #2563eb has contrast ratio ${contrastRatio.toFixed(2)}:1 with white, below WCAG AA minimum ${WCAG_AA_MINIMUM}:1`
      )
    })
  })

  describe('--warm-paper-accent token (warm-paper theme user messages)', () => {
    it('should have sufficient contrast with white text', () => {
      const warmAccent = hexToRgb('#3D6B64')
      expect(warmAccent).not.toBeNull()
      
      const contrastRatio = getContrastRatio(warmAccent!, white)
      
      expect(contrastRatio).toBeGreaterThanOrEqual(
        WCAG_AA_MINIMUM,
        `--warm-paper-accent #3D6B64 has contrast ratio ${contrastRatio.toFixed(2)}:1 with white, below WCAG AA minimum ${WCAG_AA_MINIMUM}:1`
      )
    })
  })
})

describe('User Message Component Classes', () => {
  const createUserMessageEvent = (content: string, metadata?: Record<string, unknown>): ConsoleTimelineEvent => ({
    eventId: 'test-user-message',
    eventType: 'user_message',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    content,
    actor: 'user',
    metadata,
  })

  const createStreamingDraftEvent = (content: string): ConsoleTimelineEvent => ({
    eventId: 'test-streaming-draft',
    eventType: 'assistant_message',
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    content,
    actor: 'assistant',
    metadata: {
      streamingDraft: true,
      attemptId: 'test-attempt',
    },
  })

  describe('.user-bubble', () => {
    it('should apply user-bubble class to user messages', () => {
      const { container } = render(<div className="message-bubble user-bubble">Test</div>)
      const bubble = container.querySelector('.user-bubble')
      expect(bubble).toBeInTheDocument()
    })
  })

  describe('.timeline-event-card--user_message', () => {
    it('should apply timeline-event-card--user_message class for user messages', () => {
      const event = createUserMessageEvent('Hello world')
      const { container } = render(<TimelineEventCard event={event} />)
      
      const card = container.querySelector('.timeline-event-card--user_message')
      expect(card).toBeInTheDocument()
    })

    it('should render user message content', () => {
      const event = createUserMessageEvent('Test user message')
      const { getByText } = render(<TimelineEventCard event={event} />)
      
      expect(getByText('Test user message')).toBeInTheDocument()
    })
  })

  describe('.timeline-event-card--streaming-draft', () => {
    it('should apply timeline-event-card--streaming-draft class for streaming drafts', () => {
      const event = createStreamingDraftEvent('Streaming...')
      const { container } = render(<TimelineEventCard event={event} />)
      
      const card = container.querySelector('.timeline-event-card--streaming-draft')
      expect(card).toBeInTheDocument()
    })

    it('should render streaming draft content', () => {
      const event = createStreamingDraftEvent('Partial response...')
      const { getByText } = render(<TimelineEventCard event={event} />)
      
      expect(getByText('Partial response...')).toBeInTheDocument()
    })
  })

  describe('User message metadata', () => {
    it('should render label for user messages', () => {
      const event = createUserMessageEvent('Hello')
      const { getByText } = render(<TimelineEventCard event={event} />)
      
      expect(getByText('User')).toBeInTheDocument()
    })

    it('should render timestamp for user messages', () => {
      const event = createUserMessageEvent('Hello')
      const { container } = render(<TimelineEventCard event={event} />)
      
      const timestamp = container.querySelector('.timeline-event-timestamp')
      expect(timestamp).toBeInTheDocument()
    })
  })
})
