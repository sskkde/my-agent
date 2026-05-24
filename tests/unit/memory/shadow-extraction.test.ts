import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager } from '../../../src/storage/connection.js';
import type { ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createMemoryExtractionRunStore, type MemoryExtractionRunStore } from '../../../src/storage/memory-extraction-run-store.js';
import { createLongTermMemoryStore, type LongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js';
import {
  recordShadowExtraction,
  type ShadowComparisonPayload,
  isMemorySemanticPolicyEnabled,
} from '../../../src/memory/shadow-extraction-recorder.js';
import type { ExtractedMemoryCandidate, MemoryExtractionWindow } from '../../../src/memory/long-term-memory-extraction.js';

function makeCandidate(overrides: Partial<ExtractedMemoryCandidate> = {}): ExtractedMemoryCandidate {
  return {
    memoryType: 'user_preference',
    text: 'Prefers dark mode',
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    keywords: ['dark mode'],
    scope: { visibility: 'private_user' },
    sourceRefs: {
      transcriptRefs: ['turn-1'],
      extraction: {
        windowHash: 'hash1',
        triggerTurnId: 'turn-1',
        includedTurnIds: ['turn-1'],
      },
    },
    ...overrides,
  };
}

function makeWindow(overrides: Partial<MemoryExtractionWindow> = {}): MemoryExtractionWindow {
  return {
    userId: 'user-123',
    sessionId: 'session-456',
    triggerTurnId: 'turn-5',
    includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
    windowHash: 'sha256:abc123',
    sessionMemorySummaryId: 'summary-789',
    renderedInput: 'User conversation transcript...',
    ...overrides,
  };
}

describe('Shadow Extraction', () => {
  let connection: ConnectionManager;
  let extractionRunStore: MemoryExtractionRunStore;
  let longTermMemoryStore: LongTermMemoryStore;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const runner = createMigrationRunner(connection);
    runner.init();
    runner.apply(allStoreMigrations);
    extractionRunStore = createMemoryExtractionRunStore(connection);
    longTermMemoryStore = createLongTermMemoryStore(connection);
  });

  describe('recordShadowExtraction', () => {
    it('should create a shadow extraction record with comparison payload', () => {
      const window = makeWindow();
      const legacyResult = {
        candidates: [makeCandidate({ text: 'Prefers dark mode' })],
      };
      const newResult = {
        candidates: [makeCandidate({ text: 'Prefers dark mode' }), makeCandidate({ text: 'Uses TypeScript' })],
      };

      recordShadowExtraction(extractionRunStore, window, legacyResult, newResult);

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      expect(shadows).toHaveLength(1);

      const shadow = shadows[0]!;
      expect(shadow.variant).toBe('shadow');
      expect(shadow.policyVersion).toBe('semantic_policy');
      expect(shadow.shadowComparisonPayload).toBeDefined();

      const payload: ShadowComparisonPayload = JSON.parse(shadow.shadowComparisonPayload!);
      expect(payload.windowHash).toBe('sha256:abc123');
      expect(payload.legacyAccepted).toHaveLength(1);
      expect(payload.newAccepted).toHaveLength(2);
      expect(payload.diff).toBe('new_accepted_more');
    });

    it('should compute diff=same when legacy and new accept identical candidates', () => {
      const window = makeWindow();
      const candidate = makeCandidate({ text: 'Same fact' });

      recordShadowExtraction(extractionRunStore, window, { candidates: [candidate] }, { candidates: [candidate] });

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!);
      expect(payload.diff).toBe('same');
    });

    it('should compute diff=legacy_accepted_more when legacy has more accepted', () => {
      const window = makeWindow();

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate({ text: 'A' }), makeCandidate({ text: 'B' })] },
        { candidates: [makeCandidate({ text: 'A' })] },
      );

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!);
      expect(payload.diff).toBe('legacy_accepted_more');
    });

    it('should compute diff=different when counts match but content differs', () => {
      const window = makeWindow();

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate({ text: 'A' })] },
        { candidates: [makeCandidate({ text: 'B' })] },
      );

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!);
      expect(payload.diff).toBe('different');
    });

    it('should classify discarded candidates from discardReason', () => {
      const window = makeWindow();

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate({ text: 'A' }), makeCandidate({ text: 'B', discardReason: 'low_confidence' })] },
        { candidates: [makeCandidate({ text: 'A' })] },
      );

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      const payload: ShadowComparisonPayload = JSON.parse(shadows[0]!.shadowComparisonPayload!);
      expect(payload.legacyDiscarded).toContain('low_confidence');
      expect(payload.legacyAccepted).toHaveLength(1);
    });
  });

  describe('shadow not in active store', () => {
    it('should not return shadow records in getByWindowHash', () => {
      const window = makeWindow();

      extractionRunStore.createPending({
        userId: window.userId,
        sessionId: window.sessionId,
        triggerTurnId: window.triggerTurnId,
        windowHash: window.windowHash,
        includedTurnIds: window.includedTurnIds,
      });

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [makeCandidate()] },
        { candidates: [makeCandidate()] },
      );

      const primary = extractionRunStore.getByWindowHash('user-123', 'sha256:abc123');
      expect(primary).not.toBeNull();
      expect(primary!.variant).toBeUndefined();

      const shadows = extractionRunStore.listShadowByWindowHash('user-123', 'sha256:abc123:shadow');
      expect(shadows).toHaveLength(1);
      expect(shadows[0]!.variant).toBe('shadow');
    });

    it('should not write shadow results to LongTermMemoryStore', () => {
      const window = makeWindow();
      const newCandidate = makeCandidate({ text: 'Shadow-only fact that must NOT appear in active store' });

      recordShadowExtraction(
        extractionRunStore,
        window,
        { candidates: [] },
        { candidates: [newCandidate] },
      );

      const activeMemories = longTermMemoryStore.getByUserId('user-123');
      expect(activeMemories).toHaveLength(0);
    });
  });

  describe('migration success', () => {
    it('should have policy_version, variant, shadow_comparison_payload columns after migration', () => {
      const columns = connection.query<{ name: string }>(
        "PRAGMA table_info('memory_extraction_runs')"
      );
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('policy_version');
      expect(columnNames).toContain('variant');
      expect(columnNames).toContain('shadow_comparison_payload');
    });

    it('should allow creating records with shadow fields', () => {
      const run = extractionRunStore.createPending({
        userId: 'user-test',
        sessionId: 'session-test',
        triggerTurnId: 'turn-1',
        windowHash: 'hash-test',
        includedTurnIds: ['turn-1'],
        policyVersion: 'semantic_policy',
        variant: 'shadow',
        shadowComparisonPayload: JSON.stringify({ diff: 'same' }),
      });

      expect(run.variant).toBe('shadow');
      expect(run.policyVersion).toBe('semantic_policy');
    });

    it('should allow creating records without shadow fields (backward compat)', () => {
      const run = extractionRunStore.createPending({
        userId: 'user-test',
        sessionId: 'session-test',
        triggerTurnId: 'turn-1',
        windowHash: 'hash-legacy',
        includedTurnIds: ['turn-1'],
      });

      expect(run.variant).toBeUndefined();
      expect(run.policyVersion).toBeUndefined();
      expect(run.shadowComparisonPayload).toBeUndefined();
    });
  });

  describe('isMemorySemanticPolicyEnabled', () => {
    const originalEnv = process.env.MEMORY_SEMANTIC_POLICY_ENABLED;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MEMORY_SEMANTIC_POLICY_ENABLED;
      } else {
        process.env.MEMORY_SEMANTIC_POLICY_ENABLED = originalEnv;
      }
    });

    it('should return false when flag is not set', () => {
      delete process.env.MEMORY_SEMANTIC_POLICY_ENABLED;
      expect(isMemorySemanticPolicyEnabled()).toBe(false);
    });

    it('should return true when flag is set to "true"', () => {
      process.env.MEMORY_SEMANTIC_POLICY_ENABLED = 'true';
      expect(isMemorySemanticPolicyEnabled()).toBe(true);
    });
  });
});
