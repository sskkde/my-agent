/**
 * MiniMax Document MCP MVP Tool Definitions
 *
 * Tool descriptors for MiniMax MVP tools (xlsx, pptx).
 */

import type { MCPToolDescriptor } from '../../src/connectors/types.js'

export const MINIMAX_DOCUMENT_TOOLS: MCPToolDescriptor[] = [
  {
    toolId: 'minimax_xlsx_read',
    name: 'xlsx.read',
    description: 'Read and extract structured data from an XLSX spreadsheet file',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: 'Path to the XLSX file within the sandbox workspace' },
        sheetName: { type: 'string', description: 'Name of the sheet to read (defaults to first sheet)' },
        headerRow: { type: 'number', description: 'Row number to use as headers (1-indexed, defaults to 1)' },
        maxRows: { type: 'number', description: 'Maximum number of data rows to return' },
      },
      required: ['inputPath'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        headers: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'object' } },
        sheetNames: { type: 'array', items: { type: 'string' } },
        totalRows: { type: 'number' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    toolId: 'minimax_xlsx_validate',
    name: 'xlsx.validate',
    description: 'Validate XLSX data against specified rules and constraints',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: 'Path to the XLSX file within the sandbox workspace' },
        sheetName: { type: 'string', description: 'Name of the sheet to validate' },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              column: { type: 'string' },
              type: { type: 'string' },
              required: { type: 'boolean' },
              constraints: { type: 'object' },
            },
          },
        },
      },
      required: ['inputPath', 'rules'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'object' } },
        summary: { type: 'object' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    toolId: 'minimax_pptx_generate',
    name: 'pptx.generate',
    description: 'Generate a PowerPoint presentation from structured slide definitions',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              layout: { type: 'string' },
              title: { type: 'string' },
              content: { type: 'string' },
              notes: { type: 'string' },
            },
          },
        },
        outputFileName: { type: 'string', description: 'Output file name' },
      },
      required: ['title', 'slides'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        artifact: {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            fileName: { type: 'string' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'number' },
            downloadUrl: { type: 'string' },
          },
        },
        slideCount: { type: 'number' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    toolId: 'minimax_pptx_read',
    name: 'pptx.read',
    description: 'Read and extract text content from a PowerPoint presentation',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'MCP artifact file ID returned by pptx.generate' },
        includeNotes: { type: 'boolean', description: 'Whether to include speaker notes' },
        slideRange: { type: 'string', description: 'Slide range to read (e.g., "1-5", "1,3,7")' },
      },
      required: ['fileId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        slides: { type: 'array', items: { type: 'object' } },
        totalSlides: { type: 'number' },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
]
