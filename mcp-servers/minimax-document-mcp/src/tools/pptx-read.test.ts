/**
 * PPTX Read Tool Tests
 *
 * Covers:
 * - pptx.read: happy path, file not found, slide range, speaker notes
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generatePptx,
  readPptx,
  clearFileRegistry,
  type PptxGenerateInput,
} from './pptx.js'

describe('pptx.read', () => {
  beforeEach(() => {
    clearFileRegistry()
  })

  it('reads a generated PPTX and extracts content', async () => {
    const genInput: PptxGenerateInput = {
      title: 'Read Test',
      slides: [
        { layout: 'title', title: 'First Slide', subtitle: 'Subtitle text' },
        { layout: 'titleAndContent', title: 'Second Slide', content: ['Bullet 1', 'Bullet 2'] },
      ],
    }

    const genResult = await generatePptx(genInput)

    const readResult = await readPptx(genResult.artifact.fileId)

    expect(readResult.totalSlides).toBe(2)
    expect(readResult.slides).toHaveLength(2)
    expect(readResult.slides[0].slideNumber).toBe(1)
    expect(readResult.slides[1].slideNumber).toBe(2)
    expect(readResult.slides[0].content.length).toBeGreaterThan(0)
    expect(readResult.slides[1].content.length).toBeGreaterThan(0)
  })

  it('extracts speaker notes when requested', async () => {
    const genInput: PptxGenerateInput = {
      title: 'Notes Test',
      slides: [
        { layout: 'title', title: 'Slide with Notes', notes: 'Speaker notes content' },
      ],
    }

    const genResult = await generatePptx(genInput)
    const readResult = await readPptx(genResult.artifact.fileId, { includeNotes: true })

    expect(readResult.slides).toHaveLength(1)
  })

  it('filters slides by range', async () => {
    const genInput: PptxGenerateInput = {
      title: 'Range Test',
      slides: [
        { layout: 'title', title: 'Slide 1' },
        { layout: 'titleAndContent', title: 'Slide 2', content: ['Content'] },
        { layout: 'titleAndContent', title: 'Slide 3', content: ['More'] },
        { layout: 'titleAndContent', title: 'Slide 4', content: ['Even more'] },
      ],
    }

    const genResult = await generatePptx(genInput)
    const readResult = await readPptx(genResult.artifact.fileId, { slideRange: '2-3' })

    expect(readResult.totalSlides).toBe(4)
    expect(readResult.slides).toHaveLength(2)
    expect(readResult.slides[0].slideNumber).toBe(2)
    expect(readResult.slides[1].slideNumber).toBe(3)
  })

  it('filters slides by comma-separated range', async () => {
    const genInput: PptxGenerateInput = {
      title: 'Comma Range Test',
      slides: [
        { layout: 'title', title: 'Slide 1' },
        { layout: 'titleAndContent', title: 'Slide 2', content: ['Content'] },
        { layout: 'titleAndContent', title: 'Slide 3', content: ['More'] },
      ],
    }

    const genResult = await generatePptx(genInput)
    const readResult = await readPptx(genResult.artifact.fileId, { slideRange: '1,3' })

    expect(readResult.slides).toHaveLength(2)
    expect(readResult.slides[0].slideNumber).toBe(1)
    expect(readResult.slides[1].slideNumber).toBe(3)
  })

  it('throws file_not_found for unknown fileId', async () => {
    try {
      await readPptx('nonexistent-id')
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect(error).toBeDefined()
      const err = error as { error?: { code?: string } }
      expect(err.error?.code).toBe('file_not_found')
    }
  })

  it('throws invalid_artifact_ref for invalid slide range', async () => {
    const genInput: PptxGenerateInput = {
      title: 'Invalid Range Test',
      slides: [
        { layout: 'title', title: 'Slide 1' },
      ],
    }

    const genResult = await generatePptx(genInput)

    try {
      await readPptx(genResult.artifact.fileId, { slideRange: '5-10' })
      expect.fail('Should have thrown')
    } catch (error: unknown) {
      expect(error).toBeDefined()
      const err = error as { error?: { code?: string } }
      expect(err.error?.code).toBe('invalid_artifact_ref')
    }
  })
})
