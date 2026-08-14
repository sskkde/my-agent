import { describe, it, expect } from 'vitest'
import { createToolOrchestrator, type ToolUse } from '../../../src/tools/runtime/tool-orchestrator.js'
import type { ToolCategory, ToolExecutionResult, ToolExecutor, ToolRegistry } from '../../../src/tools/types.js'
import { createPermissionContext } from '../../../src/permissions/types.js'

interface ConcurrencyTracker {
  active: number
  maxActive: number
}

function createRegistry(category: ToolCategory = 'read'): ToolRegistry {
  return {
    register: () => {},
    getTool: (name) => ({
      name,
      description: name,
      category,
      sensitivity: 'low',
      schema: { type: 'object', properties: {} },
      handler: () => ({ success: true }),
    }),
    listTools: () => [],
    listToolsByCategory: () => [],
    unregister: () => false,
    hasTool: () => true,
  }
}

function createTrackingExecutor(delayMs: number, tracker: ConcurrencyTracker): ToolExecutor {
  return {
    async execute(): Promise<ToolExecutionResult> {
      tracker.active += 1
      tracker.maxActive = Math.max(tracker.maxActive, tracker.active)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      tracker.active -= 1
      return { success: true }
    },
  }
}

function createHangingExecutor(resolveAfterMs: number): ToolExecutor {
  return {
    async execute(): Promise<ToolExecutionResult> {
      await new Promise((resolve) => setTimeout(resolve, resolveAfterMs))
      return { success: true }
    },
  }
}

function makeToolUse(toolCallId: string, overrides?: Partial<ToolUse>): ToolUse {
  return {
    toolCallId,
    toolName: 'read-tool',
    params: {},
    userId: 'user-1',
    permissionContext: createPermissionContext('user-1', 'session-1', 'ask_on_write', []),
    ...overrides,
  }
}

describe('tool orchestrator', () => {
  it('caps read-tool parallelism at maxParallelReads from constructor config', async () => {
    const tracker: ConcurrencyTracker = { active: 0, maxActive: 0 }
    const orchestrator = createToolOrchestrator({
      executor: createTrackingExecutor(30, tracker),
      registry: createRegistry(),
      maxParallelReads: 3,
    })

    const toolUses = Array.from({ length: 8 }, (_, i) => makeToolUse(`call-${i}`))
    const results = await orchestrator.executeBatch(toolUses)

    expect(results).toHaveLength(8)
    expect(results.every((r) => r.success)).toBe(true)
    expect(tracker.maxActive).toBe(3)
  })

  it('lets executeBatch option maxParallelReads override the constructor default', async () => {
    const tracker: ConcurrencyTracker = { active: 0, maxActive: 0 }
    const orchestrator = createToolOrchestrator({
      executor: createTrackingExecutor(30, tracker),
      registry: createRegistry(),
      maxParallelReads: 2,
    })

    const toolUses = Array.from({ length: 8 }, (_, i) => makeToolUse(`call-${i}`))
    await orchestrator.executeBatch(toolUses, { maxParallelReads: 5 })

    expect(tracker.maxActive).toBe(5)
  })

  it('normalizes a non-positive maxParallelReads to at least one worker', async () => {
    const tracker: ConcurrencyTracker = { active: 0, maxActive: 0 }
    const orchestrator = createToolOrchestrator({
      executor: createTrackingExecutor(30, tracker),
      registry: createRegistry(),
      maxParallelReads: 0,
    })

    const toolUses = Array.from({ length: 4 }, (_, i) => makeToolUse(`call-${i}`))
    await orchestrator.executeBatch(toolUses, { maxParallelReads: -2 })

    expect(tracker.maxActive).toBe(1)
  })

  it('applies per-tool timeoutMs in preference to the executeBatch option timeoutMs', async () => {
    const orchestrator = createToolOrchestrator({
      executor: createHangingExecutor(200),
      registry: createRegistry(),
    })

    const results = await orchestrator.executeBatch([makeToolUse('call-a', { timeoutMs: 30 })], { timeoutMs: 1000 })

    expect(results[0]?.success).toBe(false)
    expect(results[0]?.error?.code).toBe('TIMEOUT')
    expect(results[0]?.error?.message).toContain('30ms')
  })

  it('falls back to the executeBatch option timeoutMs when per-tool timeoutMs is absent', async () => {
    const orchestrator = createToolOrchestrator({
      executor: createHangingExecutor(200),
      registry: createRegistry(),
    })

    const results = await orchestrator.executeBatch([makeToolUse('call-b')], { timeoutMs: 30 })

    expect(results[0]?.success).toBe(false)
    expect(results[0]?.error?.code).toBe('TIMEOUT')
    expect(results[0]?.error?.message).toContain('30ms')
  })

  it('runs without a timeout when neither per-tool nor option timeoutMs is set', async () => {
    const orchestrator = createToolOrchestrator({
      executor: createHangingExecutor(20),
      registry: createRegistry(),
    })

    const results = await orchestrator.executeBatch([makeToolUse('call-c')])

    expect(results[0]?.success).toBe(true)
    expect(results[0]?.error).toBeUndefined()
  })
})
