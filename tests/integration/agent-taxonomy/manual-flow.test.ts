/**
 * Manual Agent Taxonomy Flow Test
 *
 * Integration test covering the manual QA flow for agent taxonomy:
 * 1. List all subagent profiles from the registry
 * 2. Launch a subagent via the runtime
 * 3. Assert a prompt snapshot from ModelInputBuilder
 * 4. Reject invalid profile IDs and tool escalation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAgentProfileRegistry,
  registerSystemProfiles,
  type AgentProfileRegistry,
} from '../../../src/taxonomy/agent-profile-registry.js'
import {
  normalizeAgentLabel,
  isKnownAgentLabel,
  getAllKnownLabels,
  UnknownAgentLabelError,
} from '../../../src/taxonomy/agent-label-normalizer.js'
import {
  assertLaunchAllowed,
  isLaunchAllowed,
  LaunchPolicyError,
  isLaunchSource,
} from '../../../src/taxonomy/launch-source-policy.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import { computeEffectiveToolIdsWithEnvelope } from '../../../src/foreground/effective-tool-ids.js'
import { SubagentRuntimeImpl } from '../../../src/subagents/subagent-runtime.js'
import type {
  ContextBundle,
  ContextItem,
} from '../../../src/context/types.js'
import type {
  SubagentTaskSpec,
  SubagentConfig,
  LaunchSubagentInput,
  KernelAdapter,
  SubagentContextManager,
} from '../../../src/subagents/types.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'

// ── Test helpers ──────────────────────────────────────────────────────────────

class FakeKernelAdapter implements KernelAdapter {
  private results: KernelRunResult[] = []
  private currentIndex = 0

  setResults(results: KernelRunResult[]) {
    this.results = results
    this.currentIndex = 0
  }

  async execute(): Promise<KernelRunResult> {
    return this.results[this.currentIndex++] ?? {
      finalStatus: 'completed',
      finalResponse: 'Subagent completed',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
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
      agentType: 'subagent',
      userId: 'test-user',
      invocationSource: 'subagent_runtime',
      pinnedItems: [isolatedItem],
      orderedItems: [],
      tokenEstimate: 10,
    }
  }
}

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
  ])
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Agent Taxonomy Manual Flow', () => {
  let registry: AgentProfileRegistry

  beforeEach(() => {
    registry = createAgentProfileRegistry()
    registerSystemProfiles(registry)
  })

  // ── 1. List subagent profiles ─────────────────────────────────────────────

  describe('list subagent profiles', () => {
    it('should list all 12 system profiles', () => {
      const profiles = registry.list()
      expect(profiles.length).toBe(12)
    })

    it('should include all expected profile IDs', () => {
      const profiles = registry.list()
      const ids = profiles.map((p) => p.id)

      expect(ids).toContain('default_main')
      expect(ids).toContain('foreground')
      expect(ids).toContain('planner')
      expect(ids).toContain('memory')
      expect(ids).toContain('search')
      expect(ids).toContain('document_processor')
      expect(ids).toContain('image_processor')
      expect(ids).toContain('data_processor')
      expect(ids).toContain('audio_processor')
      expect(ids).toContain('code_processor')
      expect(ids).toContain('research_processor')
      expect(ids).toContain('search_processor')
    })

    it('each profile should have required fields', () => {
      const profiles = registry.list()
      for (const profile of profiles) {
        expect(profile.id).toBeDefined()
        expect(profile.displayName).toBeDefined()
        expect(profile.allowedAgentTypes.length).toBeGreaterThan(0)
        expect(profile.riskLevel).toBeDefined()
        expect(profile.ownerScope).toBeDefined()
      }
    })

    it('all known legacy labels resolve to valid profiles', () => {
      const labels = getAllKnownLabels()
      expect(labels.length).toBeGreaterThan(0)

      for (const label of labels) {
        expect(isKnownAgentLabel(label)).toBe(true)
        const normalized = normalizeAgentLabel(label)
        const profile = registry.get(normalized.agentProfile)
        expect(profile).toBeDefined()
      }
    })
  })

  // ── 2. Launch a subagent via runtime ──────────────────────────────────────

  describe('launch a subagent', () => {
    let runtime: SubagentRuntimeImpl
    let fakeKernelAdapter: FakeKernelAdapter
    let fakeContextManager: FakeContextManager
    let parentContext: ContextBundle

    beforeEach(() => {
      fakeKernelAdapter = new FakeKernelAdapter()
      fakeContextManager = new FakeContextManager()

      const baseConfig: SubagentConfig = {
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

    it('should launch a subagent with a valid profile objective', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Analyze the uploaded document',
          agentType: 'document_processor',
          tools: ['file_read', 'artifact_create'],
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      expect(run.subagentRunId).toMatch(/^subagent-/)
      expect(run.status).toBe('queued')
      expect(run.taskSpec.objective).toBe('Analyze the uploaded document')
      expect(run.parentRunId).toBe('parent-run-1')
    })

    it('should execute a launched subagent and return result', async () => {
      fakeKernelAdapter.setResults([
        {
          finalStatus: 'completed',
          finalResponse: 'Document analyzed successfully',
          iterationsUsed: 2,
          toolCalls: [{ toolCallId: 'call-1', toolName: 'file_read', params: { path: '/doc.pdf' } }],
          transcript: [],
        },
      ])

      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Analyze the uploaded document',
          agentType: 'document_processor',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)
      const result = await runtime.executeSubagent(run.subagentRunId)

      expect(result.status).toBe('completed')
      expect(result.response).toBe('Document analyzed successfully')
      expect(result.iterationsUsed).toBe(2)
      expect(result.toolCalls[0].toolName).toBe('file_read')
    })

    it('should isolate subagent context from parent', () => {
      const input: LaunchSubagentInput = {
        taskSpec: {
          objective: 'Isolated research task',
          agentType: 'research_processor',
        },
        parentContext,
      }

      const run = runtime.launchSubagent(input)

      // Context bundle must be different from parent
      expect(run.contextBundle.bundleId).not.toBe(parentContext.bundleId)
      expect(run.contextBundle.runId).toBe(run.subagentRunId)

      // Parent items must not leak into subagent context
      const parentItemIds = new Set(
        [...parentContext.pinnedItems, ...parentContext.orderedItems].map((i) => i.itemId),
      )
      const subagentItemIds = new Set(
        [...run.contextBundle.pinnedItems, ...run.contextBundle.orderedItems].map((i) => i.itemId),
      )

      for (const itemId of subagentItemIds) {
        expect(parentItemIds.has(itemId)).toBe(false)
      }
    })
  })

  // ── 3. Assert prompt snapshot ─────────────────────────────────────────────

  describe('prompt snapshot assertion', () => {
    it('should build a foreground prompt with system messages preceding user messages', async () => {
      const templates = makeTestTemplates()
      const templateRegistry = new PromptTemplateRegistry(templates, '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      const builder = new ModelInputBuilder({ templateRegistry, templateLoader: loader })

      const result = await builder.build({
        mode: 'routing_json',
        agentKind: 'foreground',
        providerFamily: 'openai',
        systemPrompt: 'You are a helpful assistant.',
        currentUserMessage: 'Hello, analyze this data.',
      })

      // System messages must precede user messages
      const lastSystemIdx = result.messages.reduce(
        (lastIdx, m, idx) => (m.role === 'system' ? idx : lastIdx),
        -1,
      )
      const firstUserIdx = result.messages.findIndex((m) => m.role === 'user')
      expect(lastSystemIdx).toBeLessThan(firstUserIdx)

      // Static prefix must contain platform base
      expect(result.segments.staticPrefix).toContain('Platform Base for foreground')

      // User message must be present
      const userMessages = result.messages.filter((m) => m.role === 'user')
      expect(userMessages.length).toBeGreaterThan(0)
      expect(userMessages.some((m) => m.content.includes('Hello, analyze this data.'))).toBe(true)
    })

    it('should include tool plane with authorized tool IDs only', async () => {
      const templates = makeTestTemplates()
      const templateRegistry = new PromptTemplateRegistry(templates, '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      const builder = new ModelInputBuilder({ templateRegistry, templateLoader: loader })

      const result = await builder.build({
        mode: 'function_calling',
        agentKind: 'foreground',
        providerFamily: 'openai',
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
      })

      // Authorized tools appear in tool plane
      expect(result.segments.toolPlane).toContain('file_read')
      expect(result.segments.toolPlane).toContain('Available Tool IDs: file_read, web_search')

      // Unauthorized tools must NOT appear
      expect(result.segments.toolPlane).not.toContain('exec')
      expect(result.segments.toolPlane).not.toContain('admin_config')
    })

    it('tool plane snapshot is deterministic for same input', async () => {
      const templates = makeTestTemplates()
      const templateRegistry = new PromptTemplateRegistry(templates, '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      const builder = new ModelInputBuilder({ templateRegistry, templateLoader: loader })

      const input = {
        mode: 'function_calling' as const,
        agentKind: 'foreground' as const,
        providerFamily: 'openai' as const,
        toolProjection: {
          toolIds: ['file_read', 'memory_retrieve'],
        },
      }

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segments.toolPlane).toBe(result2.segments.toolPlane)
      expect(result1.segments.staticPrefix).toBe(result2.segments.staticPrefix)
    })
  })

  // ── 4. Reject invalid profile / tool escalation ──────────────────────────

  describe('reject invalid profile', () => {
    it('assertAllowed throws for unknown profile ID', () => {
      expect(() => registry.assertAllowed('malicious_profile')).toThrow(
        'Unknown agent profile: "malicious_profile"',
      )
    })

    it('assertAllowed throws for empty profile ID', () => {
      expect(() => registry.assertAllowed('')).toThrow('Unknown agent profile: ""')
    })

    it('assertAllowed throws for path traversal attempt', () => {
      expect(() => registry.assertAllowed('../../etc/passwd')).toThrow(
        'Unknown agent profile: "../../etc/passwd"',
      )
    })

    it('assertAllowed throws for profile mimicking system profile', () => {
      expect(() => registry.assertAllowed('system_admin')).toThrow(
        'Unknown agent profile: "system_admin"',
      )
    })

    it('normalizeAgentLabel throws for unknown label', () => {
      expect(() => normalizeAgentLabel('nonexistent')).toThrow(UnknownAgentLabelError)
    })

    it('register rejects duplicate profile ID', () => {
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

  describe('reject tool escalation', () => {
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

    it('main profile cannot expose execute/admin tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'web_search', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('main', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('subagent profile cannot expose execute/admin tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'artifact_create', 'exec', 'admin_config']
      const effective = computeEffectiveToolIdsWithEnvelope('subagent', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('artifact_create')
      expect(effective).not.toContain('exec')
      expect(effective).not.toContain('admin_config')
    })

    it('background profile cannot expose write tools beyond envelope', () => {
      const profileToolIds = ['file_read', 'web_search', 'artifact_create']
      const effective = computeEffectiveToolIdsWithEnvelope('background', catalog, envelopeRegistry, profileToolIds)

      expect(effective).toContain('file_read')
      expect(effective).toContain('web_search')
      expect(effective).not.toContain('artifact_create')
    })

    it('remote agent type denies ALL tools', () => {
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

  describe('reject invalid launch source', () => {
    it('assertLaunchAllowed throws UNKNOWN_LAUNCH_SOURCE for unrecognized string', () => {
      expect(() => assertLaunchAllowed('main', 'evil_portal')).toThrow(LaunchPolicyError)
      expect(() => assertLaunchAllowed('main', 'evil_portal')).toThrow('Unknown launch source')
    })

    it('assertLaunchAllowed throws LAUNCH_SOURCE_NOT_ALLOWED for wrong agent type', () => {
      expect(() => assertLaunchAllowed('subagent', 'gateway_intent')).toThrow(LaunchPolicyError)

      try {
        assertLaunchAllowed('subagent', 'gateway_intent')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(LaunchPolicyError)
        expect((error as LaunchPolicyError).code).toBe('LAUNCH_SOURCE_NOT_ALLOWED')
      }
    })

    it('remote agent type has no allowed launch sources', () => {
      expect(() => assertLaunchAllowed('remote', 'system')).toThrow(LaunchPolicyError)
    })

    it('isLaunchAllowed returns false for unknown source', () => {
      expect(isLaunchAllowed('main', 'not_a_real_source')).toBe(false)
    })

    it('isLaunchAllowed returns false for wrong agent type pairing', () => {
      expect(isLaunchAllowed('background', 'gateway_intent')).toBe(false)
    })

    it('isLaunchAllowed returns true for valid pairings', () => {
      expect(isLaunchAllowed('main', 'gateway_intent')).toBe(true)
      expect(isLaunchAllowed('subagent', 'subagent_runtime')).toBe(true)
      expect(isLaunchAllowed('background', 'system')).toBe(true)
    })

    it('isLaunchSource returns false for arbitrary strings', () => {
      expect(isLaunchSource('totally_fake')).toBe(false)
      expect(isLaunchSource('')).toBe(false)
    })

    it('isLaunchSource returns true for all recognized sources', () => {
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
  })
})
