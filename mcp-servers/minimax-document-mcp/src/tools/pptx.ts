/**
 * PPTX MCP Tools — tool registration + barrel re-exports
 *
 * Registers pptx.generate and pptx.read on the MCP server.
 * Re-exports types and functions from sub-modules.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSandboxError, isSandboxError } from '../sandbox.js'
import { generatePptx, validateGenerateInput } from './pptx-generate.js'
import { readPptx, validateReadInput } from './pptx-read.js'
import type { PptxGenerateInput } from './pptx-types.js'

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  SlideLayout,
  SlideDefinition,
  PptxGenerateInput,
  PptxGenerateOutput,
  SlideData,
  PptxReadOutput,
} from './pptx-types.js'

export {
  registerFile,
  resolveFileId,
  clearFileRegistry,
  SlideLayoutSchema,
  SlideDefinitionSchema,
  PptxGenerateInputSchema,
  PptxReadInputSchema,
} from './pptx-types.js'

export { generatePptx, validateGenerateInput } from './pptx-generate.js'
export { readPptx, validateReadInput } from './pptx-read.js'

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

/**
 * Registers pptx.generate and pptx.read tools on the MCP server.
 */
export function registerPptxTools(server: McpServer): void {
  // pptx.generate
  server.tool(
    'pptx.generate',
    'Generate a PowerPoint presentation from structured slide definitions. Returns an artifact reference (fileId, fileName, mimeType, sizeBytes, downloadUrl) - not raw binary data.',
    {
      destructiveHint: true,
      idempotentHint: false,
    },
    async (args: Record<string, unknown>) => {
      const validationError = validateGenerateInput(args)
      if (validationError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(validationError) }],
          isError: true,
        }
      }

      try {
        const input = args as unknown as PptxGenerateInput
        const result = await generatePptx(input)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error: unknown) {
        if (isSandboxError(error)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(error) }],
            isError: true,
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSandboxError(
              'workspace_error',
              `PPTX generation failed: ${error instanceof Error ? error.message : String(error)}`,
            )),
          }],
          isError: true,
        }
      }
    },
  )

  // pptx.read
  server.tool(
    'pptx.read',
    'Read and extract content from a PowerPoint presentation. Returns structured slide data including titles, content, and optionally speaker notes.',
    {
      readOnlyHint: true,
      idempotentHint: true,
    },
    async (args: Record<string, unknown>) => {
      const validationError = validateReadInput(args)
      if (validationError) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(validationError) }],
          isError: true,
        }
      }

      try {
        const fileId = args.fileId as string
        const includeNotes = args.includeNotes === true
        const slideRange = typeof args.slideRange === 'string' ? args.slideRange : undefined

        const result = await readPptx(fileId, { includeNotes, slideRange })
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error: unknown) {
        if (isSandboxError(error)) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(error) }],
            isError: true,
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(createSandboxError(
              'workspace_error',
              `PPTX reading failed: ${error instanceof Error ? error.message : String(error)}`,
            )),
          }],
          isError: true,
        }
      }
    },
  )
}
