/**
 * MiniMax Document MCP E2E Mock Transport
 *
 * Mock transport that simulates the MiniMax Document MCP server.
 * Returns realistic artifact references and structured data.
 */

import type { MCPToolDescriptor } from '../../src/connectors/types.js'
import type { McpToolTransport } from '../../src/connectors/mcp/mcp-tool-bridge.js'
import { MINIMAX_DOCUMENT_TOOLS } from '../fixtures/phase3-mock-mcp.js'

/** Artifact reference shape returned by pptx.generate */
export interface ArtifactReference {
  fileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  downloadUrl: string
}

/** Structured data returned by xlsx.read */
export interface XlsxReadResponse {
  content: Array<{
    type: 'text'
    text: string
  }>
  structuredContent: {
    sheetName: string
    headers: string[]
    rows: Array<Record<string, unknown>>
    totalRows: number
    totalColumns: number
    truncated: boolean
    sheetNames: string[]
    formulaSummary: {
      totalFormulas: number
      formulaCells: Array<{ sheet: string; cell: string; formula: string }>
    }
  }
}

/** Artifact reference response returned by pptx.generate */
export interface PptxGenerateResponse {
  content: Array<{
    type: 'text'
    text: string
  }>
  structuredContent: {
    artifact: ArtifactReference
    slideCount: number
    warnings: string[]
  }
}

export const MOCK_XLSX_READ_RESULT: XlsxReadResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        sheetName: 'Sheet1',
        headers: ['Name', 'Department', 'Salary'],
        totalRows: 3,
        totalColumns: 3,
        truncated: false,
      }),
    },
  ],
  structuredContent: {
    sheetName: 'Sheet1',
    headers: ['Name', 'Department', 'Salary'],
    rows: [
      { Name: 'Alice', Department: 'Engineering', Salary: 120000 },
      { Name: 'Bob', Department: 'Marketing', Salary: 95000 },
      { Name: 'Carol', Department: 'Engineering', Salary: 130000 },
    ],
    totalRows: 3,
    totalColumns: 3,
    truncated: false,
    sheetNames: ['Sheet1', 'Summary'],
    formulaSummary: {
      totalFormulas: 0,
      formulaCells: [],
    },
  },
}

export const MOCK_PPTX_GENERATE_RESULT: PptxGenerateResponse = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        artifact: {
          fileId: 'file_abc123def456',
          fileName: 'quarterly-report.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          sizeBytes: 45_312,
          downloadUrl: 'mcp-artifact://file_abc123def456',
        },
        slideCount: 3,
        warnings: [],
      }),
    },
  ],
  structuredContent: {
    artifact: {
      fileId: 'file_abc123def456',
      fileName: 'quarterly-report.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 45_312,
      downloadUrl: 'mcp-artifact://file_abc123def456',
    },
    slideCount: 3,
    warnings: [],
  },
}

export class MiniMaxDocumentMockTransport implements McpToolTransport {
  private connected = false
  private callHistory: Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> = []
  private readonly tools: MCPToolDescriptor[]

  constructor(tools: MCPToolDescriptor[] = MINIMAX_DOCUMENT_TOOLS) {
    this.tools = tools
  }

  async connect(): Promise<void> {
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async listTools(): Promise<MCPToolDescriptor[]> {
    this.ensureConnected()
    return [...this.tools]
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureConnected()

    const tool = this.tools.find((t) => t.name === toolName)
    if (!tool) {
      return {
        isError: true,
        error: { code: 'TOOL_NOT_FOUND', message: `Tool not found: ${toolName}` },
      }
    }

    const result = this.executeTool(toolName, args)
    this.callHistory.push({ toolName, args, result })
    return result
  }

  getCallHistory(): Array<{ toolName: string; args: Record<string, unknown>; result: unknown }> {
    return [...this.callHistory]
  }

  clearCallHistory(): void {
    this.callHistory = []
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Transport not connected')
    }
  }

  private executeTool(toolName: string, _args: Record<string, unknown>): unknown {
    switch (toolName) {
      case 'xlsx.read':
        return MOCK_XLSX_READ_RESULT

      case 'pptx.generate':
        return MOCK_PPTX_GENERATE_RESULT

      case 'xlsx.validate':
        return {
          content: [{ type: 'text', text: JSON.stringify({ valid: true, errors: [], summary: { totalRows: 3, validRows: 3, errorRows: 0 } }) }],
          structuredContent: { valid: true, errors: [], summary: { totalRows: 3, validRows: 3, errorRows: 0 } },
        }

      case 'pptx.read':
        return {
          content: [{ type: 'text', text: JSON.stringify({ title: 'Quarterly Report', totalSlides: 3 }) }],
          structuredContent: {
            title: 'Quarterly Report',
            slides: [
              { slideNumber: 1, title: 'Title Slide', content: ['Quarterly Report'] },
              { slideNumber: 2, title: 'Overview', content: ['Key metrics and highlights'] },
              { slideNumber: 3, title: 'Summary', content: ['Next steps and action items'] },
            ],
            totalSlides: 3,
          },
        }

      default:
        return {
          isError: true,
          error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${toolName}` },
        }
    }
  }
}
