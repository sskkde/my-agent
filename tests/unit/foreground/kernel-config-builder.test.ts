import { describe, it, expect, vi } from 'vitest'
import { buildKernelConfigFromDeps } from '../../../src/foreground/kernel-config-builder.js'
import type { ProcessorOrchestrationDeps } from '../../../src/processing/processor-orchestration.js'
import type { DispatchRequest, DispatchResult } from '../../../src/dispatcher/types.js'

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
})
