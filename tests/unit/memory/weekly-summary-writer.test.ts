import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import { createSummaryStore, type SummaryStore } from '../../../src/storage/summary-store.js';
import { createTranscriptStore, type TranscriptStore } from '../../../src/storage/transcript-store.js';
import { createSummaryManager, type SummaryManager } from '../../../src/memory/summary-manager.js';
import type { WeeklySummaryContent } from '../../../src/memory/types.js';

describe('writeWeeklySummary', () => {
  let connection: ConnectionManager;
  let summaryStore: SummaryStore;
  let transcriptStore: TranscriptStore;
  let manager: SummaryManager;

  const validSourceRefs = {
    transcriptRefs: ['trans-001', 'trans-002']
  };

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
    
    summaryStore = createSummaryStore(connection);
    transcriptStore = createTranscriptStore(connection);
    manager = createSummaryManager(summaryStore, transcriptStore);
  });

  afterEach(() => {
    connection.close();
  });

  describe('write and read', () => {
    it('should write weekly summary with correct summaryType and weekRange', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly progress summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.summaryType).toBe('weekly_summary');
        expect(result.data.summary).toBe('Weekly progress summary');
        expect(result.data.structuredState?.weekRange).toEqual({ startDate: '2024-01-01', endDate: '2024-01-07' });
      }
    });

    it('should store weekRange inside structuredState', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-02-01', endDate: '2024-02-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.structuredState).toBeDefined();
        expect(result.data.structuredState?.weekRange).toEqual({
          startDate: '2024-02-01',
          endDate: '2024-02-07'
        });
      }
    });
  });

  describe('sourceRefs validation', () => {
    it('should reject write with empty sourceRefs (MISSING_SOURCE_REFS)', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary(
        'user-123',
        content,
        { sourceRefs: {} as never }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS');
        expect(result.message).toContain('sourceRefs must contain at least one');
      }
    });

    it('should reject write with missing sourceRefs', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary(
        'user-123',
        content,
        { sourceRefs: undefined as never }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('MISSING_SOURCE_REFS');
      }
    });

    it('should accept write with valid transcriptRefs', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary(
        'user-123',
        content,
        { sourceRefs: { transcriptRefs: ['trans-001', 'trans-002'] } }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('deterministic fields protection', () => {
    it('should always create new summary (no update behavior)', async () => {
      const content: WeeklySummaryContent = {
        summary: 'First weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const firstResult = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });
      expect(firstResult.success).toBe(true);
      if (!firstResult.success) return;

      const firstSummaryId = firstResult.data.summaryId;

      const secondResult = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });
      expect(secondResult.success).toBe(true);
      if (!secondResult.success) return;

      expect(secondResult.data.summaryId).not.toBe(firstSummaryId);
      expect(secondResult.data.userId).toBe('user-123');
      expect(secondResult.data.summaryType).toBe('weekly_summary');
    });
  });

  describe('version tracking', () => {
    it('should produce version 1 on first write', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.version).toBe(1);
      }
    });

    it('should track version history for weekly summary', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (!result.success) return;

      const history = manager.getVersionHistory(result.data.summaryId);
      expect(history).toHaveLength(1);
      expect(history[0]?.version).toBe(1);
    });
  });

  describe('retrieval metadata', () => {
    it('should store provided retrieval metadata correctly', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary with custom retrieval',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' },
        retrieval: {
          keywords: ['project', 'milestone', 'progress'],
          importance: 'high'
        }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.retrieval).toEqual({
          keywords: ['project', 'milestone', 'progress'],
          importance: 'high'
        });
      }
    });

    it('should default retrieval to empty keywords and medium importance when not provided', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary without retrieval',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.retrieval).toEqual({
          keywords: [],
          importance: 'medium'
        });
      }
    });
  });

  describe('structuredState preservation', () => {
    it('should merge custom structuredState fields with weekRange', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary with custom state',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' },
        structuredState: {
          tasksCompleted: 15,
          tasksInProgress: 3,
          blockers: ['dependency-x'],
          notes: 'Good progress this week'
        }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.structuredState?.weekRange).toEqual({
          startDate: '2024-01-01',
          endDate: '2024-01-07'
        });
        expect(result.data.structuredState?.tasksCompleted).toBe(15);
        expect(result.data.structuredState?.tasksInProgress).toBe(3);
        expect(result.data.structuredState?.blockers).toEqual(['dependency-x']);
        expect(result.data.structuredState?.notes).toBe('Good progress this week');
      }
    });

    it('should preserve weekRange even when structuredState has conflicting keys', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' },
        structuredState: {
          weekRange: { startDate: 'invalid', endDate: 'invalid' }
        }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.structuredState?.weekRange).toEqual({
          startDate: '2024-01-01',
          endDate: '2024-01-07'
        });
      }
    });
  });

  describe('userId handling', () => {
    it('should store userId correctly', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-abc-456', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe('user-abc-456');
      }
    });
  });

  describe('status', () => {
    it('should set status to active by default', async () => {
      const content: WeeklySummaryContent = {
        summary: 'Weekly summary',
        weekRange: { startDate: '2024-01-01', endDate: '2024-01-07' }
      };

      const result = await manager.writeWeeklySummary('user-123', content, { sourceRefs: validSourceRefs });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
      }
    });
  });
});
