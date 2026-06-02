import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApiServer } from '../../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Routes', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let baseUrl: string;

  beforeEach(async () => {
    const ctxResult = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`);
    }
    context = ctxResult;

    server = await createApiServer(context);
    await server.listen();
    const address = server.server.address();
    baseUrl = `http://localhost:${(address as any).port}`;
  });

  afterEach(async () => {
    await server.close();
    context.connection.close();
  });

  async function createUserAndLogin(username: string, password: string): Promise<string> {
    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    expect(setupResponse.status).toBe(201);
    const setCookieHeader = setupResponse.headers.get('set-cookie');
    expect(setCookieHeader).toBeDefined();
    await setupResponse.text();
    return setCookieHeader!;
  }



  describe('GET /api/setup/status', () => {
    it('should return needsSetup=true when no users exist', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`);
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { needsSetup: boolean } };
      expect(body.data.needsSetup).toBe(true);
    });

    it('should return needsSetup=false after user is created', async () => {
      await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/setup/status`);
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { needsSetup: boolean } };
      expect(body.data.needsSetup).toBe(false);
    });
  });

  describe('POST /api/setup/user', () => {
    it('should create first user successfully', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newuser', password: 'password123' }),
      });

      expect(response.status).toBe(201);

      const body = await response.json() as { data: { user: { userId: string; username: string } } };
      expect(body.data.user.username).toBe('newuser');
      expect(body.data.user.userId).toBeDefined();

      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('agent-platform-session');
      expect(setCookieHeader).toContain('HttpOnly');
    });

    it('should return 409 if users already exist', async () => {
      await createUserAndLogin('firstuser', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'seconduser', password: 'password123' }),
      });

      expect(response.status).toBe(409);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('CONFLICT');
    });

    it('should return 400 for empty username', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '', password: 'password123' }),
      });

      expect(response.status).toBe(400);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for empty password', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user', password: '' }),
      });

      expect(response.status).toBe(400);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      });

      expect(response.status).toBe(200);

      const body = await response.json() as { data: { user: { username: string } } };
      expect(body.data.user.username).toBe('admin');

      const setCookieHeader = response.headers.get('set-cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain('agent-platform-session');
    });

    it('should return 401 for invalid username', async () => {
      await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nonexistent', password: 'password123' }),
      });

      expect(response.status).toBe(401);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for invalid password', async () => {
      await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrongpassword' }),
      });

      expect(response.status).toBe(401);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 400 for missing username', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'password123' }),
      });

      expect(response.status).toBe(400);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout and clear cookie', async () => {
      const cookie = await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Cookie': cookie },
      });

      expect(response.status).toBe(200);

      const body = await response.json() as { data: { success: boolean } };
      expect(body.data.success).toBe(true);

      const clearCookieHeader = response.headers.get('set-cookie');
      expect(clearCookieHeader).toBeDefined();
      expect(clearCookieHeader).toContain('Max-Age=0');
    });

    it('should return 200 even without a cookie', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
      });

      expect(response.status).toBe(200);

      const body = await response.json() as { data: { success: boolean } };
      expect(body.data.success).toBe(true);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user when authenticated', async () => {
      const cookie = await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { 'Cookie': cookie },
      });

      expect(response.status).toBe(200);

      const body = await response.json() as { data: { user: { username: string; userId: string } } };
      expect(body.data.user.username).toBe('admin');
      expect(body.data.user.userId).toBeDefined();
    });

    it('should return 401 when not authenticated', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`);

      expect(response.status).toBe(401);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 with invalid session cookie', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { 'Cookie': 'agent-platform-session=invalid-token' },
      });

      expect(response.status).toBe(401);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Auth Middleware - Protected Routes', () => {
    it('should allow access to /api/health without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);
      await response.text();
    });

    it('should allow access to /api/setup/status without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`);
      expect(response.status).toBe(200);
      await response.text();
    });

    it('should reject /api/sessions without auth', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`);
      expect(response.status).toBe(401);

      const body = await response.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow /api/sessions with valid session', async () => {
      const cookie = await createUserAndLogin('admin', 'password123');

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Cookie': cookie },
      });

      expect(response.status).toBe(200);
      await response.text();
    });
  });

  describe('Session Migration During Setup', () => {
    it('should migrate existing local-user sessions to new operator user', async () => {
      const LOCAL_USER_ID = 'local-user';
      const TEST_SESSION_ID = 'test-session-123';

      (context as any).stores.sessionStore.create({
        sessionId: TEST_SESSION_ID,
        userId: LOCAL_USER_ID,
        title: 'Test Session',
        status: 'active',
        messageCount: 0,
      });

      const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'operator', password: 'password123' }),
      });

      expect(setupResponse.status).toBe(201);
      const setupBody = await setupResponse.json() as { data: { user: { userId: string; username: string } } };
      const newUserId = setupBody.data.user.userId;
      expect(setupBody.data.user.username).toBe('operator');

      const cookie = setupResponse.headers.get('set-cookie');
      expect(cookie).toBeDefined();

      const listResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { 'Cookie': cookie! },
      });

      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as { data: { items: Array<{ sessionId: string; userId: string }>; total: number } };
      expect(listBody.data.total).toBe(1);
      expect(listBody.data.items[0].sessionId).toBe(TEST_SESSION_ID);
      expect(listBody.data.items[0].userId).toBe(newUserId);

      const getResponse = await fetch(`${baseUrl}/api/v1/sessions/${TEST_SESSION_ID}`, {
        headers: { 'Cookie': cookie! },
      });

      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json() as { data: { session: { sessionId: string; userId: string } } };
      expect(getBody.data.session.userId).toBe(newUserId);
    });

    it('should create new sessions under authenticated user after setup', async () => {
      const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin2', password: 'password123' }),
      });

      expect(setupResponse.status).toBe(201);
      const setupBody = await setupResponse.json() as { data: { user: { userId: string } } };
      const userId = setupBody.data.user.userId;

      const cookie = setupResponse.headers.get('set-cookie');
      expect(cookie).toBeDefined();

      const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookie! },
        body: JSON.stringify({}),
      });

      expect(sessionResponse.status).toBe(201);
      const createBody = await sessionResponse.json() as { data: { session: { sessionId: string; userId: string } } };
      expect(createBody.data.session.userId).toBe(userId);
    });
  });
});
