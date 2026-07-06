# Project Issue Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate the ten confirmed backend, frontend, and MCP issues from the 2026-07-06 review with tests and audit verification.

**Architecture:** Add small storage and middleware changes in the backend, keep route behavior local to existing files, and avoid broad policy rewrites. Frontend and MCP work are isolated to their package directories so dependency and test gates can run independently.

**Tech Stack:** TypeScript, Fastify, SQLite via `ConnectionManager`, Vitest, ESLint, React 18, Vite/Vitest, MCP SDK, ExcelJS, pptxgenjs.

## Global Constraints

- Preserve the current tenant behavior: `resolveTenant` still resolves all users to `org_default`.
- Feishu encrypted payload decryption is not in scope; when `encryptKey` is configured, inbound verification must fail closed.
- Keep legacy redirects at status `307` and do not change `LEGACY_ROUTE_DEFINITIONS` inventory.
- Workdir text reads must reject files larger than `WORKDIR_TEXT_READ_MAX_BYTES = 1 * 1024 * 1024`.
- Workdir downloads must keep the existing `WORKDIR_MAX_FILE_BYTES` limit and stream file content.
- System settings defaults are `rateLimitPerMinute=60`, `rateLimitPerHour=1000`, `sessionTokenTtlHours=24`.
- System settings limits are positive integers; `sessionTokenTtlHours <= 168`; rate limits `<= 100000`.
- MCP document workspace root uses `MINIMAX_DOCUMENT_WORKSPACE_ROOT` when set, otherwise canonical `process.cwd()`.
- Do not commit during implementation unless the user explicitly asks for a commit.

---

## File Structure

- Modify: `src/storage/all-stores-migrations.ts` - add `users.status` and `system_settings` migrations after v67 and append them to `allStoreMigrations`.
- Modify: `src/storage/user-store.ts` - expose `UserStatus`, persist `status`, and add `updateStatus(userId, status, tenantId)`.
- Create: `src/storage/system-settings-store.ts` - typed defaults, validation, `get(tenantId)`, and `update(partial, tenantId)`.
- Modify: `src/api/context.ts` - create and expose `systemSettingsStore` through `ApiContext.stores`.
- Modify: `src/api/routes/admin.ts` - return and persist real user statuses and system settings.
- Modify: `src/api/routes/auth.ts` - reject disabled users and read session TTL from settings.
- Modify: `src/api/routes/setup.ts` - read setup session TTL from settings.
- Modify: `src/api/middleware/auth.ts` - reject disabled users with existing session tokens.
- Modify: `src/api/middleware/api-key-auth.ts` - accept `UserStore`, reject disabled user-bound API keys, keep service keys with `userId === null` working.
- Modify: `src/api/middleware/rate-limit.ts` - accept `systemSettingsStore` and read `rateLimitPerMinute` in the `max()` callback.
- Modify: `src/api/middleware/auth-token.ts` - add `/api/v1/messaging/*` to default exemptions.
- Modify: `src/api/server.ts` - pass `systemSettingsStore` to rate limit and pass `userStore` to API key auth.
- Modify: `src/connectors/messaging/providers/dingtalk.ts` - fail closed when `signSecret` is missing.
- Modify: `src/connectors/messaging/providers/feishu.ts` - fail closed when `encryptKey` is configured.
- Modify: `src/api/routes/workdirs.ts` - use async text read, text read cap, streaming download, and filename sanitization.
- Modify: `src/api/v1-prefix.ts` - preserve query strings in legacy redirects.
- Modify: `web/src/components/timeline/TimelineEventCard.tsx` - block-scope default branch lexical declaration.
- Modify: `web/package.json` and `web/package-lock.json` - upgrade vulnerable frontend dependencies.
- Create: `mcp-servers/minimax-document-mcp/src/workspace-root.ts` - canonical document workspace root resolver.
- Modify: `mcp-servers/minimax-document-mcp/src/index.ts` - use document workspace root for `xlsx.read` and `xlsx.validate`.
- Modify: `mcp-servers/minimax-document-mcp/src/tools/pptx-generate.ts` - move right column inside the slide canvas.
- Modify: `mcp-servers/minimax-document-mcp/package.json` and `package-lock.json` - add `uuid` override or record audited dependency resolution.
- Modify tests listed in each task.

---

### Task 1: User Status Persistence And Auth Gates

**Files:**
- Modify: `src/storage/all-stores-migrations.ts`
- Modify: `src/storage/user-store.ts`
- Modify: `src/api/context.ts`
- Modify: `src/api/routes/admin.ts`
- Modify: `src/api/routes/auth.ts`
- Modify: `src/api/middleware/auth.ts`
- Modify: `src/api/middleware/api-key-auth.ts`
- Modify: `src/api/server.ts`
- Test: `tests/integration/api/auth.test.ts`
- Test: `tests/security/api-key-auth.test.ts`

**Interfaces:**
- Produces: `export type UserStatus = 'active' | 'disabled'` in `src/storage/user-store.ts`.
- Produces: `User.status: UserStatus`.
- Produces: `UserStore.updateStatus(userId: string, status: UserStatus, tenantId?: string): User | null`.
- Produces: `registerApiKeyAuth(server: FastifyInstance, apiKeyStore: ApiKeyStore, userStore?: UserStore): void`.

- [ ] **Step 1: Write failing tests for disabled users**

Add these imports to `tests/integration/api/auth.test.ts`:

```ts
import { hashPassword } from '../../../src/storage/auth-crypto.js'
```

Add these tests inside the `describe('Auth Routes', () => { ... })` block:

