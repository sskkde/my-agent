/**
 * MiniMax Document MCP E2E - Skill Plane Verification
 *
 * Tests that MiniMax skills are registered as documentation-only records
 * and render in the skill plane, not the tool plane.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMcpServerRegistry, type McpServerRegistry } from '../../src/connectors/mcp/mcp-server-registry.js'
import { createMcpSessionManager, type McpSessionManager } from '../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../src/tools/types.js'
import { createSkillRegistry, type SkillRegistry } from '../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../src/skills/builtin/manifest.js'
import { createMockMcpServer } from '../fixtures/phase3-mock-mcp.js'
import {
  PromptTemplateRegistry,
  type PromptTemplateRecord,
} from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import {
  renderSummarySkillPlane,
  renderSkillPlaneProjection,
} from '../../src/kernel/model-input/skill-plane-projection-renderer.js'
import {
  MiniMaxDocumentMockTransport,
  createMcpTables,
  makeTestTemplates,
} from './minimax-document-e2e-setup.js'

describe('MiniMax Document MCP - Skill Plane Verification', () => {
  let connection: ConnectionManager
  let serverRegistry: McpServerRegistry
  let sessionManager: McpSessionManager
  let transport: MiniMaxDocumentMockTransport
  let toolRegistry: ToolRegistry
  let skillRegistry: SkillRegistry
  let bridge: McpToolBridge

  const MINIMAX_SKILL_IDS = ['pptx-generator', 'minimax-xlsx', 'minimax-docx', 'minimax-pdf']

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)

    transport = new MiniMaxDocumentMockTransport()
    serverRegistry = createMcpServerRegistry(connection)
    sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', transport]]))
    toolRegistry = createToolRegistry()

    skillRegistry = createSkillRegistry()
    registerBuiltinSkills(skillRegistry)

    const serverDef = createMockMcpServer({
      serverId: 'minimax-document-mcp',
      name: 'MiniMax Document MCP Server',
      version: '0.1.0',
      baseUrl: 'stdio://minimax-document-mcp',
      configType: 'stdio',
      command: 'node',
      args: ['mcp-servers/minimax-document-mcp/dist/index.js'],
      trustLevel: 'verified',
      status: 'active',
    })
    serverRegistry.registerServer(serverDef)

    sessionManager.openSession('minimax-document-mcp')

    bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) =>
        serverId === 'minimax-document-mcp' ? transport : undefined,
    })
  })

  it('all four MiniMax skills are registered in the skill registry', () => {
    for (const skillId of MINIMAX_SKILL_IDS) {
      expect(skillRegistry.has(skillId)).toBe(true)
      const skill = skillRegistry.get(skillId)
      expect(skill).toBeDefined()
      expect(skill!.source).toBe('builtin')
      expect((skill as any).handler).toBeUndefined()
      expect((skill as any).schema).toBeUndefined()
      expect((skill as any).command).toBeUndefined()
      expect((skill as any).script).toBeUndefined()
    }
  })

  it('MiniMax skill summaries render in skill plane, not tool plane', () => {
    const projection = {
      skillIds: MINIMAX_SKILL_IDS,
      renderMode: 'summary' as const,
      skillSummaries:
        'Available Skills:\n' +
        '- pptx-generator (write): PowerPoint guidance\n' +
        '- minimax-xlsx (read): Excel guidance\n' +
        '- minimax-docx (write): Word guidance\n' +
        '- minimax-pdf (write): PDF guidance',
    }

    const rendered = renderSummarySkillPlane(projection)
    expect(rendered).toContain('Available Skill IDs:')
    expect(rendered).toContain('pptx-generator')
    expect(rendered).toContain('minimax-xlsx')
    expect(rendered).not.toContain('Available Tool IDs')
    expect(rendered).not.toContain('"type": "function"')
  })

  it('MiniMax skill documents render in skill plane with documentation headings', () => {
    const projection = {
      skillIds: ['minimax-xlsx', 'pptx-generator'],
      renderMode: 'documents' as const,
      skillDocuments: [
        {
          skillId: 'minimax-xlsx',
          name: 'MiniMax XLSX',
          document: '## XLSX Tools\n\nUse `xlsx.read` to extract data from spreadsheets.',
        },
        {
          skillId: 'pptx-generator',
          name: 'PPTX Generator',
          document: '## PPTX Tools\n\nUse `pptx.generate` to create presentations.',
        },
      ],
    }

    const rendered = renderSkillPlaneProjection(projection, { includeDocuments: true })
    expect(rendered).toContain('## Skill Documents')
    expect(rendered).toContain('### MiniMax XLSX (minimax-xlsx)')
    expect(rendered).toContain('### PPTX Generator (pptx-generator)')
    expect(rendered).toContain('xlsx.read')
    expect(rendered).toContain('pptx.generate')
    expect(rendered).not.toContain('"type": "function"')
    expect(rendered).not.toContain('Parameters:')
  })

  it('skill plane content stays in Segment C, not Segment A or B', async () => {
    const templates = makeTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const result = await builder.build({
      mode: 'function_calling',
      agentKind: 'foreground',
      providerFamily: 'openai',
      systemPrompt: 'You are a helpful assistant.',
      skillProjection: {
        skillIds: ['minimax-xlsx', 'pptx-generator'],
        renderMode: 'documents',
        skillDocuments: [
          {
            skillId: 'minimax-xlsx',
            name: 'MiniMax XLSX',
            document: 'Use xlsx.read to extract spreadsheet data.',
          },
          {
            skillId: 'pptx-generator',
            name: 'PPTX Generator',
            document: 'Use pptx.generate to create presentations.',
          },
        ],
      },
    })

    expect(result.segments.staticPrefix).not.toContain('xlsx.read')
    expect(result.segments.staticPrefix).not.toContain('pptx.generate')
    expect(result.segments.staticPrefix).not.toContain('MiniMax XLSX')
    expect(result.segments.staticPrefix).not.toContain('PPTX Generator')
    expect(result.segments.tenantProject).not.toContain('xlsx.read')
    expect(result.segments.tenantProject).not.toContain('pptx.generate')
    expect(result.segments.toolPlane).toContain('xlsx.read')
    expect(result.segments.toolPlane).toContain('pptx.generate')
    expect(result.segments.toolPlane).toContain('--- Skill Plane (documentation only) ---')
  })
})
