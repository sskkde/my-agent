import { vi } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import type { BuiltModelInput, ModelInputBuildInput } from '../../src/kernel/model-input/model-input-types.js'

function makeTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    [
      'platform:base',
      {
        id: 'platform:base',
        version: '2026-05-23',
        path: 'platform/base.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content:
          'You are a foreground routing agent. Your task is to classify the user message and decide the appropriate route.',
        description: 'Test platform base',
      },
    ],
    [
      'platform:safety',
      {
        id: 'platform:safety',
        version: '2026-05-23',
        path: 'platform/safety.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Safety rules.',
        description: 'Test safety',
      },
    ],
    [
      'provider:openai',
      {
        id: 'provider:openai',
        version: '2026-05-23',
        path: 'provider/openai.md',
        agentKind: '*',
        providerFamily: 'openai',
        layer: 2,
        content: '',
        description: 'Test openai provider',
      },
    ],
    [
      'agents:foreground',
      {
        id: 'agents:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        content: '',
        description: 'Test foreground agent',
      },
    ],
  ])
}

export function createRealModelInputBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

export function createMockModelInputBuilder(modeOverride?: 'routing_json' | 'routing_tool_call'): ModelInputBuilder {
  const mode = modeOverride ?? 'routing_json'

  const build = vi.fn(async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
    const toolIds = input.toolProjection?.toolIds ?? []
    const toolPlaneContent =
      toolIds.length > 0 ? `Available Tool IDs: ${toolIds.join(', ')}` : 'Available Tool IDs: none'

    const contextBundleParts: string[] = []
    if (input.currentUserMessage) {
      contextBundleParts.push(`USER MESSAGE: "${input.currentUserMessage}"`)
    }
    if (input.contextBundle?.transcript && input.contextBundle.transcript.length > 0) {
      contextBundleParts.push('RECENT CONVERSATION HISTORY')
      for (const msg of input.contextBundle.transcript) {
        contextBundleParts.push(`- ${msg.role}: ${msg.content}`)
      }
    }

    const messages = [
      {
        role: 'system' as const,
        content:
          'You are a foreground routing agent. Your task is to classify the user message and decide the appropriate route.',
      },
      { role: 'user' as const, content: `${toolPlaneContent}\n\n${contextBundleParts.join('\n')}` },
    ]

    return {
      messages,
      segments: {
        staticPrefix: 'system-prompt',
        tenantProject: '',
        toolPlane: toolPlaneContent,
        contextBundle: contextBundleParts.join('\n'),
      },
      segmentHashes: {
        segmentA: 'hash-a',
        segmentB: 'hash-b',
        segmentC: 'hash-c',
        segmentD: 'hash-d',
      },
      metadata: {
        mode,
        agentKind: input.agentKind,
        providerFamily: input.providerFamily,
        messageCount: messages.length,
      },
    }
  })

  return {
    build,
  } as unknown as ModelInputBuilder
}