```ts
  describe('Disabled users', () => {
    it('persists disabled status in admin user list', async () => {
      const adminCookie = await createUserAndLogin('admin', 'password123')
      const passwordHash = await hashPassword('password456')
      const disabledUser = context.stores.userStore.create({
        userId: 'disabled-user-1',
        username: 'disableduser',
        passwordHash,
      })

      const patchResponse = await fetch(`${baseUrl}/api/v1/admin/users/${disabledUser.userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ status: 'disabled' }),
      })
      expect(patchResponse.status).toBe(200)

      const listResponse = await fetch(`${baseUrl}/api/v1/admin/users`, {
        headers: { Cookie: adminCookie },
      })
      expect(listResponse.status).toBe(200)
      const listBody = (await listResponse.json()) as {
        data: { users: Array<{ userId: string; status: string }> }
      }
      expect(listBody.data.users.find((user) => user.userId === disabledUser.userId)?.status).toBe('disabled')
    })

    it('rejects login for disabled users', async () => {
      const adminCookie = await createUserAndLogin('admin', 'password123')
      const passwordHash = await hashPassword('password456')
      const disabledUser = context.stores.userStore.create({
        userId: 'disabled-user-2',
        username: 'nologin',
        passwordHash,
      })
      context.stores.userStore.updateStatus(disabledUser.userId, 'disabled')

      const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ username: 'nologin', password: 'password456' }),
      })
      expect(response.status).toBe(401)
      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe('UNAUTHORIZED')
    })

    it('rejects existing sessions for disabled users', async () => {
      await createUserAndLogin('admin', 'password123')
      const passwordHash = await hashPassword('password456')
      const targetUser = context.stores.userStore.create({
        userId: 'disabled-user-3',
        username: 'sessionuser',
        passwordHash,
      })

      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'sessionuser', password: 'password456' }),
      })
      expect(loginResponse.status).toBe(200)
      const targetCookie = loginResponse.headers.get('set-cookie')
      expect(targetCookie).toBeDefined()

      context.stores.userStore.updateStatus(targetUser.userId, 'disabled')

      const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: targetCookie! },
      })
      expect(meResponse.status).toBe(401)
    })
  })
```

Add this test to `tests/security/api-key-auth.test.ts` inside `describe('API Key Usage', () => { ... })`:

```ts
    it('rejects API keys bound to disabled users', async () => {
      const result = await createUserAndLogin('api-disabled-user', 'password123')
      const apiKey = await createApiKey(result.cookie, 'Disabled User Key', 'user')
      context.stores.userStore.updateStatus(result.userId, 'disabled')

      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Authorization: `Bearer ${apiKey.key}` },
      })

      expect(response.status).toBe(401)
      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
    })
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/integration/api/auth.test.ts tests/security/api-key-auth.test.ts --maxWorkers=1`

Expected: FAIL before implementation. Failures should mention missing `updateStatus`, missing `status`, or disabled users still authenticating.

- [ ] **Step 3: Add user status storage**

In `src/storage/all-stores-migrations.ts`, add this migration before `allStoreMigrations`:

```ts
export const usersStatusColumnMigration: Migration = {
  version: 68,
  name: 'add_users_status_column',
  up: `
    ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK(status IN ('active', 'disabled'));
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(tenant_id, status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_users_status
  `,
}
```

Append it after `workDirectoriesTableMigration` in `allStoreMigrations`:

```ts
  // User disabled state
  usersStatusColumnMigration, // v68
```

In `src/storage/user-store.ts`, add the type and interface members:

```ts
export type UserStatus = 'active' | 'disabled'

