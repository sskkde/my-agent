import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Health Check', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  it('GET /api/health should return liveness status', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; data: { status: string; timestamp: string } };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBeDefined();
    expect(body.data.timestamp).toBeDefined();
  });

  it('GET /api/health/ready should return readiness status', async () => {
    const response = await fetch(`${baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; data: { status: string; checks: { database: { status: string } } } };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBeDefined();
    expect(body.data.checks).toBeDefined();
    expect(body.data.checks.database).toBeDefined();
  });
});
