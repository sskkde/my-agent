/**
 * Tests for foreground compact hint generation.
 *
 * Validates that `buildContextBundleFromForegroundState()` produces
 * `compactHints` under token pressure instead of hardcoding undefined.
 *
 * @module tests/unit/foreground/context-bundle-builder-compact
 */

import { describe, it, expect } from 'vitest'
import type { ContextItem } from '../../../src/context/types.js'
import { generateForegroundCompactHints } from '../../../src/foreground/compact-hints.js'
import { buildContextBundleFromForegroundState } from '../../../src/foreground/context-bundle-builder.js'
import type { ForegroundSessionState } from '../../../src/foreground/types.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    itemId: `item-${Math.random().toString(36).slice(2, 8)}`,
    sourceType: 'session_history',
    semanticType: 'fact',
    content: 'test content',
    estimatedTokens: 100,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateForegroundCompactHints', () => {
  // ── Scenario 1: long history → shouldCompactSoon = true ──────────────
  describe('when utilization exceeds threshold (long history)', () => {
    it('should return shouldCompactSoon: true with candidateItemIds when tokenEstimate / tokenBudget > 0.8', () => {
      // Given: 20 items × 200 tokens = 4000 tokens, budget = 4000
      // utilization = 4000 / 4000 = 1.0 → exceeds 0.8
      const items = Array.from({ length: 20 }, (_, i) =>
        makeItem({ itemId: `hist-${i}`, estimatedTokens: 200 }),
      )
      const tokenBudget = 4000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(true)
      expect(hints.candidateItemIds).toBeDefined()
      expect(hints.candidateItemIds!.length).toBeGreaterThan(0)
    })

    it('should include compressible, non-pinned items as candidates', () => {
      // Given: items that are compressible and not pinned
      const items = Array.from({ length: 15 }, (_, i) =>
        makeItem({
          itemId: `compressible-${i}`,
          estimatedTokens: 300,
          isPinned: false,
          isCompressible: true,
        }),
      )
      const tokenBudget = 3000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(true)
      expect(hints.candidateItemIds).toBeDefined()
      expect(hints.candidateItemIds!.length).toBeGreaterThan(0)
      for (const id of hints.candidateItemIds!) {
        expect(id).toMatch(/^compressible-/)
      }
    })

    it('should cap candidates at 10 items', () => {
      // Given: 30 compressible items, all exceeding threshold
      const items = Array.from({ length: 30 }, (_, i) =>
        makeItem({
          itemId: `many-${i}`,
          estimatedTokens: 200,
          isCompressible: true,
        }),
      )
      const tokenBudget = 2000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(true)
      expect(hints.candidateItemIds!.length).toBeLessThanOrEqual(10)
    })
  })

  // ── Scenario 2: pinned / non-compressible excluded from candidates ───
  describe('candidates exclude pinned and non-compressible items', () => {
    it('should exclude pinned items from candidateItemIds', () => {
      // Given: mix of pinned and unpinned items exceeding threshold
      const pinnedItems = Array.from({ length: 5 }, (_, i) =>
        makeItem({
          itemId: `pinned-${i}`,
          estimatedTokens: 300,
          isPinned: true,
          isCompressible: true,
        }),
      )
      const normalItems = Array.from({ length: 10 }, (_, i) =>
        makeItem({
          itemId: `normal-${i}`,
          estimatedTokens: 300,
          isPinned: false,
          isCompressible: true,
        }),
      )
      const items = [...pinnedItems, ...normalItems]
      const tokenBudget = 3000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(true)
      for (const id of hints.candidateItemIds!) {
        expect(id).not.toMatch(/^pinned-/)
      }
    })

    it('should exclude non-compressible items from candidateItemIds', () => {
      // Given: mix of compressible and non-compressible items
      const lockedItems = Array.from({ length: 5 }, (_, i) =>
        makeItem({
          itemId: `locked-${i}`,
          estimatedTokens: 300,
          isPinned: false,
          isCompressible: false,
        }),
      )
      const compressibleItems = Array.from({ length: 10 }, (_, i) =>
        makeItem({
          itemId: `free-${i}`,
          estimatedTokens: 300,
          isPinned: false,
          isCompressible: true,
        }),
      )
      const items = [...lockedItems, ...compressibleItems]
      const tokenBudget = 3000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(true)
      for (const id of hints.candidateItemIds!) {
        expect(id).not.toMatch(/^locked-/)
      }
    })

    it('should include pinned items in mustKeepItemIds', () => {
      // Given: pinned items exist
      const pinnedItems = Array.from({ length: 3 }, (_, i) =>
        makeItem({
          itemId: `pinned-${i}`,
          estimatedTokens: 400,
          isPinned: true,
        }),
      )
      const normalItems = Array.from({ length: 10 }, (_, i) =>
        makeItem({
          itemId: `normal-${i}`,
          estimatedTokens: 400,
          isPinned: false,
          isCompressible: true,
        }),
      )
      const items = [...pinnedItems, ...normalItems]
      const tokenBudget = 3000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.mustKeepItemIds).toBeDefined()
      for (const id of hints.mustKeepItemIds!) {
        expect(id).toMatch(/^pinned-/)
      }
    })
  })

  // ── Scenario 3: low utilization → shouldCompactSoon = false ──────────
  describe('when utilization is below threshold (short history)', () => {
    it('should return shouldCompactSoon: false for short conversation history', () => {
      // Given: 3 items × 100 tokens = 300 tokens, budget = 4000
      // utilization = 300 / 4000 = 0.075 → well below 0.8
      const items = Array.from({ length: 3 }, (_, i) =>
        makeItem({ itemId: `short-${i}`, estimatedTokens: 100 }),
      )
      const tokenBudget = 4000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(false)
      expect(hints.candidateItemIds).toBeUndefined()
      expect(hints.mustKeepItemIds).toBeUndefined()
    })

    it('should return shouldCompactSoon: false for empty items', () => {
      // Given: no items
      const items: ContextItem[] = []
      const tokenBudget = 4000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then
      expect(hints.shouldCompactSoon).toBe(false)
    })

    it('should return shouldCompactSoon: false when utilization is exactly at threshold', () => {
      // Given: utilization = 0.8 exactly (not > 0.8)
      // 8 items × 100 tokens = 800, budget = 1000 → 0.8 exactly
      const items = Array.from({ length: 8 }, (_, i) =>
        makeItem({ itemId: `exact-${i}`, estimatedTokens: 100 }),
      )
      const tokenBudget = 1000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then — threshold is > 0.8, so exactly 0.8 should NOT trigger
      expect(hints.shouldCompactSoon).toBe(false)
    })
  })

  // ── Scenario 4: custom threshold override ────────────────────────────
  describe('threshold semantics', () => {
    it('should use default 0.8 threshold when no override provided', () => {
      // Given: utilization = 0.85
      const items = Array.from({ length: 17 }, (_, i) =>
        makeItem({ itemId: `item-${i}`, estimatedTokens: 50 }),
      )
      // 17 × 50 = 850, budget = 1000 → 0.85
      const tokenBudget = 1000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget)

      // Then — 0.85 > 0.8 → should compact
      expect(hints.shouldCompactSoon).toBe(true)
    })

    it('should respect custom threshold when provided', () => {
      // Given: utilization = 0.6, custom threshold = 0.5
      const items = Array.from({ length: 6 }, (_, i) =>
        makeItem({ itemId: `item-${i}`, estimatedTokens: 100 }),
      )
      // 6 × 100 = 600, budget = 1000 → 0.6
      const tokenBudget = 1000

      // When
      const hints = generateForegroundCompactHints(items, tokenBudget, 0.5)

      // Then — 0.6 > 0.5 → should compact
      expect(hints.shouldCompactSoon).toBe(true)
    })
  })
})