export interface User {
  userId: string
  username: string
  passwordHash: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

export interface UserStore {
  create(input: CreateUserInput, tenantId?: string): User
  getById(userId: string, tenantId?: string): User | null
  getByUsername(username: string, tenantId?: string): User | null
  getFirstCreated(tenantId?: string): User | null
  list(tenantId?: string): User[]
  updatePassword(userId: string, passwordHash: string, tenantId?: string): boolean
  updateStatus(userId: string, status: UserStatus, tenantId?: string): User | null
}

interface UserRow {
  user_id: string
  username: string
  password_hash: string
  role: UserRole
  status: UserStatus
  created_at: string
  updated_at: string
}
```

Update `create`, add `updateStatus`, and map `status`:

```ts
  create(input: CreateUserInput, tenantId: string = DEFAULT_TENANT_ID): User {
    const isFirstUser = this.getFirstCreated(tenantId) === null
    const role = input.role ?? (isFirstUser ? 'admin' : 'user')
    const now = new Date().toISOString()
    const user: User = {
      userId: input.userId,
      username: input.username,
      passwordHash: input.passwordHash,
      role,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }

    const sql = `
      INSERT INTO users (
        user_id, username, password_hash, role, status, created_at, updated_at, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      user.userId,
      user.username,
      user.passwordHash,
      user.role,
      user.status,
      user.createdAt,
      user.updatedAt,
      tenantId,
    ]

    this.connection.exec(sql, params)
    return user
  }

  updateStatus(userId: string, status: UserStatus, tenantId: string = DEFAULT_TENANT_ID): User | null {
    const now = new Date().toISOString()
    this.connection.exec(
      'UPDATE users SET status = ?, updated_at = ? WHERE tenant_id = ? AND user_id = ?',
      [status, now, tenantId, userId],
    )
    return this.getById(userId, tenantId)
  }

  private rowToUser(row: UserRow): User {
    return {
      userId: row.user_id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
```

- [ ] **Step 4: Enforce disabled status in auth paths**

In `src/api/routes/admin.ts`, import `UserStatus`, validate status, and return stored status:

```ts
import type { UserRole, UserStatus } from '../../storage/user-store.js'

const VALID_STATUSES: UserStatus[] = ['active', 'disabled']

function toAdminUser(user: {
  userId: string
  username: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}) {
  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}
```

Replace the status route handler body with:

```ts
      const { status } = request.body
      if (!VALID_STATUSES.includes(status)) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid user status', request.requestId))
      }
      const user = userStore.updateStatus(request.params.userId, status)
      if (!user) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'User not found', request.requestId))
      }
      return reply.code(200).send(success({ user: toAdminUser(user) }, request.requestId))
```

In `src/api/routes/auth.ts`, reject disabled users before password verification and before issuing a response from `/me`:

```ts
      if (user.status === 'disabled') {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid username or password', request.requestId))
      }
```

```ts
    if (user.status === 'disabled') {
      return reply.code(401).send(envelopeError('UNAUTHORIZED', 'User disabled', request.requestId))
    }
```

In `src/api/middleware/auth.ts`, reject disabled users:

```ts
  const user = userStore.getById(authToken.userId)
  if (!user || user.status === 'disabled') {
    return null
  }
```

In `src/api/middleware/api-key-auth.ts`, add the import and optional store parameter:

```ts
import type { UserRole, UserStore } from '../../storage/user-store.js'
```

```ts
export async function authenticateApiKey(
  request: FastifyRequest,
  apiKeyStore: ApiKeyStore,
  userStore?: UserStore,
): Promise<ApiKeyIdentity | null> {
```

After expiry validation and before `updateLastUsed`, add:

```ts
  if (apiKey.userId && userStore) {
    const user = userStore.getById(apiKey.userId)
    if (!user || user.status === 'disabled') {
      return null
    }
  }
```

Change registration to pass the store and use `UserRole`:

```ts
export function registerApiKeyAuth(server: FastifyInstance, apiKeyStore: ApiKeyStore, userStore?: UserStore): void {
```

```ts
    const identity = await authenticateApiKey(request, apiKeyStore, userStore)
```

```ts
        role: identity.role as UserRole,
```

In `src/api/server.ts`, change API key auth registration:

```ts
    registerApiKeyAuth(server, context.stores.apiKeyStore, context.stores.userStore)
```

- [ ] **Step 5: Run user status tests**

Run: `npx vitest run tests/integration/api/auth.test.ts tests/security/api-key-auth.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Review diff without committing**

Run: `git diff -- src/storage/all-stores-migrations.ts src/storage/user-store.ts src/api/routes/admin.ts src/api/routes/auth.ts src/api/middleware/auth.ts src/api/middleware/api-key-auth.ts src/api/server.ts tests/integration/api/auth.test.ts tests/security/api-key-auth.test.ts`

Expected: diff only contains user status persistence and disabled-user auth enforcement.

---

### Task 2: Persistent System Settings And Runtime Consumers

**Files:**
- Modify: `src/storage/all-stores-migrations.ts`
- Create: `src/storage/system-settings-store.ts`
- Modify: `src/api/context.ts`
- Modify: `src/api/routes/admin.ts`
- Modify: `src/api/routes/auth.ts`
- Modify: `src/api/routes/setup.ts`
- Modify: `src/api/middleware/rate-limit.ts`
- Modify: `src/api/server.ts`
- Test: `tests/integration/api/auth.test.ts`
- Test: `tests/integration/api/rate-limit.test.ts`

**Interfaces:**
- Produces: `SystemSettings` with `rateLimitPerMinute`, `rateLimitPerHour`, `sessionTokenTtlHours`.
- Produces: `SystemSettingsStore.get(tenantId?: string): SystemSettings`.
- Produces: `SystemSettingsStore.update(partial: Partial<SystemSettings>, tenantId?: string): SystemSettings`.
- Consumes: `ApiContext.stores.systemSettingsStore`.

- [ ] **Step 1: Write failing tests for persisted settings and session TTL**

Add this test to `tests/integration/api/auth.test.ts` inside `describe('Auth Routes', () => { ... })`:

```ts
  describe('System settings session TTL', () => {
    it('uses configured sessionTokenTtlHours for login tokens', async () => {
      const cookie = await createUserAndLogin('admin', 'password123')
      const settingsResponse = await fetch(`${baseUrl}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ sessionTokenTtlHours: 2 }),
      })
      expect(settingsResponse.status).toBe(200)

      const beforeLogin = Date.now()
      const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'password123' }),
      })
      expect(loginResponse.status).toBe(200)
      const storedToken = context.connection.query<{ expires_at: string }>(
        'SELECT expires_at FROM auth_tokens ORDER BY created_at DESC LIMIT 1',
      )[0]
      const ttlMs = new Date(storedToken.expires_at).getTime() - beforeLogin
      expect(ttlMs).toBeGreaterThan(110 * 60 * 1000)
      expect(ttlMs).toBeLessThan(130 * 60 * 1000)
    })
  })
```

Add this test to `tests/integration/api/auth.test.ts`:

```ts
  describe('Admin settings persistence', () => {
    it('persists PATCH /api/v1/admin/settings and returns the same values on GET', async () => {
      const cookie = await createUserAndLogin('admin', 'password123')

      const patchResponse = await fetch(`${baseUrl}/api/v1/admin/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ rateLimitPerMinute: 77, rateLimitPerHour: 1700, sessionTokenTtlHours: 12 }),
      })
      expect(patchResponse.status).toBe(200)

      const getResponse = await fetch(`${baseUrl}/api/v1/admin/settings`, {
        headers: { Cookie: cookie },
      })
      expect(getResponse.status).toBe(200)
      const body = (await getResponse.json()) as { data: { settings: Record<string, number> } }
      expect(body.data.settings).toEqual({
        rateLimitPerMinute: 77,
        rateLimitPerHour: 1700,
        sessionTokenTtlHours: 12,
      })
    })
  })
```

Add this test to `tests/integration/api/rate-limit.test.ts` inside `describe('registerRateLimitMiddleware defaults', () => { ... })`:

```ts
    it('uses system settings store for non-auth request limits', async () => {
      const server = Fastify({ logger: false })
      await registerRateLimitMiddleware(server, {
        authMax: 10,
        systemSettingsStore: {
          get: () => ({ rateLimitPerMinute: 2, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 }),
          update: () => ({ rateLimitPerMinute: 2, rateLimitPerHour: 1000, sessionTokenTtlHours: 24 }),
        },
      })
      server.get('/limited', async () => ({ ok: true }))
      await server.ready()

      const remoteAddress = '10.0.0.202'
      expect((await server.inject({ method: 'GET', url: '/limited', remoteAddress })).statusCode).toBe(200)
      expect((await server.inject({ method: 'GET', url: '/limited', remoteAddress })).statusCode).toBe(200)
      expect((await server.inject({ method: 'GET', url: '/limited', remoteAddress })).statusCode).toBe(429)

      await server.close()
    })
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/integration/api/auth.test.ts tests/integration/api/rate-limit.test.ts --maxWorkers=1`

Expected: FAIL before implementation. Failures should show admin settings are not persisted and rate limit options lack `systemSettingsStore`.

- [ ] **Step 3: Add system settings storage**

In `src/storage/all-stores-migrations.ts`, add this migration after `usersStatusColumnMigration`:

```ts
export const systemSettingsTableMigration: Migration = {
  version: 69,
  name: 'create_system_settings_table',
  up: `
    CREATE TABLE system_settings (
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    )
  `,
  down: `
    DROP TABLE IF EXISTS system_settings
  `,
}
```

Append it after `usersStatusColumnMigration` in `allStoreMigrations`:

```ts
  // Tenant system settings
  systemSettingsTableMigration, // v69
