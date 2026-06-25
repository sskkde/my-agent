/**
 * MiniMax Document MCP E2E - Full Flow
 *
 * Tests the complete end-to-end document artifact flow.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
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
} from '../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../src/kernel/model-input/model-input-builder.js'
import { renderSummarySkillPlane } from '../../src/kernel/model-input/skill-plane-projection-renderer.js'
import { readXlsx } from '../../mcp-servers/minimax-document-mcp/src/tools/xlsx.js'
import { generatePptx, readPptx, clearFileRegistry } from '../../mcp-servers/minimax-document-mcp/src/tools/pptx.js'
import { createWorkspace, cleanupWorkspace } from '../../mcp-servers/minimax-document-mcp/src/sandbox.js'
import {
  MiniMaxDocumentMockTransport,
  MOCK_XLSX_READ_RESULT,
  MOCK_PPTX_GENERATE_RESULT,
} from './minimax-document-e2e-transport.js'
import {
  createMcpTables,
  makeTestTemplates,
  containsBase64BinaryContent,
  containsBinaryContentMarkers,
} from './minimax-document-e2e-helpers.js'

describe('MiniMax Document MCP - Full E2E Flow', () => {
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

  afterEach(() => {
    connection.close()
  })

  it('platform sees MiniMax skills AND calls document tools in tool plane', async () => {
    const minimaxSkills = MINIMAX_SKILL_IDS
      .map((id) => skillRegistry.get(id))
      .filter(Boolean)
    expect(minimaxSkills).toHaveLength(4)

    const skillProjection = {
      skillIds: MINIMAX_SKILL_IDS,
      renderMode: 'summary' as const,
      skillSummaries:
        'Available Skills:\n' +
        '- pptx-generator (write): PowerPoint generation guidance\n' +
        '- minimax-xlsx (read): Excel reading guidance\n' +
        '- minimax-docx (write): Word document guidance\n' +
        '- minimax-pdf (write): PDF generation guidance',
    }

    const renderedSkillPlane = renderSummarySkillPlane(skillProjection)
    expect(renderedSkillPlane).toContain('Available Skill IDs:')
    expect(renderedSkillPlane).not.toContain('Available Tool IDs')
    expect(renderedSkillPlane).not.toContain('"type": "function"')

    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const allTools = toolRegistry.listTools()
    expect(allTools).toHaveLength(4)

    const xlsxResult = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_xlsx_read',
      { inputPath: '/data/report.xlsx' },
    )
    expect(xlsxResult.status).toBe('completed')

    const xlsxData = xlsxResult.data as typeof MOCK_XLSX_READ_RESULT
    expect(xlsxData.structuredContent.headers).toBeDefined()
    expect(xlsxData.structuredContent.rows).toBeDefined()

    const xlsxSerialized = JSON.stringify(xlsxResult.data)
    expect(containsBase64BinaryContent(xlsxSerialized)).toBe(false)
    expect(containsBinaryContentMarkers(xlsxSerialized)).toBe(false)

    const pptxResult = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_pptx_generate',
      {
        title: 'Analysis Report',
        slides: [
          { layout: 'title', title: 'Analysis Report', content: ['Q2 2026'] },
          { layout: 'titleAndContent', title: 'Findings', content: ['Key finding 1', 'Key finding 2'] },
        ],
      },
    )
    expect(pptxResult.status).toBe('completed')

    const pptxData = pptxResult.data as typeof MOCK_PPTX_GENERATE_RESULT
    const artifact = pptxData.structuredContent.artifact

    expect(artifact.fileId).toMatch(/^file_/)
    expect(artifact.fileName).toMatch(/\.pptx$/)
    expect(artifact.mimeType).toContain('presentationml')
    expect(artifact.sizeBytes).toBeGreaterThan(0)
    expect(artifact.downloadUrl).toMatch(/^mcp-artifact:\/\//)

    const pptxSerialized = JSON.stringify(pptxResult.data)
    expect(containsBase64BinaryContent(pptxSerialized)).toBe(false)
    expect(containsBinaryContentMarkers(pptxSerialized)).toBe(false)

    const history = transport.getCallHistory()
    expect(history).toHaveLength(2)
    expect(history[0].toolName).toBe('xlsx.read')
    expect(history[1].toolName).toBe('pptx.generate')

    expect(xlsxSerialized).not.toContain('PowerPoint generation guidance')
    expect(xlsxSerialized).not.toContain('Excel reading guidance')
    expect(pptxSerialized).not.toContain('PowerPoint generation guidance')
    expect(pptxSerialized).not.toContain('Excel reading guidance')
  })

  it('uses real MCP implementation fixtures for XLSX read and PPTX generate/read', async () => {
    clearFileRegistry()
    const workspace = await createWorkspace('real-minimax-e2e')
    try {
      const sourceXlsx = path.join(
        process.cwd(),
        'mcp-servers/minimax-document-mcp/test-fixtures/employees.xlsx',
      )
      await fs.copyFile(sourceXlsx, path.join(workspace.root, 'employees.xlsx'))

      const xlsxResult = await readXlsx({ inputPath: 'employees.xlsx', maxRows: 2 }, workspace.root)
      expect(xlsxResult.headers).toContain('Name')
      expect(xlsxResult.rows).toHaveLength(2)
      expect(JSON.stringify(xlsxResult)).not.toMatch(/[A-Za-z0-9+/]{200,}={0,2}/)

      const generated = await generatePptx({
        title: 'Real Fixture Flow',
        slides: [
          { layout: 'title', title: 'Real Fixture Flow' },
          { layout: 'titleAndContent', title: 'Rows Read', content: [`Rows: ${xlsxResult.rows.length}`] },
        ],
        outputFileName: 'real-fixture-flow.pptx',
      })
      expect(generated.artifact.downloadUrl).toMatch(/^mcp-artifact:\/\//)
      expect(generated.artifact.fileName).toBe('real-fixture-flow.pptx')
      expect(generated.artifact.sizeBytes).toBeGreaterThan(0)

      const readBack = await readPptx(generated.artifact.fileId)
      expect(readBack.totalSlides).toBe(2)
      expect(readBack.slides.some((slide) => slide.content.includes('Real Fixture Flow'))).toBe(true)
    } finally {
      await cleanupWorkspace(workspace)
      clearFileRegistry()
    }
  })

  it('combined model input has skill plane AND tool plane separated', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const templates = makeTestTemplates()
    const registry = new PromptTemplateRegistry(templates, '/nonexistent')
    const loader = new TemplateLoader('/nonexistent')
    const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })

    const tool = {
      type: 'function' as const,
      function: {
        name: 'mcp_minimax-document-mcp_xlsx_read',
        description: 'Read XLSX file',
        parameters: { type: 'object' as const, properties: { inputPath: { type: 'string' } } },
      },
    }

    const result = await builder.build({
      mode: 'function_calling',
      agentKind: 'subagent',
      providerFamily: 'openai',
      systemPrompt: 'You are a document processing agent.',
      toolProjection: {
        toolIds: ['mcp_minimax-document-mcp_xlsx_read', 'mcp_minimax-document-mcp_pptx_generate'],
        tools: [tool],
      },
      skillProjection: {
        skillIds: ['minimax-xlsx', 'pptx-generator'],
        renderMode: 'documents',
        skillDocuments: [
          {
            skillId: 'minimax-xlsx',
            name: 'MiniMax XLSX',
            document: '## XLSX Tools\n\nUse `xlsx.read` for data extraction.',
          },
          {
            skillId: 'pptx-generator',
            name: 'PPTX Generator',
            document: '## PPTX Tools\n\nUse `pptx.generate` for presentation creation.',
          },
        ],
      },
    })

    expect(result.segments.toolPlane).toContain('--- Tool Plane (callable tools) ---')
    expect(result.segments.toolPlane).toContain('--- Skill Plane (documentation only) ---')

    const toolPlaneIdx = result.segments.toolPlane.indexOf('--- Tool Plane (callable tools) ---')
    const skillPlaneIdx = result.segments.toolPlane.indexOf('--- Skill Plane (documentation only) ---')
    expect(skillPlaneIdx).toBeGreaterThan(toolPlaneIdx)

    expect(result.segments.toolPlane).toContain('XLSX Tools')
    expect(result.segments.toolPlane).toContain('PPTX Tools')
    expect(result.segments.toolPlane).toContain('mcp_minimax-document-mcp_xlsx_read')

    expect(result.segments.staticPrefix).not.toContain('xlsx.read')
    expect(result.segments.staticPrefix).not.toContain('pptx.generate')
    expect(result.segments.tenantProject).not.toContain('xlsx.read')
    expect(result.segments.tenantProject).not.toContain('pptx.generate')
  })
})
