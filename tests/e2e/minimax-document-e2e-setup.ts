/**
 * MiniMax Document MCP E2E Test Setup (Barrel Re-export)
 *
 * Re-exports from split modules for backward compatibility.
 * Import from specific modules for new code:
 * - `./minimax-document-e2e-transport.js` for MiniMaxDocumentMockTransport
 * - `./minimax-document-e2e-helpers.js` for helpers and fixtures
 */

export {
  MiniMaxDocumentMockTransport,
  MOCK_XLSX_READ_RESULT,
  MOCK_PPTX_GENERATE_RESULT,
} from './minimax-document-e2e-transport.js'
export type { ArtifactReference, XlsxReadResponse, PptxGenerateResponse } from './minimax-document-e2e-transport.js'
export {
  containsBase64BinaryContent,
  containsBinaryContentMarkers,
  createMcpTables,
  makeTestTemplates,
} from './minimax-document-e2e-helpers.js'