```

Create `src/storage/system-settings-store.ts`:

```ts
import type { ConnectionManager } from './connection.js'
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-context.js'

export interface SystemSettings {
  rateLimitPerMinute: number
  rateLimitPerHour: number
  sessionTokenTtlHours: number
}

export interface SystemSettingsStore {
  get(tenantId?: string): SystemSettings
  update(partial: Partial<SystemSettings>, tenantId?: string): SystemSettings
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  rateLimitPerMinute: 60,
  rateLimitPerHour: 1000,
  sessionTokenTtlHours: 24,
}

const SETTINGS_KEY = 'runtime'

interface SettingsRow {
  value_json: string
}

function assertPositiveInteger(name: keyof SystemSettings, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  if ((name === 'rateLimitPerMinute' || name === 'rateLimitPerHour') && value > 100000) {
    throw new Error(`${name} must be <= 100000`)
  }
  if (name === 'sessionTokenTtlHours' && value > 168) {
    throw new Error('sessionTokenTtlHours must be <= 168')
  }
}

function normalizeSettings(input: Partial<SystemSettings>): SystemSettings {
  const settings = { ...DEFAULT_SYSTEM_SETTINGS, ...input }
  assertPositiveInteger('rateLimitPerMinute', settings.rateLimitPerMinute)
  assertPositiveInteger('rateLimitPerHour', settings.rateLimitPerHour)
  assertPositiveInteger('sessionTokenTtlHours', settings.sessionTokenTtlHours)
  return settings
}

class SystemSettingsStoreImpl implements SystemSettingsStore {
  constructor(private readonly connection: ConnectionManager) {}

  get(tenantId: string = DEFAULT_TENANT_ID): SystemSettings {
    const rows = this.connection.query<SettingsRow>(
      'SELECT value_json FROM system_settings WHERE tenant_id = ? AND key = ?',
      [tenantId, SETTINGS_KEY],
    )
    if (rows.length === 0) return DEFAULT_SYSTEM_SETTINGS
    const parsed = JSON.parse(rows[0].value_json) as Partial<SystemSettings>
    return normalizeSettings(parsed)
  }

  update(partial: Partial<SystemSettings>, tenantId: string = DEFAULT_TENANT_ID): SystemSettings {
    const settings = normalizeSettings({ ...this.get(tenantId), ...partial })
    const now = new Date().toISOString()
    this.connection.exec(
      `
        INSERT INTO system_settings (tenant_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `,
      [tenantId, SETTINGS_KEY, JSON.stringify(settings), now],
    )
    return settings
  }
}

export function createSystemSettingsStore(connection: ConnectionManager): SystemSettingsStore {
  return new SystemSettingsStoreImpl(connection)
}
```

In `src/api/context.ts`, import, type, create, and expose the store:

```ts
import { createSystemSettingsStore, type SystemSettingsStore } from '../storage/system-settings-store.js'
```

```ts
    systemSettingsStore: SystemSettingsStore
```

```ts
  let systemSettingsStore: SystemSettingsStore
```

```ts
    systemSettingsStore =
      ((existingStores as Record<string, unknown>)?.systemSettingsStore as SystemSettingsStore) ??
      createSystemSettingsStore(connection)
```

```ts
      systemSettingsStore,
```

- [ ] **Step 4: Wire settings into routes and middleware**

In `src/api/routes/admin.ts`, destructure the new store and use it:

```ts
  const { userStore, systemSettingsStore } = context.stores
```

Replace `GET /api/v1/admin/settings` response with:

```ts
    return reply.code(200).send(success({ settings: systemSettingsStore.get() }, request.requestId))
```

Replace `PATCH /api/v1/admin/settings` settings block with:

```ts
      try {
        const settings = systemSettingsStore.update(request.body)
        return reply.code(200).send(success({ settings }, request.requestId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid system settings'
        return reply.code(400).send(envelopeError('BAD_REQUEST', message, request.requestId))
      }
```

In `src/api/routes/auth.ts`, replace `SESSION_TTL_HOURS` usage with:

```ts
      const sessionTtlHours = context.stores.systemSettingsStore.get().sessionTokenTtlHours
      const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000).toISOString()
```

In `src/api/routes/setup.ts`, replace `SESSION_TTL_HOURS` usage with:

```ts
      const sessionTtlHours = context.stores.systemSettingsStore.get().sessionTokenTtlHours
      const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000).toISOString()
```

In `src/api/middleware/rate-limit.ts`, import the type and add the option:

```ts
import type { SystemSettingsStore } from '../../storage/system-settings-store.js'

export interface RateLimitMiddlewareOptions {
  globalMax?: number
  authMax?: number
  timeWindow?: string
  systemSettingsStore?: Pick<SystemSettingsStore, 'get'>
}
```

Replace the non-auth max return with:

```ts
      if (options?.systemSettingsStore) {
        return options.systemSettingsStore.get().rateLimitPerMinute
      }
      return globalMax
```

In `src/api/server.ts`, pass the store:

```ts
    await registerRateLimitMiddleware(server, { systemSettingsStore: context.stores.systemSettingsStore })
```

- [ ] **Step 5: Run settings tests**

Run: `npx vitest run tests/integration/api/auth.test.ts tests/integration/api/rate-limit.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Review diff without committing**

Run: `git diff -- src/storage/all-stores-migrations.ts src/storage/system-settings-store.ts src/api/context.ts src/api/routes/admin.ts src/api/routes/auth.ts src/api/routes/setup.ts src/api/middleware/rate-limit.ts src/api/server.ts tests/integration/api/auth.test.ts tests/integration/api/rate-limit.test.ts`

Expected: diff only contains persistent runtime settings and consumers.

---

