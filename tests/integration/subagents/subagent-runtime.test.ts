import { describe, it, expect, beforeEach } from 'vitest'
import type { ContextBundle, ContextItem } from '../../../src/context/types.js'
import type {
  SubagentTaskSpec,
  SubagentConfig,
  LaunchSubagentInput,
  KernelAdapter,
  SubagentContextManager,
} from '../../../src/subagents/types.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import { SubagentRuntimeImpl } from '../../../src/subagents/subagent-runtime.js'

class FakeKernelAdapter implements KernelAdapter {
  private results: KernelRunResult[] = []
  private currentIndex = 0
  private cancelFlags = new Map<string, boolean>()

  setResults(results: KernelRunResult[]) {
    this.results = results
    this.currentIndex = 0
  }

  setCancelFlag(runId: string, value: boolean) {
    this.cancelFlags.set(runId, value)
  }

  async execute(options: {
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    onCancel?: () => boolean
  }): Promise<KernelRunResult> {
    const result = this.results[this.currentIndex] ?? this.createDefaultResult()
    this.currentIndex++

    if (options.onCancel) {
      const runId = options.contextBundle.runId
      if (this.cancelFlags.get(runId)) {
        return this.createCancelledResult()
      }
    }

    return result
  }

  private createDefaultResult(): KernelRunResult {
    return {
      finalStatus: 'completed',
      finalResponse: 'Subagent completed successfully',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
    }
  }

  private createCancelledResult(): KernelRunResult {
    return {
      finalStatus: 'failed',
      finalResponse: undefined,
      iterationsUsed: 0,
      toolCalls: [],
      transcript: [],
      error: {
        code: 'CANCELLED',
        message: 'Subagent execution was cancelled',
      },
    }
  }
}

class FakeContextManager implements SubagentContextManager {
  createIsolatedContext(options: {
    parentContext: ContextBundle
    taskSpec: SubagentTaskSpec
    subagentRunId: string
  }): ContextBundle {
    const isolatedItem: ContextItem = {
      itemId: `isolated-${options.subagentRunId}`,
      sourceType: 'system_note',
      semanticType: 'instruction',
      content: `Objective: ${options.taskSpec.objective}`,
      estimatedTokens: 10,
    }

    return {
      bundleId: `bundle-${options.subagentRunId}`,
      runId: options.subagentRunId,
      agentId: `agent-${options.subagentRunId}`,
      agentType: (options.taskSpec.agentType ?? 'subagent') as 'subagent',
      userId: 'test-user',
      invocationSource: 'subagent_runtime',
      pinnedItems: [isolatedItem],
      orderedItems: [],
      tokenEstimate: 10,
    }
  }
}

