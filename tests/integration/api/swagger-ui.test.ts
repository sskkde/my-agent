import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext } from '../../helpers/auth.js';
import type { AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Swagger UI', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
  });

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  });

  it('GET /api/docs should return Swagger UI page', async () => {
    const response = await fetch(`${baseUrl}/api/v1/docs`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.toLowerCase()).toContain('swagger');
  });

  it('GET /api/docs/json should return valid OpenAPI JSON', async () => {
    const response = await fetch(`${baseUrl}/api/v1/docs/json`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.openapi).toBeDefined();
    expect(body.info).toBeDefined();
    expect((body.info as Record<string, unknown>).title).toBeDefined();
    expect(body.paths).toBeDefined();
  });

  it('GET /api/docs/json should include API info', async () => {
    const response = await fetch(`${baseUrl}/api/v1/docs/json`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const info = body.info as Record<string, unknown>;
    expect(info.title).toBe('Agent Platform API');
    expect(info.version).toBe('0.7.0-rc.1');
  });

  it('GET /api/docs/json should include security schemes', async () => {
    const response = await fetch(`${baseUrl}/api/v1/docs/json`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const components = body.components as Record<string, unknown>;
    expect(components.securitySchemes).toBeDefined();
    const securitySchemes = components.securitySchemes as Record<string, unknown>;
    expect(securitySchemes.cookieSession).toBeDefined();
  });

  it('GET /api/docs/json should include key endpoints', async () => {
    const response = await fetch(`${baseUrl}/api/v1/docs/json`);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    const paths = body.paths as Record<string, unknown>;
    
    expect(paths['/api/v1/health']).toBeDefined();
    expect(paths['/api/v1/sessions']).toBeDefined();
    expect(paths['/api/v1/auth/login']).toBeDefined();
    expect(paths['/api/v1/approvals']).toBeDefined();
    expect(paths['/api/v1/providers']).toBeDefined();
    expect(paths['/api/v1/workflows/drafts']).toBeDefined();
    expect(paths['/api/v1/triggers/schedules']).toBeDefined();
    expect(paths['/api/v1/memory']).toBeDefined();
    expect(paths['/api/v1/observability/runs']).toBeDefined();
    expect(paths['/api/v1/connectors']).toBeDefined();
  });
});
