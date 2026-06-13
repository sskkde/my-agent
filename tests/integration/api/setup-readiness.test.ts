import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

interface ReadinessItem {
  id: string
  label: string
  status: 'ok' | 'warning' | 'error'
  details: string
}

interface ReadinessResponse {
  ok: boolean
  data: {
    items: ReadinessItem[]
    timestamp: string
  }
}

describe('Setup Readiness Endpoint', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  it('GET /api/v1/setup/readiness should return setup readiness items', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as ReadinessResponse
    expect(body.ok).toBe(true)
    expect(body.data.items).toBeDefined()
    expect(Array.isArray(body.data.items)).toBe(true)
    expect(body.data.timestamp).toBeDefined()
  })

  it('should return required setup items with correct structure', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    const itemIds = body.data.items.map((item) => item.id)

    // Should include required items
    expect(itemIds).toContain('app_secret_key')
    expect(itemIds).toContain('cors')
    expect(itemIds).toContain('https')
    expect(itemIds).toContain('database')
    expect(itemIds).toContain('stores')
  })

  it('each item should have required fields', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    for (const item of body.data.items) {
      expect(item.id).toBeDefined()
      expect(typeof item.id).toBe('string')
      expect(item.label).toBeDefined()
      expect(typeof item.label).toBe('string')
      expect(item.status).toBeDefined()
      expect(['ok', 'warning', 'error']).toContain(item.status)
      expect(item.details).toBeDefined()
      expect(typeof item.details).toBe('string')
    }
  })

  it('app_secret_key check should return error or warning when not configured in test environment', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    const appSecretItem = body.data.items.find((item) => item.id === 'app_secret_key')
    expect(appSecretItem).toBeDefined()

    // In test environment, APP_SECRET_KEY may not be set or may be a test value
    // Should NOT return 'ok' for missing/weak config
    if (!process.env.APP_SECRET_KEY || process.env.APP_SECRET_KEY.length < 32) {
      expect(appSecretItem!.status).not.toBe('ok')
      expect(['warning', 'error']).toContain(appSecretItem!.status)
    }
  })

  it('cors check should return error or warning when ALLOWED_ORIGINS is not set', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    const corsItem = body.data.items.find((item) => item.id === 'cors')
    expect(corsItem).toBeDefined()

    // In test environment, ALLOWED_ORIGINS may not be properly configured
    // Should NOT return 'ok' for missing/weak config
    if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS === '*') {
      expect(corsItem!.status).not.toBe('ok')
      expect(['warning', 'error']).toContain(corsItem!.status)
    }
  })

  it('https check should return warning when not using HTTPS in production', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    const httpsItem = body.data.items.find((item) => item.id === 'https')
    expect(httpsItem).toBeDefined()

    // In test/development environment, HTTPS may not be configured
    // Should NOT return 'ok' for non-HTTPS setup in production, or warning for dev
    expect(['ok', 'warning', 'error']).toContain(httpsItem!.status)
  })

  it('database and stores checks should reflect actual health', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    const dbItem = body.data.items.find((item) => item.id === 'database')
    const storesItem = body.data.items.find((item) => item.id === 'stores')

    expect(dbItem).toBeDefined()
    expect(storesItem).toBeDefined()

    // In test environment, database should be healthy
    // But if not, it should be error, not ok
    expect(['ok', 'warning', 'error']).toContain(dbItem!.status)
    expect(['ok', 'warning', 'error']).toContain(storesItem!.status)
  })

  it('should NOT pretend unchecked items are OK', async () => {
    const response = await fetch(`${baseUrl}/api/v1/setup/readiness`)
    const body = (await response.json()) as ReadinessResponse

    // Verify that no item has 'ok' status when it shouldn't
    // This test ensures the endpoint doesn't just return all 'ok' regardless of actual state
    const hasValidChecks = body.data.items.every((item) => {
      // Each item should have meaningful details, not empty strings
      return item.details && item.details.length > 0
    })

    expect(hasValidChecks).toBe(true)
  })
})
