import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'

/**
 * Calculate p95 (95th percentile) from an array of latencies.
 * For 20 samples, p95 is the 19th value when sorted (index 18).
 */
function calculateP95(latencies: number[]): number {
  const sorted = [...latencies].sort((a, b) => a - b)
  // p95 index = ceil(0.95 * n) - 1 = ceil(19) - 1 = 18 for n=20
  const p95Index = Math.ceil(0.95 * sorted.length) - 1
  return sorted[p95Index]
}

async function measureLatency(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
  iterations: number = 20,
): Promise<number[]> {
  const latencies: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    await response.arrayBuffer()

    const end = performance.now()
    latencies.push(end - start)

    // Ensure request succeeded (don't fail on non-200, just record latency)
    if (!response.ok) {
      console.warn(`Request ${method} ${path} returned ${response.status}`)
    }
  }

  return latencies
}

describe('API Latency Smoke Tests', () => {
  let server: FastifyInstance
  let baseUrl: string
  let apiContext: ApiContext

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    apiContext = ctx

    server = await createApiServer(apiContext)
    await server.listen({ port: 0 })
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as any).port}`
  }, 60000)

  afterAll(async () => {
    await server.close()
    if (apiContext && 'connection' in apiContext) {
      ;(apiContext as any).connection.close()
    }
  }, 60000)

  describe('GET /api/v1/health', () => {
    it('p95 latency should be < 200ms (20 runs)', async () => {
      const latencies = await measureLatency(baseUrl, '/api/v1/health', 'GET')
      const p95 = calculateP95(latencies)

      console.log(`GET /api/v1/health - p95: ${p95.toFixed(2)}ms`)
      console.log(`  All latencies: ${latencies.map((l) => l.toFixed(2)).join(', ')}ms`)

      expect(p95).toBeLessThan(200)
    })
  })

  describe('GET /api/v1/sessions', () => {
    it('p95 latency should be < 1000ms (20 runs)', async () => {
      const latencies = await measureLatency(baseUrl, '/api/v1/sessions', 'GET')
      const p95 = calculateP95(latencies)

      console.log(`GET /api/v1/sessions - p95: ${p95.toFixed(2)}ms`)
      console.log(`  All latencies: ${latencies.map((l) => l.toFixed(2)).join(', ')}ms`)

      expect(p95).toBeLessThan(1000)
    })
  })

  describe('POST /api/v1/sessions', () => {
    it('p95 latency should be < 500ms (20 runs)', async () => {
      const latencies = await measureLatency(baseUrl, '/api/v1/sessions', 'POST', { userId: 'perf-test-user' })
      const p95 = calculateP95(latencies)

      console.log(`POST /api/v1/sessions - p95: ${p95.toFixed(2)}ms`)
      console.log(`  All latencies: ${latencies.map((l) => l.toFixed(2)).join(', ')}ms`)

      expect(p95).toBeLessThan(500)
    })
  })

  describe('GET /api/v1/tools', () => {
    it('p95 latency should be < 200ms (20 runs)', async () => {
      const latencies = await measureLatency(baseUrl, '/api/v1/tools', 'GET')
      const p95 = calculateP95(latencies)

      console.log(`GET /api/v1/tools - p95: ${p95.toFixed(2)}ms`)
      console.log(`  All latencies: ${latencies.map((l) => l.toFixed(2)).join(', ')}ms`)

      expect(p95).toBeLessThan(200)
    })
  })
})
