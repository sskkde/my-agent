import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createE2EHarness, type E2EHarness } from './test-harness.js'
import type { ToolDefinition } from '../../src/tools/types.js'
import type { PermissionContext } from '../../src/permissions/types.js'
import { createToolResultStore, type ToolResultStore } from '../../src/storage/tool-result-store.js'
import { processToolOutput, INLINE_THRESHOLD } from '../../src/tools/tool-result-reference.js'

// ============================================================
// Test fixture: read tool that can produce large output
// ============================================================

function createReadTool(resultSize: 'small' | 'large', toolResultStore: ToolResultStore): ToolDefinition {
  const toolName = resultSize === 'large' ? 'file_read_large' : 'file_read'

  return {
    name: toolName,
    description:
      resultSize === 'large' ? 'Read a file, returns large output as resultRef' : 'Read a file, returns inline output',
    category: 'read',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    handler: async (params, context) => {
      const path = (params as { path: string }).path

      if (resultSize === 'large') {
        // Generate result that exceeds INLINE_THRESHOLD (32 KiB)
        const lines: Array<{ line: number; content: string }> = []
        let totalSize = 0
        for (let i = 0; totalSize < INLINE_THRESHOLD + 2048; i++) {
          const content = `Line ${i + 1}: ${'x'.repeat(200)} - additional padding to reach threshold`
          lines.push({ line: i + 1, content })
          totalSize += JSON.stringify({ line: i + 1, content }).length
        }
        const largeResult = {
          path,
          lines,
          totalLines: lines.length,
          sizeBytes: totalSize,
        }

        const processed = processToolOutput(toolResultStore, context.toolCallId, largeResult, {
          toolName,
          userId: context.userId,
          sessionId: context.sessionId,
          sensitivity: 'medium',
        })

        if (processed.isRef && processed.resultRef) {
          return {
            success: true,
            data: { path, totalLines: lines.length, sizeBytes: totalSize },
            resultRef: processed.resultRef.resultId,
            resultPreview: `File ${path} has ${lines.length} lines (${totalSize} bytes) — stored as reference ${processed.resultRef.resultId}`,
            structuredContent: {
              _type: 'blob_ref',
              refId: processed.resultRef.resultId,
              sizeBytes: processed.resultRef.sizeBytes,
            },
            events: [
              {
                eventType: 'tool_execution_completed',
                sourceModule: 'tool_plane',
                payload: {
                  toolCallId: context.toolCallId,
                  toolName,
                  path,
                  totalLines: lines.length,
                  isRef: true,
                  resultRefId: processed.resultRef.resultId,
                },
                timestamp: new Date().toISOString(),
              },
            ],
          }
        }

        return {
          success: true,
          data: largeResult,
          resultPreview: `File ${path} has ${lines.length} lines`,
        }
      }

      // Small result — inline
      const smallResult = { path, content: 'Hello World', lines: 1 }
      return {
        success: true,
        data: smallResult,
        resultPreview: `File ${path}: ${smallResult.content}`,
        events: [
          {
            eventType: 'tool_execution_completed',
            sourceModule: 'tool_plane',
            payload: {
              toolCallId: context.toolCallId,
              toolName,
              path,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      }
    },
  }
}

// ============================================================
// Flow 13: Read Tool + ResultRef Dedicated E2E
// ============================================================

describe('Flow 13: Read Tool + ResultRef Dedicated E2E', () => {
  let harness: E2EHarness
  let toolResultStore: ToolResultStore

  beforeEach(() => {
    harness = createE2EHarness()
    toolResultStore = createToolResultStore(harness.connection)
  })

  afterEach(() => {
    harness.close()
  })

  // ── SECTION A: Tool execution stores resultRef ────────────

  describe('Large result creates resultRef', () => {
    it('records ToolExecution with resultRef for large output', async () => {
      const userId = 'user_rr_001'
      const sessionId = 'sess_rr_001'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/tmp/large_file.log' },
        userId,
        sessionId,
        permissionContext,
      })

      // Tool execution succeeded
      expect(result.success).toBe(true)

      // ToolExecution record persisted in tool_executions store
      const exec = harness.stores.toolExecutionStore.getById(toolCallId)
      expect(exec).toBeDefined()
      expect(exec?.toolCallId).toBe(toolCallId)
      expect(exec?.toolName).toBe('file_read_large')
      expect(exec?.userId).toBe(userId)
      expect(exec?.sessionId).toBe(sessionId)

      // resultRef is populated
      expect(exec?.resultRef).toBeDefined()
      expect(exec?.resultRef).toBe(result.resultRef)
      expect(typeof exec?.resultRef).toBe('string')

      // preview is present
      expect(exec?.resultPreview).toBeDefined()
      expect(exec?.resultPreview).toContain('stored as reference')

      // structuredContent reflects blob ref
      expect(exec?.structuredContent).toBeDefined()
      expect(exec?.structuredContent?._type).toBe('blob_ref')
    })

    it('persists ToolResultReference in tool_results store', async () => {
      const userId = 'user_rr_002'
      const sessionId = 'sess_rr_002'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/data/huge.json' },
        userId,
        sessionId,
        permissionContext,
      })

      expect(result.success).toBe(true)
      expect(result.resultRef).toBeDefined()

      // ToolResultReference persisted via ToolResultStore
      const storedRefs = toolResultStore.findByToolCallId(toolCallId)
      expect(storedRefs.length).toBe(1)
      const storedRef = storedRefs[0]
      expect(storedRef).toBeDefined()
      expect(storedRef.resultRef).toBe(result.resultRef)
      expect(storedRef.toolCallId).toBe(toolCallId)
      expect(storedRef.toolName).toBe('file_read_large')
      expect(storedRef.userId).toBe(userId)
      expect(storedRef.sessionId).toBe(sessionId)
      expect(storedRef.sensitivity).toBe('medium')
    })

    it('can find ToolResultReference by toolCallId', async () => {
      const userId = 'user_rr_003'
      const sessionId = 'sess_rr_003'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/data/search_results.json' },
        userId,
        sessionId,
        permissionContext,
      })

      const refs = toolResultStore.findByToolCallId(toolCallId)
      expect(refs.length).toBe(1)
      expect(refs[0].toolCallId).toBe(toolCallId)
      expect(refs[0].toolName).toBe('file_read_large')
    })
  })

  // ── SECTION B: Small result stays inline ──────────────────

  describe('Small result stays inline', () => {
    it('records ToolExecution without resultRef for small output', async () => {
      const userId = 'user_rr_010'
      const sessionId = 'sess_rr_010'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('small', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read',
        params: { path: '/tmp/hello.txt' },
        userId,
        sessionId,
        permissionContext,
      })

      expect(result.success).toBe(true)

      const exec = harness.stores.toolExecutionStore.getById(toolCallId)
      expect(exec).toBeDefined()

      // resultRef should NOT be set for small results
      expect(exec?.resultRef).toBeUndefined()

      // preview should be present
      expect(exec?.resultPreview).toBeDefined()
      expect(exec?.resultPreview).toContain('Hello World')

      // data is inline (not a ref)
      expect(result.resultRef).toBeUndefined()
      expect(result.data).toBeDefined()
    })

    it('does NOT create ToolResultReference blob for small output', async () => {
      const userId = 'user_rr_011'
      const sessionId = 'sess_rr_011'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('small', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read',
        params: { path: '/tmp/small.txt' },
        userId,
        sessionId,
        permissionContext,
      })

      const refs = toolResultStore.findByToolCallId(toolCallId)
      expect(refs.length).toBe(0)
    })
  })

  // ── SECTION C: Assistant response references result ───────

  describe('Assistant response structure', () => {
    it('tool result contains resultRef in structured content', async () => {
      const userId = 'user_rr_020'
      const sessionId = 'sess_rr_020'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/tmp/log.txt' },
        userId,
        sessionId,
        permissionContext,
      })

      // resultRef present on the tool execution result
      expect(result.resultRef).toBeDefined()
      expect(result.resultRef).toBeTruthy()

      // structuredContent provides metadata so assistant can reference
      expect(result.structuredContent).toBeDefined()
      expect(result.structuredContent?._type).toBe('blob_ref')
      expect(result.structuredContent?.refId).toBe(result.resultRef)

      // resultPreview provides human-readable summary for assistant
      expect(result.resultPreview).toBeDefined()
      expect(result.resultPreview).toContain('stored as reference')
    })

    it('sendMessage flow records tool executions with resultRef', async () => {
      const userId = 'user_rr_021'
      const sessionId = 'sess_rr_021'

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      // Send a message that would trigger the read tool via foreground
      // Since we can't deterministically trigger via LLM, we execute directly
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const toolCallId = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/data/deploy_commands.log' },
        userId,
        sessionId,
        permissionContext,
      })

      // Verify session-scoped query returns the execution
      const sessionExecs = harness.stores.toolExecutionStore.getBySession(sessionId)
      expect(sessionExecs.length).toBeGreaterThan(0)
      expect(sessionExecs[0].toolCallId).toBe(toolCallId)
      expect(sessionExecs[0].resultRef).toBeDefined()
    })
  })

  // ── SECTION D: Timeline / event recording ─────────────────

  describe('Timeline events for tool execution', () => {
    it('creates timeline events when tool is executed', async () => {
      const userId = 'user_rr_030'
      const sessionId = 'sess_rr_030'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/etc/config.json' },
        userId,
        sessionId,
        permissionContext,
      })

      // Events are recorded in event store
      const events = harness.stores.eventStore.query({ sessionId })
      const toolEvents = events.filter(
        (e) => e.eventType === 'tool_execution_completed' || e.eventType?.startsWith('tool_'),
      )
      expect(toolEvents.length).toBeGreaterThan(0)

      // At least one event references the tool call
      const matchingEvent = toolEvents.find((e) => e.payload?.toolCallId === toolCallId)
      expect(matchingEvent).toBeDefined()
      expect(matchingEvent?.payload?.isRef).toBe(true)
      expect(matchingEvent?.payload?.resultRefId).toBeDefined()
    })

    it('events carry resultRef info for downstream consumers', async () => {
      const userId = 'user_rr_031'
      const sessionId = 'sess_rr_031'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/data/report.json' },
        userId,
        sessionId,
        permissionContext,
      })

      const events = harness.stores.eventStore.query({ sessionId })
      const toolEvent = events.find(
        (e) => e.payload?.toolCallId === toolCallId && e.eventType === 'tool_execution_completed',
      )
      expect(toolEvent).toBeDefined()
      expect(toolEvent?.payload?.resultRefId).toBe(result.resultRef)
      expect(toolEvent?.payload?.toolName).toBe('file_read_large')
    })

    it('timeline includes tool execution event for read tools', async () => {
      const userId = 'user_rr_032'
      const sessionId = 'sess_rr_032'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const toolSmall = createReadTool('small', toolResultStore)
      harness.registerTool(toolSmall)

      const toolCallId = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read',
        params: { path: '/tmp/notes.txt' },
        userId,
        sessionId,
        permissionContext,
      })

      // Even small results create timeline events
      const events = harness.stores.eventStore.query({ sessionId })
      const toolCompletedEvents = events.filter((e) => e.eventType === 'tool_execution_completed')
      expect(toolCompletedEvents.length).toBeGreaterThan(0)
      expect(toolCompletedEvents[0].sessionId).toBe(sessionId)
      expect(toolCompletedEvents[0].userId).toBe(userId)
    })
  })

  // ── SECTION E: Edge cases ─────────────────────────────────

  describe('Edge cases', () => {
    it('handles multiple read tool executions in same session', async () => {
      const userId = 'user_rr_040'
      const sessionId = 'sess_rr_040'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const toolSmall = createReadTool('small', toolResultStore)
      const toolLarge = createReadTool('large', toolResultStore)
      harness.registerTool(toolSmall)
      harness.registerTool(toolLarge)

      const smallCallId = harness.idGenerator.custom('tool_call')
      const largeCallId = harness.idGenerator.custom('tool_call')

      await harness.toolExecutor.execute({
        toolCallId: smallCallId,
        toolName: 'file_read',
        params: { path: '/tmp/a.txt' },
        userId,
        sessionId,
        permissionContext,
      })

      await harness.toolExecutor.execute({
        toolCallId: largeCallId,
        toolName: 'file_read_large',
        params: { path: '/tmp/b.log' },
        userId,
        sessionId,
        permissionContext,
      })

      const sessionExecs = harness.stores.toolExecutionStore.getBySession(sessionId)
      expect(sessionExecs.length).toBe(2)

      const smallExec = sessionExecs.find((e) => e.toolCallId === smallCallId)
      const largeExec = sessionExecs.find((e) => e.toolCallId === largeCallId)

      expect(smallExec?.resultRef).toBeUndefined()
      expect(largeExec?.resultRef).toBeDefined()
    })

    it('resultRef size exceeds inline threshold', async () => {
      const userId = 'user_rr_041'
      const sessionId = 'sess_rr_041'
      const permissionContext: PermissionContext = {
        userId,
        sessionId,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const toolLarge = createReadTool('large', toolResultStore)
      harness.registerTool(toolLarge)

      const toolCallId = harness.idGenerator.custom('tool_call')
      const result = await harness.toolExecutor.execute({
        toolCallId,
        toolName: 'file_read_large',
        params: { path: '/tmp/huge.log' },
        userId,
        sessionId,
        permissionContext,
      })

      expect(result.success).toBe(true)
      expect(result.resultRef).toBeDefined()

      // Verify the stored reference has correct size
      const storedRefs = toolResultStore.findByToolCallId(toolCallId)
      expect(storedRefs.length).toBe(1)
      const storedRef = storedRefs[0]
      expect(storedRef).toBeDefined()

      const payloadSize = JSON.stringify(storedRef.structuredContent).length
      expect(payloadSize).toBeGreaterThan(INLINE_THRESHOLD)
    })

    it('findBySession returns only session-scoped results', async () => {
      const user1 = 'user_rr_042'
      const user2 = 'user_rr_043'
      const sessA = 'sess_rr_a'
      const sessB = 'sess_rr_b'

      const permissionContext: PermissionContext = {
        userId: user1,
        sessionId: sessA,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }

      const tool = createReadTool('large', toolResultStore)
      harness.registerTool(tool)

      // Execute in session A
      const tcA = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId: tcA,
        toolName: 'file_read_large',
        params: { path: '/data/a.json' },
        userId: user1,
        sessionId: sessA,
        permissionContext,
      })

      // Execute in session B as user 2
      const permissionContextB: PermissionContext = {
        userId: user2,
        sessionId: sessB,
        mode: 'read_only',
        grants: [],
        metadata: {},
      }
      const tcB = harness.idGenerator.custom('tool_call')
      await harness.toolExecutor.execute({
        toolCallId: tcB,
        toolName: 'file_read_large',
        params: { path: '/data/b.json' },
        userId: user2,
        sessionId: sessB,
        permissionContext: permissionContextB,
      })

      const sessAExecs = harness.stores.toolExecutionStore.getBySession(sessA)
      const sessBExecs = harness.stores.toolExecutionStore.getBySession(sessB)

      expect(sessAExecs.length).toBe(1)
      expect(sessAExecs[0].toolCallId).toBe(tcA)
      expect(sessAExecs[0].sessionId).toBe(sessA)

      expect(sessBExecs.length).toBe(1)
      expect(sessBExecs[0].toolCallId).toBe(tcB)
      expect(sessBExecs[0].sessionId).toBe(sessB)
    })
  })
})
