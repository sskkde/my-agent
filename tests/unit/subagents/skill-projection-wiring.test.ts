import { describe, it, expect, vi } from 'vitest'
import type { KernelRunInput, KernelRunResult } from '../../../src/kernel/types.js'
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { SubagentDefinition } from '../../../src/subagents/registry.js'
import type { SkillPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import { createSubagentKernelAdapter } from '../../../src/subagents/kernel-adapter.js'
import { buildSevenLayerModelInput } from '../../../src/subagents/context-manager.js'
import { createSubagentRegistry } from '../../../src/subagents/registry.js'
import { createSkillRegistry, type SkillRegistry } from '../../../src/skills/skill-registry.js'
import { createAgentTypeSkillEnvelopeRegistry, type AgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import type { SkillDefinition } from '../../../src/skills/types.js'
import type { ProviderConfigStore } from '../../../src/storage/provider-config-store.js'
import type { AgentConfigStore } from '../../../src/storage/agent-config-store.js'
import type { SessionStore } from '../../../src/storage/session-store.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import type { SubagentTaskSpec } from '../../../src/subagents/types.js'

// ─── Fakes ──────────────────────────────────────────────────────────────────

function createFakeKernel(onRun?: (input: KernelRunInput) => void): AgentKernel {
  return {
    async run(input: KernelRunInput): Promise<KernelRunResult> {
      onRun?.(input)
      return {
        finalStatus: 'completed',
        finalResponse: 'ok',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      }
    },
  } as unknown as AgentKernel
}

function createMockDocumentLoader(): { loadSkillDocument: ReturnType<typeof vi.fn> } {
  return {
    loadSkillDocument: vi.fn(async (skillId: string) => `# ${skillId}\n\nSkill documentation.`),
  }
}

function createMockProviderConfigStore(): ProviderConfigStore {
  return {
    listByUser: () => [{
      providerId: 'openrouter',
      enabled: true,
      selectedModel: 'anthropic/claude-3-sonnet',
    }],
  } as unknown as ProviderConfigStore
}

function createMockAgentConfigStore(): AgentConfigStore {
  return {
    getGlobalDefault: () => ({
      providerId: 'openrouter',
      model: 'anthropic/claude-3-sonnet',
    }),
  } as unknown as AgentConfigStore
}

function createMockSessionStore(): SessionStore {
  return { getById: () => null } as unknown as SessionStore
}

function createDocumentProcessor(): SubagentDefinition {
  return {
    agentType: 'document_processor',
    agentProfile: 'document_processor',
    displayName: 'Document Processor',
    description: 'Processes documents',
    modality: 'document',
    promptId: 'agentProfile:document_processor',
    allowedToolIds: ['file_read'],
    allowedSkillIds: ['artifact_workflow', 'documentation_search'],
    defaultMaxIterations: 8,
    defaultTimeoutMs: 120_000,
    supportedExecutionModes: ['sync', 'background'],
    canRunInBackground: true,
    providerPolicy: {
      requiredCapabilities: ['text'],
      fallbackMode: 'any_compatible',
    },
    permissionProfile: 'ask_on_write',
    summaryPolicy: {
      returnMode: 'summary_with_artifacts',
      maxSummaryTokens: 1500,
    },
  }
}

function registerTestSkills(registry: SkillRegistry): void {
  const skills: SkillDefinition[] = [
    {
      skillId: 'session_status',
      name: 'Session Status',
      description: 'Check session status',
      category: 'internal',
      sensitivity: 'low',
      enabled: true,
      source: 'builtin',
      allowedAgentTypes: ['main', 'subagent', 'background'],
      defaultAgentProfiles: ['default_main'],
      documentPath: 'session_status.md',
    },
    {
      skillId: 'documentation_search',
      name: 'Documentation Search',
      description: 'Search documentation',
      category: 'search',
      sensitivity: 'low',
      enabled: true,
      source: 'builtin',
      allowedAgentTypes: ['main', 'subagent', 'background'],
      defaultAgentProfiles: ['default_main'],
      documentPath: 'documentation_search.md',
    },
    {
      skillId: 'artifact_workflow',
      name: 'Artifact Workflow',
      description: 'Manage artifacts',
      category: 'write',
      sensitivity: 'medium',
      enabled: true,
      source: 'builtin',
      allowedAgentTypes: ['subagent'],
      defaultAgentProfiles: ['planner'],
      documentPath: 'artifact_workflow.md',
    },
    {
      skillId: 'admin_config',
      name: 'Admin Config',
      description: 'Admin configuration',
      category: 'admin',
      sensitivity: 'restricted',
      enabled: true,
      source: 'builtin',
      allowedAgentTypes: [],
      defaultAgentProfiles: [],
      documentPath: 'admin_config.md',
    },
  ]
  for (const skill of skills) {
    registry.register(skill)
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Subagent skill projection wiring', () => {
  let skillRegistry: SkillRegistry
  let skillEnvelopeRegistry: AgentTypeSkillEnvelopeRegistry

  const setupRegistries = () => {
    skillRegistry = createSkillRegistry()
    skillEnvelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
    registerTestSkills(skillRegistry)
  }

  describe('kernel-adapter with skill deps', () => {
    it('builds skill projection and passes it to kernel input for subagent', async () => {
      setupRegistries()
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })
      const subagentRegistry = createSubagentRegistry()
      const definition = createDocumentProcessor()
      subagentRegistry.register(definition)

      const docLoader = createMockDocumentLoader()
      const adapter = createSubagentKernelAdapter({
        agentKernel: kernel,
        subagentRegistry,
        providerConfigStore: createMockProviderConfigStore(),
        agentConfigStore: createMockAgentConfigStore(),
        sessionStore: createMockSessionStore(),
        toolRegistry: createToolRegistry(),
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      const contextBundle = {
        bundleId: 'test-bundle',
        runId: 'test-run',
        agentId: 'test-agent',
        agentType: 'subagent' as const,
        userId: 'test-user',
        invocationSource: 'subagent_runtime' as const,
        pinnedItems: [],
        orderedItems: [],
        tokenEstimate: 100,
      }

      await adapter.execute({
        contextBundle,
        maxIterations: 5,
        timeoutMs: 30000,
        definition,
      })

      expect(capturedInput).toBeDefined()
      expect(capturedInput!.skillProjection).toBeDefined()
      expect(capturedInput!.skillProjection!.renderMode).toBe('documents')
    })

    it('subagent profile gets profile-relevant skills (write allowed by subagent envelope)', async () => {
      setupRegistries()
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })
      const subagentRegistry = createSubagentRegistry()
      const definition = createDocumentProcessor()
      subagentRegistry.register(definition)

      const docLoader = createMockDocumentLoader()
      const adapter = createSubagentKernelAdapter({
        agentKernel: kernel,
        subagentRegistry,
        providerConfigStore: createMockProviderConfigStore(),
        agentConfigStore: createMockAgentConfigStore(),
        sessionStore: createMockSessionStore(),
        toolRegistry: createToolRegistry(),
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await adapter.execute({
        contextBundle: {
          bundleId: 'test-bundle',
          runId: 'test-run',
          agentId: 'test-agent',
          agentType: 'subagent',
          userId: 'test-user',
          invocationSource: 'subagent_runtime',
          pinnedItems: [],
          orderedItems: [],
          tokenEstimate: 100,
        },
        maxIterations: 5,
        timeoutMs: 30000,
        definition,
      })

      const skillIds = capturedInput!.skillProjection!.skillIds
      // Subagent envelope allows read/search/internal/write/automation
      // Profile defaultSkillIds = ['artifact_workflow', 'documentation_search']
      // Intersection: artifact_workflow (write) + documentation_search (search)
      expect(skillIds).toContain('artifact_workflow')
      expect(skillIds).toContain('documentation_search')
    })

    it('does not add skillProjection when skill deps are missing', async () => {
      setupRegistries()
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })
      const subagentRegistry = createSubagentRegistry()
      const definition = createDocumentProcessor()
      subagentRegistry.register(definition)

      const adapter = createSubagentKernelAdapter({
        agentKernel: kernel,
        subagentRegistry,
        providerConfigStore: createMockProviderConfigStore(),
        agentConfigStore: createMockAgentConfigStore(),
        sessionStore: createMockSessionStore(),
        toolRegistry: createToolRegistry(),
        // No skill deps
      })

      await adapter.execute({
        contextBundle: {
          bundleId: 'test-bundle',
          runId: 'test-run',
          agentId: 'test-agent',
          agentType: 'subagent',
          userId: 'test-user',
          invocationSource: 'subagent_runtime',
          pinnedItems: [],
          orderedItems: [],
          tokenEstimate: 100,
        },
        maxIterations: 5,
        timeoutMs: 30000,
        definition,
      })

      expect(capturedInput!.skillProjection).toBeUndefined()
    })

    it('tool projection is still built regardless of skill deps', async () => {
      setupRegistries()
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })
      const subagentRegistry = createSubagentRegistry()
      const definition = createDocumentProcessor()
      subagentRegistry.register(definition)

      const docLoader = createMockDocumentLoader()
      const adapter = createSubagentKernelAdapter({
        agentKernel: kernel,
        subagentRegistry,
        providerConfigStore: createMockProviderConfigStore(),
        agentConfigStore: createMockAgentConfigStore(),
        sessionStore: createMockSessionStore(),
        toolRegistry: createToolRegistry(),
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await adapter.execute({
        contextBundle: {
          bundleId: 'test-bundle',
          runId: 'test-run',
          agentId: 'test-agent',
          agentType: 'subagent',
          userId: 'test-user',
          invocationSource: 'subagent_runtime',
          pinnedItems: [],
          orderedItems: [],
          tokenEstimate: 100,
        },
        maxIterations: 5,
        timeoutMs: 30000,
        definition,
      })

      expect(capturedInput!.toolProjection).toBeDefined()
      expect(capturedInput!.toolProjection!.toolIds).toBeDefined()
    })
  })

  describe('context-manager buildSevenLayerModelInput with skillProjection', () => {
    it('passes skillProjection to ModelInputBuildInput', async () => {
      const modelInputBuilder = new ModelInputBuilder({
        templateRegistry: new PromptTemplateRegistry(new Map([
          ['platform:base', {
            id: 'platform:base',
            version: '2026-05-23',
            path: 'platform/base.md',
            agentKind: '*',
            providerFamily: '*',
            layer: 1,
            taxonomyLayer: 'platform',
            description: 'Test base',
            content: 'You are a helpful assistant.',
          }],
        ])),
        templateLoader: new TemplateLoader(),
      })

      const definition = createDocumentProcessor()
      const taskSpec: SubagentTaskSpec = {
        objective: 'Test objective',
      }

      const skillProjection: SkillPlaneProjection = {
        skillIds: ['artifact_workflow', 'documentation_search'],
        skillSummaries: 'Available Skills:\n- artifact_workflow (write): Manage artifacts\n- documentation_search (search): Search documentation',
        renderMode: 'summary',
      }

      const result = await buildSevenLayerModelInput({
        definition,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder,
        skillProjection,
      })

      expect(result.segments.toolPlane).toContain('Skill Plane')
      expect(result.segments.toolPlane).toContain('artifact_workflow')
    })

    it('works without skillProjection (backward compatible)', async () => {
      const modelInputBuilder = new ModelInputBuilder({
        templateRegistry: new PromptTemplateRegistry(new Map([
          ['platform:base', {
            id: 'platform:base',
            version: '2026-05-23',
            path: 'platform/base.md',
            agentKind: '*',
            providerFamily: '*',
            layer: 1,
            taxonomyLayer: 'platform',
            description: 'Test base',
            content: 'You are a helpful assistant.',
          }],
        ])),
        templateLoader: new TemplateLoader(),
      })

      const definition = createDocumentProcessor()
      const taskSpec: SubagentTaskSpec = {
        objective: 'Test objective',
      }

      const result = await buildSevenLayerModelInput({
        definition,
        taskSpec,
        providerFamily: 'openai',
        modelInputBuilder,
      })

      expect(result.segments.toolPlane).not.toContain('Skill Plane')
    })
  })
})
