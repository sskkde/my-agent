/**
 * PPTX Type Definitions and File Registry
 */

import { z } from 'zod'
import type { ArtifactReference } from '../sandbox.js'

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const SlideLayoutSchema = z.enum([
  'title',
  'titleAndContent',
  'twoColumn',
  'blank',
  'comparison',
  'sectionHeader',
])

export const SlideDefinitionSchema = z.object({
  layout: SlideLayoutSchema,
  title: z.string().optional(),
  subtitle: z.string().optional(),
  content: z.array(z.string()).optional(),
  notes: z.string().optional(),
  leftContent: z.array(z.string()).optional(),
  rightContent: z.array(z.string()).optional(),
})

export const PptxGenerateInputSchema = z.object({
  title: z.string().min(1, 'title is required and must be a non-empty string'),
  slides: z.array(SlideDefinitionSchema).min(1, 'slides is required and must be a non-empty array'),
  template: z.string().optional(),
  outputFileName: z.string().optional(),
})

export const PptxReadInputSchema = z.object({
  fileId: z.string().min(1, 'fileId is required and must be a non-empty string'),
  includeNotes: z.boolean().optional(),
  slideRange: z.string().optional(),
})

// ---------------------------------------------------------------------------
// TypeScript Types (inferred from Zod schemas)
// ---------------------------------------------------------------------------

export type SlideLayout = z.infer<typeof SlideLayoutSchema>
export type SlideDefinition = z.infer<typeof SlideDefinitionSchema>
export type PptxGenerateInput = z.infer<typeof PptxGenerateInputSchema>

/** Output for pptx.generate */
export interface PptxGenerateOutput {
  artifact: ArtifactReference
  slideCount: number
  warnings: string[]
}

/** Single slide data from pptx.read */
export interface SlideData {
  slideNumber: number
  title?: string
  content: string[]
  notes?: string
}

/** Output for pptx.read */
export interface PptxReadOutput {
  title?: string
  slides: SlideData[]
  totalSlides: number
}

// ---------------------------------------------------------------------------
// File Registry (in-memory mapping of fileId → filePath)
// ---------------------------------------------------------------------------

/** Maps fileId (UUID) to absolute file path for cross-tool file resolution */
const fileRegistry = new Map<string, string>()

/**
 * Registers a file in the registry so pptx.read can resolve it by fileId.
 * @internal Exported for testing.
 */
export function registerFile(fileId: string, filePath: string): void {
  fileRegistry.set(fileId, filePath)
}

/**
 * Resolves a fileId to an absolute file path.
 * @internal Exported for testing.
 */
export function resolveFileId(fileId: string): string | undefined {
  return fileRegistry.get(fileId)
}

/**
 * Clears the file registry. For testing only.
 * @internal Exported for testing.
 */
export function clearFileRegistry(): void {
  fileRegistry.clear()
}
