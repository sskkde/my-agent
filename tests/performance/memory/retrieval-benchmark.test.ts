/**
 * Retrieval Benchmark Tests
 *
 * Performance benchmarks for memory recall operations:
 * 1. Lexical recall P95 ≤ 200ms
 * 2. getByMemoryId P95 ≤ 50ms
 * 3. getByUserId P95 ≤ 100ms
 *
 * Uses in-memory SQLite with 100 test memories.
 * Uses performance.now() for sub-millisecond precision.
 *
 * @module performance/memory/retrieval-benchmark
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import {
  createLongTermMemoryStore,
  type LongTermMemoryStore,
  type LongTermMemoryRecord,
} from '../../../src/storage/long-term-memory-store.js';

const USER_ID = 'user-benchmark';
const MEMORY_COUNT = 100;
const ITERATIONS = 10;

function makeMemory(index: number): LongTermMemoryRecord {
  const now = new Date().toISOString();
  return {
    memoryId: `mem-benchmark-${index}`,
    userId: USER_ID,
    memoryType: 'user_preference',
    content: { text: `Benchmark test memory ${index} with some content to search` },
    sourceRefs: { transcriptRefs: [`t-${index}`] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: index % 4 === 0 ? 'critical' : index % 3 === 0 ? 'high' : 'medium',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: now, updatedAt: now, lastAccessedAt: now },
    retrieval: { keywords: [`keyword-${index}`, 'benchmark'], recallCount: index },
    fingerprint: `fp-benchmark-${index}`,
  };
}

describe('Retrieval Benchmark Tests', () => {
  let connection: ConnectionManager;
  let store: LongTermMemoryStore;

  beforeAll(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    store = createLongTermMemoryStore(connection);

    for (let i = 0; i < MEMORY_COUNT; i++) {
      store.save(makeMemory(i));
    }
  });

  afterAll(() => {
    connection.close();
  });

  describe('lexical recall performance', () => {
    it('search P95 ≤ 200ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.search('benchmark', USER_ID, 10);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(200);
    });

    it('search with different queries P95 ≤ 200ms', () => {
      const durations: number[] = [];
      const queries = ['content', 'memory', 'keyword', 'test', 'benchmark'];

      for (let i = 0; i < ITERATIONS; i++) {
        const query = queries[i % queries.length];
        const start = performance.now();
        store.search(query, USER_ID, 10);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(200);
    });
  });

  describe('getByMemoryId performance', () => {
    it('getByMemoryId P95 ≤ 50ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const memoryId = `mem-benchmark-${i % MEMORY_COUNT}`;
        const start = performance.now();
        store.getByMemoryId(memoryId);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(50);
    });

    it('getByMemoryId for non-existent memory P95 ≤ 50ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.getByMemoryId(`non-existent-${i}`);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(50);
    });
  });

  describe('getByUserId performance', () => {
    it('getByUserId P95 ≤ 100ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.getByUserId(USER_ID);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(100);
    });

    it('getByUserId returns all memories', () => {
      const memories = store.getByUserId(USER_ID);
      expect(memories.length).toBe(MEMORY_COUNT);
    });
  });

  describe('searchActive performance', () => {
    it('searchActive P95 ≤ 200ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.searchActive('benchmark', USER_ID, 10);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(200);
    });
  });

  describe('getByEntityName performance', () => {
    it('getByEntityName P95 ≤ 100ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.getByEntityName('benchmark', 10);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(100);
    });
  });

  describe('getByDateRange performance', () => {
    it('getByDateRange P95 ≤ 100ms', () => {
      const durations: number[] = [];
      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        store.getByDateRange(startDate, endDate, 50);
        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(100);
    });
  });

  describe('mixed operations performance', () => {
    it('mixed read operations P95 ≤ 200ms', () => {
      const durations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();

        switch (i % 4) {
          case 0:
            store.search('benchmark', USER_ID, 10);
            break;
          case 1:
            store.getByMemoryId(`mem-benchmark-${i % MEMORY_COUNT}`);
            break;
          case 2:
            store.getByUserId(USER_ID);
            break;
          case 3:
            store.searchActive('memory', USER_ID, 10);
            break;
        }

        const duration = performance.now() - start;
        durations.push(duration);
      }

      durations.sort((a, b) => a - b);
      const p95Index = Math.ceil(durations.length * 0.95) - 1;
      const p95 = durations[p95Index];

      expect(p95).toBeLessThan(200);
    });
  });
});
