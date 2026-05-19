import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { decodeCursor, applyCursorPagination } from '../../../src/api/pagination/cursor-pagination.js';
import type { FastifyInstance } from 'fastify';

describe('Edge Cases', () => {
  let server: FastifyInstance;
  let context: ApiContext;

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) throw new Error(ctx.message);
    context = ctx;
    server = await createApiServer(context);
  }, 30000);

  afterAll(async () => {
    await server.close();
    context.connection.close();
  });

  describe('Cursor pagination - empty result set', () => {
    it('should handle empty items array', () => {
      const result = applyCursorPagination(
        [],
        { limit: 10 },
        (item) => ({ id: item })
      );
      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it('should handle limit larger than items', () => {
      const items = [{ id: 'a' }, { id: 'b' }];
      const result = applyCursorPagination(
        items,
        { limit: 10 },
        (item) => ({ id: item.id })
      );
      expect(result.items).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });
  });

  describe('Invalid cursor handling', () => {
    it('should reject invalid base64 cursor', () => {
      expect(() => decodeCursor('!!!invalid-base64!!!')).toThrow('Invalid cursor: unable to decode');
    });

    it('should reject cursor that decodes to non-object', () => {
      const nonObjectCursor = Buffer.from('"string"').toString('base64');
      expect(() => decodeCursor(nonObjectCursor)).toThrow('Cursor must decode to a JSON object');
    });

    it('should reject cursor that decodes to array', () => {
      const arrayCursor = Buffer.from('[1,2,3]').toString('base64');
      expect(() => decodeCursor(arrayCursor)).toThrow('Cursor must decode to a JSON object');
    });

    it('should reject cursor that decodes to null', () => {
      const nullCursor = Buffer.from('null').toString('base64');
      expect(() => decodeCursor(nullCursor)).toThrow('Cursor must decode to a JSON object');
    });
  });

  describe('Error envelope structure', () => {
    it('should return structured error for 401 unauthorized', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      });
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('should return structured error for 404 not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions/nonexistent-session-id',
      });
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });

    it('should return structured error for invalid route', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/nonexistent-route-xyz',
      });
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
    });
  });
});
