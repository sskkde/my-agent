/**
 * PPTX Reading — reads PPTX files and extracts slide content.
 */

import JSZip from 'jszip'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  enforceSizeLimit,
  withTimeout,
  createSandboxError,
  MAX_FILE_SIZE_BYTES,
  TIMEOUT_MS,
} from '../sandbox.js'
import {
  PptxReadInputSchema,
  resolveFileId,
  type SlideData,
  type PptxReadOutput,
} from './pptx-types.js'
import type { SandboxErrorResponse } from '../sandbox.js'

// ---------------------------------------------------------------------------
// Input Validation (Zod-based)
// ---------------------------------------------------------------------------

/**
 * Validates pptx.read input using Zod schema.
 * Returns null if valid, or a SandboxErrorResponse if invalid.
 */
export function validateReadInput(input: unknown): SandboxErrorResponse | null {
  const result = PptxReadInputSchema.safeParse(input)
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ')
    return createSandboxError('invalid_artifact_ref', messages)
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses slide range string (e.g., '1-5', '1,3,7') into a Set of 1-indexed slide numbers.
 */
function parseSlideRange(range: string, totalSlides: number): Set<number> | null {
  if (!range || range.trim().length === 0) return null

  const result = new Set<number>()
  const parts = range.split(',')

  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (isNaN(start) || isNaN(end) || start < 1 || end < start || end > totalSlides) {
        throw createSandboxError('invalid_artifact_ref', `Invalid slide range: ${trimmed}`)
      }
      for (let i = start; i <= end; i++) {
        result.add(i)
      }
    } else {
      const num = parseInt(trimmed, 10)
      if (isNaN(num) || num < 1 || num > totalSlides) {
        throw createSandboxError('invalid_artifact_ref', `Invalid slide number: ${trimmed}`)
      }
      result.add(num)
    }
  }

  return result
}

/**
 * Extracts text content from a PPTX slide XML.
 */
function extractTextFromSlideXml(xml: string): { title?: string; content: string[] } {
  const content: string[] = []
  let title: string | undefined

  const textRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g
  let match: RegExpExecArray | null

  while ((match = textRegex.exec(xml)) !== null) {
    const text = match[1].trim()
    if (text.length > 0) {
      content.push(text)
    }
  }

  if (content.length > 0) {
    title = content[0]
  }

  return { title, content }
}

// ---------------------------------------------------------------------------
// PPTX Reading
// ---------------------------------------------------------------------------

/**
 * Reads a PPTX file and extracts structured slide content.
 */
export async function readPptx(
  fileId: string,
  options?: { includeNotes?: boolean; slideRange?: string },
): Promise<PptxReadOutput> {
  const filePath = resolveFileId(fileId)
  if (!filePath) {
    throw createSandboxError('file_not_found', `File not found for ID: ${fileId}`)
  }

  try {
    await fs.access(filePath)
  } catch {
    throw createSandboxError('file_not_found', `File not found: ${path.basename(filePath)}`)
  }

  const stat = await fs.stat(filePath)
  enforceSizeLimit(stat.size, MAX_FILE_SIZE_BYTES, 'Input PPTX')

  const result = await withTimeout(
    async () => {
      const fileBuffer = await fs.readFile(filePath)
      const zip = await JSZip.loadAsync(fileBuffer)

      // Get presentation title from core.xml
      let presentationTitle: string | undefined
      const coreXml = zip.file('docProps/core.xml')
      if (coreXml) {
        const coreContent = await coreXml.async('string')
        const titleMatch = coreContent.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/)
        if (titleMatch) {
          presentationTitle = titleMatch[1].trim() || undefined
        }
      }

      // Find all slide files
      const slideFiles: { name: string; number: number }[] = []
      zip.forEach((relativePath) => {
        const slideMatch = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/)
        if (slideMatch) {
          slideFiles.push({
            name: relativePath,
            number: parseInt(slideMatch[1], 10),
          })
        }
      })

      slideFiles.sort((a, b) => a.number - b.number)
      const totalSlides = slideFiles.length

      const slideFilter = options?.slideRange
        ? parseSlideRange(options.slideRange, totalSlides)
        : null

      const slides: SlideData[] = []

      for (const slideFile of slideFiles) {
        if (slideFilter && !slideFilter.has(slideFile.number)) continue

        const slideXml = await zip.file(slideFile.name)!.async('string')
        const { title, content } = extractTextFromSlideXml(slideXml)

        const slideData: SlideData = { slideNumber: slideFile.number, content }
        if (title) slideData.title = title

        if (options?.includeNotes) {
          const notesFileName = `ppt/notesSlides/notesSlide${slideFile.number}.xml`
          const notesFile = zip.file(notesFileName)
          if (notesFile) {
            const notesXml = await notesFile.async('string')
            const notesTexts: string[] = []
            const notesRegex = /<a:t[^>]*>([^<]*)<\/a:t>/g
            let notesMatch: RegExpExecArray | null
            while ((notesMatch = notesRegex.exec(notesXml)) !== null) {
              const text = notesMatch[1].trim()
              if (text.length > 0) notesTexts.push(text)
            }
            if (notesTexts.length > 0) slideData.notes = notesTexts.join(' ')
          }
        }

        slides.push(slideData)
      }

      return { title: presentationTitle, slides, totalSlides }
    },
    TIMEOUT_MS.standard,
    'PPTX reading',
  )

  return result
}
