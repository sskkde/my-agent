import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { KernelRunInput, KernelRunResult } from '../../../src/kernel/types.js'
import type { AgentConfig } from '../../../src/storage/agent-config-store.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js'
import { createSkillRegistry, type SkillRegistry } from '../../../src/skills/skill-registry.js'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import type { SkillDefinition } from '../../../src/skills/types.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'

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

function createMockTurnInput(overrides?: Partial<ForegroundTurnInput>): ForegroundTurnInput {
  return {
    userId: 'test-user',
    sessionId: 'test-session',
    turnId: 'test-turn',
    message: 'test message',
    timestamp: new Date().toISOString(),
    hydratedState: {} as any,
    foregroundState: {
      resolvedModel: 'gpt-4o-mini',
    } as any,
    ...overrides,
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

describe('ForegroundAgent skill projection wiring', () => {
  let skillRegistry: SkillRegistry
  let skillEnvelopeRegistry: AgentTypeSkillEnvelopeRegistry

  beforeEach(() => {
    skillRegistry = createSkillRegistry()
    skillEnvelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
    registerTestSkills(skillRegistry)
  })

  describe('when skill deps are provided', () => {
    it('builds a skill projection and passes it to the kernel for main agentType', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await agent.runTurn(createMockTurnInput())

      expect(capturedInput).toBeDefined()
      expect(capturedInput!.skillProjection).toBeDefined()
      expect(capturedInput!.skillProjection!.skillIds).toBeDefined()
      expect(capturedInput!.skillProjection!.renderMode).toBe('documents')
    })

    it('includes main-envelope-allowed skills (read/search/internal) in projection', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await agent.runTurn(createMockTurnInput())

      const skillIds = capturedInput!.skillProjection!.skillIds
      // Main envelope allows read/search/internal — session_status (internal), documentation_search (search)
      expect(skillIds).toContain('session_status')
      expect(skillIds).toContain('documentation_search')
      // Main envelope does NOT allow write — artifact_workflow should be excluded
      expect(skillIds).not.toContain('artifact_workflow')
      // Main envelope does NOT allow admin — admin_config should be excluded
      expect(skillIds).not.toContain('admin_config')
    })

    it('loads skill documents in documents mode', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await agent.runTurn(createMockTurnInput())

      expect(capturedInput!.skillProjection!.renderMode).toBe('documents')
      expect(capturedInput!.skillProjection!.skillDocuments).toBeDefined()
      // Documents were loaded for the effective skills
      expect(docLoader.loadSkillDocument).toHaveBeenCalled()
    })

    it('respects allowedSkillIds: [] from agent config — produces empty skill projection', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      const configWithNoSkills: AgentConfig = {
        agentConfigId: 'cfg-1',
        agentId: 'foreground.default',
        scope: 'global',
        userId: null,
        displayName: 'Test',
        enabled: true,
        systemPrompt: null,
        routingPrompt: null,
        providerId: null,
        model: null,
        allowedToolIds: null,
        allowedSkillIds: [],
        routingTimeoutMs: 60000,
        repairAttempts: 1,
        promptType: null,
        promptVersion: null,
        searchLlmProviderId: null,
        searchLlmModel: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await agent.runTurn(createMockTurnInput({ agentConfig: configWithNoSkills }))

      expect(capturedInput!.skillProjection).toBeDefined()
      expect(capturedInput!.skillProjection!.skillIds).toEqual([])
    })

    it('respects allowedSkillIds: explicit list from agent config — intersects with envelope', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      const configWithExplicitSkills: AgentConfig = {
        agentConfigId: 'cfg-1',
        agentId: 'foreground.default',
        scope: 'global',
        userId: null,
        displayName: 'Test',
        enabled: true,
        systemPrompt: null,
        routingPrompt: null,
        providerId: null,
        model: null,
        allowedToolIds: null,
        allowedSkillIds: ['session_status', 'artifact_workflow'],
        routingTimeoutMs: 60000,
        repairAttempts: 1,
        promptType: null,
        promptVersion: null,
        searchLlmProviderId: null,
        searchLlmModel: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await agent.runTurn(createMockTurnInput({ agentConfig: configWithExplicitSkills }))

      const skillIds = capturedInput!.skillProjection!.skillIds
      // session_status is internal (allowed by main envelope) and in the explicit list
      expect(skillIds).toContain('session_status')
      // artifact_workflow is write (NOT allowed by main envelope) — blocked even though in config
      expect(skillIds).not.toContain('artifact_workflow')
    })
  })

  describe('when skill deps are NOT provided', () => {
    it('does not add skillProjection to kernel input', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const agent = createForegroundAgent({
        agentKernel: kernel,
        // No skillRegistry, skillEnvelopeRegistry, or skillDocumentLoader
      })

      await agent.runTurn(createMockTurnInput())

      expect(capturedInput).toBeDefined()
      expect(capturedInput!.skillProjection).toBeUndefined()
    })
  })

  describe('tool callability is unchanged', () => {
    it('tool projection is still built and passed to kernel regardless of skill deps', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const docLoader = createMockDocumentLoader()
      const agent = createForegroundAgent({
        agentKernel: kernel,
        skillRegistry,
        skillEnvelopeRegistry,
        skillDocumentLoader: docLoader as any,
      })

      await agent.runTurn(createMockTurnInput())

      expect(capturedInput!.toolProjection).toBeDefined()
      expect(capturedInput!.toolProjection!.toolIds).toBeDefined()
      expect(capturedInput!.toolProjection!.tools).toBeDefined()
    })

    it('tool projection is still built when skill deps are missing', async () => {
      let capturedInput: KernelRunInput | undefined
      const kernel = createFakeKernel((input) => {
        capturedInput = input
      })

      const agent = createForegroundAgent({
        agentKernel: kernel,
      })

      await agent.runTurn(createMockTurnInput())

      expect(capturedInput!.toolProjection).toBeDefined()
      expect(capturedInput!.toolProjection!.toolIds).toBeDefined()
    })
  })
})
