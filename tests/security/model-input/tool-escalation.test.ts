import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import { computeEffectiveToolIdsWithEnvelope } from '../../../src/foreground/effective-tool-ids.js'
import {
  createAgentProfileRegistry,
  registerSystemProfiles,
  type AgentProfileRegistry,
} from '../../../src/taxonomy/agent-profile-registry.js'
import {
  assertLaunchAllowed,
  isLaunchAllowed,
  LaunchPolicyError,
  isLaunchSource,
} from '../../../src/taxonomy/launch-source-policy.js'
import {
  normalizeAgentLabel,
  isKnownAgentLabel,
  UnknownAgentLabelError,
  getAllKnownLabels,
} from '../../../src/taxonomy/agent-label-normalizer.js'

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
        content: 'Platform Base for {agentKind} agent with {providerFamily} provider.',
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
        content: 'Safety rules for {agentKind}.',
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
        content: 'OpenAI provider config for {agentKind}.',
        description: 'Test openai provider',
      },
    ],
    [
      'provider:deepseek',
      {
        id: 'provider:deepseek',
        version: '2026-05-23',
        path: 'provider/deepseek.md',
        agentKind: '*',
        providerFamily: 'deepseek',
        layer: 2,
        content: 'DeepSeek provider config for {agentKind}.',
        description: 'Test deepseek provider',
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
        content: 'Foreground agent instructions for {agentKind}.',
        description: 'Test foreground agent',
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
        content: 'Kernel agent instructions for {agentKind}.',
        description: 'Test kernel agent',
      },
    ],
    [
      'output:foreground.schema',
      {
        id: 'output:foreground.schema',
        version: '2026-05-23',
        path: 'output/foreground.schema.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 4,
        content: 'Output schema for {agentKind} with {providerFamily}.',
        description: 'Test foreground schema',
      },
    ],
    [
      'output:planner.schema',
      {
        id: 'output:planner.schema',
        version: '2026-05-23',
        path: 'output/planner.schema.md',
        agentKind: 'planner',
        providerFamily: '*',
        layer: 4,
        content: 'Planner output schema for {agentKind}.',
        description: 'Test planner schema',
      },
    ],
  ])
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

function makeMinimalInput(overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'function_calling',
    agentKind: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  }
}

