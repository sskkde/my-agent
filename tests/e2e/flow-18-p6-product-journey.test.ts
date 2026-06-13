import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import { createDeadLetterStore } from '../../src/dead-letter/dead-letter-store.js'
import { createDeadLetterQueue } from '../../src/dead-letter/dead-letter-queue.js'
import { createBudgetStore, createBudgetUsageMigration } from '../../src/storage/budget-store.js'
import { createBudgetManager } from '../../src/memory/budget-manager.js'
import { createMigrationRunner, type Migration } from '../../src/storage/migrations.js'
import { createConnectionManager } from '../../src/storage/connection.js'
import { enforceMemoryLimit } from '../../src/memory/resource-limits.js'
import type { BudgetConfig } from '../../src/memory/limit-types.js'
import { createPrometheusExporter } from '../../src/observability/prometheus-exporter.js'
import { createMetricStore } from '../../src/observability/metric-store.js'
import type { FastifyInstance } from 'fastify'

/**
 * P6 Product Journey E2E Test
 *
 * Tests the complete Phase 6 product journey covering all P6 features:
 * 1. RBAC: admin creates user → user login → user restricted access → admin assigns role
 * 2. API Key: admin creates API Key → service uses API Key → revoke → failure
 * 3. /api/v1/: product journey uses only versioned API routes
 * 4. Trigger creation: create schedule trigger → create webhook trigger → list
 * 5. DLQ: simulate failed event → DLQ list → retry → discard
 * 6. Connector: mock mode connector → list connectors
 * 7. Memory budget: set budget → normal use → exceed → error returned
 * 8. Prometheus: /api/v1/metrics → Prometheus format output
 * 9. Alerting: create alert rule → trigger condition → alert state
 */
