import { describe, it, expect, beforeEach } from 'vitest';
import { createModelInputRedactor } from '../../../../src/kernel/model-input/model-input-redactor.js';
import { createModelInputSnapshotStore } from '../../../../src/kernel/model-input/model-input-snapshot-store.js';
import type { BuiltModelInput } from '../../../../src/kernel/model-input/model-input-types.js';
import type { TokenUsage } from '../../../../src/llm/types.js';

function makeBuiltInput(overrides: Partial<BuiltModelInput> = {}): BuiltModelInput {
  return {
    messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
    segments: {
      staticPrefix: 'Segment A content',
      tenantProject: 'Segment B content',
      toolPlane: 'Segment C content',
      contextBundle: 'Segment D content',
    },
    segmentHashes: {
      segmentA: 'hash-a-123',
      segmentB: 'hash-b-456',
      segmentC: 'hash-c-789',
      segmentD: 'hash-d-abc',
    },
    metadata: {
      mode: 'routing_json',
      agentKind: 'foreground',
      providerFamily: 'deepseek',
      messageCount: 1,
    },
    ...overrides,
  };
}

describe('ModelInputSnapshotStore', () => {
  let redactor: ReturnType<typeof createModelInputRedactor>;
  let store: ReturnType<typeof createModelInputSnapshotStore>;

  beforeEach(() => {
    redactor = createModelInputRedactor();
    store = createModelInputSnapshotStore(redactor);
  });

  describe('record', () => {
    it('records a snapshot with generated snapshotId', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.snapshotId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('records timestamp in ISO format', () => {
      const before = new Date().toISOString();
      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });
      const after = new Date().toISOString();

      expect(snapshot.timestamp).toBeDefined();
      expect(new Date(snapshot.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(new Date(snapshot.timestamp).getTime()).toBeLessThanOrEqual(new Date(after).getTime());
    });

    it('preserves segment hashes from built input', () => {
      const builtInput = makeBuiltInput({
        segmentHashes: {
          segmentA: 'custom-hash-a',
          segmentB: 'custom-hash-b',
          segmentC: 'custom-hash-c',
          segmentD: 'custom-hash-d',
        },
      });

      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput,
      });

      expect(snapshot.segmentHashes.segmentA).toBe('custom-hash-a');
      expect(snapshot.segmentHashes.segmentB).toBe('custom-hash-b');
      expect(snapshot.segmentHashes.segmentC).toBe('custom-hash-c');
      expect(snapshot.segmentHashes.segmentD).toBe('custom-hash-d');
    });

    it('redacts sensitive data in input', () => {
      const builtInput = makeBuiltInput({
        messages: [
          { role: 'system', content: 'API Key: sk-12345' },
        ],
      });

      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput,
      });

      const inputJson = JSON.stringify(snapshot.input);
      expect(inputJson).not.toContain('sk-12345');
    });

    it('redacts sensitive data in response', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        response: {
          content: 'Here is the token: bearer-abc-123',
          metadata: { apiKey: 'secret-key' },
        },
      });

      const responseJson = JSON.stringify(snapshot.response);
      expect(responseJson).not.toContain('bearer-abc-123');
      expect(responseJson).not.toContain('secret-key');
    });

    it('records token usage with cache metrics', () => {
      const tokenUsage: TokenUsage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptCacheHitTokens: 80,
        promptCacheMissTokens: 20,
        cacheHitRate: 0.8,
      };

      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        tokenUsage,
      });

      expect(snapshot.tokenUsage?.promptTokens).toBe(100);
      expect(snapshot.tokenUsage?.completionTokens).toBe(50);
      expect(snapshot.tokenUsage?.totalTokens).toBe(150);
      expect(snapshot.tokenUsage?.promptCacheHitTokens).toBe(80);
      expect(snapshot.tokenUsage?.promptCacheMissTokens).toBe(20);
      expect(snapshot.tokenUsage?.cacheHitRate).toBe(0.8);
    });

    it('records provider and model info', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
      });

      expect(snapshot.provider).toBe('openrouter');
      expect(snapshot.model).toBe('deepseek/deepseek-chat');
    });
  });

  describe('get', () => {
    it('retrieves snapshot by ID', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });

      const retrieved = store.get(snapshot.snapshotId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.snapshotId).toBe(snapshot.snapshotId);
    });

    it('returns undefined for non-existent ID', () => {
      const retrieved = store.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getByAgent', () => {
    it('filters snapshots by agent kind', () => {
      store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });
      store.record({
        agentKind: 'foreground',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
      });
      store.record({
        agentKind: 'search',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
      });

      const foregroundSnapshots = store.getByAgent('foreground');
      const searchSnapshots = store.getByAgent('search');

      expect(foregroundSnapshots.length).toBe(2);
      expect(searchSnapshots.length).toBe(1);
      expect(searchSnapshots[0].agentKind).toBe('search');
    });
  });

  describe('getByTimeRange', () => {
    it('filters snapshots by time range', async () => {
      const snapshot1 = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const snapshot2 = store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });

      const from = new Date(new Date(snapshot1.timestamp).getTime() - 1000).toISOString();
      const to = new Date(new Date(snapshot2.timestamp).getTime() + 1000).toISOString();

      const snapshots = store.getByTimeRange(from, to);
      expect(snapshots.length).toBe(2);
    });

    it('returns empty array for non-overlapping range', () => {
      store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });

      const snapshots = store.getByTimeRange('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z');
      expect(snapshots.length).toBe(0);
    });
  });

  describe('count', () => {
    it('returns total count of snapshots', () => {
      expect(store.count()).toBe(0);

      store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });
      expect(store.count()).toBe(1);

      store.record({
        agentKind: 'search',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
      });
      expect(store.count()).toBe(2);
    });
  });

  describe('clear', () => {
    it('clears all snapshots', () => {
      store.record({
        agentKind: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
      });
      store.record({
        agentKind: 'search',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
      });

      expect(store.count()).toBe(2);

      store.clear();

      expect(store.count()).toBe(0);
    });
  });

  describe('snapshot association', () => {
    it('every LLM call can be associated with a snapshotId', () => {
      const snapshot = store.record({
        agentKind: 'kernel',
        mode: 'function_calling',
        builtInput: makeBuiltInput(),
        provider: 'deepseek',
        model: 'deepseek-chat',
      });

      expect(snapshot.snapshotId).toBeDefined();
      expect(store.get(snapshot.snapshotId)).toBe(snapshot);
    });
  });
});
