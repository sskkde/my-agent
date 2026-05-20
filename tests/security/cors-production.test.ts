/**
 * CORS Production Allowlist Tests
 *
 * Tests for the CORS production configuration module.
 * Verifies that:
 * - Production mode uses explicit origin allowlist
 * - Development mode reflects any origin
 * - OPTIONS requests are handled correctly
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../src/api/server.js';
import { createApiContext, isApiContextError } from '../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

describe('CORS Production Allowlist', () => {
  describe('getCorsOrigin function', async () => {
    const { getCorsOrigin } = await import('../../src/api/middleware/cors-production.js');

    it('should return origin: true in development mode', () => {
      const config = getCorsOrigin({ NODE_ENV: 'development' });
      expect(config.origin).toBe(true);
    });

    it('should return origin array in production mode with ALLOWED_ORIGINS', () => {
      const config = getCorsOrigin({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
      });
      expect(config.origin).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });

    it('should trim whitespace from origins', () => {
      const config = getCorsOrigin({
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: '  https://app.example.com  ,  https://admin.example.com  ',
      });
      expect(config.origin).toEqual(['https://app.example.com', 'https://admin.example.com']);
    });

    it('should throw error when ALLOWED_ORIGINS is "*" in production', () => {
      expect(() =>
        getCorsOrigin({
          NODE_ENV: 'production',
          ALLOWED_ORIGINS: '*',
        })
      ).toThrow('ALLOWED_ORIGINS must be set to explicit comma-separated URLs in production');
    });

    it('should throw error when ALLOWED_ORIGINS is not set in production', () => {
      expect(() =>
        getCorsOrigin({
          NODE_ENV: 'production',
        })
      ).toThrow('ALLOWED_ORIGINS must be set to explicit comma-separated URLs in production');
    });

    it('should throw error when ALLOWED_ORIGINS is empty string in production', () => {
      expect(() =>
        getCorsOrigin({
          NODE_ENV: 'production',
          ALLOWED_ORIGINS: '',
        })
      ).toThrow('ALLOWED_ORIGINS must be set to explicit comma-separated URLs in production');
    });

    it('should return origin: true when NODE_ENV is undefined', () => {
      const config = getCorsOrigin({});
      expect(config.origin).toBe(true);
    });
  });

  describe('CORS integration with Fastify server', () => {
    let server: FastifyInstance;
    let baseUrl: string;

    describe('Development mode (reflective CORS)', () => {
      beforeAll(async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        delete process.env.NODE_ENV;

        const ctxResult = createApiContext({ dbPath: ':memory:' });
        if (isApiContextError(ctxResult)) {
          throw new Error(`Failed to create context: ${ctxResult.message}`);
        }

        server = await createApiServer(ctxResult);
        await server.listen();
        const address = server.server.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;

        process.env.NODE_ENV = originalNodeEnv;
      });

      afterAll(async () => {
        if (server.server.closeAllConnections) {
          server.server.closeAllConnections();
        }
        await server.close();
      });

      it('should reflect any origin in development mode', async () => {
        const response = await fetch(`${baseUrl}/api/v1/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://evil.com',
            'Access-Control-Request-Method': 'GET',
          },
        });

        expect(response.headers.get('access-control-allow-origin')).toBe('https://evil.com');
      });
    });

    describe('Production mode (allowlist CORS)', () => {
      let prodServer: FastifyInstance;
      let prodBaseUrl: string;

      beforeAll(async () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

        process.env.NODE_ENV = 'production';
        process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';

        const ctxResult = createApiContext({ dbPath: ':memory:' });
        if (isApiContextError(ctxResult)) {
          throw new Error(`Failed to create context: ${ctxResult.message}`);
        }

        prodServer = await createApiServer(ctxResult);
        await prodServer.listen();
        const address = prodServer.server.address() as { port: number };
        prodBaseUrl = `http://localhost:${address.port}`;

        process.env.NODE_ENV = originalNodeEnv;
        process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
      });

      afterAll(async () => {
        if (prodServer.server.closeAllConnections) {
          prodServer.server.closeAllConnections();
        }
        await prodServer.close();
      });

      it('should allow OPTIONS from allowed origin', async () => {
        const response = await fetch(`${prodBaseUrl}/api/v1/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://app.example.com',
            'Access-Control-Request-Method': 'GET',
          },
        });

        expect(response.headers.get('access-control-allow-origin')).toBe(
          'https://app.example.com'
        );
      });

      it('should reject OPTIONS from non-allowed origin', async () => {
        const response = await fetch(`${prodBaseUrl}/api/v1/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://evil.com',
            'Access-Control-Request-Method': 'GET',
          },
        });

        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      });

      it('should allow OPTIONS from second allowed origin', async () => {
        const response = await fetch(`${prodBaseUrl}/api/v1/health`, {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://admin.example.com',
            'Access-Control-Request-Method': 'GET',
          },
        });

        expect(response.headers.get('access-control-allow-origin')).toBe(
          'https://admin.example.com'
        );
      });
    });
  });
});