describe('buildContextBundleFromForegroundState — compactHints via tokenBudget', () => {
  function makeForegroundState(conversationHistory: ForegroundSessionState['conversationHistory']): ForegroundSessionState {
    return {
      hydratedSession: {} as ForegroundSessionState['hydratedSession'],
      activeWorkRefs: { pendingApprovals: [], activeRuns: [] },
      currentPersona: { personaId: 'default', name: 'Assistant', directDelegationPolicy: {} as ForegroundSessionState['currentPersona']['directDelegationPolicy'] },
      effectivePolicy: {} as ForegroundSessionState['effectivePolicy'],
      conversationHistory,
    }
  }

  function makeTurnInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
    const state = makeForegroundState([])
    return {
      userId: 'u1',
      sessionId: 's1',
      turnId: 't1',
      message: 'Hello',
      timestamp: '2024-01-01T00:00:00.000Z',
      hydratedState: state.hydratedSession,
      foregroundState: state,
      ...overrides,
    }
  }

  it('produces compactHints when tokenBudget is provided and utilization is high', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      turnId: `turn-${i}`,
      message: 'B'.repeat(800),
      timestamp: `2024-01-01T00:0${i % 10}:00.000Z`,
      role: 'user' as const,
    }))
    const state = makeForegroundState(history)
    const input = makeTurnInput({ foregroundState: state })

    const bundle = buildContextBundleFromForegroundState(state, input, undefined, 4000)

    expect(bundle.compactHints).toBeDefined()
    expect(bundle.compactHints!.shouldCompactSoon).toBe(true)
  })

  it('produces compactHints undefined when tokenBudget is not provided', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      turnId: `turn-${i}`,
      message: 'B'.repeat(800),
      timestamp: `2024-01-01T00:0${i % 10}:00.000Z`,
      role: 'user' as const,
    }))
    const state = makeForegroundState(history)
    const input = makeTurnInput({ foregroundState: state })

    const bundle = buildContextBundleFromForegroundState(state, input)

    expect(bundle.compactHints).toBeUndefined()
  })
})