### Task 3: Messaging Webhook Auth Alignment And Provider Verification

**Files:**
- Modify: `src/api/middleware/auth-token.ts`
- Modify: `src/connectors/messaging/providers/dingtalk.ts`
- Modify: `src/connectors/messaging/providers/feishu.ts`
- Test: `tests/integration/api/auth-token.test.ts`
- Test: `tests/integration/connectors/messaging/webhook-ingress.test.ts`
- Test: create `tests/unit/connectors/messaging-provider-verification.test.ts`

**Interfaces:**
- Produces: `DEFAULT_EXEMPT_PATHS` in `auth-token.ts` includes `/api/v1/messaging/*`.
- Produces: `DingTalkAdapter.verifyInbound()` returns `false` without `signSecret`.
- Produces: `FeishuAdapter.verifyInbound()` returns `false` when `encryptKey` is configured.

- [ ] **Step 1: Write failing auth-token exemption test**

In `tests/integration/api/auth-token.test.ts`, inside the `when auth is enabled via options` setup, add this route:

```ts
        server.post('/api/v1/messaging/telegram/inst-1/webhook', async () => ({
          ok: true,
          data: { accepted: true },
          requestId: 'test',
        }))
```

Add this test in the same `describe` block:

```ts
      it('should exempt /api/v1/messaging/* from auth token middleware', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/messaging/telegram/inst-1/webhook',
          payload: { update_id: 1 },
        })
        expect(response.statusCode).toBe(200)
      })
```

- [ ] **Step 2: Write provider verification tests**

Create `tests/unit/connectors/messaging-provider-verification.test.ts`:

```ts
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDingTalkAdapter } from '../../../src/connectors/messaging/providers/dingtalk.js'
import { createFeishuAdapter } from '../../../src/connectors/messaging/providers/feishu.js'
import type { MessagingTransport } from '../../../src/connectors/messaging/types.js'

const transport: MessagingTransport = {
  sendText: async () => ({ success: true }),
  verifyWebhook: async () => true,
}

function dingtalkSignature(timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
}

describe('messaging provider inbound verification', () => {
  it('rejects DingTalk inbound callbacks when signSecret is missing', async () => {
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot' },
      transport,
    )

    await expect(adapter.verifyInbound({}, {})).resolves.toBe(false)
  })

  it('accepts DingTalk inbound callbacks with a valid signature', async () => {
    const signSecret = 'secret-123'
    const timestamp = String(Date.now())
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot', signSecret },
      transport,
    )

    await expect(
      adapter.verifyInbound({}, { timestamp, sign: dingtalkSignature(timestamp, signSecret) }),
    ).resolves.toBe(true)
  })

  it('rejects DingTalk inbound callbacks with an invalid signature', async () => {
    const adapter = createDingTalkAdapter(
      { appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot', signSecret: 'secret-123' },
      transport,
    )

    await expect(adapter.verifyInbound({}, { timestamp: String(Date.now()), sign: 'bad-signature' })).resolves.toBe(false)
  })

  it('rejects Feishu callbacks when encryptKey is configured because encrypted payloads are unsupported', async () => {
    const adapter = createFeishuAdapter(
      { appId: 'app-id', appSecret: 'app-secret', verificationToken: 'verify-token', encryptKey: 'encrypt-key' },
      transport,
    )
    const payload = {
      schema: '2.0',
      header: { token: 'verify-token' },
      event: { message: { message_type: 'text' } },
    }

    await expect(adapter.verifyInbound(payload, { 'x-lark-signature': 'present' })).resolves.toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run tests/integration/api/auth-token.test.ts tests/unit/connectors/messaging-provider-verification.test.ts --maxWorkers=1`

Expected: FAIL before implementation. Failures should show messaging path is blocked by auth-token and weak provider verification passes.

- [ ] **Step 4: Implement auth-token exemption and provider gates**

In `src/api/middleware/auth-token.ts`, add the exemption:

```ts
  '/api/v1/messaging/*',
```

In `src/connectors/messaging/providers/dingtalk.ts`, replace the missing-secret branch:

```ts
    if (!signSecret) {
      return false
    }
```

In `src/connectors/messaging/providers/feishu.ts`, replace the `encryptKey` block:

```ts
    if (this.config.encryptKey) {
      return false
    }
```

- [ ] **Step 5: Run messaging security tests**

