import { describe, it, expect, vi } from 'vitest'
import { buildKernelConfigFromDeps } from '../../../src/foreground/kernel-config-builder.js'
import type { ProcessorOrchestrationDeps } from '../../../src/processing/processor-orchestration.js'
import type { DispatchRequest, DispatchResult } from '../../../src/dispatcher/types.js'
import { createRealModelInputBuilder } from '../../helpers/model-input.js'

describe('buildKernelConfigFromDeps', () => {
  it('forwards agent identity through foreground tool executor adapter', async () => {
    let capturedRequest: DispatchRequest | undefined
    const dispatch = vi.fn(async (request: DispatchRequest): Promise<DispatchResult> => {
      capturedRequest = request
      return {
        requestId: request.requestId,
        actionId: request.action.actionId,
        status: 'completed',
        targetRuntime: 'tool_plane',
        result: 'ok',
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    })

    const deps = {
      runtimeDispatcher: { dispatch },
      llmAdapter: {},
    } as unknown as ProcessorOrchestrationDeps

    const config = buildKernelConfigFromDeps(deps)
    const result = await config.toolExecutor.execute({
      toolCallId: 'call-identity',
      toolName: 'todolist',
      params: {},
      userId: 'user-1',
      sessionId: 'session-1',
      kernelRunId: 'kernel-1',
      agentId: 'foreground.default',
      agentType: 'main',
      agentProfile: 'default',
      launchSource: 'gateway_intent',
      permissionContext: {
        userId: 'user-1',
        permissions: [],
      },
    })

    expect(result.success).toBe(true)
    expect(capturedRequest?.action.payload).toMatchObject({
      agentId: 'foreground.default',
      agentType: 'main',
      agentProfile: 'default',
      launchSource: 'gateway_intent',
    })
  })

  it('uses the injected real ModelInputBuilder instead of creating an empty-segment stub', async () => {
    const modelInputBuilder = createRealModelInputBuilder()
    const deps = {
      runtimeDispatcher: { dispatch: vi.fn() },
      llmAdapter: {},
      modelInputBuilder,
    } as unknown as ProcessorOrchestrationDeps

    const config = buildKernelConfigFromDeps(deps)

    expect(config.modelInputBuilder).toBe(modelInputBuilder)

    const built = await config.modelInputBuilder.build({
      mode: 'function_calling',
      agentType: 'main',
      agentProfile: 'default_main',
      providerFamily: 'openai',
      outputContract: 'output:default-chat.schema',
      currentUserMessage: 'hello',
      toolProjection: { toolIds: [] },
    })

    expect(built.segments.staticPrefix).toContain('You are a foreground routing agent')
    expect(built.segmentHashes.segmentA).toMatch(/^[a-f0-9]{64}$/)
    expect(built.segmentHashes.segmentA).not.toBe('')
  })
})
