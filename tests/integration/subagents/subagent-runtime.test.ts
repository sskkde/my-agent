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
import { buildToolProjection } from '../../../src/subagents/kernel-adapter.js'
import { createDefaultSubagentContextManager } from '../../../src/subagents/context-manager.js'
import type { SubagentDefinition } from '../../../src/subagents/registry.js'
import type { ToolDefinition, ToolRegistry, ToolCategory } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'

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

function createFakeToolRegistry(tools: Array<{ id: string; category: ToolCategory }>): ToolRegistry {
  const toolMap = new Map<string, ToolDefinition>()
  for (const t of tools) {
    toolMap.set(t.id, {
      name: t.id,
      description: `Fake tool ${t.id}`,
      category: t.category,
      sensitivity: 'low',
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    })
  }
  return {
    getTool: (id: string) => toolMap.get(id),
    getAllTools: () => Array.from(toolMap.values()),
    register: () => {},
  } as unknown as ToolRegistry
}

describe('buildToolProjection — todo tools in subagent definitions', () => {
  const fakeRegistry = createFakeToolRegistry([
    { id: 'file_read', category: 'read' },
    { id: 'file_glob', category: 'read' },
    { id: 'file_grep', category: 'read' },
    { id: 'docs_search', category: 'search' },
    { id: 'artifact_create', category: 'write' },
    { id: 'artifact_update', category: 'write' },
    { id: 'web_search', category: 'search' },
    { id: 'web_fetch', category: 'read' },
    { id: 'todolist', category: 'read' },
    { id: 'todowrite', category: 'write' },
    { id: 'exec', category: 'execute' },
    { id: 'bash', category: 'execute' },
    { id: 'admin_config', category: 'admin' },
  ])

  const documentProcessorDef: SubagentDefinition = {
    agentType: 'document_processor',
    displayName: '文档处理',
    description: '处理文档类内容',
    modality: 'document',
    promptId: 'agentProfile:document_processor',
    allowedToolIds: [
      'file_read',
      'file_glob',
      'file_grep',
      'docs_search',
      'artifact_create',
      'artifact_update',
      'todolist',
      'todowrite',
    ],
    defaultMaxIterations: 8,
    defaultTimeoutMs: 120_000,
    supportedExecutionModes: ['sync', 'background'],
    canRunInBackground: true,
    providerPolicy: {
      requiredCapabilities: ['text', 'long_context', 'json_schema'],
      fallbackMode: 'any_compatible',
    },
    permissionProfile: 'ask_on_write',
    summaryPolicy: { returnMode: 'summary_with_artifacts', maxSummaryTokens: 1500 },
  }

  const searchProcessorDef: SubagentDefinition = {
    agentType: 'search_processor',
    displayName: '搜索',
    description: '执行快速网络搜索',
    modality: 'text',
    promptId: 'agentProfile:search_processor',
    allowedToolIds: ['web_search', 'todolist', 'todowrite'],
    defaultMaxIterations: 5,
    defaultTimeoutMs: 60_000,
    supportedExecutionModes: ['sync', 'background'],
    canRunInBackground: true,
    providerPolicy: {
      requiredCapabilities: ['text', 'function_calling'],
      fallbackMode: 'any_compatible',
    },
    permissionProfile: 'ask_on_write',
    summaryPolicy: { returnMode: 'summary_with_artifacts', maxSummaryTokens: 1200 },
  }

  it('document_processor projection includes todolist and todowrite', () => {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
    const projection = buildToolProjection(documentProcessorDef, { objective: 'test' }, fakeRegistry, envelopeRegistry)

    expect(projection.toolIds).toContain('todolist')
    expect(projection.toolIds).toContain('todowrite')
    expect((projection.tools ?? []).length).toBeGreaterThan(0)
  })

  it('search_processor projection includes todolist and todowrite', () => {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
    const projection = buildToolProjection(searchProcessorDef, { objective: 'test' }, fakeRegistry, envelopeRegistry)

    expect(projection.toolIds).toContain('todolist')
    expect(projection.toolIds).toContain('todowrite')
  })

  it('subagent projection excludes shell/admin tools even if listed', () => {
    const defWithShell: SubagentDefinition = {
      ...documentProcessorDef,
      allowedToolIds: ['file_read', 'todolist', 'todowrite', 'exec', 'bash', 'admin_config'],
    }

    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
    const projection = buildToolProjection(defWithShell, { objective: 'test' }, fakeRegistry, envelopeRegistry)

    expect(projection.toolIds).toContain('todolist')
    expect(projection.toolIds).toContain('todowrite')
    expect(projection.toolIds).not.toContain('exec')
    expect(projection.toolIds).not.toContain('bash')
    expect(projection.toolIds).not.toContain('admin_config')
  })

  it('background agentType allows todo tools via envelope exception', () => {
    const backgroundDef: SubagentDefinition = {
      ...documentProcessorDef,
      agentType: 'memory',
      agentProfile: 'memory',
      allowedToolIds: ['file_read', 'web_search', 'todolist', 'todowrite', 'artifact_create'],
    }

    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
    const projection = buildToolProjection(backgroundDef, { objective: 'bg task' }, fakeRegistry, envelopeRegistry)

    expect(projection.toolIds).toContain('todolist')
    expect(projection.toolIds).toContain('todowrite')
    expect(projection.toolIds).toContain('file_read')
    expect(projection.toolIds).toContain('web_search')

    expect(projection.toolIds).not.toContain('artifact_create')
  })

  it('default context manager keeps generic subagent agentType for profile labels', () => {
    const manager = createDefaultSubagentContextManager({})
    const sourceContext: ContextBundle = {
      bundleId: 'parent-bundle-ctx-manager',
      runId: 'parent-run-ctx-manager',
      agentId: 'parent-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 0,
    }

    const context = manager.createIsolatedContext({
      parentContext: sourceContext,
      taskSpec: { objective: 'Process a document', agentType: 'document_processor' },
      subagentRunId: 'subagent-run-1',
      definition: documentProcessorDef,
    })

    expect(context.agentType).toBe('subagent')
    expect(context.agentProfile).toBe('document_processor')
    expect(context.agentId).toBe('subagent.document_processor.subagent-run-1')
  })
})