describe('Subagent Runtime', () => {
  let runtime: SubagentRuntimeImpl
  let fakeKernelAdapter: FakeKernelAdapter
  let fakeContextManager: FakeContextManager
  let baseConfig: SubagentConfig
  let parentContext: ContextBundle

  beforeEach(() => {
    fakeKernelAdapter = new FakeKernelAdapter()
    fakeContextManager = new FakeContextManager()

    baseConfig = {
      kernelAdapter: fakeKernelAdapter,
      contextManager: fakeContextManager,
      maxConcurrent: 5,
      defaultTimeoutMs: 60000,
      defaultMaxIterations: 10,
    }

    runtime = new SubagentRuntimeImpl(baseConfig)

    parentContext = {
      bundleId: 'parent-bundle-1',
      runId: 'parent-run-1',
      agentId: 'parent-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [
        {
          itemId: 'parent-item-1',
          sourceType: 'system_note',
          semanticType: 'instruction',
          content: 'Parent context item',
          estimatedTokens: 10,
        },
      ],
      tokenEstimate: 10,
    }
  })

  describe('SubagentRun launch', () => {
    it('should create subagent run with unique ID', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
          tools: ['search', 'calculator'],
          maxIterations: 5,
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.subagentRunId).toBeDefined()
      expect(run.subagentRunId).toMatch(/^subagent-/)
      expect(run.status).toBe('queued')
    })

    it('should link parentRunId from parent context', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.parentRunId).toBe('parent-run-1')
    })

    it('should use provided parentRunId when specified', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
        },
        parentContext,
        parentRunId: 'custom-parent-run',
      }

      const run = runtime.launchSubagent(input)

      expect(run.parentRunId).toBe('custom-parent-run')
    })

    it('should link rootRunId same as parentRunId when not specified', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
        },
        parentContext,
        parentRunId: 'custom-parent',
      }

      const run = runtime.launchSubagent(input)

      expect(run.rootRunId).toBe('custom-parent')
    })

    it('should use provided rootRunId when specified', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
        },
        parentContext,
        parentRunId: 'parent-run-2',
        rootRunId: 'root-run-1',
      }

      const run = runtime.launchSubagent(input)

      expect(run.rootRunId).toBe('root-run-1')
      expect(run.parentRunId).toBe('parent-run-2')
    })

    it('should store task spec correctly', () => {
      const taskSpec: SubagentTaskSpec = {
        objective: 'Analyze data',
        tools: ['search', 'analyze'],
        maxIterations: 10,
        timeoutMs: 30000,
        agentType: 'analyzer',
      }

      const input: LaunchSubagentInput = {
        taskSpec,
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.taskSpec).toEqual(taskSpec)
    })
  })

  describe('Context isolation', () => {
    it('should create isolated context bundle', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Isolated task',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.contextBundle).toBeDefined()
      expect(run.contextBundle.runId).toBe(run.subagentRunId)
      expect(run.contextBundle.bundleId).not.toBe(parentContext.bundleId)
    })

    it('should not share mutable state with parent context', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Isolated task',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      const parentItemIds = new Set([...parentContext.pinnedItems, ...parentContext.orderedItems].map((i) => i.itemId))

      const subagentItemIds = new Set(
        [...run.contextBundle.pinnedItems, ...run.contextBundle.orderedItems].map((i) => i.itemId),
      )

      for (const itemId of subagentItemIds) {
        expect(parentItemIds.has(itemId)).toBe(false)
      }
    })

    it('should include objective in isolated context', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Specific task to accomplish',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      const allItems = [...run.contextBundle.pinnedItems, ...run.contextBundle.orderedItems]
      const objectiveItem = allItems.find((item) => item.content.includes('Specific task to accomplish'))

      expect(objectiveItem).toBeDefined()
    })
  })

  describe('Agent type selection', () => {
    it('should use specified agent type from task spec', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
          agentType: 'custom-agent',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.contextBundle.agentType).toBe('custom-agent')
    })

    it('should default to subagent type when not specified', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.contextBundle.agentType).toBe('subagent')
    })

    it('should have different agentId than parent', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.contextBundle.agentId).not.toBe(parentContext.agentId)
    })
  })

  describe('Subagent execution', () => {
    it('should execute subagent and return result', async () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        finalResponse: 'Task completed successfully',
        iterationsUsed: 3,
        toolCalls: [{ toolCallId: 'call-1', toolName: 'search', params: { query: 'test' } }],
        transcript: [],
      }

      fakeKernelAdapter.setResults([kernelResult])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Execute task',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      const result = await runtime.executeSubagent(run.subagentRunId)

      expect(result.status).toBe('completed')
      expect(result.response).toBe('Task completed successfully')
      expect(result.iterationsUsed).toBe(3)
    })

    it('should update run status to running during execution', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Done',
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.status).toBe('queued')

      const executionPromise = runtime.executeSubagent(run.subagentRunId)

      const currentRun = runtime.getSubagentRun(run.subagentRunId)
      expect(currentRun?.status).toBe('running')

      await executionPromise
    })

    it('should update run status to completed after successful execution', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Done',
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      await runtime.executeSubagent(run.subagentRunId)

      const currentRun = runtime.getSubagentRun(run.subagentRunId)
      expect(currentRun?.status).toBe('completed')
    })

    it('should map tool calls from kernel result', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Done',
          iterationsUsed: 2,
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'search', params: { query: 'test' } },
            { toolCallId: 'call-2', toolName: 'analyze', params: { data: 'sample' } },
          ],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      const result = await runtime.executeSubagent(run.subagentRunId)

      expect(result.toolCalls).toHaveLength(2)
      expect(result.toolCalls[0].toolName).toBe('search')
      expect(result.toolCalls[1].toolName).toBe('analyze')
    })

    it('should handle kernel failure', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'failed',
          finalResponse: undefined,
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
          error: {
            code: 'KERNEL_ERROR',
            message: 'Something went wrong',
          },
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      const result = await runtime.executeSubagent(run.subagentRunId)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('KERNEL_ERROR')
      expect(result.error?.message).toBe('Something went wrong')
    })
  })

  describe('Subagent cancellation', () => {
    it('should return cancelled status when cancelled', async () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Long running task',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      fakeKernelAdapter.setCancelFlag(run.subagentRunId, true)

      const cancelResult = runtime.cancelSubagent(run.subagentRunId)

      expect(cancelResult.status).toBe('cancelled')
    })

    it('should set isCancelled flag on run', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      runtime.cancelSubagent(run.subagentRunId)

      const currentRun = runtime.getSubagentRun(run.subagentRunId)
      expect(currentRun?.isCancelled).toBe(true)
    })

    it('should include cancellation info in result', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      const result = runtime.cancelSubagent(run.subagentRunId)

      expect(result.status).toBe('cancelled')
      expect(result.error?.code).toBe('CANCELLED')
    })

    it('should return structured result with iterations used', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'failed',
          finalResponse: undefined,
          iterationsUsed: 2,
          toolCalls: [],
          transcript: [],
          error: {
            code: 'CANCELLED',
            message: 'Execution was cancelled',
          },
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      fakeKernelAdapter.setCancelFlag(run.subagentRunId, true)

      const result = runtime.cancelSubagent(run.subagentRunId)

      expect(result.iterationsUsed).toBeDefined()
      expect(result.status).toBe('cancelled')
    })
  })

  describe('Parent/root run linkage', () => {
    it('should persist parentRunId in result', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Done',
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
        parentRunId: 'parent-123',
      }

      const run = runtime.launchSubagent(input)
      await runtime.executeSubagent(run.subagentRunId)

      const storedRun = runtime.getSubagentRun(run.subagentRunId)
      expect(storedRun?.parentRunId).toBe('parent-123')
    })

    it('should persist rootRunId in result', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Done',
          iterationsUsed: 1,
          toolCalls: [],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
        parentRunId: 'parent-123',
        rootRunId: 'root-456',
      }

      const run = runtime.launchSubagent(input)
      await runtime.executeSubagent(run.subagentRunId)

      const storedRun = runtime.getSubagentRun(run.subagentRunId)
      expect(storedRun?.rootRunId).toBe('root-456')
    })
  })

  describe('getSubagentResult', () => {
    it('should return undefined for non-existent run', () => {
      const result = runtime.getSubagentResult('non-existent')
      expect(result).toBeUndefined()
    })

    it('should return result after execution', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Success',
          iterationsUsed: 2,
          toolCalls: [],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      await runtime.executeSubagent(run.subagentRunId)

      const result = runtime.getSubagentResult(run.subagentRunId)

      expect(result).toBeDefined()
      expect(result?.status).toBe('completed')
      expect(result?.response).toBe('Success')
    })

    it('should return result after cancellation', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      runtime.cancelSubagent(run.subagentRunId)

      const result = runtime.getSubagentResult(run.subagentRunId)

      expect(result).toBeDefined()
      expect(result?.status).toBe('cancelled')
    })
  })

  describe('getSubagentRun', () => {
    it('should return undefined for non-existent run', () => {
      const run = runtime.getSubagentRun('non-existent')
      expect(run).toBeUndefined()
    })

    it('should return the run with correct properties', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Test objective',
        },
        parentContext,
        parentRunId: 'parent-abc',
        rootRunId: 'root-xyz',
      }

      const run = runtime.launchSubagent(input)
      const retrieved = runtime.getSubagentRun(run.subagentRunId)

      expect(retrieved).toBeDefined()
      expect(retrieved?.subagentRunId).toBe(run.subagentRunId)
      expect(retrieved?.parentRunId).toBe('parent-abc')
      expect(retrieved?.rootRunId).toBe('root-xyz')
      expect(retrieved?.taskSpec.objective).toBe('Test objective')
      expect(retrieved?.status).toBe('queued')
    })
  })
})