Run: `npx vitest run tests/integration/api/auth-token.test.ts tests/unit/connectors/messaging-provider-verification.test.ts tests/integration/connectors/messaging/webhook-ingress.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Review diff without committing**

Run: `git diff -- src/api/middleware/auth-token.ts src/connectors/messaging/providers/dingtalk.ts src/connectors/messaging/providers/feishu.ts tests/integration/api/auth-token.test.ts tests/unit/connectors/messaging-provider-verification.test.ts`

Expected: diff only contains auth exemption and fail-closed provider verification.

---

### Task 4: Workdir File API Async Reads And Streaming Downloads

**Files:**
- Modify: `src/api/routes/workdirs.ts`
- Test: `tests/integration/api/workdirs-api.test.ts`

**Interfaces:**
- Produces: `WORKDIR_TEXT_READ_MAX_BYTES = 1 * 1024 * 1024` in `src/api/routes/workdirs.ts`.
- Produces: `sanitizeDownloadFileName(filePath: string): string` in `src/api/routes/workdirs.ts`.
- Consumes: existing `WORKDIR_MAX_FILE_BYTES` download cap.

- [ ] **Step 1: Write failing tests for text cap and header sanitization**

In `tests/integration/api/workdirs-api.test.ts`, update the imports:

```ts
import { WORKDIR_MAX_FILE_BYTES } from '../../../src/workdirs/workdir-paths.js'
```

Add this constant near the response interfaces:

```ts
const WORKDIR_TEXT_READ_MAX_BYTES = 1 * 1024 * 1024
```

Replace the oversized read test body with:

```ts
      const largeFilePath = path.join(workdirPath, 'oversized-read.txt')
      const handle = fs.openSync(largeFilePath, 'w')
      fs.writeSync(handle, Buffer.from('x'), 0, 1, WORKDIR_TEXT_READ_MAX_BYTES)
      fs.closeSync(handle)

      const response = await fetch(`${baseUrl}/api/v1/workdirs/${workdirId}/files?path=oversized-read.txt`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(413)
```

Add this test inside `describe('File Operations', () => { ... })`:

```ts
    it('sanitizes Content-Disposition filenames for downloads', async () => {
      fs.writeFileSync(path.join(workdirPath, 'quoted-name.txt'), 'safe download', 'utf-8')

      const response = await fetch(
        `${baseUrl}/api/v1/workdirs/${workdirId}/files/download?path=${encodeURIComponent('quoted-name.txt')}`,
        { headers: { Cookie: authCookie } },
      )

      expect(response.status).toBe(200)
      const disposition = response.headers.get('content-disposition') ?? ''
      expect(disposition).toBe('attachment; filename="quoted-name.txt"')
      expect(disposition).not.toContain('\\')
      expect(disposition).not.toContain('\r')
      expect(disposition).not.toContain('\n')
      expect(await response.text()).toBe('safe download')
    })
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/integration/api/workdirs-api.test.ts --maxWorkers=1`

Expected: FAIL before implementation because text read still allows files up to `WORKDIR_MAX_FILE_BYTES` and download uses `readFileSync`.

- [ ] **Step 3: Implement async read cap and streaming download**

In `src/api/routes/workdirs.ts`, import stream support:

```ts
import { createReadStream } from 'node:fs'
```

Add the text read cap and sanitizer near other constants:

```ts
export const WORKDIR_TEXT_READ_MAX_BYTES = 1 * 1024 * 1024

function sanitizeDownloadFileName(filePath: string): string {
  const baseName = path.basename(filePath)
  const sanitized = baseName.replace(/[\r\n"\\]/g, '')
  return sanitized.length > 0 ? sanitized : 'download'
}
```

Replace the read route `try` block with async filesystem calls:

```ts
      try {
        const stat = await fs.promises.stat(validation.canonicalPath)
        if (stat.isDirectory()) {
          return reply.code(400).send(envelopeError('BAD_REQUEST', 'Path is a directory, not a file', request.requestId))
        }
        if (stat.size > WORKDIR_TEXT_READ_MAX_BYTES) {
          return reply.code(413).send(envelopeError('QUOTA_EXCEEDED', `File exceeds maximum text read size of ${WORKDIR_TEXT_READ_MAX_BYTES} bytes`, request.requestId))
        }

        const content = await fs.promises.readFile(validation.canonicalPath, 'utf-8')
        return reply.code(200).send(
          success(
            {
              path: filePath,
              content,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            },
            request.requestId,
          ),
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send(envelopeError('NOT_FOUND', 'File not found', request.requestId))
        }
        throw error
      }
```

Replace the download success response with a stream:

```ts
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${sanitizeDownloadFileName(filePath)}"`)
          .send(createReadStream(validation.canonicalPath))
```

- [ ] **Step 4: Run workdir API tests**

Run: `npx vitest run tests/integration/api/workdirs-api.test.ts tests/security/workdir-boundary.test.ts tests/security/workdir-permission.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Review diff without committing**

Run: `git diff -- src/api/routes/workdirs.ts tests/integration/api/workdirs-api.test.ts`

Expected: diff only contains async text read cap, stream download, and filename sanitization.

---

### Task 5: Legacy Redirect Query Preservation

**Files:**
- Modify: `src/api/v1-prefix.ts`
- Test: `tests/architecture/api-version-redirect-coverage.test.ts`

**Interfaces:**
- Produces: `createLegacyRedirect()` preserves `request.url` query strings when calling `reply.redirect(path, 307)`.

- [ ] **Step 1: Write failing redirect query test**

Add this test to `tests/architecture/api-version-redirect-coverage.test.ts`:

```ts
  it('preserves query strings when redirecting legacy routes', async () => {
    const redirect = createLegacyRedirect('/api/sessions', '/api/v1/sessions', 'GET')
    const reply = {
      header: vi.fn().mockReturnThis(),
      redirect: vi.fn().mockReturnThis(),
    }

    await (redirect.handler as (request: unknown, reply: unknown) => Promise<unknown>).call(
      null,
      { params: {}, url: '/api/sessions?limit=10&offset=20' },
      reply,
    )

    expect(reply.redirect).toHaveBeenCalledWith('/api/v1/sessions?limit=10&offset=20', 307)
    expect(reply.header).toHaveBeenCalledWith('Link', '</api/v1/sessions?limit=10&offset=20>; rel="successor-version"')
  })
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/architecture/api-version-redirect-coverage.test.ts --maxWorkers=1`

Expected: FAIL before implementation. Redirect target should currently miss the query string.

- [ ] **Step 3: Preserve query strings in redirect target**

In `src/api/v1-prefix.ts`, add this helper above `createLegacyRedirect`:

```ts
function appendOriginalQueryString(requestUrl: string | undefined, redirectPath: string): string {
  if (!requestUrl) return redirectPath
  const queryStart = requestUrl.indexOf('?')
  if (queryStart === -1) return redirectPath
  return `${redirectPath}${requestUrl.slice(queryStart)}`
}
```

In `createLegacyRedirect`, after param replacement, append the query string and use it for headers:

```ts
      redirectPath = appendOriginalQueryString(request.url, redirectPath)

      reply.header('Deprecation', 'true')
      reply.header('Link', `<${redirectPath}>; rel="successor-version"`)

      return reply.redirect(redirectPath, 307)
```

- [ ] **Step 4: Run redirect tests**

Run: `npx vitest run tests/architecture/api-version-redirect-coverage.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Review diff without committing**

Run: `git diff -- src/api/v1-prefix.ts tests/architecture/api-version-redirect-coverage.test.ts`

Expected: diff only contains query preservation for legacy redirects.

---

### Task 6: Frontend Lint Error And Dependency Audit

**Files:**
- Modify: `web/src/components/timeline/TimelineEventCard.tsx`
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

**Interfaces:**
- Produces: no public API changes.
- Preserves: Vite dev server default host and current proxy behavior.

- [ ] **Step 1: Run current frontend lint and audit gates**

Run: `npm --prefix web run lint`

Expected: FAIL with `no-case-declarations` at `web/src/components/timeline/TimelineEventCard.tsx`.

Run: `npm --prefix web audit --audit-level=moderate`

Expected: FAIL with the known `dompurify`, `vite`, `form-data`, and transitive vulnerabilities.

- [ ] **Step 2: Fix `no-case-declarations`**

In `web/src/components/timeline/TimelineEventCard.tsx`, block-scope the `default` branch:

```tsx
      default: {
        if (!event.content && extractAttachments(event.metadata).length === 0) {
          return null
        }

        const attachments = extractAttachments(event.metadata)

        return isChatMessage ? (
          <>
            {event.content && <MessageContent text={event.content} role={messageRole} mode={messageMode} />}
            <AttachmentChips attachments={attachments} />
          </>
        ) : (
          <div className="timeline-event-content">
            {event.content && <MessageContent text={event.content} role={messageRole} mode={messageMode} />}
            <AttachmentChips attachments={attachments} />
          </div>
        )
      }
```

- [ ] **Step 3: Upgrade vulnerable frontend dependencies**

Run: `npm --prefix web install dompurify@latest vite@latest vitest@latest @vitejs/plugin-react@latest jsdom@latest`

Expected: `web/package.json` and `web/package-lock.json` change. The resolved `dompurify` version must be greater than `3.4.10`. The resolved Vite dependency tree must not include vulnerable `esbuild <=0.24.2`.

- [ ] **Step 4: Run frontend verification**

Run: `npm --prefix web run typecheck`

Expected: PASS.

Run: `npm --prefix web run lint`

Expected: PASS with no errors.

Run: `npm --prefix web test -- --run src/components/message/security.test.tsx src/components/timeline/formatMessageContent.test.ts`

Expected: PASS.

Run: `npm --prefix web test`

Expected: PASS or record the exact failing test name and error output for fixes in this task.

Run: `npm --prefix web audit --audit-level=moderate`

Expected: PASS.

- [ ] **Step 5: Review diff without committing**

Run: `git diff -- web/src/components/timeline/TimelineEventCard.tsx web/package.json web/package-lock.json`

Expected: diff only contains the lint block scope and dependency lock updates.

---

### Task 7: MCP XLSX Workspace, PPTX Layout, And Dependency Audit

**Files:**
- Create: `mcp-servers/minimax-document-mcp/src/workspace-root.ts`
- Modify: `mcp-servers/minimax-document-mcp/src/index.ts`
- Modify: `mcp-servers/minimax-document-mcp/src/tools/pptx-generate.ts`
- Modify: `mcp-servers/minimax-document-mcp/package.json`
- Modify: `mcp-servers/minimax-document-mcp/package-lock.json`
- Test: `mcp-servers/minimax-document-mcp/src/workspace-root.test.ts`
- Test: `mcp-servers/minimax-document-mcp/src/tools/xlsx.test.ts`
- Test: `mcp-servers/minimax-document-mcp/src/tools/pptx-generate.test.ts`

**Interfaces:**
- Produces: `resolveDocumentWorkspaceRoot(env?: NodeJS.ProcessEnv): Promise<string>`.
- Produces: `xlsx.read` and `xlsx.validate` use the resolved document root rather than an empty temp workspace.
- Produces: PPTX right column `x` coordinate is inside `LAYOUT_16x9`.

- [ ] **Step 1: Write failing workspace root tests**

Create `mcp-servers/minimax-document-mcp/src/workspace-root.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { resolveDocumentWorkspaceRoot } from './workspace-root.js'

describe('resolveDocumentWorkspaceRoot', () => {
  it('uses MINIMAX_DOCUMENT_WORKSPACE_ROOT when configured', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-doc-root-'))
    await expect(resolveDocumentWorkspaceRoot({ MINIMAX_DOCUMENT_WORKSPACE_ROOT: root })).resolves.toBe(
      await fs.realpath(root),
    )
    await fs.rm(root, { recursive: true, force: true })
  })

  it('uses process.cwd when no env root is configured', async () => {
    await expect(resolveDocumentWorkspaceRoot({})).resolves.toBe(await fs.realpath(process.cwd()))
  })

  it('rejects missing configured roots', async () => {
    await expect(
      resolveDocumentWorkspaceRoot({ MINIMAX_DOCUMENT_WORKSPACE_ROOT: '/definitely/not/present/minimax' }),
    ).rejects.toSatisfy((error: { error?: { code?: string } }) => error.error?.code === 'file_not_found')
  })
})
```

- [ ] **Step 2: Write failing XLSX root behavior tests**

In `mcp-servers/minimax-document-mcp/src/tools/xlsx.test.ts`, add this test to `describe('xlsx.read', () => { ... })`:

```ts
  it('reads from a caller-provided workspace root', async () => {
    const externalRoot = await createWorkspace('xlsx-external-root-test')
    try {
      await fs.copyFile(path.join(FIXTURE_DIR, 'employees.xlsx'), path.join(externalRoot.root, 'employees.xlsx'))

      const result = await readXlsx({ inputPath: 'employees.xlsx' }, externalRoot.root)

      expect(result.sheetName).toBe('Employees')
      expect(result.rows).toHaveLength(5)
    } finally {
      await cleanupWorkspace(externalRoot)
    }
  })
```

- [ ] **Step 3: Run MCP tests to verify failure**

Run: `npm --prefix mcp-servers/minimax-document-mcp test -- src/workspace-root.test.ts src/tools/xlsx.test.ts`

Expected: FAIL before implementation because `workspace-root.ts` does not exist.

- [ ] **Step 4: Add document workspace resolver and wire XLSX tools**

Create `mcp-servers/minimax-document-mcp/src/workspace-root.ts`:

```ts
import * as fs from 'node:fs/promises'
import { createSandboxError } from './sandbox.js'

export async function resolveDocumentWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const configuredRoot = env.MINIMAX_DOCUMENT_WORKSPACE_ROOT?.trim()
  const root = configuredRoot && configuredRoot.length > 0 ? configuredRoot : process.cwd()
  try {
    const stat = await fs.stat(root)
    if (!stat.isDirectory()) {
      throw createSandboxError('file_not_found', `Document workspace root is not a directory: ${root}`)
    }
    return await fs.realpath(root)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      throw error
    }
    throw createSandboxError('file_not_found', `Document workspace root not found: ${root}`)
  }
}
```

In `mcp-servers/minimax-document-mcp/src/index.ts`, import the resolver:

```ts
import { resolveDocumentWorkspaceRoot } from './workspace-root.js'
```

Replace the `xlsx.read` call wrapper:

```ts
        async () => {
          const workspaceRoot = await resolveDocumentWorkspaceRoot()
          return readXlsx(
            {
              inputPath: args.inputPath,
              sheetName: args.sheetName,
              range: args.range,
              headerRow: args.headerRow,
              maxRows: args.maxRows,
            },
            workspaceRoot,
          )
        },
