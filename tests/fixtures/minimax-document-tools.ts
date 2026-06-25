/**
 * MiniMax Document MCP Tool Definitions (Deferred + Setup)
 *
 * Deferred tool descriptors (pdf, docx) and setup functions.
 * MVP tools are in minimax-document-tools-mvp.ts.
 */

import type { MCPToolDescriptor, MCPServerDefinition, MCPSession } from '../../src/connectors/types.js'
import type { MockMcpTransportConfig } from './mcp-mock-transport.js'
import { MockMcpTransport } from './mcp-mock-transport.js'
import { createMockMcpServer, createMockMcpSession } from './mcp-mock-factories.js'
import { MINIMAX_DOCUMENT_TOOLS } from './minimax-document-tools-mvp.js'

export { MINIMAX_DOCUMENT_TOOLS } from './minimax-document-tools-mvp.js'

export const MINIMAX_DOCUMENT_TOOLS_WITH_DEFERRED: MCPToolDescriptor[] = [
  ...MINIMAX_DOCUMENT_TOOLS,
  {
    toolId: 'minimax_pdf_generate',
    name: 'pdf.generate',
    description: 'Generate a PDF document from structured content (deferred)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Document content (markdown)' },
        fileName: { type: 'string', description: 'Output file name' },
      },
      required: ['title', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        sizeBytes: { type: 'number' },
        downloadUrl: { type: 'string' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    toolId: 'minimax_docx_generate',
    name: 'docx.generate',
    description: 'Generate a DOCX document from structured content (deferred)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Document content (markdown)' },
        fileName: { type: 'string', description: 'Output file name' },
      },
      required: ['title', 'content'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        fileName: { type: 'string' },
        mimeType: { type: 'string' },
        sizeBytes: { type: 'number' },
        downloadUrl: { type: 'string' },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
]

export interface MockMcpSetup {
  server: MCPServerDefinition
  session: MCPSession
  transport: MockMcpTransport
  tools: MCPToolDescriptor[]
}

export function createMockMcpSetup(config?: MockMcpTransportConfig): MockMcpSetup {
  const transport = new MockMcpTransport(config)
  const server = createMockMcpServer({
    serverId: config?.serverId,
    name: config?.name,
    version: config?.version,
  })
  const session = createMockMcpSession({
    serverId: server.serverId,
  })

  return {
    server,
    session,
    transport,
    tools: config?.tools ?? MINIMAX_DOCUMENT_TOOLS,
  }
}

export function createFileSystemMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'filesystem_mcp',
    name: 'Filesystem MCP Server',
    tools: MINIMAX_DOCUMENT_TOOLS.filter((t) => ['read_file', 'write_file', 'list_directory'].includes(t.name)),
  })
}

export function createCommandMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'command_mcp',
    name: 'Command Execution MCP Server',
    tools: MINIMAX_DOCUMENT_TOOLS.filter((t) => t.name === 'execute_command'),
  })
}

export function createFullMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'full_mcp',
    name: 'Full MCP Server',
    tools: MINIMAX_DOCUMENT_TOOLS,
  })
}

export function createMiniMaxDocumentMcpSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'minimax-document-mcp',
    name: 'MiniMax Document MCP Server',
    version: '0.1.0',
    tools: MINIMAX_DOCUMENT_TOOLS,
  })
}

export function createMiniMaxDocumentMcpWithDeferredSetup(): MockMcpSetup {
  return createMockMcpSetup({
    serverId: 'minimax-document-mcp',
    name: 'MiniMax Document MCP Server',
    version: '0.1.0',
    tools: MINIMAX_DOCUMENT_TOOLS_WITH_DEFERRED,
  })
}
