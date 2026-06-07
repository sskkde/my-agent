import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import type { LLMResponse, ToolCall } from '../../../src/llm/types.js'
import type { ContextItem } from '../../../src/context/types.js'
import type { DispatchRequest } from '../../../src/dispatcher/types.js'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMResult, LLMRequest, ToolDefinition } from '../../../src/llm/types.js'
import type { LLMProvider } from '../../../src/llm/provider'
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

class FakeLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[]
  private currentIndex = 0
  private capturedRequests: LLMRequest[] = []
  config: LLMAdapterConfig
  providers: LLMProvider[] = []

  constructor(responses: LLMResponse[]) {
    this.responses = responses
    this.config = {
      providers: [],
      defaultTimeoutMs: 60000,
      enableCircuitBreaker: false,
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.capturedRequests.push(request)
    const response = this.responses[this.currentIndex++]
    if (this.currentIndex >= this.responses.length) {
      this.currentIndex = this.responses.length - 1
    }
    return {
      success: true,
      response,
      providerId: 'fake-provider',
    }
  }

  getAllRequests(): LLMRequest[] {
    return this.capturedRequests
  }

  async *stream(): AsyncGenerator<{
    delta: string
    providerId: string
    model?: string
    usage?: import('../../../src/api/types.js').ExactContextUsage
  }> {}

  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }

  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId)
  }

  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }

  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }

  updateProviderPriority(providerId: string, priority: number): void {
    const provider = this.getProvider(providerId)
    if (provider) {
      provider.updateConfig({ ...provider.config, priority })
    }
  }
}

class FakeToolExecutor {
  private tools: Map<
    string,
    (params: unknown) => Promise<{
      success: boolean
      data?: unknown
      error?: { code: string; message: string; recoverable: boolean }
      resultPreview?: string
    }>
  > = new Map()

  registerTool(
    name: string,
    handler: (params: unknown) => Promise<{
      success: boolean
      data?: unknown
      error?: { code: string; message: string; recoverable: boolean }
      resultPreview?: string
    }>,
  ): void {
    this.tools.set(name, handler)
  }

  async execute(request: {
    toolCallId: string
    toolName: string
    params: unknown
    userId: string
    sessionId?: string
    kernelRunId?: string
    permissionContext: { userId: string; permissions: string[] }
  }): Promise<{
    success: boolean
    data?: unknown
    error?: { code: string; message: string; recoverable: boolean }
    resultPreview?: string
  }> {
    const handler = this.tools.get(request.toolName)
    if (!handler) {
      return {
        success: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: 'Tool not found: ' + request.toolName,
          recoverable: false,
        },
      }
    }
    return handler(request.params)
  }
}

class FakeContextManager {
  private contextItems: ContextItem[] = []

  addItem(item: ContextItem): void {
    this.contextItems.push(item)
  }

  getItems(): ContextItem[] {
    return this.contextItems
  }

  assembleBundle() {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent' as const,
      pinnedItems: [],
      orderedItems: this.contextItems,
      tokenEstimate: 100,
    }
  }

  applyDelta(delta: { items?: ContextItem[] }): void {
    if (delta.items) {
      this.contextItems.push(...delta.items)
    }
  }
}

class FakeDispatcher {
  private handlers: Map<
    string,
    (request: DispatchRequest) => Promise<{
      requestId: string
      actionId: string
      status: string
      targetRuntime: string
      result?: unknown
      error?: { code: string; message: string; recoverable: boolean }
      createdAt: string
      completedAt?: string
    }>
  > = new Map()

  lastRequest: DispatchRequest | null = null

  registerHandler(
    actionType: string,
    handler: (request: DispatchRequest) => Promise<{
      requestId: string
      actionId: string
      status: string
      targetRuntime: string
      result?: unknown
      error?: { code: string; message: string; recoverable: boolean }
      createdAt: string
      completedAt?: string
    }>,
  ): void {
    this.handlers.set(actionType, handler)
  }

  async dispatch(request: DispatchRequest): Promise<{
    requestId: string
    actionId: string
    status: string
    targetRuntime: string
    result?: unknown
    error?: { code: string; message: string; recoverable: boolean }
    createdAt: string
    completedAt?: string
  }> {
    this.lastRequest = request

    const handler = this.handlers.get(request.action.actionType)
    if (handler) {
      return handler(request)
    }
    return {
      requestId: request.requestId,
      actionId: request.action.actionId,
      status: 'failed',
      targetRuntime: request.action.targetRuntime,
      error: {
        code: 'NO_HANDLER',
        message: 'No handler for action type: ' + request.action.actionType,
        recoverable: false,
      },
      createdAt: new Date().toISOString(),
    }
  }
}

