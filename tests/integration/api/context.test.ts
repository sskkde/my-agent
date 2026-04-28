import { describe, it, expect } from 'vitest';
import { createApiContext, isApiContextError, type ApiContextError } from '../../../src/api/context.js';
import { createTestDatabase } from '../../helpers/db.js';

describe('ApiContext', () => {
  describe('createApiContext', () => {
    it('should create context with default in-memory database', () => {
      const result = createApiContext();

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.gateway).toBeDefined();
      expect(result.stores).toBeDefined();
      expect(result.stores.eventStore).toBeDefined();
      expect(result.stores.transcriptStore).toBeDefined();
      expect(result.stores.summaryStore).toBeDefined();
      expect(result.stores.approvalStore).toBeDefined();
      expect(result.connection).toBeDefined();

      result.connection.close();
    });

    it('should create context with explicit in-memory database path', () => {
      const result = createApiContext({ dbPath: ':memory:' });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(result.connection.isOpen()).toBe(true);
      result.connection.close();
    });

    it('should create context with explicit test DB path', () => {
      const testDb = createTestDatabase(':memory:');
      
      const result = createApiContext({
        dbPath: ':memory:',
      });

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      result.connection.close();
      testDb.close();
    });

    it('should create two separate contexts with isolated data', () => {
      const context1 = createApiContext({ dbPath: ':memory:' });
      const context2 = createApiContext({ dbPath: ':memory:' });

      expect(isApiContextError(context1)).toBe(false);
      expect(isApiContextError(context2)).toBe(false);
      if (isApiContextError(context1) || isApiContextError(context2)) return;

      context1.stores.eventStore.append({
        eventId: 'event-1',
        eventType: 'test_event',
        sourceModule: 'gateway',
        payload: { test: 'data1' },
        sensitivity: 'low',
        retentionClass: 'short',
        createdAt: new Date().toISOString(),
      });

      context2.stores.eventStore.append({
        eventId: 'event-2',
        eventType: 'test_event',
        sourceModule: 'gateway',
        payload: { test: 'data2' },
        sensitivity: 'low',
        retentionClass: 'short',
        createdAt: new Date().toISOString(),
      });

      const events1 = context1.stores.eventStore.query({});
      const events2 = context2.stores.eventStore.query({});

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0]?.eventId).toBe('event-1');
      expect(events2[0]?.eventId).toBe('event-2');

      context1.connection.close();
      context2.connection.close();
    });

    it('should return structured error when connection fails to open', () => {
      const result = createApiContext({ dbPath: '/nonexistent/path/db.sqlite' });

      expect(isApiContextError(result)).toBe(true);
      if (!isApiContextError(result)) return;

      expect(result.code).toBe('CONNECTION_FAILED');
      expect(result.message).toBeDefined();
    });

    it('should handle connection errors gracefully', () => {
      const result = createApiContext({ dbPath: '/nonexistent/path/db.sqlite' });

      expect(isApiContextError(result)).toBe(true);
      if (!isApiContextError(result)) return;

      expect(result.code).toBe('CONNECTION_FAILED');
      expect(result.message).toBeDefined();
    });

    it('should expose gateway, stores, and connection', () => {
      const result = createApiContext();

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      expect(typeof result.gateway.receiveUserMessage).toBe('function');
      expect(typeof result.gateway.assembleHydratedState).toBe('function');
      expect(typeof result.gateway.formatOutbound).toBe('function');

      expect(result.stores.eventStore.append).toBeDefined();
      expect(result.stores.eventStore.query).toBeDefined();
      expect(result.stores.runtimeActionStore.query).toBeDefined();
      expect(result.stores.transcriptStore.findBySession).toBeDefined();
      expect(result.stores.summaryStore.getSessionMemory).toBeDefined();
      expect(result.stores.approvalStore.create).toBeDefined();
      expect(result.stores.permissionGrantStore.findByUser).toBeDefined();
      expect(result.stores.toolExecutionStore.getById).toBeDefined();

      expect(typeof result.connection.open).toBe('function');
      expect(typeof result.connection.close).toBe('function');
      expect(typeof result.connection.isOpen).toBe('function');

      result.connection.close();
    });

    it('should NOT expose raw database connection directly via context', () => {
      const result = createApiContext();

      expect(isApiContextError(result)).toBe(false);
      if (isApiContextError(result)) return;

      const contextKeys = Object.keys(result);
      expect(contextKeys).not.toContain('db');
      expect(contextKeys).not.toContain('database');
      expect(contextKeys).not.toContain('rawConnection');

      expect(result.connection).toBeDefined();
      expect(typeof result.connection.query).toBe('function');
      expect(typeof result.connection.exec).toBe('function');

      result.connection.close();
    });
  });

  describe('isApiContextError', () => {
    it('should return true for error object', () => {
      const error: ApiContextError = {
        code: 'CONNECTION_FAILED',
        message: 'Test error',
      };

      expect(isApiContextError(error)).toBe(true);
    });

    it('should return false for valid context', () => {
      const context = createApiContext();
      if (isApiContextError(context)) {
        return;
      }

      expect(isApiContextError(context)).toBe(false);
      context.connection.close();
    });
  });
});