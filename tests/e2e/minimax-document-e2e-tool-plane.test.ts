/**
 * MiniMax Document MCP E2E - Tool Plane Verification
 *
 * Tests that MCP-bridged document tools are discovered and registered
 * with correct metadata, categories, and permissions.
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
import { extractToolsForRequest } from '../../src/kernel/model-input/model-input-builder.js'
import { MiniMaxDocumentMockTransport, createMcpTables } from './minimax-document-e2e-setup.js'

describe('MiniMax Document MCP - Tool Plane Verification', () => {
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

  it('discovers xlsx.read, xlsx.validate, pptx.generate, pptx.read via bridge', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')

    const tools = await bridge.discoverTools(session.sessionId)
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('mcp_minimax-document-mcp_xlsx_read')
    expect(toolNames).toContain('mcp_minimax-document-mcp_xlsx_validate')
    expect(toolNames).toContain('mcp_minimax-document-mcp_pptx_generate')
    expect(toolNames).toContain('mcp_minimax-document-mcp_pptx_read')
    expect(tools).toHaveLength(4)
  })

  it('registers bridged tools with correct metadata (bridge, serverId, categories)', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const xlsxRead = toolRegistry.getTool('mcp_minimax-document-mcp_xlsx_read')
    expect(xlsxRead).not.toBeNull()
    expect(xlsxRead!.metadata?.bridge).toBe('mcp')
    expect(xlsxRead!.metadata?.serverId).toBe('minimax-document-mcp')
    expect(xlsxRead!.metadata?.rawToolName).toBe('xlsx.read')
    expect(xlsxRead!.category).toBe('read')
    expect(xlsxRead!.sensitivity).toBe('medium')
    expect(xlsxRead!.requiresPermission).toBe(false)
    expect(xlsxRead!.idempotent).toBe(true)

    const pptxGenerate = toolRegistry.getTool('mcp_minimax-document-mcp_pptx_generate')
    expect(pptxGenerate).not.toBeNull()
    expect(pptxGenerate!.metadata?.bridge).toBe('mcp')
    expect(pptxGenerate!.metadata?.serverId).toBe('minimax-document-mcp')
    expect(pptxGenerate!.metadata?.rawToolName).toBe('pptx.generate')
    expect(pptxGenerate!.category).toBe('write')
    expect(pptxGenerate!.sensitivity).toBe('high')
    expect(pptxGenerate!.idempotent).toBe(false)
  })

  it('no bare document tool names in registry — all prefixed with mcp_minimax-document-mcp_', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const bareNames = ['xlsx_read', 'xlsx_validate', 'pptx_generate', 'pptx_read', 'pdf_generate', 'docx_generate']
    for (const name of bareNames) {
      expect(toolRegistry.hasTool(name)).toBe(false)
    }

    const allNames = toolRegistry.listTools().map((t) => t.name)
    expect(allNames.every((name) => name.startsWith('mcp_minimax-document-mcp_'))).toBe(true)
  })

  it('MiniMax skills do not appear in tool projection', () => {
    const toolProjection = {
      toolIds: ['mcp_minimax-document-mcp_xlsx_read'],
      tools: [{
        type: 'function' as const,
        function: {
          name: 'mcp_minimax-document-mcp_xlsx_read',
          description: 'Read XLSX file',
          parameters: { type: 'object' as const, properties: { inputPath: { type: 'string' } } },
        },
      }],
    }

    const result = extractToolsForRequest({
      mode: 'function_calling',
      agentKind: 'foreground',
      providerFamily: 'openai',
      toolProjection,
      skillProjection: {
        skillIds: MINIMAX_SKILL_IDS,
        renderMode: 'documents',
        skillDocuments: MINIMAX_SKILL_IDS.map((id) => ({
          skillId: id,
          name: id,
          document: `Guidance for ${id}`,
        })),
      },
    })

    expect(result).toBeDefined()
    expect(result!.length).toBe(1)
    expect(result![0].function.name).toBe('mcp_minimax-document-mcp_xlsx_read')

    for (const skillId of MINIMAX_SKILL_IDS) {
      expect(result!.some((t) => t.function.name === skillId)).toBe(false)
    }
  })
})
