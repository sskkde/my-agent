/**
 * Session Cookie Production Security Test
 *
 * Tests that session cookies include the Secure flag when NODE_ENV=production.
 * This ensures cookies are only transmitted over HTTPS in production environments.
 */

import { describe, it, expect } from 'vitest';
import type { FastifyReply } from 'fastify';
import { setSessionCookie, clearSessionCookie } from '../../src/api/middleware/auth.js';

describe('Session Cookie Production Security', () => {
  describe('setSessionCookie', () => {
    it('should include Secure flag when NODE_ENV=production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      setSessionCookie(mockReply, 'test-token-123');

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).toContain('Secure');
      expect(headers['Set-Cookie']).toContain('HttpOnly');
      expect(headers['Set-Cookie']).toContain('SameSite=Lax');
      expect(headers['Set-Cookie']).toContain('Max-Age=86400');

      process.env.NODE_ENV = originalEnv;
    });

    it('should NOT include Secure flag when NODE_ENV=development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      setSessionCookie(mockReply, 'test-token-123');

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).not.toContain('Secure');
      expect(headers['Set-Cookie']).toContain('HttpOnly');
      expect(headers['Set-Cookie']).toContain('SameSite=Lax');

      process.env.NODE_ENV = originalEnv;
    });

    it('should NOT include Secure flag when NODE_ENV is not set', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      setSessionCookie(mockReply, 'test-token-123');

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).not.toContain('Secure');
      expect(headers['Set-Cookie']).toContain('HttpOnly');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('clearSessionCookie', () => {
    it('should include Secure flag when NODE_ENV=production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      clearSessionCookie(mockReply);

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).toContain('Secure');
      expect(headers['Set-Cookie']).toContain('Max-Age=0');
      expect(headers['Set-Cookie']).toContain('HttpOnly');

      process.env.NODE_ENV = originalEnv;
    });

    it('should NOT include Secure flag when NODE_ENV=development', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      clearSessionCookie(mockReply);

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).not.toContain('Secure');
      expect(headers['Set-Cookie']).toContain('Max-Age=0');

      process.env.NODE_ENV = originalEnv;
    });

    it('should NOT include Secure flag when NODE_ENV is not set', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      clearSessionCookie(mockReply);

      expect(headers['Set-Cookie']).toBeDefined();
      expect(headers['Set-Cookie']).not.toContain('Secure');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Cookie Structure Verification', () => {
    it('should maintain all required cookie attributes in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      setSessionCookie(mockReply, 'test-token-123');

      const cookie = headers['Set-Cookie'];
      
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=86400');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('agent-platform-session=test-token-123');

      process.env.NODE_ENV = originalEnv;
    });

    it('should properly clear cookie with all attributes', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const headers: Record<string, string> = {};
      const mockReply = {
        header: (name: string, value: string) => {
          headers[name] = value;
          return mockReply;
        },
      } as unknown as FastifyReply;

      clearSessionCookie(mockReply);

      const cookie = headers['Set-Cookie'];
      
      expect(cookie).toContain('agent-platform-session=');
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Secure');

      process.env.NODE_ENV = originalEnv;
    });
  });
});