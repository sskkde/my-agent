/**
 * Phase 3 Mock MCP (Barrel Re-export)
 *
 * Re-exports from split modules for backward compatibility.
 * Import from specific modules for new code:
 * - `./mcp-mock-tools.js` for generic MCP tool descriptors
 * - `./mcp-mock-transport.js` for MockMcpTransport
 * - `./mcp-mock-factories.js` for server/session/tool factories
 * - `./minimax-document-tools.js` for MiniMax-specific tools and setups
 */

export { MOCK_MCP_TOOLS } from './mcp-mock-tools.js'
export { MockMcpTransport } from './mcp-mock-transport.js'
export type { MockMcpTransportConfig } from './mcp-mock-transport.js'
export { createMockMcpServer, createMockMcpSession, createMockMcpToolDescriptor } from './mcp-mock-factories.js'
export {
  MINIMAX_DOCUMENT_TOOLS,
  MINIMAX_DOCUMENT_TOOLS_WITH_DEFERRED,
  createMockMcpSetup,
  createFileSystemMcpSetup,
  createCommandMcpSetup,
  createFullMcpSetup,
  createMiniMaxDocumentMcpSetup,
  createMiniMaxDocumentMcpWithDeferredSetup,
} from './minimax-document-tools.js'
export type { MockMcpSetup } from './minimax-document-tools.js'
