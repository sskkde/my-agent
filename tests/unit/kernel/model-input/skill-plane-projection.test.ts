import { describe, it, expect } from 'vitest'
import {
  renderSkillPlaneProjection,
  renderSummarySkillPlane,
  renderDocumentsSkillPlane,
  renderMinimalSkillPlane,
} from '../../../../src/kernel/model-input/skill-plane-projection-renderer.js'
import type { SkillPlaneProjection } from '../../../../src/kernel/model-input/model-input-types.js'

function makeSummaryProjection(overrides: Partial<SkillPlaneProjection> = {}): SkillPlaneProjection {
  return {
    skillIds: ['artifact_workflow', 'memory_research'],
    skillSummaries: 'Available Skills:\n- artifact_workflow (guidance): Artifact workflow\n- memory_research (guidance): Memory research',
    renderMode: 'summary',
    ...overrides,
  }
}

function makeDocumentsProjection(overrides: Partial<SkillPlaneProjection> = {}): SkillPlaneProjection {
  return {
    skillIds: ['artifact_workflow', 'memory_research'],
    skillSummaries: 'Available Skills:\n- artifact_workflow (guidance): Artifact workflow\n- memory_research (guidance): Memory research',
    skillDocuments: [
      {
        skillId: 'artifact_workflow',
        name: 'Artifact Workflow',
        document: '# Artifact Workflow\n\nGuidance on creating and managing artifacts.',
      },
      {
        skillId: 'memory_research',
        name: 'Memory Research',
        document: '# Memory Research\n\nGuidance on memory research strategies.',
      },
    ],
    renderMode: 'documents',
    ...overrides,
  }
}

describe('renderSkillPlaneProjection', () => {
  describe('summary mode', () => {
    it('renders Available Skill IDs heading with skill IDs', () => {
      const projection = makeSummaryProjection()

      const output = renderSkillPlaneProjection(projection)

      expect(output).toContain('Available Skill IDs: artifact_workflow, memory_research')
    })

    it('includes skill summaries when includeSummaries is true', () => {
      const projection = makeSummaryProjection()

      const output = renderSkillPlaneProjection(projection, { includeSummaries: true })

      expect(output).toContain('Available Skills:')
      expect(output).toContain('artifact_workflow (guidance): Artifact workflow')
    })

    it('excludes summaries when includeSummaries is false', () => {
      const projection = makeSummaryProjection()

      const output = renderSkillPlaneProjection(projection, { includeSummaries: false })

      expect(output).not.toContain('Available Skills:')
      expect(output).toContain('Available Skill IDs')
    })

    it('returns empty string when skillIds is empty', () => {
      const projection: SkillPlaneProjection = {
        skillIds: [],
        renderMode: 'summary',
      }

      const output = renderSkillPlaneProjection(projection)

      expect(output).toBe('')
    })
  })

  describe('documents mode', () => {
    it('renders Skill Documents heading', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('## Skill Documents')
    })

    it('renders each skill document with name and skillId', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('### Artifact Workflow (artifact_workflow)')
      expect(output).toContain('# Artifact Workflow')
      expect(output).toContain('### Memory Research (memory_research)')
      expect(output).toContain('# Memory Research')
    })

    it('excludes documents when includeDocuments is false', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: false,
      })

      expect(output).not.toContain('## Skill Documents')
      expect(output).not.toContain('### Artifact Workflow')
    })
  })

  describe('token budget', () => {
    it('includes all documents when budget is sufficient', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('### Artifact Workflow (artifact_workflow)')
      expect(output).toContain('### Memory Research (memory_research)')
    })

    it('clips documents when budget is too small for all', () => {
      const projection = makeDocumentsProjection({ tokenBudget: 30 })

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('## Skill Documents')
      expect(output).toContain('### Artifact Workflow (artifact_workflow)')
      expect(output).not.toContain('### Memory Research (memory_research)')
    })

    it('includes no documents when budget is zero', () => {
      const projection = makeDocumentsProjection({ tokenBudget: 0 })

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).not.toContain('## Skill Documents')
    })
  })

  describe('skill/tool boundary', () => {
    it('never renders Available Tool IDs heading', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).not.toContain('Available Tool IDs')
    })

    it('never renders parameters section', () => {
      const projection = makeDocumentsProjection()

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).not.toContain('Parameters:')
      expect(output).not.toContain('parameters')
    })

    it('never renders function-call JSON schemas', () => {
      const projection = makeDocumentsProjection({
        skillDocuments: [
          {
            skillId: 'test_skill',
            name: 'Test Skill',
            document: 'Some guidance text.',
          },
        ],
      })

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).not.toContain('"type": "function"')
      expect(output).not.toContain('"function":')
      expect(output).not.toContain('"name":')
      expect(output).not.toMatch(/"parameters"\s*:/)
    })

    it('renders skill document text as documentation, not as tool schema', () => {
      const projection = makeDocumentsProjection({
        skillDocuments: [
          {
            skillId: 'web_research_guidance',
            name: 'Web Research Guidance',
            document: '# Web Research\n\nUse search tools effectively.',
          },
        ],
      })

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('### Web Research Guidance (web_research_guidance)')
      expect(output).toContain('# Web Research')
      expect(output).not.toContain('Tool:')
      expect(output).not.toContain('Description:')
    })
  })

  describe('function schema rejection', () => {
    it('ignores extra tools/parameters fields sneaked onto the projection object', () => {
      const projection = makeDocumentsProjection({
        skillDocuments: [
          {
            skillId: 'safe_skill',
            name: 'Safe Skill',
            document: '# Safe Skill\n\nThis is documentation only.',
          },
        ],
      }) as SkillPlaneProjection & Record<string, unknown>

      projection.tools = [
        {
          type: 'function',
          function: {
            name: 'exec',
            description: 'Execute arbitrary code',
            parameters: { type: 'object', properties: { cmd: { type: 'string' } } },
          },
        },
      ]
      projection.parameters = { type: 'object', properties: { malicious: { type: 'string' } } }

      const output = renderSkillPlaneProjection(projection, {
        includeSummaries: true,
        includeDocuments: true,
      })

      expect(output).toContain('Available Skill IDs: artifact_workflow, memory_research')
      expect(output).toContain('### Safe Skill (safe_skill)')
      expect(output).not.toMatch(/"type"\s*:\s*"function"/)
      expect(output).not.toMatch(/"function"\s*:/)
      expect(output).not.toContain('Execute arbitrary code')
      expect(output).not.toContain('malicious')
    })

    it('does not expose tools or parameters fields on SkillPlaneProjection type', () => {
      const projection: SkillPlaneProjection = {
        skillIds: ['test'],
        renderMode: 'summary',
      }

      expect(projection).not.toHaveProperty('tools')
      expect(projection).not.toHaveProperty('parameters')
      expect(projection).not.toHaveProperty('toolIds')
    })
  })
})