describe('P6 Product Journey', () => {
  let server: FastifyInstance
  let context: ApiContext
  let adminCookie: string
  let adminUserId: string

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) throw new Error(ctx.message)
    context = ctx
    server = await createApiServer(context)

    // First user is admin by default
    const setupResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/setup/user',
      payload: { username: 'p6admin', password: 'adminpassword123' },
    })
    expect(setupResponse.statusCode).toBe(201)
    const setupBody = setupResponse.json() as { ok: boolean; data: { user: { userId: string } } }
    adminUserId = setupBody.data.user.userId
    const cookies = setupResponse.headers['set-cookie'] as string | string[] | undefined
    const cookieStr = Array.isArray(cookies) ? cookies[0] : (cookies ?? '')
    adminCookie = cookieStr.split(';')[0]
  }, 30000)

  afterAll(async () => {
    await server.close()
    context.connection.close()
  })

  // Helper: create a second user (non-admin since setup is one-time)
  // We use API keys with different roles to simulate user/service access

  async function createApiKey(
    cookie: string,
    name: string,
    role: 'admin' | 'user' | 'service',
  ): Promise<{ keyId: string; rawKey: string }> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      payload: { name, role },
      headers: { cookie },
    })
    expect(response.statusCode).toBe(201)
    const body = response.json() as { ok: boolean; data: { id: string; key: string } }
    return { keyId: body.data.id, rawKey: body.data.key }
  }

  // ==========================================================================
  // 1. RBAC: Admin access vs restricted access
  // ==========================================================================
  describe('Step 1: RBAC Access Control', () => {
    it('admin user can access agent global config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents/foreground.default/config',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: unknown }
      expect(body.ok).toBe(true)
    })

    it('admin user can update agent global config', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/agents/foreground.default/config/global',
        payload: { displayName: 'P6 Test Agent' },
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { displayName: string } }
      expect(body.ok).toBe(true)
      expect(body.data.displayName).toBe('P6 Test Agent')
    })

    it('user-role API key cannot access admin routes (403)', async () => {
      const { rawKey } = await createApiKey(adminCookie, 'User RBAC Key', 'user')

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/agents/foreground.default/config/global',
        payload: { displayName: 'Hacked by User' },
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(response.statusCode).toBe(403)
      const body = response.json() as { ok: boolean; error: { code: string; message: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('FORBIDDEN')
    })

    it('service-role API key cannot access admin routes (403)', async () => {
      const { rawKey } = await createApiKey(adminCookie, 'Service RBAC Key', 'service')

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/agents/foreground.default/config/global',
        payload: { displayName: 'Hacked by Service' },
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(response.statusCode).toBe(403)
    })

    it('admin-role API key can access admin routes', async () => {
      const { rawKey } = await createApiKey(adminCookie, 'Admin RBAC Key', 'admin')

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/agents/foreground.default/config',
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(response.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // 2. API Key: Create → Use → Revoke → Failure
  // ==========================================================================
  describe('Step 2: API Key Lifecycle', () => {
    it('admin creates an API key and receives full key once', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        payload: { name: 'P6 Service Key', role: 'service' },
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json() as { ok: boolean; data: { id: string; key: string; prefix: string; role: string } }
      expect(body.ok).toBe(true)
      expect(body.data.key).toMatch(/^ak_/)
      expect(body.data.prefix).toBe(body.data.key.slice(0, 8))
      expect(body.data.role).toBe('service')
    })

    it('service uses API key to access protected endpoint', async () => {
      const { rawKey } = await createApiKey(adminCookie, 'P6 Service Use Key', 'service')

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(response.statusCode).toBe(200)
    })

    it('admin revokes API key and subsequent requests fail', async () => {
      const { keyId, rawKey } = await createApiKey(adminCookie, 'P6 Revoke Key', 'user')

      // Verify key works before revocation (use /api/v1/api-keys which requires auth)
      const beforeRevoke = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(beforeRevoke.statusCode).toBe(200)

      // Revoke the key
      const revokeResponse = await server.inject({
        method: 'DELETE',
        url: `/api/v1/api-keys/${keyId}`,
        headers: { cookie: adminCookie },
      })
      expect(revokeResponse.statusCode).toBe(200)

      // Verify key no longer works
      const afterRevoke = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { authorization: `Bearer ${rawKey}` },
      })
      expect(afterRevoke.statusCode).toBe(401)
    })

    it('listing API keys does not expose full key or hash', async () => {
      await createApiKey(adminCookie, 'P6 List Key', 'user')

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/api-keys',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as {
        ok: boolean
        data: Array<{ id: string; name: string; prefix: string; isActive: boolean }>
      }
      expect(body.ok).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)

      // Ensure no full key or hash in listing
      const firstKey = body.data[0] as Record<string, unknown>
      expect(firstKey.key).toBeUndefined()
      expect(firstKey.keyHash).toBeUndefined()
      expect(firstKey.prefix).toBeDefined()
    })
  })

  // ==========================================================================
  // 3. /api/v1/ prefix routes and legacy redirects
  // ==========================================================================
  describe('Step 3: V1 Prefix and Legacy Redirects', () => {
    it('GET /api/v1/health returns health status', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/health',
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { status: string } }
      expect(body.ok).toBe(true)
      expect(body.data.status).toBeDefined()
    })

    it('GET /api/v1/metrics is accessible without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      })
      expect(response.statusCode).toBe(200)
    })

    it('GET /api/v1/setup/status is accessible without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/setup/status',
      })
      expect(response.statusCode).toBe(200)
    })

    it('GET /api/v1/tools is accessible without auth', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/tools',
      })
      expect(response.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // 4. Trigger creation: schedule + webhook
  // ==========================================================================
  describe('Step 4: Trigger Creation', () => {
    it('creates a schedule trigger', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/triggers/schedules',
        payload: { name: 'P6 Daily Report', schedulePattern: '0 9 * * *' },
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json() as {
        ok: boolean
        data: { scheduleId: string; name: string; schedulePattern: string; status: string }
      }
      expect(body.ok).toBe(true)
      expect(body.data.scheduleId).toMatch(/^sched_/)
      expect(body.data.name).toBe('P6 Daily Report')
      expect(body.data.schedulePattern).toBe('0 9 * * *')
      expect(body.data.status).toBe('active')
    })

    it('creates a webhook trigger with secret', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/triggers/webhooks',
        payload: { name: 'P6 Webhook Listener' },
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json() as {
        ok: boolean
        data: { webhookId: string; name: string; status: string; secret: string; secretLast4: string }
      }
      expect(body.ok).toBe(true)
      expect(body.data.webhookId).toMatch(/^wh_/)
      expect(body.data.name).toBe('P6 Webhook Listener')
      expect(body.data.secret).toBeDefined()
      expect(body.data.secret.length).toBeGreaterThan(0)
      expect(body.data.secretLast4).toBe(body.data.secret.slice(-4))
    })

    it('lists schedule triggers for user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/triggers/schedules',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: Array<{ scheduleId: string }> }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('lists webhook triggers for user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/triggers/webhooks',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: Array<{ webhookId: string }> }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    })
  })

  // ==========================================================================
  // 5. DLQ: Failed event → list → retry → discard
  // ==========================================================================
  describe('Step 5: Dead Letter Queue (DLQ)', () => {
    it('enqueues a failed event to DLQ', async () => {
      const dlqStore = createDeadLetterStore(context.connection)
      const dlq = createDeadLetterQueue(dlqStore, async () => ({ success: false, error: 'Simulated failure' }))

      const record = dlq.enqueue('trigger', 'evt_test_001', 'Processing failed after retries', { data: 'test payload' })
      expect(record.eventId).toMatch(/^dlq_/)
      expect(record.sourceModule).toBe('trigger')
      expect(record.status).toBe('pending')
      expect(record.reason).toBe('Processing failed after retries')
    })

    it('lists DLQ entries', async () => {
      const dlqStore = createDeadLetterStore(context.connection)
      const dlq = createDeadLetterQueue(dlqStore, async () => ({ success: false, error: 'Simulated failure' }))

      // Enqueue another entry
      dlq.enqueue('workflow', 'evt_test_002', 'Workflow step timeout')

      const entries = dlq.list()
      expect(entries.length).toBeGreaterThanOrEqual(2)
    })

    it('retries a DLQ entry (succeeds)', async () => {
      const dlqStore = createDeadLetterStore(context.connection)
      const dlq = createDeadLetterQueue(dlqStore, async () => ({ success: true }))

      const record = dlq.enqueue('connector', 'evt_test_003', 'Connector timeout')
      const result = await dlq.retry(record.eventId)
      expect(result.success).toBe(true)

      // Verify status changed to resolved
      const updated = dlq.getByEventId(record.eventId)
      expect(updated?.status).toBe('resolved')
    })

    it('discards a DLQ entry', async () => {
      const dlqStore = createDeadLetterStore(context.connection)
      const dlq = createDeadLetterQueue(dlqStore, async () => ({ success: false, error: 'Still failing' }))

      const record = dlq.enqueue('memory', 'evt_test_004', 'Memory extraction failed')
      dlq.discard(record.eventId)

      const updated = dlq.getByEventId(record.eventId)
      expect(updated?.status).toBe('discarded')
    })

    it('cannot retry a discarded DLQ entry', async () => {
      const dlqStore = createDeadLetterStore(context.connection)
      const dlq = createDeadLetterQueue(dlqStore, async () => ({ success: true }))

      const record = dlq.enqueue('kernel', 'evt_test_005', 'Kernel error')
      dlq.discard(record.eventId)

      const result = await dlq.retry(record.eventId)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Cannot retry discarded record')
    })
  })

  // ==========================================================================
  // 6. Connector: list connectors
  // ==========================================================================
  describe('Step 6: Connector Management', () => {
    it('lists available connectors', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: unknown }
      expect(body.ok).toBe(true)
    })

    it('returns 404 for non-existent connector', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors/nonexistent_connector',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(404)
    })
  })

  // ==========================================================================
  // 7. Memory budget: set budget → exceed → error
  // ==========================================================================
  describe('Step 7: Memory Budget', () => {
    let budgetConnection: ReturnType<typeof createConnectionManager>
    let budgetStore: ReturnType<typeof createBudgetStore>

    beforeAll(() => {
      budgetConnection = createConnectionManager(':memory:')
      budgetConnection.open()
      const budgetMigration = createBudgetUsageMigration()
      // Override version to 1 for standalone :memory: DB (migration runner requires sequential versions)
      const standaloneMigration: Migration = { ...budgetMigration, version: 1 }
      const migrations = createMigrationRunner(budgetConnection)
      migrations.init()
      migrations.apply([standaloneMigration])
      budgetStore = createBudgetStore(budgetConnection)
    })

    afterAll(() => {
      budgetConnection.close()
    })

    it('creates a budget usage record', async () => {
      const now = new Date().toISOString()
      budgetStore.upsert({
        recordId: `budget-${adminUserId}-daily`,
        userId: adminUserId,
        period: 'daily',
        tokensUsed: 5000,
        requestsUsed: 100,
        memoryUsedMb: 10,
        periodStartedAt: now,
        updatedAt: now,
      })

      const record = budgetStore.getByUserAndPeriod(adminUserId, 'daily')
      expect(record).toBeDefined()
      expect(record!.tokensUsed).toBe(5000)
      expect(record!.requestsUsed).toBe(100)
      expect(record!.memoryUsedMb).toBe(10)
    })

    it('retrieves budget records for a user', async () => {
      const records = budgetStore.getByUserId(adminUserId)
      expect(records.length).toBeGreaterThanOrEqual(1)
    })

    it('resets budget usage for a period', async () => {
      const newPeriodStart = new Date().toISOString()
      budgetStore.resetUsage(adminUserId, 'daily', newPeriodStart)

      const record = budgetStore.getByUserAndPeriod(adminUserId, 'daily')
      expect(record).toBeDefined()
      expect(record!.tokensUsed).toBe(0)
      expect(record!.requestsUsed).toBe(0)
      expect(record!.memoryUsedMb).toBe(0)
    })

    it('budget manager throws BudgetExceededError when limit exceeded', () => {
      const budgetManager = createBudgetManager(budgetStore)
      const config: BudgetConfig = {
        period: 'daily',
        tokenLimit: 100,
        requestLimit: 10,
        memoryLimitMb: 5,
      }

      // Track usage within limits
      budgetManager.trackTokenUsage(adminUserId, 50, config)
      budgetManager.checkBudget(adminUserId, 'daily', config)

      // Exceed token limit
      budgetManager.trackTokenUsage(adminUserId, 60, config)
      expect(() => budgetManager.checkBudget(adminUserId, 'daily', config)).toThrow()
    })

    it('enforceMemoryLimit throws ResourceLimit when exceeded', () => {
      expect(() => enforceMemoryLimit('test-session', 10, 5)).not.toThrow()
      expect(() => enforceMemoryLimit('test-session', 10, 15)).toThrow()
    })
  })

  // ==========================================================================
  // 8. Prometheus: /api/v1/metrics → Prometheus format output
  // ==========================================================================
  describe('Step 8: Prometheus Metrics', () => {
    it('returns Prometheus exposition format via direct exporter', async () => {
      const metricStore = createMetricStore(context.connection)

      // Insert a metric so the exporter has data to format
      metricStore.recordMetric({
        metricId: 'metric_p6_test_001',
        module: 'gateway',
        metricType: 'counter',
        name: 'request_total',
        value: 42,
        timestamp: new Date().toISOString(),
        labels: { method: 'GET', path: '/api/v1/health' },
      })

      const exporter = createPrometheusExporter({
        metricStore,
        config: {
          defaultLabels: {
            service_name: 'agent-platform',
            version: '0.8.0-ga-candidate',
            instance: 'local-1',
          },
          metricPrefix: 'agent_platform_',
          includeTimestamp: false,
        },
      })

      const output = exporter.export()
      expect(output).toContain('# HELP')
      expect(output).toContain('# TYPE')
      expect(output).toContain('agent_platform_')
    })

    it('/api/v1/metrics endpoint returns 200 with correct content-type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/plain')
      expect(response.headers['content-type']).toContain('version=0.0.4')
    })

    it('metrics endpoint is accessible without authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/metrics',
      })
      expect(response.statusCode).toBe(200)
    })
  })

  // ==========================================================================
  // 9. Alerting: create rule → evaluate → state
  // ==========================================================================
  describe('Step 9: Alerting System', () => {
    it('creates an alert rule', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/alerts/rules',
        payload: {
          id: 'p6_high_memory',
          name: 'High Memory Usage',
          metricName: 'agent_platform_memory_usage_bytes',
          conditionType: 'threshold',
          operator: '>',
          threshold: 100000000,
          windowSeconds: 300,
          severity: 'critical',
          labels: { team: 'platform' },
        },
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(201)
      const body = response.json() as { ok: boolean; data: { rule: { id: string; name: string; severity: string } } }
      expect(body.ok).toBe(true)
      expect(body.data.rule.id).toBe('p6_high_memory')
      expect(body.data.rule.severity).toBe('critical')
    })

    it('lists alert rules', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/alerts/rules',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { rules: Array<{ id: string }> } }
      expect(body.ok).toBe(true)
      expect(body.data.rules.length).toBeGreaterThanOrEqual(1)
    })

    it('gets alert state', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/alerts/state',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { states: unknown } }
      expect(body.ok).toBe(true)
    })

    it('evaluates alert rules', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/alerts/evaluate',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { notifications: unknown[]; count: number } }
      expect(body.ok).toBe(true)
      expect(typeof body.data.count).toBe('number')
    })

    it('deletes an alert rule', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/v1/alerts/rules/p6_high_memory',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { ok: boolean; data: { deleted: boolean } }
      expect(body.ok).toBe(true)
      expect(body.data.deleted).toBe(true)
    })
  })

  // ==========================================================================
  // 10. Error handling and auth enforcement
  // ==========================================================================
  describe('Step 10: Error Handling and Auth', () => {
    it('returns 401 for unauthenticated requests to protected endpoints', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      })
      expect(response.statusCode).toBe(401)
    })

    it('returns standard error envelope for auth failures', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/sessions',
      })
      const body = response.json() as { ok: boolean; error: { code: string; message: string }; requestId: string }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('UNAUTHORIZED')
      expect(body.error.message).toBeDefined()
      expect(body.requestId).toBeDefined()
    })

    it('returns 404 for non-existent alert rule', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/alerts/rules/nonexistent_rule',
        headers: { cookie: adminCookie },
      })
      expect(response.statusCode).toBe(404)
    })
  })
})
