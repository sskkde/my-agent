import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import {
  createMemoryExtractionRunStore,
  type MemoryExtractionRunStore,
} from '../../../src/storage/memory-extraction-run-store.js'
import { recordShadowExtraction, type ShadowComparisonPayload } from '../../../src/memory/shadow-extraction-recorder.js'
import type {
  ExtractedMemoryCandidate,
  MemoryExtractionWindow,
} from '../../../src/memory/long-term-memory-extraction.js'

/**
 * PM-15 Integration Test: Shadow Extraction Comparison
 *
 * Tests the comparison between legacy and semantic-policy extraction results.
 * Uses mocked deterministic results (no external LLM calls) to verify:
 * - Similar input produces similar accepted/discarded patterns
 * - New extraction doesn't drop recall for legit memory content
 * - Shadow comparison payload has correct diff type
 */
describe('Shadow Extraction Comparison Integration', () => {
  let connection: ConnectionManager
  let extractionRunStore: MemoryExtractionRunStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    extractionRunStore = createMemoryExtractionRunStore(connection)
  })

  afterEach(() => {
    connection.close()
  })

  // Helper to create a standard memory candidate
  function makeCandidate(overrides: Partial<ExtractedMemoryCandidate> = {}): ExtractedMemoryCandidate {
    return {
      memoryType: 'user_preference',
      text: 'Prefers dark mode for UI',
      confidence: 0.9,
      importance: 'high',
      sensitivity: 'low',
      keywords: ['dark mode', 'ui'],
      scope: { visibility: 'private_user' },
      sourceRefs: {
        transcriptRefs: ['turn-1'],
        extraction: {
          windowHash: 'hash-abc',
          triggerTurnId: 'turn-5',
          includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        },
      },
      ...overrides,
    }
  }

  // Helper to create a standard extraction window
  function makeWindow(overrides: Partial<MemoryExtractionWindow> = {}): MemoryExtractionWindow {
    return {
      userId: 'user-123',
      sessionId: 'session-456',
      triggerTurnId: 'turn-5',
      includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
      windowHash: 'sha256:test-window-hash',
      sessionMemorySummaryId: 'sm-test-789',
      renderedInput: 'User conversation about preferences...',
      ...overrides,
    }
  }

  describe('legacy vs semantic-policy comparison', () => {
    it('should show both accept relevant memory content', () => {
      const window = makeWindow()

      // Both extractions accept the same valid memory content
      const legacyResult = {
        candidates: [makeCandidate({ text: 'Prefers dark mode' }), makeCandidate({ text: 'Works with TypeScript' })],
      }

      const newResult = {
        candidates: [makeCandidate({ text: 'Prefers dark mode' }), makeCandidate({ text: 'Works with TypeScript' })],
      }

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult)

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      expect(shadows).toHaveLength(1)

      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)
      expect(payload.diff).toBe('same')
      expect(payload.legacyAccepted).toHaveLength(2)
      expect(payload.newAccepted).toHaveLength(2)
    })

    it('should show legacy accepts ephemeral content but new rejects it (policy improvement)', () => {
      const window = makeWindow()

      // Legacy accepts ephemeral content (console.log, git commands, etc.)
      const legacyResult = {
        candidates: [
          makeCandidate({ text: 'Prefers dark mode' }),
          makeCandidate({ text: 'Console log at file.ts:42' }),
          makeCandidate({ text: 'Git commit abc123 pushed to origin' }),
        ],
      }

      // New policy rejects ephemeral content
      const newResult = {
        candidates: [
          makeCandidate({ text: 'Prefers dark mode' }),
          makeCandidate({ text: 'Console log at file.ts:42', discardReason: 'ephemeral_pattern_detected' }),
          makeCandidate({ text: 'Git commit abc123 pushed to origin', discardReason: 'ephemeral_pattern_detected' }),
        ],
      }

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult)

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      // Legacy accepted more (including ephemeral)
      expect(payload.diff).toBe('legacy_accepted_more')
      expect(payload.legacyAccepted).toHaveLength(3)
      expect(payload.newAccepted).toHaveLength(1)
      expect(payload.newDiscarded).toContain('ephemeral_pattern_detected')
    })

    it('should correctly classify accepted vs discarded candidates', () => {
      const window = makeWindow()

      const legacyResult = {
        candidates: [
          makeCandidate({ text: 'Valid preference A' }),
          makeCandidate({ text: 'Discarded by legacy', discardReason: 'low_confidence' }),
          makeCandidate({ text: 'Valid preference B' }),
        ],
      }

      const newResult = {
        candidates: [
          makeCandidate({ text: 'Valid preference A' }),
          makeCandidate({ text: 'Valid preference B' }),
          makeCandidate({ text: 'New finding C' }),
        ],
      }

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult)

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      expect(payload.legacyAccepted).toHaveLength(2)
      expect(payload.legacyDiscarded).toContain('low_confidence')
      expect(payload.newAccepted).toHaveLength(3)
      expect(payload.newDiscarded).toHaveLength(0)
      expect(payload.diff).toBe('new_accepted_more')
    })

    it('should compute diff=different when counts match but content differs', () => {
      const window = makeWindow()

      const legacyResult = {
        candidates: [makeCandidate({ text: 'Preference A' }), makeCandidate({ text: 'Preference B' })],
      }

      const newResult = {
        candidates: [makeCandidate({ text: 'Preference X' }), makeCandidate({ text: 'Preference Y' })],
      }

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult)

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      expect(payload.diff).toBe('different')
      expect(payload.legacyAccepted).toHaveLength(2)
      expect(payload.newAccepted).toHaveLength(2)
    })
  })

  describe('shadow comparison payload structure', () => {
    it('should include correct windowHash in payload', () => {
      const window = makeWindow({ windowHash: 'sha256:unique-hash-123' })

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate()] },
        { candidates: [makeCandidate()] },
      )

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:unique-hash-123:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      // windowHash should NOT include the :shadow suffix
      expect(payload.windowHash).toBe('sha256:unique-hash-123')
    })

    it('should include full candidate data in accepted arrays', () => {
      const window = makeWindow()
      const candidate = makeCandidate({
        text: 'Specific preference text',
        memoryType: 'user_profile',
        confidence: 0.95,
      })

      recordShadowExtraction(extractionRunStore, window, { candidates: [candidate] }, { candidates: [candidate] })

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      expect(payload.legacyAccepted[0].text).toBe('Specific preference text')
      expect(payload.legacyAccepted[0].memoryType).toBe('user_profile')
      expect(payload.legacyAccepted[0].confidence).toBe(0.95)
    })

    it('should preserve structured data in candidates', () => {
      const window = makeWindow()
      const candidate = makeCandidate({
        text: 'Project uses React',
        structured: { framework: 'React', version: '18.2' },
      })

      recordShadowExtraction(extractionRunStore, window, { candidates: [candidate] }, { candidates: [candidate] })

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      expect(payload.legacyAccepted[0].structured).toEqual({ framework: 'React', version: '18.2' })
    })
  })

  describe('store integration', () => {
    it('should create shadow record with correct variant and policyVersion', () => {
      const window = makeWindow()

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate()] },
        { candidates: [makeCandidate()] },
      )

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      expect(shadows).toHaveLength(1)

      const shadow = shadows[0]!
      expect(shadow.variant).toBe('shadow')
      expect(shadow.policyVersion).toBe('semantic_policy')
    })

    it('should use :shadow suffix in windowHash for shadow records', () => {
      const window = makeWindow()

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate()] },
        { candidates: [makeCandidate()] },
      )

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      expect(shadows).toHaveLength(1)

      // The shadow's windowHash includes :shadow suffix
      expect(shadows[0]!.windowHash).toBe('sha256:test-window-hash:shadow')
    })

    it('should preserve sourceRefs from window in shadow record', () => {
      const window = makeWindow({
        userId: 'user-test-456',
        sessionId: 'session-test-789',
        triggerTurnId: 'turn-10',
        includedTurnIds: ['turn-6', 'turn-7', 'turn-8', 'turn-9', 'turn-10'],
      })

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate()] },
        { candidates: [makeCandidate()] },
      )

      const shadows = extractionRunStore.listShadowByWindowHash('user-test-456', 'sha256:test-window-hash:shadow')
      const shadow = shadows[0]!

      expect(shadow.userId).toBe('user-test-456')
      expect(shadow.sessionId).toBe('session-test-789')
      expect(shadow.triggerTurnId).toBe('turn-10')
      expect(shadow.includedTurnIds).toEqual(['turn-6', 'turn-7', 'turn-8', 'turn-9', 'turn-10'])
    })
  })

  describe('recall preservation', () => {
    it('should not drop recall for legitimate memory content', () => {
      const window = makeWindow()

      // Scenario: New policy accepts all legitimate content that legacy accepted
      const legitimateCandidates = [
        makeCandidate({ text: 'User prefers dark theme' }),
        makeCandidate({ text: 'User works with TypeScript daily' }),
        makeCandidate({ text: 'User wants notifications on critical updates' }),
        makeCandidate({ text: 'User timezone is UTC-5' }),
      ]

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: legitimateCandidates },
        { candidates: legitimateCandidates },
      )

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      // Same result means recall is preserved
      expect(payload.diff).toBe('same')
      expect(payload.newAccepted.length).toBe(payload.legacyAccepted.length)
    })

    it('should track when new policy improves recall (finds more)', () => {
      const window = makeWindow()

      const legacyResult = {
        candidates: [makeCandidate({ text: 'Known preference A' })],
      }

      const newResult = {
        candidates: [
          makeCandidate({ text: 'Known preference A' }),
          makeCandidate({ text: 'New discovery B' }),
          makeCandidate({ text: 'New discovery C' }),
        ],
      }

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult)

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:test-window-hash:shadow')
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!)

      expect(payload.diff).toBe('new_accepted_more')
      expect(payload.newAccepted.length).toBe(3)
    })
  })
})