describe('renderSummarySkillPlane', () => {
  it('renders skill IDs and summaries without documents', () => {
    const projection = makeSummaryProjection()

    const output = renderSummarySkillPlane(projection)

    expect(output).toContain('Available Skill IDs: artifact_workflow, memory_research')
    expect(output).toContain('Available Skills:')
    expect(output).not.toContain('## Skill Documents')
  })

  it('returns empty string for empty skill IDs', () => {
    const projection: SkillPlaneProjection = {
      skillIds: [],
      renderMode: 'summary',
    }

    const output = renderSummarySkillPlane(projection)

    expect(output).toBe('')
  })
})

describe('renderDocumentsSkillPlane', () => {
  it('renders skill IDs, summaries, and documents', () => {
    const projection = makeDocumentsProjection()

    const output = renderDocumentsSkillPlane(projection)

    expect(output).toContain('Available Skill IDs: artifact_workflow, memory_research')
    expect(output).toContain('Available Skills:')
    expect(output).toContain('## Skill Documents')
    expect(output).toContain('### Artifact Workflow (artifact_workflow)')
    expect(output).toContain('### Memory Research (memory_research)')
  })

  it('never contains tool-related headings', () => {
    const projection = makeDocumentsProjection()

    const output = renderDocumentsSkillPlane(projection)

    expect(output).not.toContain('Available Tool IDs')
    expect(output).not.toContain('Tool:')
    expect(output).not.toContain('Parameters:')
  })
})

describe('renderMinimalSkillPlane', () => {
  it('renders only skill IDs', () => {
    const projection = makeSummaryProjection()

    const output = renderMinimalSkillPlane(projection)

    expect(output).toBe('Available Skill IDs: artifact_workflow, memory_research')
  })

  it('returns empty string for empty skill IDs', () => {
    const projection: SkillPlaneProjection = {
      skillIds: [],
      renderMode: 'summary',
    }

    const output = renderMinimalSkillPlane(projection)

    expect(output).toBe('')
  })
})