```

Replace the `xlsx.validate` call wrapper:

```ts
        async () => {
          const workspaceRoot = await resolveDocumentWorkspaceRoot()
          return validateXlsx(
            {
              inputPath: args.inputPath,
              rules: args.rules as import('./tools/xlsx.js').ValidationRule[] | undefined,
              sheetName: args.sheetName,
            },
            workspaceRoot,
          )
        },
```

- [ ] **Step 5: Fix PPTX right-column position**

In `mcp-servers/minimax-document-mcp/src/tools/pptx-generate.ts`, replace `x: 50` with `x: 5.0`:

```ts
        slide.addText(rightText, {
          x: 5.0, y: 1.3, w: '45%', h: 4,
          fontSize: 14, valign: 'top',
        })
```

- [ ] **Step 6: Add MCP dependency audit override**

In `mcp-servers/minimax-document-mcp/package.json`, add this top-level field after `devDependencies`:

```json
  "overrides": {
    "uuid": "^11.1.1"
  }
```

Run: `npm --prefix mcp-servers/minimax-document-mcp install`

Expected: `package-lock.json` updates and transitive `uuid` resolves to `>=11.1.1`.

- [ ] **Step 7: Run MCP verification**

Run: `npm --prefix mcp-servers/minimax-document-mcp run typecheck`

Expected: PASS.

Run: `npm --prefix mcp-servers/minimax-document-mcp test`

Expected: PASS.

Run: `npm --prefix mcp-servers/minimax-document-mcp audit --audit-level=moderate`

Expected: PASS. If `exceljs` is incompatible with `uuid@^11.1.1`, remove the override, restore `package-lock.json` for this package, and report the `exceljs -> uuid` audit item as an upstream blocker with the exact audit output.

- [ ] **Step 8: Review diff without committing**

Run: `git diff -- mcp-servers/minimax-document-mcp/src/workspace-root.ts mcp-servers/minimax-document-mcp/src/index.ts mcp-servers/minimax-document-mcp/src/tools/pptx-generate.ts mcp-servers/minimax-document-mcp/package.json mcp-servers/minimax-document-mcp/package-lock.json mcp-servers/minimax-document-mcp/src/workspace-root.test.ts mcp-servers/minimax-document-mcp/src/tools/xlsx.test.ts`

Expected: diff only contains workspace root, PPTX coordinate, and dependency audit work.

---

### Task 8: Full Verification And Completion Evidence

**Files:**
- Read: `git diff`
- Read: `git status --short`
- No source edits unless a verification command fails.

**Interfaces:**
- Consumes: all outputs from Tasks 1-7.
- Produces: final evidence list with exact command results and remaining risks.

- [ ] **Step 1: Run backend gates**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run lint`