function createTextResponse(content: string): LLMResponse {
  return {
    id: 'resp-' + Date.now(),
    model: 'test-model',
    content,
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  }
}

function createToolUseResponse(toolCalls: ToolCall[]): LLMResponse {
  return {
    id: 'resp-' + Date.now(),
    model: 'test-model',
    content: '',
    role: 'assistant',
    toolCalls,
    finishReason: 'tool_calls',
    createdAt: new Date().toISOString(),
  }
}

describe('Kernel Tool Loop Closure', () => {
  let fakeToolExecutor: FakeToolExecutor
  let fakeContextManager: FakeContextManager
  let fakeDispatcher: FakeDispatcher
  let modelInputBuilder: ModelInputBuilder
  let originalEnv: string | undefined

  beforeAll(() => {
    originalEnv = process.env.TOOL_LOOP_V2_ENABLED
    process.env.TOOL_LOOP_V2_ENABLED = 'true'
  })

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.TOOL_LOOP_V2_ENABLED
    } else {
      process.env.TOOL_LOOP_V2_ENABLED = originalEnv
    }
  })

  beforeEach(() => {
    fakeToolExecutor = new FakeToolExecutor()
    fakeContextManager = new FakeContextManager()
    fakeDispatcher = new FakeDispatcher()

    const testRegistry = new PromptTemplateRegistry(
      new Map([
        [
          'platform:base',
          {
            id: 'platform:base',
            version: '2026-05-23',
            path: 'platform/base.md',
            agentKind: '*',
            providerFamily: '*',
            layer: 1,
            description: 'Test base',
            content: 'You are a helpful assistant.',
          },
        ],
        [
          'agents:kernel',
          {
            id: 'agents:kernel',
            version: '2026-05-23',
            path: 'agents/kernel.md',
            agentKind: 'kernel',
            providerFamily: '*',
            layer: 3,
            description: 'Test kernel',
            content: 'Execute tasks using available tools.',
          },
        ],
      ]),
    )
    modelInputBuilder = new ModelInputBuilder({
      templateRegistry: testRegistry,
      templateLoader: new TemplateLoader(),
    })

    fakeToolExecutor.registerTool('test-tool', async (params) => ({
      success: true,
      data: params,
      resultPreview: JSON.stringify(params),
    }))

    fakeDispatcher.registerHandler('execute_tool', async (request) => {
      const payload = request.action.targetAction as
        | { toolCallId?: string; toolName?: string; params?: unknown }
        | undefined
      const toolResult = await fakeToolExecutor.execute({
        toolCallId: payload?.toolCallId || 'test-call-id',
        toolName: payload?.toolName || 'unknown',
        params: payload?.params || {},
        userId: request.context.userId || 'test-user',
        sessionId: request.context.sessionId,
        permissionContext: {
          userId: request.context.userId || 'test-user',
          permissions: ['tool:execute'],
        },
      })
      return {
        requestId: request.requestId,
        actionId: request.action.actionId,
        status: toolResult.success ? 'completed' : 'failed',
        targetRuntime: 'tool_plane',
        result: toolResult,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    })
  })

  function createConfig(llmAdapter: FakeLLMAdapter, maxIterations = 10): KernelConfig {
    return {
      llmAdapter,
      toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
      modelInputBuilder,
      maxIterations,
      timeoutMs: 60000,
    }
  }

  function createInput(overrides?: Partial<KernelRunInput>): KernelRunInput {
    return {
      contextBundle: fakeContextManager.assembleBundle(),
      runId: 'test-run-id',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      sessionId: 'test-session',
      maxIterations: 10,
      timeoutMs: 60000,
      ...overrides,
    }
  }

  function toolProjectionFor(...toolNames: string[]): ToolPlaneProjection {
    const tools: ToolDefinition[] = toolNames.map(function (name) {
      return {
        type: 'function',
        function: {
          name: name,
          description: 'Test tool: ' + name,
          parameters: { type: 'object', properties: {} },
        },
      }
    })
    return { toolIds: toolNames, tools: tools }
  }

  it('should complete single-turn tool loop (tool to result to LLM text response)', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-single-1',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ key: 'value' }),
        },
      },
    ]

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls),
      createTextResponse('Tool executed successfully with value.'),
    ])

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter))
    const result: KernelRunResult = await kernel.run(createInput())

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Tool executed successfully with value.')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].toolName).toBe('test-tool')
    expect(result.toolCalls[0].toolCallId).toBe('call-single-1')
    expect(result.iterationsUsed).toBe(2)

    const types = result.transcript.map((e) => e.type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types.filter((t) => t === 'llm_response')).toHaveLength(2)
  })

  it('should complete multi-turn tool loop (multiple tool rounds before text)', async () => {
    const toolCalls1: ToolCall[] = [
      {
        id: 'call-multi-1',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ step: 1 }),
        },
      },
    ]

    const toolCalls2: ToolCall[] = [
      {
        id: 'call-multi-2',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ step: 2 }),
        },
      },
    ]

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls1),
      createToolUseResponse(toolCalls2),
      createTextResponse('Both tool calls completed successfully.'),
    ])

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter))
    const result: KernelRunResult = await kernel.run(createInput())

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Both tool calls completed successfully.')
    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0].toolCallId).toBe('call-multi-1')
    expect(result.toolCalls[1].toolCallId).toBe('call-multi-2')
    expect(result.iterationsUsed).toBe(3)

    const types = result.transcript.map((e) => e.type)
    expect(types.filter((t) => t === 'tool_call')).toHaveLength(2)
    expect(types.filter((t) => t === 'tool_result')).toHaveLength(2)
  })

  it('should return max_iterations_reached when LLM always returns tool_calls', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-loop',
        type: 'function',
        function: {
          name: 'test-tool',
          arguments: JSON.stringify({ loop: true }),
        },
      },
    ]

    const fakeLLMAdapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls),
      createToolUseResponse(toolCalls),
      createToolUseResponse(toolCalls),
    ])

    const maxIterations = 2
    const kernel = new AgentKernel(createConfig(fakeLLMAdapter, maxIterations))
    const result: KernelRunResult = await kernel.run(createInput({ maxIterations }))

    expect(result.finalStatus).toBe('max_iterations_reached')
    expect(result.iterationsUsed).toBe(2)
    expect(result.toolCalls).toHaveLength(2)
    expect(result.finalResponse).toBeUndefined()
  })

  it('should handle empty tool_calls array without stalling (EC-1)', async () => {
    const emptyToolCallsResponse: LLMResponse = {
      id: 'resp-' + Date.now(),
      model: 'test-model',
      content: '',
      role: 'assistant',
      toolCalls: [],
      finishReason: 'tool_calls',
      createdAt: new Date().toISOString(),
    }

    const fakeLLMAdapter = new FakeLLMAdapter([
      emptyToolCallsResponse,
      createTextResponse('Proceeding without tool calls.'),
    ])

    const kernel = new AgentKernel(createConfig(fakeLLMAdapter))
    const result: KernelRunResult = await kernel.run(createInput())

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Proceeding without tool calls.')
    expect(result.toolCalls).toHaveLength(0)
    const types = result.transcript.map((e) => e.type)
    expect(types).not.toContain('tool_call')
    expect(types).not.toContain('tool_result')
  })

  it('should produce tool_result with error when tool fails and loop completes', async () => {
    fakeToolExecutor.registerTool('failing-tool', async function () {
      return {
        success: false,
        error: { code: 'EXECUTION_FAILED', message: 'Network timeout contacting upstream service', recoverable: true },
      }
    })

    const tc: ToolCall[] = [
      {
        id: 'call-fail-1',
        type: 'function',
        function: { name: 'failing-tool', arguments: JSON.stringify({ target: 'example.com' }) },
      },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(tc), createTextResponse('Tool failed, retrying.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('failing-tool') }))

    const tre = result.transcript.filter(function (e) {
      return e.type === 'tool_result'
    })
    expect(tre).toHaveLength(1)

    const tr = tre[0].content as {
      toolCallId: string
      result: unknown
      error?: { code: string; message: string; recoverable: boolean }
    }
    expect(tr.toolCallId).toBe('call-fail-1')
    expect(tr.error).toBeDefined()
    expect(tr.error!.code).toBe('EXECUTION_FAILED')
    expect(tr.error!.message).toContain('Network timeout')
    expect(tr.result).toBeNull()
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Tool failed, retrying.')
  })

  it('should include Error: content in tool role message sent to LLM after failure', async () => {
    fakeToolExecutor.registerTool('error-tool', async function () {
      return {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Upstream service temporarily unavailable', recoverable: true },
      }
    })

    const tc: ToolCall[] = [
      {
        id: 'call-err-1',
        type: 'function',
        function: { name: 'error-tool', arguments: JSON.stringify({ query: 'test' }) },
      },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(tc), createTextResponse('Service down.')])
    const kernel = new AgentKernel(createConfig(adapter))
    await kernel.run(createInput({ toolProjection: toolProjectionFor('error-tool') }))

    const reqs = adapter.getAllRequests()
    expect(reqs.length).toBe(2)

    const secondRequest = reqs[1]
    const toolMsgs = secondRequest.messages.filter(function (m) {
      return m.role === 'tool'
    })
    expect(toolMsgs.length).toBeGreaterThanOrEqual(1)

    const errMsg = toolMsgs.find(function (m) {
      return m.content.startsWith('Error:')
    })
    expect(errMsg).toBeDefined()
    expect(errMsg!.content).toBe('Error: Upstream service temporarily unavailable')
    expect(errMsg!.toolCallId).toBe('call-err-1')
    expect(errMsg!.role).toBe('tool')
  })

  it('should complete loop with finalResponse when LLM recovers after tool failure', async () => {
    fakeToolExecutor.registerTool('retriable-tool', async function (params: unknown) {
      const a = (params as { attempt: number }).attempt
      if (a === 1) {
        return {
          success: false,
          error: { code: 'TRANSIENT_ERROR', message: 'Connection refused, please retry', recoverable: true },
        }
      }
      return { success: true, data: { result: 'success after retry' }, resultPreview: 'success' }
    })

    const tc1: ToolCall[] = [
      {
        id: 'call-retry-1',
        type: 'function',
        function: { name: 'retriable-tool', arguments: JSON.stringify({ attempt: 1 }) },
      },
    ]
    const tc2: ToolCall[] = [
      {
        id: 'call-retry-2',
        type: 'function',
        function: { name: 'retriable-tool', arguments: JSON.stringify({ attempt: 2 }) },
      },
    ]

    const adapter = new FakeLLMAdapter([
      createToolUseResponse(tc1),
      createToolUseResponse(tc2),
      createTextResponse('Success on second attempt.'),
    ])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('retriable-tool'),
        maxIterations: 5,
      }),
    )

    expect(result.finalStatus).toBe('completed')
    expect(result.toolCalls).toHaveLength(2)
    expect(result.iterationsUsed).toBe(3)

    const tre = result.transcript.filter(function (e) {
      return e.type === 'tool_result'
    })
    expect(tre).toHaveLength(2)

    const firstResult = tre[0].content as { toolCallId: string; error?: { code: string } }
    expect(firstResult.toolCallId).toBe('call-retry-1')
    expect(firstResult.error!.code).toBe('TRANSIENT_ERROR')

    const secondResult = tre[1].content as { toolCallId: string; result: unknown }
    expect(secondResult.toolCallId).toBe('call-retry-2')
    expect(secondResult.result).toEqual({ result: 'success after retry' })

    const reqs = adapter.getAllRequests()
    const middleRequest = reqs[1]
    const errMsgs = middleRequest.messages.filter(function (m) {
      return m.role === 'tool' && m.content.startsWith('Error:')
    })
    expect(errMsgs).toHaveLength(1)
    expect(errMsgs[0].content).toBe('Error: Connection refused, please retry')
  })

  it('should produce paired results for all tools when some succeed and some fail', async () => {
    fakeToolExecutor.registerTool('success-tool', async function (params: unknown) {
      const x = (params as { x: number }).x
      return { success: true, data: { value: x * 2 } }
    })
    fakeToolExecutor.registerTool('failure-tool', async function () {
      return {
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'User does not have write access', recoverable: false },
      }
    })

    const tcs: ToolCall[] = [
      {
        id: 'call-success',
        type: 'function',
        function: { name: 'success-tool', arguments: JSON.stringify({ x: 21 }) },
      },
      { id: 'call-failure', type: 'function', function: { name: 'failure-tool', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(tcs), createTextResponse('One succeeded, one failed.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('success-tool', 'failure-tool'),
      }),
    )

    expect(result.toolCalls).toHaveLength(2)

    const tre = result.transcript.filter(function (e) {
      return e.type === 'tool_result'
    })
    expect(tre).toHaveLength(2)

    const ids = tre
      .map(function (e) {
        return (e.content as { toolCallId: string }).toolCallId
      })
      .sort()
    expect(ids).toEqual(['call-failure', 'call-success'].sort())

    const okEntry = tre.find(function (e) {
      return (e.content as { toolCallId: string }).toolCallId === 'call-success'
    })!
    const okContent = okEntry.content as { result: unknown; error?: unknown }
    expect(okContent.result).toEqual({ value: 42 })
    expect(okContent.error).toBeUndefined()

    const failEntry = tre.find(function (e) {
      return (e.content as { toolCallId: string }).toolCallId === 'call-failure'
    })!
    const failContent = failEntry.content as { result: unknown; error?: { code: string; recoverable: boolean } }
    expect(failContent.result).toBeNull()
    expect(failContent.error!.code).toBe('PERMISSION_DENIED')
    expect(failContent.error!.recoverable).toBe(false)

    expect(result.finalStatus).toBe('completed')

    const req2 = adapter.getAllRequests()[1]
    const msgs = req2.messages.filter(function (m) {
      return m.role === 'tool'
    })
    expect(msgs).toHaveLength(2)

    const successMsg = msgs.find(function (m) {
      return m.toolCallId === 'call-success'
    })!
    expect(successMsg.content).toBe(JSON.stringify({ value: 42 }))

    const failureMsg = msgs.find(function (m) {
      return m.toolCallId === 'call-failure'
    })!
    expect(failureMsg.content).toBe('Error: User does not have write access')
  })

  it('should produce tool_result with DISPATCH_ERROR when tool dispatch throws', async () => {
    fakeDispatcher.registerHandler('execute_tool', async function (request: DispatchRequest) {
      const p = request.action.targetAction as { toolName?: string } | undefined
      if (p && p.toolName === 'crash-tool') {
        throw new Error('Dispatcher panic: tool plane unreachable')
      }
      const r = await fakeToolExecutor.execute({
        toolCallId: 'x',
        toolName: p?.toolName || 'unknown',
        params: {},
        userId: 'test-user',
        permissionContext: { userId: 'test-user', permissions: ['tool:execute'] },
      })
      return {
        requestId: request.requestId,
        actionId: request.action.actionId,
        status: r.success ? 'completed' : 'failed',
        targetRuntime: 'tool_plane',
        result: r,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    })

    const tc: ToolCall[] = [{ id: 'call-crash', type: 'function', function: { name: 'crash-tool', arguments: '{}' } }]

    const adapter = new FakeLLMAdapter([createToolUseResponse(tc), createTextResponse('Dispatch crashed.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('crash-tool'),
      }),
    )

    const tre = result.transcript.filter(function (e) {
      return e.type === 'tool_result'
    })
    expect(tre).toHaveLength(1)

    const tr = tre[0].content as {
      toolCallId: string
      result: unknown
      error?: { code: string; message: string; recoverable: boolean }
    }
    expect(tr.toolCallId).toBe('call-crash')
    expect(tr.error!.code).toBe('DISPATCH_ERROR')
    expect(tr.error!.message).toContain('Dispatcher panic')
    expect(tr.result).toBeNull()
    expect(result.finalStatus).toBe('completed')

    const em = adapter.getAllRequests()[1].messages.find(function (m) {
      return m.role === 'tool' && m.content.startsWith('Error:')
    })!
    expect(em.content).toContain('Dispatcher panic')
  })

  it('should produce error tool_result when tool is not projected as callable', async () => {
    const tc: ToolCall[] = [
      { id: 'call-unprojected', type: 'function', function: { name: 'unprojected-tool', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(tc), createTextResponse('Tool not available.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput())

    const tre = result.transcript.filter(function (e) {
      return e.type === 'tool_result'
    })
    expect(tre).toHaveLength(1)

    const tr = tre[0].content as { toolCallId: string; error?: { code: string; recoverable: boolean } }
    expect(tr.error!.code).toBe('UNPROJECTED_TOOL_CALL')
    expect(tr.error!.recoverable).toBe(false)
    expect(result.finalStatus).toBe('completed')
  })

  it('should produce valid pairing when transcript includes both successful and failed tool calls', async () => {
    fakeToolExecutor.registerTool('tool-a', async function () {
      return { success: true, data: { ok: true } }
    })
    fakeToolExecutor.registerTool('tool-b', async function () {
      return { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests', recoverable: true } }
    })
    fakeToolExecutor.registerTool('tool-c', async function () {
      return { success: true, data: { done: true } }
    })

    const ta: ToolCall[] = [{ id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } }]
    const tbc: ToolCall[] = [
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
      { id: 'call-c', type: 'function', function: { name: 'tool-c', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([
      createToolUseResponse(ta),
      createToolUseResponse(tbc),
      createTextResponse('All done.'),
    ])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('tool-a', 'tool-b', 'tool-c'),
        maxIterations: 5,
      }),
    )

    expect(result.toolCalls).toHaveLength(3)
    expect(
      result.transcript.filter(function (e) {
        return e.type === 'tool_result'
      }),
    ).toHaveLength(3)

    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pr = validateToolResultPairing(result.transcript)
    expect(pr.valid).toBe(true)
    expect(pr.warnings).toHaveLength(0)
  })
})
