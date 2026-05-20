import { describe, it, expect, vi } from 'vitest';
import {
  V1_PREFIX,
  withV1Prefix,
  createLegacyRedirect,
  ROUTE_MAP,
} from '../../../src/api/v1-prefix.js';

describe('v1-prefix utilities', () => {
  describe('V1_PREFIX constant', () => {
    it('should be /api/v1', () => {
      expect(V1_PREFIX).toBe('/api/v1');
    });
  });

  describe('withV1Prefix', () => {
    it('should prepend /api/v1/ to path without leading slash', () => {
      expect(withV1Prefix('health')).toBe('/api/v1/health');
    });

    it('should prepend /api/v1/ to path with leading slash', () => {
      expect(withV1Prefix('/health')).toBe('/api/v1/health');
    });

    it('should handle paths with multiple segments', () => {
      expect(withV1Prefix('/sessions/:sessionId/messages')).toBe('/api/v1/sessions/:sessionId/messages');
    });

    it('should handle root path', () => {
      expect(withV1Prefix('/')).toBe('/api/v1/');
    });

    it('should handle empty path', () => {
      expect(withV1Prefix('')).toBe('/api/v1/');
    });

    it('should not double prefix if already has /api/v1/', () => {
      expect(withV1Prefix('/api/v1/health')).toBe('/api/v1/health');
    });
  });

  describe('createLegacyRedirect', () => {
    it('should return Fastify route options with 307 redirect', () => {
      const routeOptions = createLegacyRedirect('/api/health', '/api/v1/health');

      expect(routeOptions.method).toBe('GET');
      expect(routeOptions.url).toBe('/api/health');
      expect(routeOptions.handler).toBeDefined();
    });

    it('should support custom HTTP method', () => {
      const routeOptions = createLegacyRedirect('/api/sessions', '/api/v1/sessions', 'POST');

      expect(routeOptions.method).toBe('POST');
    });

    it('should support wildcard routes for parameterized paths', () => {
      const routeOptions = createLegacyRedirect('/api/sessions/:sessionId', '/api/v1/sessions/:sessionId');

      expect(routeOptions.url).toBe('/api/sessions/:sessionId');
    });

    it('should return redirect handler that sets 307 status and Location header', async () => {
      const routeOptions = createLegacyRedirect('/api/health', '/api/v1/health');

      // Mock Fastify request and reply
      const mockRequest = {
        params: {},
      };

      const mockReply = {
        code: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis(),
        header: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      // Call the handler
      await routeOptions.handler.call(null as any, mockRequest as any, mockReply as any);

      expect(mockReply.redirect).toHaveBeenCalledWith('/api/v1/health', 307);
    });

    it('should interpolate params in redirect URL', async () => {
      const routeOptions = createLegacyRedirect(
        '/api/sessions/:sessionId',
        '/api/v1/sessions/:sessionId'
      );

      const mockRequest = {
        params: { sessionId: 'session-123' },
      };

      const mockReply = {
        redirect: vi.fn().mockReturnThis(),
      };

      await routeOptions.handler.call(null as any, mockRequest as any, mockReply as any);

      expect(mockReply.redirect).toHaveBeenCalledWith('/api/v1/sessions/session-123', 307);
    });
  });

  describe('ROUTE_MAP', () => {
    it('should be a Record<string, string> mapping legacy routes to v1 routes', () => {
      expect(ROUTE_MAP).toBeDefined();
      expect(typeof ROUTE_MAP).toBe('object');
    });

    it('should contain health routes', () => {
      expect(ROUTE_MAP['/api/health']).toBe('/api/v1/health');
      expect(ROUTE_MAP['/api/health/ready']).toBe('/api/v1/health/ready');
    });

    it('should contain sessions routes', () => {
      expect(ROUTE_MAP['/api/sessions']).toBe('/api/v1/sessions');
    });

    it('should contain auth routes', () => {
      expect(ROUTE_MAP['/api/auth/login']).toBe('/api/v1/auth/login');
      expect(ROUTE_MAP['/api/auth/logout']).toBe('/api/v1/auth/logout');
      expect(ROUTE_MAP['/api/auth/me']).toBe('/api/v1/auth/me');
    });

    it('should contain tools routes', () => {
      expect(ROUTE_MAP['/api/tools']).toBe('/api/v1/tools');
    });

    it('should contain agents routes', () => {
      expect(ROUTE_MAP['/api/agents/:agentId/config']).toBe('/api/v1/agents/:agentId/config');
    });

    it('should have all 24 route modules covered', () => {
      // Verify that ROUTE_MAP has entries from all major route categories
      const routeCategories = [
        'sessions', 'health', 'approvals', 'runs', 'usage', 'logs',
        'debug', 'instances', 'channels', 'skills', 'settings', 'setup',
        'auth', 'providers', 'models', 'tools', 'agents', 'memory',
        'workflows', 'tool-results', 'triggers', 'connectors', 'planner-runs',
        'observability'
      ];

      for (const category of routeCategories) {
        const hasCategoryRoute = Object.keys(ROUTE_MAP).some(
          route => route.includes(category)
        );
        expect(hasCategoryRoute, `Missing routes for category: ${category}`).toBe(true);
      }
    });

    it('should map all routes to /api/v1/* paths', () => {
      for (const [legacy, v1] of Object.entries(ROUTE_MAP)) {
        const v1Path = v1 as string;
        expect(v1Path.startsWith('/api/v1/'), `Route ${legacy} should map to /api/v1/*`).toBe(true);
      }
    });
  });
});
