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
        taxonomyLayer: 'platform',
        content:
          'You are a helpful AI assistant with access to tools.',
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
        taxonomyLayer: 'platform',
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
        taxonomyLayer: 'provider',
        content: '',
        description: 'Test openai provider',
      },
    ],
    [
      'agentProfile:foreground',
      {
        id: 'agentProfile:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'foreground',
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

export function createMockModelInputBuilder(modeOverride?: 'function_calling' | 'structured_json'): ModelInputBuilder {
  const mode = modeOverride ?? 'function_calling'

  const build = vi.fn(async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
    const toolIds = input.toolProjection?.toolIds ?? []
    // Match production: function_calling has empty prompt tool plane; structured_json keeps IDs.
    const toolPlaneContent =
      mode === 'structured_json' && toolIds.length > 0
        ? `Available Tool IDs: ${toolIds.join(', ')}`
        : mode === 'structured_json'
          ? 'Available Tool IDs: none'
          : ''

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
          'You are a helpful AI assistant with access to tools.',
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
        agentKind: input.agentKind ?? input.agentProfile ?? 'foreground',
        agentType: input.agentType ?? 'main',
        agentProfile: input.agentProfile ?? input.agentKind ?? 'foreground',
        providerFamily: input.providerFamily,
        messageCount: messages.length,
        outputContract: input.outputContract,
        launchSource: input.launchSource,
      },
    }
  })

  return {
    build,
  } as unknown as ModelInputBuilder
}
