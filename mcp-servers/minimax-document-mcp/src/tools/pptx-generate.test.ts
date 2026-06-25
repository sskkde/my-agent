/**
 * PPTX Generate Tool Tests
 *
 * Covers:
 * - pptx.generate: happy path, validation, artifact reference, slide layouts
 * - Security: path traversal and absolute path rejection
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  generatePptx,
  clearFileRegistry,
  type PptxGenerateInput,
} from './pptx.js'
import type { SandboxErrorResponse } from '../sandbox.js'

describe('pptx.generate', () => {
  beforeEach(() => {
    clearFileRegistry()
  })

  it('generates a PPTX with title slide', async () => {
    const input: PptxGenerateInput = {
      title: 'Test Presentation',
      slides: [
        { layout: 'title', title: 'Welcome', subtitle: 'A test presentation' },
      ],
    }

    const result = await generatePptx(input)

    expect(result.slideCount).toBe(1)
    expect(result.artifact.fileId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.artifact.fileName).toBe('presentation.pptx')
    expect(result.artifact.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
    expect(result.artifact.sizeBytes).toBeGreaterThan(0)
    expect(result.artifact.downloadUrl).toContain(result.artifact.fileId)
    expect(result.warnings).toEqual([])
  })

  it('generates a PPTX with multiple slide layouts', async () => {
    const input: PptxGenerateInput = {
      title: 'Multi-Layout Presentation',
      slides: [
        { layout: 'title', title: 'Title Slide', subtitle: 'Subtitle' },
        { layout: 'titleAndContent', title: 'Content Slide', content: ['Point 1', 'Point 2', 'Point 3'] },
        { layout: 'twoColumn', title: 'Two Column', leftContent: ['Left 1'], rightContent: ['Right 1'] },
        { layout: 'blank' },
        { layout: 'sectionHeader', title: 'Section', subtitle: 'New section' },
        { layout: 'comparison', title: 'Comparison', leftContent: ['Option A'], rightContent: ['Option B'] },
      ],
    }

    const result = await generatePptx(input)

    expect(result.slideCount).toBe(6)
    expect(result.artifact.sizeBytes).toBeGreaterThan(0)
  })

  it('generates a PPTX with speaker notes', async () => {
    const input: PptxGenerateInput = {
      title: 'Notes Test',
      slides: [
        { layout: 'title', title: 'Slide with Notes', notes: 'These are speaker notes' },
      ],
    }

    const result = await generatePptx(input)
    expect(result.slideCount).toBe(1)
  })

  it('uses custom output filename', async () => {
    const input: PptxGenerateInput = {
      title: 'Custom Name',
      slides: [{ layout: 'title', title: 'Test' }],
      outputFileName: 'my-presentation.pptx',
    }

    const result = await generatePptx(input)
    expect(result.artifact.fileName).toBe('my-presentation.pptx')
  })

  it('appends .pptx extension if missing', async () => {
    const input: PptxGenerateInput = {
      title: 'No Extension',
      slides: [{ layout: 'title', title: 'Test' }],
      outputFileName: 'my-presentation',
    }

    const result = await generatePptx(input)
    expect(result.artifact.fileName).toBe('my-presentation.pptx')
  })

  it('rejects parent traversal output filename before writing outside workspace', async () => {
    const escapedName = `pptx-escape-${Date.now()}`
    const escapedPath = path.join(os.tmpdir(), `${escapedName}.pptx`)
    await fs.rm(escapedPath, { force: true })

    const input: PptxGenerateInput = {
      title: 'Traversal Test',
      slides: [{ layout: 'title', title: 'Test' }],
      outputFileName: `../${escapedName}`,
    }

    try {
      await expect(generatePptx(input)).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'path_traversal',
      )
      await expect(fs.access(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(escapedPath, { force: true })
    }
  })

  it('rejects absolute output filename before writing outside workspace', async () => {
    const escapedName = `pptx-absolute-${Date.now()}.pptx`
    const escapedPath = path.join(os.tmpdir(), escapedName)
    await fs.rm(escapedPath, { force: true })

    const input: PptxGenerateInput = {
      title: 'Absolute Path Test',
      slides: [{ layout: 'title', title: 'Test' }],
      outputFileName: escapedPath,
    }

    try {
      await expect(generatePptx(input)).rejects.toSatisfy(
        (err: SandboxErrorResponse) => err.error.code === 'absolute_path_rejected',
      )
      await expect(fs.access(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(escapedPath, { force: true })
    }
  })

  it('accepts empty slides array (validation at MCP tool level)', async () => {
    const input = {
      title: 'Empty',
      slides: [],
    }

    const result = await generatePptx(input as PptxGenerateInput)
    expect(result.slideCount).toBe(0)
  })

  it('accepts missing title (validation at MCP tool level)', async () => {
    const input = {
      slides: [{ layout: 'title' }],
    }

    const result = await generatePptx(input as unknown as PptxGenerateInput)
    expect(result.slideCount).toBe(1)
  })

  it('falls back to blank for invalid layout with warning', async () => {
    const input = {
      title: 'Invalid Layout',
      slides: [{ layout: 'invalidLayout' }],
    }

    const result = await generatePptx(input as unknown as PptxGenerateInput)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('Unsupported layout')
  })

  it('warns on unsupported layout fallback', async () => {
    const input: PptxGenerateInput = {
      title: 'Warning Test',
      slides: [
        { layout: 'title', title: 'Test' },
      ],
    }

    const result = await generatePptx(input)
    expect(result.warnings).toEqual([])
  })
})
