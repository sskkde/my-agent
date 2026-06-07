import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { createAuditStore } from '../../../src/observability/audit-store.js'
import type { FastifyInstance } from 'fastify'
import type { LongTermMemoryRecord, MemoryType } from '../../../src/storage/long-term-memory-store.js'
import type { AuditRecord } from '../../../src/observability/audit-types.js'

describe('Memory Delete Audit Trail', () => {
  let server: FastifyInstance
  let baseUrl: string
  let apiContext: ApiContext
  let authCookie: string
  let userId: string

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    apiContext = ctx
    server = await createApiServer(apiContext)
    await server.listen()
    const address = server.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected server to listen on a TCP port')
    }
    baseUrl = `http://localhost:${address.port}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'audittest', password: 'password123' }),
    })

    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: authCookie },
    })
    const meBody = (await meResponse.json()) as { data: { user: { userId: string } } }
    userId = meBody.data.user.userId
  })

  beforeEach(() => {
    // Clean up memories between tests
    const memories = apiContext.stores.longTermMemoryStore.getByUserId(userId)
    for (const mem of memories) {
      apiContext.stores.longTermMemoryStore.delete(mem.memoryId)
    }
  })

  afterAll(async () => {
    await server.close()
    apiContext.connection.close()
  })

  function createTestMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
    const memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const now = new Date().toISOString()
    return {
      memoryId,
      userId,
      memoryType: 'user_preference' as MemoryType,
      content: { text: 'Test memory for audit' },
      sourceRefs: { transcriptRefs: ['turn-1'] },
      scope: { visibility: 'private_user' },
      confidence: 0.85,
      importance: 'medium',
      sensitivity: 'low',
      lifecycle: {
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      retrieval: {
        keywords: ['test', 'audit'],
        recallCount: 0,
      },
      ...overrides,
    }
  }

  describe('DELETE /api/memory/:memoryId → audit trail', () => {
    it('should write audit record with auditType memory_delete on delete', async () => {
      const memory = createTestMemory({
        fingerprint: 'fp-audit-1',
        sourceWindowHash: 'hash-audit-1',
      })
      apiContext.stores.longTermMemoryStore.save(memory)

      const deleteResp = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(deleteResp.status).toBe(200)

      // Query audit store for memory_delete records
      const auditStore = createAuditStore(apiContext.connection)
      const auditRecords = auditStore.query({ auditType: 'memory_delete', userId })

      expect(auditRecords.length).toBeGreaterThanOrEqual(1)

      const auditRecord = auditRecords.find((r: AuditRecord) => r.targetRef === memory.memoryId)
      expect(auditRecord).toBeDefined()
      expect(auditRecord!.auditType).toBe('memory_delete')
      expect(auditRecord!.sourceModule).toBe('memory')
      expect(auditRecord!.sourceAction).toBe('delete')
      expect(auditRecord!.userId).toBe(userId)
      expect(auditRecord!.status).toBe('completed')
      expect(auditRecord!.payload).toBeDefined()
      // The payload should contain the memoryId and operation
      expect((auditRecord!.payload as Record<string, unknown>).memoryId).toBe(memory.memoryId)
      expect((auditRecord!.payload as Record<string, unknown>).operation).toBe('delete')
    })

    it('should write audit record with correct timestamp and risk level', async () => {
      const memory = createTestMemory({
        fingerprint: 'fp-audit-2',
        sourceWindowHash: 'hash-audit-2',
        content: { text: 'Sensitive preference data' },
      })
      apiContext.stores.longTermMemoryStore.save(memory)

      const beforeDelete = new Date().toISOString()
      const deleteResp = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(deleteResp.status).toBe(200)

      const auditStore = createAuditStore(apiContext.connection)
      const auditRecords = auditStore.query({ auditType: 'memory_delete', userId })
      const auditRecord = auditRecords.find((r: AuditRecord) => r.targetRef === memory.memoryId)
      expect(auditRecord).toBeDefined()
      // Verify timestamp is after the delete
      expect(auditRecord!.timestamp).toBeDefined()
      expect(auditRecord!.timestamp >= beforeDelete).toBe(true)
      // Risk level for memory delete should be medium
      expect(auditRecord!.riskLevel).toBe('medium')
    })
  })

  describe('Soft-delete behavior via API', () => {
    it('should return 404 on GET after soft delete', async () => {
      const memory = createTestMemory()
      apiContext.stores.longTermMemoryStore.save(memory)

      // Verify it exists before delete
      const getBefore = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        headers: { Cookie: authCookie },
      })
      expect(getBefore.status).toBe(200)

      // Delete
      const deleteResp = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(deleteResp.status).toBe(200)

      // GET after delete should 404
      const getAfter = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        headers: { Cookie: authCookie },
      })
      expect(getAfter.status).toBe(404)
    })

    it('should preserve tombstone record after soft delete', async () => {
      const memory = createTestMemory({
        fingerprint: 'fp-tombstone-audit',
        sourceWindowHash: 'hash-tombstone-audit',
      })
      apiContext.stores.longTermMemoryStore.save(memory)

      const deleteResp = await fetch(`${baseUrl}/api/v1/memory/${memory.memoryId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })
      expect(deleteResp.status).toBe(200)

      // Verify the record still exists in the store (soft delete, not hard)
      const recordInStore = apiContext.stores.longTermMemoryStore.getByMemoryId(memory.memoryId)
      expect(recordInStore).not.toBeNull()
      expect(recordInStore!.lifecycle.status).toBe('deleted')

      // Verify tombstone exists
      const tombstone = apiContext.stores.longTermMemoryStore.getTombstone(memory.memoryId)
      expect(tombstone).not.toBeNull()
      expect(tombstone!.userId).toBe(userId)
      expect(tombstone!.memoryId).toBe(memory.memoryId)
    })
  })
})