Expected: PASS with no errors.

Run: `npm audit --audit-level=moderate`

Expected: PASS.

Run: `npx vitest run tests/integration/api/auth.test.ts tests/security/api-key-auth.test.ts tests/integration/api/auth-token.test.ts tests/integration/api/rate-limit.test.ts tests/integration/api/workdirs-api.test.ts tests/integration/connectors/messaging/webhook-ingress.test.ts tests/architecture/api-version-redirect-coverage.test.ts tests/unit/connectors/messaging-provider-verification.test.ts --maxWorkers=1`

Expected: PASS.

- [ ] **Step 2: Run frontend gates**

Run: `npm --prefix web run typecheck`

Expected: PASS.

Run: `npm --prefix web run lint`

Expected: PASS with no errors.

Run: `npm --prefix web test`

Expected: PASS.

Run: `npm --prefix web audit --audit-level=moderate`

Expected: PASS.

- [ ] **Step 3: Run MCP gates**

Run: `npm --prefix mcp-servers/minimax-document-mcp run typecheck`

Expected: PASS.

Run: `npm --prefix mcp-servers/minimax-document-mcp test`

Expected: PASS.

Run: `npm --prefix mcp-servers/minimax-document-mcp audit --audit-level=moderate`

Expected: PASS or exact blocker recorded for `exceljs -> uuid` if no compatible override or upstream version is available.

- [ ] **Step 4: Inspect final diff and status**

Run: `git status --short`

Expected: only planned source, test, lockfile, spec, and plan files are changed.

Run: `git diff --stat`

Expected: changes match the eight tasks above.

Run: `git diff -- docs/superpowers/specs/2026-07-06-project-issue-remediation-design.md docs/superpowers/plans/2026-07-06-project-issue-remediation.md`

Expected: spec and plan are present for review.

- [ ] **Step 5: Report completion without committing**

Final response must include:

```text
Implemented: user disabled state, system settings persistence, webhook auth/provider hardening, workdir file API safety, legacy redirect query preservation, frontend lint/audit remediation, MCP workspace/PPTX/audit remediation.
Verification: list every command from this task with PASS, FAIL, or BLOCKED.
Not committed: no git commit was created because the user did not request one.
```

---

## Self-Review Checklist

- Spec coverage: Tasks 1-8 map to every requirement in `docs/superpowers/specs/2026-07-06-project-issue-remediation-design.md` sections 3-9.
- Red-flag scan: clean. The plan contains concrete file paths, commands, expected outcomes, and code snippets for each task.
- Type consistency: `UserStatus`, `SystemSettings`, `SystemSettingsStore`, and `resolveDocumentWorkspaceRoot()` names are defined before downstream tasks consume them.