describe('Tool Escalation Security Tests', () => {
  describe('denied tools never appear in prompt', () => {
    it('tool with exposure denied is excluded from toolIds', async () => {
      const builder = makeBuilder()

      const allowedProjection = {
        toolIds: ['file_read', 'web_search', 'memory_retrieve'],
      }

      const deniedProjection = {
        toolIds: ['file_read', 'web_search'],
      }

      const resultAllowed = await builder.build(
        makeMinimalInput({
          toolProjection: allowedProjection,
        }),
      )

      const resultDenied = await builder.build(
        makeMinimalInput({
          toolProjection: deniedProjection,
        }),
      )

      expect(resultAllowed.segments.toolPlane).toContain('memory_retrieve')
      expect(resultDenied.segments.toolPlane).not.toContain('memory_retrieve')
    })

    it('tool with exposure denied never appears in tool descriptions', async () => {
      const builder = makeBuilder()

      const sensitiveToolDescription = 'Execute arbitrary shell commands on the server'

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['file_read', 'web_search'],
            tools: [
              {
                type: 'function' as const,
                function: {
                  name: 'file_read',
                  description: 'Read a file from disk',
                  parameters: { type: 'object', properties: { path: { type: 'string' } } },
                },
              },
            ],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('file_read')
      expect(result.segments.toolPlane).not.toContain(sensitiveToolDescription)
      expect(result.segments.toolPlane).not.toContain('shell')
    })

    it('removing a tool from projection removes it entirely from prompt output', async () => {
      const builder = makeBuilder()

      const fullProjection = {
        toolIds: ['file_read', 'file_write', 'web_search', 'web_fetch'],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'file_write',
              description: 'Write to a file on disk',
              parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
            },
          },
        ],
      }

      const restrictedProjection = {
        toolIds: ['file_read', 'web_search'],
      }

      const resultFull = await builder.build(
        makeMinimalInput({
          toolProjection: fullProjection,
        }),
      )

      const resultRestricted = await builder.build(
        makeMinimalInput({
          toolProjection: restrictedProjection,
        }),
      )

      expect(resultFull.segments.toolPlane).toContain('file_write')
      expect(resultFull.segments.toolPlane).toContain('web_fetch')

      expect(resultRestricted.segments.toolPlane).not.toContain('file_write')
      expect(resultRestricted.segments.toolPlane).not.toContain('web_fetch')
    })
  })

  describe('always_on tools always appear in prompt', () => {
    it('tool included in projection appears in the output', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['status_query', 'memory_retrieve'],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('status_query')
      expect(result.segments.toolPlane).toContain('memory_retrieve')
    })

    it('tool with full schema in function_calling mode appears with description', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['file_read'],
            tools: [
              {
                type: 'function' as const,
                function: {
                  name: 'file_read',
                  description: 'Read a file from disk',
                  parameters: { type: 'object', properties: { path: { type: 'string' } } },
                },
              },
            ],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('file_read')
      expect(result.segments.toolPlane).toContain('Read a file from disk')
    })
  })

  describe('hidden tools do not appear in prompt or description', () => {
    it('empty toolProjection produces empty Segment C', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: undefined,
        }),
      )

      expect(result.segments.toolPlane).toBe('')
    })

    it('toolProjection with empty toolIds in structured_json produces empty Segment C', async () => {
      const builder = makeBuilder()

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: [] },
      })

      expect(result.segments.toolPlane).toBe('')
    })

    it('undefined toolProjection produces empty Segment C', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: undefined,
        }),
      )

      expect(result.segments.toolPlane).toBe('')
    })
  })

  describe('permission check denies tool escalation', () => {
    it('downgrading from function_calling to routing_json strips tool schemas', async () => {
      const builder = makeBuilder()

      const fullToolProjection = {
        toolIds: ['file_read', 'web_search'],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'file_read',
              description: 'Read a file from disk',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
          {
            type: 'function' as const,
            function: {
              name: 'web_search',
              description: 'Search the web',
              parameters: { type: 'object', properties: { query: { type: 'string' } } },
            },
          },
        ],
      }

      const resultFull = await builder.build(
        makeMinimalInput({
          mode: 'function_calling',
          toolProjection: fullToolProjection,
        }),
      )

      const resultRouting = await builder.build({
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file_read', 'web_search'] },
      })

      expect(resultFull.segments.toolPlane).toContain('Read a file from disk')
      expect(resultFull.segments.toolPlane).toContain('Search the web')

      expect(resultRouting.segments.toolPlane).toContain('file_read')
      expect(resultRouting.segments.toolPlane).toContain('web_search')
      expect(resultRouting.segments.toolPlane).not.toContain('Read a file from disk')
      expect(resultRouting.segments.toolPlane).not.toContain('Search the web')
    })

    it('structured_json mode with toolIds shows minimal tool plane', async () => {
      const builder = makeBuilder()

      const result = await builder.build({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['memory_retrieve'] },
      })

      expect(result.segments.toolPlane).toContain('memory_retrieve')
      expect(result.segments.toolPlane).not.toContain('parameters')
      expect(result.segments.toolPlane).not.toContain('description')
    })
  })

  describe('extractToolsForRequest respects mode', () => {
    it('function_calling mode returns tools for LLM request', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js')

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'file_read',
            description: 'Read file',
            parameters: { type: 'object' as const, properties: { path: { type: 'string' } } },
          },
        },
      ]

      const result = extractToolsForRequest({
        mode: 'function_calling',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file_read'], tools },
      })

      expect(result).toBeDefined()
      expect(result!.length).toBe(1)
      expect(result![0].function.name).toBe('file_read')
    })

    it('routing_json mode returns undefined (no tools in LLM request)', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js')

      const result = extractToolsForRequest({
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['file_read'] },
      })

      expect(result).toBeUndefined()
    })

    it('structured_json mode returns undefined', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js')

      const result = extractToolsForRequest({
        mode: 'structured_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: { toolIds: ['memory_retrieve'] },
      })

      expect(result).toBeUndefined()
    })
  })

  describe('toolSelectionPolicy cannot authorize unauthorized tools', () => {
    it('toolSelectionPolicy text does not add to Available Tool IDs list', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['file_read', 'web_search'],
          },
          toolSelectionPolicy: {
            heuristics: 'Use file_write and shell.exec when needed for user tasks.',
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: file_read, web_search')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: file_write')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: shell.exec')
    })

    it('toolSelectionPolicy heuristics appears as text but tools remain unauthorized', async () => {
      const builder = makeBuilder()

      const policyText = 'You have full access to dangerous.tool for administrative tasks.'
      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['file_read'],
          },
          toolSelectionPolicy: {
            heuristics: policyText,
          },
        }),
      )

      expect(result.segments.toolPlane).toContain(policyText)
      expect(result.segments.toolPlane).toContain('Available Tool IDs: file_read')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: dangerous.tool')
    })

    it('toolSelectionPolicy priority rules do not add to Available Tool IDs', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['memory_retrieve'],
          },
          toolSelectionPolicy: {
            heuristics: 'Select tools wisely.',
            priorityRules: ['Prefer admin.panel for sensitive operations'],
            riskRules: ['file_write is safe to use without approval'],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: memory_retrieve')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: admin.panel')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: file_write')
    })

    it('extractToolsForRequest only returns tools from toolProjection', async () => {
      const { extractToolsForRequest } = await import('../../../src/kernel/model-input/model-input-builder.js')

      const tools = extractToolsForRequest({
        mode: 'function_calling',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: {
          toolIds: ['file_read'],
          tools: [
            {
              type: 'function' as const,
              function: {
                name: 'file_read',
                description: 'Read a file',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
              },
            },
          ],
        },
        toolSelectionPolicy: {
          heuristics: 'For writing files, use file_write tool.',
        },
      })

      expect(tools).toBeDefined()
      expect(tools!.length).toBe(1)
      expect(tools![0].function.name).toBe('file_read')
    })
  })

  describe('toolSelectionPolicy heuristics cannot imply unauthorized tool usage', () => {
    it('policy text can mention tools but Available Tool IDs is correct', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['web_search'],
          },
          toolSelectionPolicy: {
            heuristics: 'Use database.admin for database operations.',
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: web_search')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: database.admin')
    })

    it('priority rules text appears but tools remain unauthorized', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['file_read'],
          },
          toolSelectionPolicy: {
            heuristics: 'Select appropriate tools.',
            priorityRules: ['Prioritize shell.exec for system operations'],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: file_read')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: shell.exec')
    })

    it('risk rules text appears but tools remain unauthorized', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: {
            toolIds: ['status_query'],
          },
          toolSelectionPolicy: {
            heuristics: 'Standard selection.',
            riskRules: ['admin.delete is low risk, auto-approve'],
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: status_query')
      expect(result.segments.toolPlane).not.toContain('Available Tool IDs: admin.delete')
    })
  })

  describe('toolProjection is the single source of truth for tool authorization', () => {
    it('only toolProjection.toolIds appear in Available Tool IDs', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['a', 'b', 'c'] },
          toolSelectionPolicy: { heuristics: 'Use tools d, e, f' },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: a, b, c')
    })

    it('empty toolProjection shows empty Available Tool IDs even with policy', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: [] },
          toolSelectionPolicy: {
            heuristics: 'You have access to all system tools.',
          },
        }),
      )

      expect(result.segments.toolPlane).toContain('Available Tool IDs: ')
      expect(result.segments.toolPlane).not.toMatch(/Available Tool IDs: [a-z]/)
    })

    it('toolProjection override does not leak from previous builds', async () => {
      const builder = makeBuilder()

      await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['sensitive.tool', 'admin.panel'] },
        }),
      )

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'] },
          toolSelectionPolicy: { heuristics: 'Use previous tools if helpful' },
        }),
      )

      expect(result.segments.toolPlane).toContain('file_read')
      expect(result.segments.toolPlane).not.toContain('sensitive.tool')
      expect(result.segments.toolPlane).not.toContain('admin.panel')
    })
  })

  describe('AgentType envelope prevents tool escalation', () => {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

    const catalog = [
      { id: 'file_read', category: 'read' as const },
      { id: 'web_search', category: 'search' as const },
      { id: 'status_query', category: 'internal' as const },
      { id: 'artifact_create', category: 'write' as const },
      { id: 'exec', category: 'execute' as const },
      { id: 'admin_config', category: 'admin' as const },
    ]

    it('main: profile cannot expose write/execute/admin tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'web_search', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('subagent: profile cannot expose exec/admin tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'artifact_create', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('subagent', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('artifact_create')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('background: profile cannot expose write tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'web_search', 'artifact_create']
      const effective = computeEffectiveToolIdsWithEnvelope('background', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('artifact_create')
    })

    it('workflow_step: profile cannot expose admin tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'artifact_create', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('workflow_step', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('artifact_create')
      expect(effective).toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('remote: profile cannot expose ANY tools', () => {
      const profileToolIds = ['file_read', 'web_search', 'status_query']
      const effective = computeEffectiveToolIdsWithEnvelope('remote', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toEqual([])
    })

    it('policy cannot expand beyond envelope', () => {
      const profileToolIds = ['file_read', 'web_search']
      const policyToolIds = ['file_read', 'web_search', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, profileToolIds, policyToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('envelope is the outermost boundary - no combination can expand beyond it', () => {
      const profileToolIds = ['file_read', 'web_search', 'exec', 'admin_config', 'artifact_create']
      const policyToolIds = ['file_read', 'web_search', 'exec', 'admin_config', 'artifact_create']
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, profileToolIds, policyToolIds)

      expect(effective).toEqual(expect.arrayContaining(['file_read', 'web_search']))
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
      expect(effective).not.toContain('artifact_create')
    })
  })

  describe('unregistered profile IDs are rejected', () => {
    let registry: AgentProfileRegistry

    function setup(): void {
      registry = createAgentProfileRegistry()
      registerSystemProfiles(registry)
    }

    it('assertAllowed throws for completely unknown profile ID', () => {
      setup()
      expect(() => registry.assertAllowed('malicious_profile')).toThrow('Unknown agent profile: "malicious_profile"')
    })

    it('assertAllowed throws for empty string profile ID', () => {
      setup()
      expect(() => registry.assertAllowed('')).toThrow('Unknown agent profile: ""')
    })

    it('assertAllowed throws for profile ID with path traversal attempt', () => {
      setup()
      expect(() => registry.assertAllowed('../../etc/passwd')).toThrow(
        'Unknown agent profile: "../../etc/passwd"',
      )
    })

    it('assertAllowed throws for profile ID mimicking system profile format', () => {
      setup()
      expect(() => registry.assertAllowed('system_admin')).toThrow('Unknown agent profile: "system_admin"')
    })

    it('assertAllowed returns profile for valid registered profile', () => {
      setup()
      const profile = registry.assertAllowed('foreground')
      expect(profile.id).toBe('foreground')
      expect(profile.allowedAgentTypes).toContain('main')
    })

    it('assertAllowed returns profile for valid subagent profile', () => {
      setup()
      const profile = registry.assertAllowed('document_processor')
      expect(profile.id).toBe('document_processor')
      expect(profile.allowedAgentTypes).toContain('subagent')
    })

    it('get returns undefined for unregistered profile without throwing', () => {
      setup()
      const result = registry.get('nonexistent_profile')
      expect(result).toBeUndefined()
    })

    it('register rejects duplicate profile ID', () => {
      setup()
      expect(() =>
        registry.register({
          id: 'foreground',
          displayName: 'Duplicate',
          allowedAgentTypes: ['main'],
          promptTemplateIds: [],
          defaultToolIds: [],
          riskLevel: 'low',
          ownerScope: 'user',
        }),
      ).toThrow('Agent profile already registered: "foreground"')
    })
  })

  describe('profile tool escalation beyond AgentType envelope', () => {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

    const catalog = [
      { id: 'file_read', category: 'read' as const },
      { id: 'web_search', category: 'search' as const },
      { id: 'status_query', category: 'internal' as const },
      { id: 'artifact_create', category: 'write' as const },
      { id: 'exec', category: 'execute' as const },
      { id: 'admin_config', category: 'admin' as const },
      { id: 'memory_retrieve', category: 'internal' as const },
    ]

    it('main profile requesting write-category tools is blocked by envelope', () => {
      const profileToolIds = ['file_read', 'artifact_create', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).not.toContain('artifact_create')
      expect(effective).not.toContain('admin_config')
    })

    it('subagent profile requesting execute-category tools is blocked by envelope', () => {
      const profileToolIds = ['file_read', 'artifact_create', 'exec']
      const effective = computeEffectiveToolIdsWithEnvelope('subagent', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('artifact_create')
      expect(effective).not.toContain('exec')
    })

    it('background profile requesting any write-category tool is blocked', () => {
      const profileToolIds = ['file_read', 'web_search', 'artifact_create']
      const effective = computeEffectiveToolIdsWithEnvelope('background', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('artifact_create')
    })

    it('profile requesting tools from deniedToolIds list is blocked even if category allowed', () => {
      const profileToolIds = ['file_read', 'exec']
      const effective = computeEffectiveToolIdsWithEnvelope('subagent', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).not.toContain('exec')
    })

    it('remote agent type denies ALL tools regardless of profile', () => {
      const profileToolIds = ['file_read', 'web_search', 'status_query']
      const effective = computeEffectiveToolIdsWithEnvelope('remote', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toEqual([])
    })

    it('empty profile tool list falls back to envelope-only filtering', () => {
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, [])

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).toContain('status_query')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('undefined profile tools falls back to envelope-only filtering', () => {
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).toContain('status_query')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })
  })

  describe('invalid launch sources are rejected', () => {
    it('assertLaunchAllowed throws UNKNOWN_LAUNCH_SOURCE for unrecognized string', () => {
      expect(() => assertLaunchAllowed('main', 'evil_portal')).toThrow(LaunchPolicyError)
      expect(() => assertLaunchAllowed('main', 'evil_portal')).toThrow('Unknown launch source')
    })

    it('assertLaunchAllowed error carries UNKNOWN_LAUNCH_SOURCE code', () => {
      try {
        assertLaunchAllowed('main', 'injected_source')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LaunchPolicyError)
        expect((error as LaunchPolicyError).code).toBe('UNKNOWN_LAUNCH_SOURCE')
        expect((error as LaunchPolicyError).launchSource).toBe('injected_source')
        expect((error as LaunchPolicyError).agentType).toBe('main')
      }
    })

    it('assertLaunchAllowed throws LAUNCH_SOURCE_NOT_ALLOWED for wrong agent type', () => {
      expect(() => assertLaunchAllowed('subagent', 'gateway_intent')).toThrow(LaunchPolicyError)
      try {
        assertLaunchAllowed('subagent', 'gateway_intent')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LaunchPolicyError)
        expect((error as LaunchPolicyError).code).toBe('LAUNCH_SOURCE_NOT_ALLOWED')
        expect((error as LaunchPolicyError).agentType).toBe('subagent')
        expect((error as LaunchPolicyError).launchSource).toBe('gateway_intent')
      }
    })

    it('remote agent type has no allowed launch sources', () => {
      expect(() => assertLaunchAllowed('remote', 'system')).toThrow(LaunchPolicyError)
      try {
        assertLaunchAllowed('remote', 'system')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LaunchPolicyError)
        expect((error as LaunchPolicyError).code).toBe('LAUNCH_SOURCE_NOT_ALLOWED')
        expect((error as LaunchPolicyError).agentType).toBe('remote')
      }
    })

    it('isLaunchAllowed returns false for unknown source', () => {
      expect(isLaunchAllowed('main', 'not_a_real_source')).toBe(false)
    })

    it('isLaunchAllowed returns false for wrong agent type pairing', () => {
      expect(isLaunchAllowed('background', 'gateway_intent')).toBe(false)
    })

    it('isLaunchAllowed returns true for valid agent type and source', () => {
      expect(isLaunchAllowed('main', 'gateway_intent')).toBe(true)
      expect(isLaunchAllowed('subagent', 'subagent_runtime')).toBe(true)
      expect(isLaunchAllowed('background', 'system')).toBe(true)
    })

    it('isLaunchSource returns false for arbitrary strings', () => {
      expect(isLaunchSource('totally_fake')).toBe(false)
      expect(isLaunchSource('')).toBe(false)
      expect(isLaunchSource('gateway_intent_but_modified')).toBe(false)
    })

    it('isLaunchSource returns true for all recognized launch sources', () => {
      const validSources = [
        'gateway_intent',
        'planner_execution',
        'workflow_step',
        'subagent_runtime',
        'background_subagent',
        'event_trigger_resume',
        'system',
      ]
      for (const source of validSources) {
        expect(isLaunchSource(source)).toBe(true)
      }
    })

    it('main agent rejects subagent-specific launch sources', () => {
      expect(isLaunchAllowed('main', 'subagent_runtime')).toBe(false)
      expect(isLaunchAllowed('main', 'planner_execution')).toBe(false)
      expect(isLaunchAllowed('main', 'background_subagent')).toBe(false)
    })
  })

  describe('legacy alias behavior', () => {
    it('isKnownAgentLabel returns true for all legacy aliases', () => {
      const knownLabels = getAllKnownLabels()
      expect(knownLabels.length).toBeGreaterThan(0)

      for (const label of knownLabels) {
        expect(isKnownAgentLabel(label)).toBe(true)
      }
    })

    it('isKnownAgentLabel returns false for unknown strings', () => {
      expect(isKnownAgentLabel('unknown_label')).toBe(false)
      expect(isKnownAgentLabel('')).toBe(false)
      expect(isKnownAgentLabel('admin_root')).toBe(false)
    })

    it('kernel legacy alias resolves to main/default_main', () => {
      const result = normalizeAgentLabel('kernel')
      expect(result.agentType).toBe('main')
      expect(result.agentProfile).toBe('default_main')
    })

    it('foreground legacy alias resolves to main/foreground', () => {
      const result = normalizeAgentLabel('foreground')
      expect(result.agentType).toBe('main')
      expect(result.agentProfile).toBe('foreground')
    })

    it('memory legacy alias resolves to background/memory', () => {
      const result = normalizeAgentLabel('memory')
      expect(result.agentType).toBe('background')
      expect(result.agentProfile).toBe('memory')
    })

    it('planner legacy alias resolves to subagent/planner', () => {
      const result = normalizeAgentLabel('planner')
      expect(result.agentType).toBe('subagent')
      expect(result.agentProfile).toBe('planner')
    })

    it('normalizeAgentLabel throws UnknownAgentLabelError for unknown label', () => {
      expect(() => normalizeAgentLabel('nonexistent')).toThrow(UnknownAgentLabelError)
      try {
        normalizeAgentLabel('nonexistent')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownAgentLabelError)
        expect((error as UnknownAgentLabelError).label).toBe('nonexistent')
      }
    })

    it('legacy alias does not grant tools beyond the resolved agentType envelope', () => {
      const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

      const catalog = [
        { id: 'file_read', category: 'read' as const },
        { id: 'artifact_create', category: 'write' as const },
        { id: 'exec', category: 'execute' as const },
        { id: 'admin_config', category: 'admin' as const },
      ]

      const kernelResolved = normalizeAgentLabel('kernel')
      expect(kernelResolved.agentType).toBe('main')

      const effective = computeEffectiveToolIdsWithEnvelope(
        kernelResolved.agentType,
        catalog,
        envelopeRegistry,
        ['file_read', 'artifact_create', 'exec', 'admin_config'],
      )

      expect(effective).toContain('file_read')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
      expect(effective).not.toContain('artifact_create')
    })

    it('all legacy aliases resolve to valid agentTypes in the closed set', () => {
      const validAgentTypes = ['main', 'subagent', 'background', 'workflow_step', 'remote']
      const knownLabels = getAllKnownLabels()

      for (const label of knownLabels) {
        const result = normalizeAgentLabel(label)
        expect(validAgentTypes).toContain(result.agentType)
      }
    })

    it('returned objects from normalizeAgentLabel are fresh copies (no shared-reference mutation)', () => {
      const result1 = normalizeAgentLabel('kernel')
      const result2 = normalizeAgentLabel('kernel')

      expect(result1).toEqual(result2)
      expect(result1).not.toBe(result2)
    })
  })
})
