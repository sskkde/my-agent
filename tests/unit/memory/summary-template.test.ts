/**
 * Unit tests for summary prompt builder template loading
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildSessionSummaryPrompt,
  buildDailySummaryPrompt,
  buildWeeklySummaryPrompt,
  buildLongTermProfilePrompt,
  buildAtomicFactsPrompt,
  type SessionSummaryPromptInput,
  type DailySummaryPromptInput,
  type WeeklySummaryPromptInput,
  type LongTermProfilePromptInput,
  type AtomicFactsPromptInput,
} from '../../../src/memory/summary-prompt-builder.js'

describe('Summary Prompt Builder', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  // ============================================================================
  // Session Summary Tests
  // ============================================================================

  describe('buildSessionSummaryPrompt', () => {
    it('should build prompt with hardcoded fallback when P0 disabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'false' }

      const { buildSessionSummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: SessionSummaryPromptInput = {
        sessionId: 'session-123',
        userId: 'user-456',
        conversationContent: 'User: Hello\nAssistant: Hi!',
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('Key Decisions')
      expect(result.prompt).toContain('Action Items')
      expect(result.prompt).toContain('Unresolved Questions')
      expect(result.prompt).toContain('Current State')
      expect(result.templateLoaded).toBe(false)
      expect(result.templateId).toBe('summary:session')
    })

    it('should load template when P0 enabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const { buildSessionSummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: SessionSummaryPromptInput = {
        sessionId: 'session-123',
        userId: 'user-456',
        conversationContent: 'User: Hello\nAssistant: Hi!',
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('Session Summary Prompt')
      expect(result.prompt).toContain('Key Decisions')
      expect(result.templateLoaded).toBe(true)
      expect(result.templateId).toBe('summary:session')
    })

    it('should include dynamic session context', async () => {
      const input: SessionSummaryPromptInput = {
        sessionId: 'session-abc',
        userId: 'user-xyz',
        conversationContent: 'User: I prefer TypeScript\nAssistant: Noted!',
        turnCount: 5,
        startTime: '2024-01-15T10:00:00Z',
        endTime: '2024-01-15T10:30:00Z',
      }

      const result = await buildSessionSummaryPrompt(input)

      expect(result.prompt).toContain('Session ID: session-abc')
      expect(result.prompt).toContain('User ID: user-xyz')
      expect(result.prompt).toContain('Turn Count: 5')
      expect(result.prompt).toContain('Start Time: 2024-01-15T10:00:00Z')
      expect(result.prompt).toContain('End Time: 2024-01-15T10:30:00Z')
      expect(result.prompt).toContain('I prefer TypeScript')
    })

    it('should handle minimal input', async () => {
      const input: SessionSummaryPromptInput = {
        sessionId: 'session-minimal',
        userId: 'user-minimal',
        conversationContent: 'Brief chat',
      }

      const result = await buildSessionSummaryPrompt(input)

      expect(result.prompt).toContain('Session ID: session-minimal')
      expect(result.prompt).toContain('User ID: user-minimal')
      expect(result.prompt).toContain('Brief chat')
      expect(result.prompt).not.toContain('Turn Count')
      expect(result.prompt).not.toContain('Start Time')
    })
  })

  // ============================================================================
  // Daily Summary Tests
  // ============================================================================

  describe('buildDailySummaryPrompt', () => {
    it('should build prompt with hardcoded fallback when P0 disabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'false' }

      const { buildDailySummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: DailySummaryPromptInput = {
        userId: 'user-123',
        date: '2024-01-15',
        sessionSummaries: ['Session 1 summary', 'Session 2 summary'],
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('Key Achievements')
      expect(result.prompt).toContain('Patterns Observed')
      expect(result.prompt).toContain('Blockers Encountered')
      expect(result.templateLoaded).toBe(false)
      expect(result.templateId).toBe('summary:daily')
    })

    it('should load template when P0 enabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const { buildDailySummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: DailySummaryPromptInput = {
        userId: 'user-123',
        date: '2024-01-15',
        sessionSummaries: ['Session 1 summary'],
      }

      const result = await buildPrompt(input)

      expect(result.templateLoaded).toBe(true)
      expect(result.templateId).toBe('summary:daily')
    })

    it('should include dynamic daily context', async () => {
      const input: DailySummaryPromptInput = {
        userId: 'user-abc',
        date: '2024-01-20',
        sessionSummaries: ['Morning session summary', 'Afternoon session summary'],
        totalTurnCount: 42,
      }

      const result = await buildDailySummaryPrompt(input)

      expect(result.prompt).toContain('User ID: user-abc')
      expect(result.prompt).toContain('Date: 2024-01-20')
      expect(result.prompt).toContain('Total Turns: 42')
      expect(result.prompt).toContain('Morning session summary')
      expect(result.prompt).toContain('Afternoon session summary')
    })
  })

  // ============================================================================
  // Weekly Summary Tests
  // ============================================================================

  describe('buildWeeklySummaryPrompt', () => {
    it('should build prompt with hardcoded fallback when P0 disabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'false' }

      const { buildWeeklySummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: WeeklySummaryPromptInput = {
        userId: 'user-123',
        weekStartDate: '2024-01-15',
        weekEndDate: '2024-01-21',
        dailySummaries: ['Monday summary', 'Tuesday summary'],
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('High-Level Progress')
      expect(result.prompt).toContain('Trends Identified')
      expect(result.prompt).toContain('Strategic Insights')
      expect(result.templateLoaded).toBe(false)
      expect(result.templateId).toBe('summary:weekly')
    })

    it('should load template when P0 enabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const { buildWeeklySummaryPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: WeeklySummaryPromptInput = {
        userId: 'user-123',
        weekStartDate: '2024-01-15',
        weekEndDate: '2024-01-21',
        dailySummaries: ['Week summary'],
      }

      const result = await buildPrompt(input)

      expect(result.templateLoaded).toBe(true)
      expect(result.templateId).toBe('summary:weekly')
    })

    it('should include dynamic weekly context', async () => {
      const input: WeeklySummaryPromptInput = {
        userId: 'user-weekly',
        weekStartDate: '2024-01-01',
        weekEndDate: '2024-01-07',
        dailySummaries: ['Day 1', 'Day 2', 'Day 3'],
      }

      const result = await buildWeeklySummaryPrompt(input)

      expect(result.prompt).toContain('User ID: user-weekly')
      expect(result.prompt).toContain('Week Range: 2024-01-01 to 2024-01-07')
      expect(result.prompt).toContain('Day 1')
      expect(result.prompt).toContain('Day 2')
      expect(result.prompt).toContain('Day 3')
    })
  })

  // ============================================================================
  // Long-Term Profile Tests
  // ============================================================================

  describe('buildLongTermProfilePrompt', () => {
    it('should build prompt with hardcoded fallback when P0 disabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'false' }

      const { buildLongTermProfilePrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: LongTermProfilePromptInput = {
        userId: 'user-123',
        memoryContent: 'User prefers dark mode and TypeScript',
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('Preferences')
      expect(result.prompt).toContain('Goals')
      expect(result.prompt).toContain('Work Style')
      expect(result.prompt).toContain('Domain Expertise')
      expect(result.templateLoaded).toBe(false)
      expect(result.templateId).toBe('summary:long-term')
    })

    it('should load template when P0 enabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const { buildLongTermProfilePrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: LongTermProfilePromptInput = {
        userId: 'user-123',
        memoryContent: 'Memory content',
      }

      const result = await buildPrompt(input)

      expect(result.templateLoaded).toBe(true)
      expect(result.templateId).toBe('summary:long-term')
    })

    it('should include dynamic profile context', async () => {
      const input: LongTermProfilePromptInput = {
        userId: 'user-profile',
        memoryContent: 'Accumulated memories here',
        previousProfile: 'Previous profile summary',
      }

      const result = await buildLongTermProfilePrompt(input)

      expect(result.prompt).toContain('User ID: user-profile')
      expect(result.prompt).toContain('Previous Profile')
      expect(result.prompt).toContain('Previous profile summary')
      expect(result.prompt).toContain('Accumulated Memory')
      expect(result.prompt).toContain('Accumulated memories here')
    })

    it('should handle missing previous profile', async () => {
      const input: LongTermProfilePromptInput = {
        userId: 'user-new',
        memoryContent: 'First memory',
      }

      const result = await buildLongTermProfilePrompt(input)

      expect(result.prompt).toContain('User ID: user-new')
      expect(result.prompt).toContain('Accumulated Memory')
      expect(result.prompt).not.toContain('Previous Profile')
    })
  })

  // ============================================================================
  // Atomic Facts Tests
  // ============================================================================

  describe('buildAtomicFactsPrompt', () => {
    it('should build prompt with hardcoded fallback when P0 disabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'false' }

      const { buildAtomicFactsPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: AtomicFactsPromptInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        conversationContent: 'User: I use VS Code',
      }

      const result = await buildPrompt(input)

      expect(result.prompt).toContain('Self-Contained')
      expect(result.prompt).toContain('Traceable')
      expect(result.prompt).toContain('Not Transient')
      expect(result.prompt).toContain('Verifiable')
      expect(result.templateLoaded).toBe(false)
      expect(result.templateId).toBe('summary:atomic-facts')
    })

    it('should load template when P0 enabled', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const { buildAtomicFactsPrompt: buildPrompt } = await import('../../../src/memory/summary-prompt-builder.js')

      const input: AtomicFactsPromptInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        conversationContent: 'Conversation',
      }

      const result = await buildPrompt(input)

      expect(result.templateLoaded).toBe(true)
      expect(result.templateId).toBe('summary:atomic-facts')
    })

    it('should include dynamic extraction context', async () => {
      const input: AtomicFactsPromptInput = {
        userId: 'user-atomic',
        sessionId: 'session-atomic',
        conversationContent: 'User: My favorite language is Rust',
      }

      const result = await buildAtomicFactsPrompt(input)

      expect(result.prompt).toContain('User ID: user-atomic')
      expect(result.prompt).toContain('Session ID: session-atomic')
      expect(result.prompt).toContain('My favorite language is Rust')
    })
  })

  // ============================================================================
  // Template Loading Failure Tests
  // ============================================================================

  describe('template loading failure handling', () => {
    it('should gracefully fallback when template file missing', async () => {
      process.env = { ...originalEnv, PROMPT_MEMORY_P0_ENABLED: 'true' }

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const input: SessionSummaryPromptInput = {
        sessionId: 'session-test',
        userId: 'user-test',
        conversationContent: 'Test content',
      }

      const result = await buildSessionSummaryPrompt(input)

      expect(result.prompt).toBeDefined()
      expect(result.prompt.length).toBeGreaterThan(0)

      consoleWarnSpy.mockRestore()
    })
  })
})
