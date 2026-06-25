/**
 * MiniMax Document MCP E2E - pptx.generate Tests
 *
 * Tests that pptx.generate returns artifact references with metadata,
 * not binary content, and is correctly marked as write/destructive.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMcpServerRegistry, type McpServerRegistry } from '../../src/connectors/mcp/mcp-server-registry.js'
import { createMcpSessionManager, type McpSessionManager } from '../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../src/tools/types.js'
import { createMockMcpServer } from '../fixtures/phase3-mock-mcp.js'
import {
  MiniMaxDocumentMockTransport,
  createMcpTables,
  containsBase64BinaryContent,
  containsBinaryContentMarkers,
  MOCK_PPTX_GENERATE_RESULT,
} from './minimax-document-e2e-setup.js'

describe('MiniMax Document MCP - pptx.generate Verification', () => {
  let connection: ConnectionManager
  let serverRegistry: McpServerRegistry
  let sessionManager: McpSessionManager
  let transport: MiniMaxDocumentMockTransport
  let toolRegistry: ToolRegistry
  let bridge: McpToolBridge

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)

    transport = new MiniMaxDocumentMockTransport()
    serverRegistry = createMcpServerRegistry(connection)
    sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', transport]]))
    toolRegistry = createToolRegistry()

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

  it('calls pptx.generate via bridge and returns artifact reference with metadata', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_pptx_generate',
      {
        title: 'Quarterly Report',
        slides: [
          { layout: 'title', title: 'Q2 2026 Report', content: ['Prepared by Engineering'] },
          { layout: 'titleAndContent', title: 'Key Metrics', content: ['Revenue: $1.2M', 'Users: 15,000'] },
          { layout: 'titleAndContent', title: 'Next Steps', content: ['Scale infrastructure', 'Expand to APAC'] },
        ],
        outputFileName: 'quarterly-report.pptx',
      },
    )

    expect(result.status).toBe('completed')
    expect(result.data).toBeDefined()

    const data = result.data as typeof MOCK_PPTX_GENERATE_RESULT
    expect(data.structuredContent).toBeDefined()
    expect(data.structuredContent.artifact).toBeDefined()

    const artifact = data.structuredContent.artifact
    expect(artifact.fileId).toBe('file_abc123def456')
    expect(artifact.fileName).toBe('quarterly-report.pptx')
    expect(artifact.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
    expect(artifact.sizeBytes).toBe(45_312)
    expect(artifact.downloadUrl).toBe('mcp-artifact://file_abc123def456')

    expect(data.structuredContent.slideCount).toBe(3)
    expect(data.structuredContent.warnings).toEqual([])
  })

  it('pptx.generate response contains no base64 or binary content in model-visible text', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_pptx_generate',
      {
        title: 'Test Presentation',
        slides: [{ layout: 'title', title: 'Slide 1', content: ['Content'] }],
      },
    )

    expect(result.status).toBe('completed')

    const serialized = JSON.stringify(result.data)
    expect(containsBase64BinaryContent(serialized)).toBe(false)
    expect(containsBinaryContentMarkers(serialized)).toBe(false)

    const data = result.data as typeof MOCK_PPTX_GENERATE_RESULT
    for (const item of data.content) {
      expect(item.type).toBe('text')
      expect(containsBase64BinaryContent(item.text)).toBe(false)
      const parsed = JSON.parse(item.text)
      expect(parsed).toHaveProperty('artifact')
      expect(parsed.artifact).toHaveProperty('fileId')
      expect(parsed.artifact).toHaveProperty('fileName')
      expect(parsed.artifact).toHaveProperty('mimeType')
      expect(parsed.artifact).toHaveProperty('sizeBytes')
      expect(parsed.artifact).toHaveProperty('downloadUrl')
    }
  })

  it('pptx.generate artifact reference has all required metadata fields', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const result = await bridge.callTool(
      session.sessionId,
      'mcp_minimax-document-mcp_pptx_generate',
      {
        title: 'Metadata Check',
        slides: [{ layout: 'title', title: 'Slide 1', content: ['Content'] }],
      },
    )

    expect(result.status).toBe('completed')
    const data = result.data as typeof MOCK_PPTX_GENERATE_RESULT
    const artifact = data.structuredContent.artifact

    const requiredFields = ['fileId', 'fileName', 'mimeType', 'sizeBytes', 'downloadUrl'] as const
    for (const field of requiredFields) {
      expect(artifact).toHaveProperty(field)
      expect(artifact[field]).toBeDefined()
      expect(artifact[field]).not.toBe('')
    }

    expect(typeof artifact.fileId).toBe('string')
    expect(artifact.fileId.length).toBeGreaterThan(0)

    expect(typeof artifact.sizeBytes).toBe('number')
    expect(artifact.sizeBytes).toBeGreaterThan(0)

    expect(artifact.mimeType).toMatch(/^application\//)

    expect(artifact.downloadUrl).toMatch(/^mcp-artifact:\/\//)
  })

  it('pptx.generate tool is marked write/destructive (requires permission)', async () => {
    await transport.connect()
    const session = sessionManager.openSession('minimax-document-mcp')
    await bridge.registerTools(toolRegistry, session.sessionId)

    const tool = toolRegistry.getTool('mcp_minimax-document-mcp_pptx_generate')
    expect(tool).not.toBeNull()
    expect(tool!.category).toBe('write')
    expect(tool!.sensitivity).toBe('high')
    expect(tool!.idempotent).toBe(false)
  })
})
