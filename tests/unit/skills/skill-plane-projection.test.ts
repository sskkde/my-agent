import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSkillPlaneProjection } from '../../../src/skills/skill-plane-projection.js'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import type { SkillDefinition, SkillRegistry } from '../../../src/skills/types.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import type { SkillDocumentLoader } from '../../../src/skills/skill-document-loader.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    skillId: 'test_skill',
    name: 'Test Skill',
    description: 'A test skill for unit testing',
    category: 'read',
    sensitivity: 'low',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent'],
    defaultAgentProfiles: ['default_main'],
    documentPath: 'test_skill.md',
    summary: 'Test skill summary for catalog display',
    ...overrides,
  }
}

function createMockDocumentLoader(): SkillDocumentLoader & { loadSkillDocument: ReturnType<typeof vi.fn> } {
  return {
    loadSkillDocument: vi.fn().mockResolvedValue('# Test Document\n\nFull document content.'),
    loadSkillDocumentSync: vi.fn(),
    loadSkillDocuments: vi.fn(),
    resolveDocumentPath: vi.fn(),
    clearCache: vi.fn(),
    isCached: vi.fn(),
  } as unknown as SkillDocumentLoader & { loadSkillDocument: ReturnType<typeof vi.fn> }
}

function seedRegistry(registry: SkillRegistry, skills: SkillDefinition[]): void {
  for (const skill of skills) {
    registry.register(skill)
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SKILL_CATALOG: SkillDefinition[] = [
  makeSkill({
    skillId: 'memory_research',
    name: 'Memory Research',
    description: 'Guidance on memory research strategies',
    category: 'read',
    summary: 'Memory research guidance',
  }),
  makeSkill({
    skillId: 'documentation_search',
    name: 'Documentation Search',
    description: 'Guidance on searching documentation',
    category: 'search',
    summary: 'Documentation search guidance',
  }),
  makeSkill({
    skillId: 'session_status',
    name: 'Session Status',
    description: 'Internal session status skill',
    category: 'internal',
  }),
  makeSkill({
    skillId: 'artifact_workflow',
    name: 'Artifact Workflow',
    description: 'Guidance on artifact workflows',
    category: 'write',
    summary: 'Artifact workflow guidance',
  }),
  makeSkill({
    skillId: 'auto_deploy',
    name: 'Auto Deploy',
    description: 'Automation deployment guidance',
    category: 'automation',
    summary: 'Auto deploy guidance',
  }),
  makeSkill({
    skillId: 'admin_config',
    name: 'Admin Config',
    description: 'Administrative configuration guidance',
    category: 'admin',
    summary: 'Admin config guidance',
  }),
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSkillPlaneProjection', () => {
  let registry: SkillRegistry
  let envelopeRegistry: AgentTypeSkillEnvelopeRegistry
  let documentLoader: ReturnType<typeof createMockDocumentLoader>

  beforeEach(() => {
    registry = createSkillRegistry()
    envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
    documentLoader = createMockDocumentLoader()
    seedRegistry(registry, SKILL_CATALOG)
  })

  // ── Envelope / config / profile intersection ──────────────────────────

  describe('envelope/config/profile intersection', () => {
    it('main agent: returns only read/search/internal skills (envelope boundary)', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).toContain('documentation_search')
      expect(projection.skillIds).toContain('session_status')
      expect(projection.skillIds).not.toContain('artifact_workflow')
      expect(projection.skillIds).not.toContain('auto_deploy')
      expect(projection.skillIds).not.toContain('admin_config')
    })

    it('subagent: returns read/search/internal/write/automation skills', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'subagent',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).toContain('artifact_workflow')
      expect(projection.skillIds).toContain('auto_deploy')
      expect(projection.skillIds).not.toContain('admin_config')
    })

    it('remote: returns empty array (hard deny)', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'remote',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(projection.skillIds).toEqual([])
    })

    it('intersects envelope with profile skill IDs', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        profileDefaultSkillIds: ['memory_research', 'documentation_search', 'artifact_workflow'],
        mode: 'summary',
      })

      // main envelope allows read/search/internal, so artifact_workflow (write) is filtered
      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).toContain('documentation_search')
      expect(projection.skillIds).not.toContain('artifact_workflow')
    })

    it('intersects envelope with config skill IDs', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        agentConfigAllowedSkillIds: ['memory_research', 'session_status'],
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).toContain('session_status')
      expect(projection.skillIds).not.toContain('documentation_search')
    })

    it('intersects all three layers: envelope ∩ profile ∩ config', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        profileDefaultSkillIds: ['memory_research', 'documentation_search', 'session_status'],
        agentConfigAllowedSkillIds: ['memory_research', 'session_status'],
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).toContain('session_status')
      expect(projection.skillIds).not.toContain('documentation_search')
    })

    it('profile cannot expand beyond envelope', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        profileDefaultSkillIds: ['memory_research', 'admin_config'],
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).not.toContain('admin_config')
    })

    it('config cannot expand beyond envelope', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        agentConfigAllowedSkillIds: ['memory_research', 'admin_config'],
        mode: 'summary',
      })

      expect(projection.skillIds).toContain('memory_research')
      expect(projection.skillIds).not.toContain('admin_config')
    })
  })

  // ── Lazy document load count ──────────────────────────────────────────

  describe('lazy document loading', () => {
    it('summary mode: does NOT load any documents', async () => {
      await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalled()
    })

    it('documents mode: loads documents for effective skills', async () => {
      await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      // main envelope allows read/search/internal: memory_research, documentation_search, session_status
      expect(documentLoader.loadSkillDocument).toHaveBeenCalledTimes(3)
      expect(documentLoader.loadSkillDocument).toHaveBeenCalledWith('memory_research')
      expect(documentLoader.loadSkillDocument).toHaveBeenCalledWith('documentation_search')
      expect(documentLoader.loadSkillDocument).toHaveBeenCalledWith('session_status')
    })

    it('documents mode: does not load documents for envelope-filtered skills', async () => {
      await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      // admin_config, artifact_workflow, auto_deploy are filtered by main envelope
      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalledWith('admin_config')
      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalledWith('artifact_workflow')
      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalledWith('auto_deploy')
    })

    it('documents mode: includes loaded documents in projection', async () => {
      documentLoader.loadSkillDocument.mockImplementation(async (skillId: string) => {
        return `# ${skillId}\n\nFull document for ${skillId}.`
      })

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      expect(projection.skillDocuments).toBeDefined()
      expect(projection.skillDocuments!.length).toBe(3)
      const docIds = projection.skillDocuments!.map((d) => d.skillId)
      expect(docIds).toContain('memory_research')
      expect(docIds).toContain('documentation_search')
      expect(docIds).toContain('session_status')
    })

    it('documents mode: skips skills whose documents fail to load', async () => {
      documentLoader.loadSkillDocument.mockImplementation(async (skillId: string) => {
        if (skillId === 'session_status') {
          throw new Error('File not found')
        }
        return `# ${skillId}\n\nFull document.`
      })

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      // session_status fails, so only 2 documents loaded
      expect(projection.skillDocuments!.length).toBe(2)
      expect(projection.skillDocuments!.map((d) => d.skillId)).not.toContain('session_status')
    })

    it('remote agent: loads zero documents even in documents mode', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'remote',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalled()
      expect(projection.skillDocuments).toEqual([])
    })
  })

  // ── Stable ordering ───────────────────────────────────────────────────

  describe('stable ordering', () => {
    it('preserves registry order for skill IDs', async () => {
      // Registry.list() returns sorted by skillId
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      // Registry sorts by skillId.localeCompare, so:
      // documentation_search < memory_research < session_status
      expect(projection.skillIds).toEqual([
        'documentation_search',
        'memory_research',
        'session_status',
      ])
    })

    it('preserves registry order for documents', async () => {
      documentLoader.loadSkillDocument.mockImplementation(async (skillId: string) => {
        return `# ${skillId}\n\nDocument content.`
      })

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      const docIds = projection.skillDocuments!.map((d) => d.skillId)
      expect(docIds).toEqual([
        'documentation_search',
        'memory_research',
        'session_status',
      ])
    })

    it('skillIds and skillDocuments have same order', async () => {
      documentLoader.loadSkillDocument.mockImplementation(async (skillId: string) => {
        return `# ${skillId}\n\nDocument content.`
      })

      const projection = await buildSkillPlaneProjection({
        agentType: 'subagent',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      const docIds = projection.skillDocuments!.map((d) => d.skillId)
      expect(projection.skillIds).toEqual(docIds)
    })
  })

  // ── Budget clipping ───────────────────────────────────────────────────

  describe('budget clipping', () => {
    it('loads no documents when budget is 0', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
        tokenBudget: 0,
      })

      expect(documentLoader.loadSkillDocument).not.toHaveBeenCalled()
      expect(projection.skillDocuments).toEqual([])
    })

    it('clips documents when budget is too small for all', async () => {
      documentLoader.loadSkillDocument.mockImplementation(async (skillId: string) => {
        // Each document is ~40 chars = ~10 tokens
        return `# ${skillId}\n\nDocument content for ${skillId} with some extra text.`
      })

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
        tokenBudget: 25, // Enough for ~2 documents, not 3
      })

      // Should have loaded some but not all documents
      expect(projection.skillDocuments!.length).toBeLessThan(3)
      expect(projection.skillDocuments!.length).toBeGreaterThan(0)
    })

    it('loads all documents when budget is undefined (no limit)', async () => {
      documentLoader.loadSkillDocument.mockResolvedValue('# Doc\n\nContent.')

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
        tokenBudget: undefined,
      })

      expect(projection.skillDocuments!.length).toBe(3)
    })

    it('loads all documents when budget is large enough', async () => {
      documentLoader.loadSkillDocument.mockResolvedValue('# Doc\n\nContent.')

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
        tokenBudget: 10000,
      })

      expect(projection.skillDocuments!.length).toBe(3)
    })

    it('records tokenBudget on the projection', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
        tokenBudget: 50,
      })

      expect(projection.tokenBudget).toBe(50)
    })
  })

  // ── Projection shape ──────────────────────────────────────────────────

  describe('projection shape', () => {
    it('summary mode: has renderMode "summary" and no skillDocuments', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(projection.renderMode).toBe('summary')
      expect(projection.skillDocuments).toBeUndefined()
    })

    it('documents mode: has renderMode "documents" and skillDocuments', async () => {
      documentLoader.loadSkillDocument.mockResolvedValue('# Doc\n\nContent.')

      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      expect(projection.renderMode).toBe('documents')
      expect(projection.skillDocuments).toBeDefined()
      expect(projection.skillDocuments!.length).toBeGreaterThan(0)
    })

    it('includes skillSummaries in both modes', async () => {
      documentLoader.loadSkillDocument.mockResolvedValue('# Doc\n\nContent.')

      const summaryProjection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      const docsProjection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      expect(summaryProjection.skillSummaries).toBeDefined()
      expect(docsProjection.skillSummaries).toBeDefined()
    })

    it('returns empty skillIds when no skills pass envelope', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'remote',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'summary',
      })

      expect(projection.skillIds).toEqual([])
      expect(projection.skillSummaries).toBeUndefined()
    })

    it('never includes tool-related fields', async () => {
      const projection = await buildSkillPlaneProjection({
        agentType: 'main',
        registry,
        envelopeRegistry,
        documentLoader,
        mode: 'documents',
      })

      expect(projection).not.toHaveProperty('tools')
      expect(projection).not.toHaveProperty('toolIds')
      expect(projection).not.toHaveProperty('parameters')
    })
  })
})
