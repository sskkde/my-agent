/**
 * PPTX Generation — generates PPTX presentations from structured slide definitions.
 */

import PptxGenJS from 'pptxgenjs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createWorkspace,
  cleanupWorkspace,
  normalizePath,
  resolveArtifactRef,
  enforceSizeLimit,
  withTimeout,
  createSandboxError,
  isSandboxError,
  MAX_FILE_SIZE_BYTES,
  TIMEOUT_MS,
  type SandboxErrorResponse,
} from '../sandbox.js'
import {
  PptxGenerateInputSchema,
  registerFile,
  type SlideDefinition,
  type PptxGenerateInput,
  type PptxGenerateOutput,
} from './pptx-types.js'

// ---------------------------------------------------------------------------
// Input Validation (Zod-based)
// ---------------------------------------------------------------------------

/**
 * Validates pptx.generate input using Zod schema.
 * Returns null if valid, or a SandboxErrorResponse if invalid.
 */
export function validateGenerateInput(input: unknown): SandboxErrorResponse | null {
  const result = PptxGenerateInputSchema.safeParse(input)
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ')
    return createSandboxError('invalid_artifact_ref', messages)
  }
  return null
}

// ---------------------------------------------------------------------------
// Slide Content Generation Helpers
// ---------------------------------------------------------------------------

/**
 * Adds slide content based on layout type.
 * Returns any warnings encountered.
 */
function addSlideContent(pptx: PptxGenJS, slideDef: SlideDefinition): string[] {
  const slide = pptx.addSlide()
  const warnings: string[] = []

  switch (slideDef.layout) {
    case 'title': {
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.5, y: 1.5, w: '90%', h: 1.5,
          fontSize: 36, bold: true, align: 'center',
        })
      }
      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.5, y: 3.2, w: '90%', h: 1,
          fontSize: 18, align: 'center', color: '666666',
        })
      }
      break
    }

    case 'titleAndContent': {
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.5, y: 0.3, w: '90%', h: 0.8,
          fontSize: 28, bold: true,
        })
      }
      if (slideDef.content && slideDef.content.length > 0) {
        const bulletText = slideDef.content.map((line) => ({
          text: line,
          options: { bullet: true, indentLevel: 0 },
        }))
        slide.addText(bulletText, {
          x: 0.5, y: 1.3, w: '90%', h: 4,
          fontSize: 16, valign: 'top',
        })
      }
      break
    }

    case 'twoColumn':
    case 'comparison': {
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.5, y: 0.3, w: '90%', h: 0.8,
          fontSize: 28, bold: true,
        })
      }
      if (slideDef.leftContent && slideDef.leftContent.length > 0) {
        const leftText = slideDef.leftContent.map((line) => ({
          text: line,
          options: { bullet: true },
        }))
        slide.addText(leftText, {
          x: 0.3, y: 1.3, w: '45%', h: 4,
          fontSize: 14, valign: 'top',
        })
      }
      if (slideDef.rightContent && slideDef.rightContent.length > 0) {
        const rightText = slideDef.rightContent.map((line) => ({
          text: line,
          options: { bullet: true },
        }))
        slide.addText(rightText, {
          x: 50, y: 1.3, w: '45%', h: 4,
          fontSize: 14, valign: 'top',
        })
      }
      break
    }

    case 'blank': {
      break
    }

    case 'sectionHeader': {
      if (slideDef.title) {
        slide.addText(slideDef.title, {
          x: 0.5, y: 2, w: '90%', h: 2,
          fontSize: 40, bold: true, align: 'center',
        })
      }
      if (slideDef.subtitle) {
        slide.addText(slideDef.subtitle, {
          x: 0.5, y: 4, w: '90%', h: 1,
          fontSize: 20, align: 'center', color: '666666',
        })
      }
      break
    }

    default:
      warnings.push(`Unsupported layout '${slideDef.layout as string}', falling back to blank`)
      break
  }

  if (slideDef.notes) {
    slide.addNotes(slideDef.notes)
  }

  return warnings
}

// ---------------------------------------------------------------------------
// PPTX Generation
// ---------------------------------------------------------------------------

function normalizeOutputFileName(outputFileName: string | undefined): string {
  const requested = outputFileName ?? 'presentation.pptx'

  if (requested.trim().length === 0) {
    throw createSandboxError('invalid_artifact_ref', 'outputFileName must not be empty')
  }

  if (path.isAbsolute(requested)) {
    throw createSandboxError('absolute_path_rejected', 'outputFileName must be a file name, not an absolute path')
  }

  if (requested.includes('/') || requested.includes('\\') || requested.split(path.sep).length > 1) {
    throw createSandboxError('path_traversal', 'outputFileName must not contain path separators')
  }

  if (requested === '..' || requested.includes('..')) {
    throw createSandboxError('path_traversal', 'outputFileName must not contain parent traversal segments')
  }

  return requested.endsWith('.pptx') ? requested : `${requested}.pptx`
}

/**
 * Generates a PPTX presentation from structured slide definitions.
 */
export async function generatePptx(input: PptxGenerateInput): Promise<PptxGenerateOutput> {
  const workspace = await createWorkspace('pptx-gen')
  const warnings: string[] = []

  try {
    const pptx = new PptxGenJS()
    pptx.title = input.title
    pptx.author = 'MiniMax Document MCP'
    pptx.layout = 'LAYOUT_16x9'

    for (const slideDef of input.slides) {
      const slideWarnings = addSlideContent(pptx, slideDef)
      warnings.push(...slideWarnings)
    }

    const safeFileName = normalizeOutputFileName(input.outputFileName)
    const filePath = await normalizePath(workspace, safeFileName)

    await withTimeout(
      () => pptx.writeFile({ fileName: filePath }),
      TIMEOUT_MS.generation,
      'PPTX generation',
    )

    const stat = await fs.stat(filePath)
    enforceSizeLimit(stat.size, MAX_FILE_SIZE_BYTES, 'Generated PPTX')

    const artifact = await resolveArtifactRef(
      workspace,
      filePath,
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )

    registerFile(artifact.fileId, filePath)

    // Copy to persistent location (workspace will be cleaned up)
    const persistentDir = path.join(workspace.root, '..', `pptx-persistent-${workspace.id}`)
    await fs.mkdir(persistentDir, { recursive: true })
    const persistentPath = path.join(persistentDir, safeFileName)
    await fs.copyFile(filePath, persistentPath)
    registerFile(artifact.fileId, persistentPath)

    return { artifact, slideCount: input.slides.length, warnings }
  } catch (error: unknown) {
    if (isSandboxError(error)) throw error
    throw createSandboxError(
      'workspace_error',
      `PPTX generation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    await cleanupWorkspace(workspace)
  }
}
