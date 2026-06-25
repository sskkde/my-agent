/**
 * PPTX Integration Tests
 *
 * Covers:
 * - File registry: register, resolve, clear
 * - Integration: generate then read
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  generatePptx,
  readPptx,
  registerFile,
  resolveFileId,
  clearFileRegistry,
  type PptxGenerateInput,
} from './pptx.js'

describe('pptx integration', () => {
  beforeEach(() => {
    clearFileRegistry()
  })

  describe('file registry', () => {
    it('registers and resolves file IDs', () => {
      const fileId = 'test-id-123'
      const filePath = '/tmp/test.pptx'

      registerFile(fileId, filePath)
      expect(resolveFileId(fileId)).toBe(filePath)
    })

    it('returns undefined for unknown file IDs', () => {
      expect(resolveFileId('unknown')).toBeUndefined()
    })

    it('clears registry', () => {
      registerFile('id1', '/tmp/file1.pptx')
      registerFile('id2', '/tmp/file2.pptx')

      clearFileRegistry()

      expect(resolveFileId('id1')).toBeUndefined()
      expect(resolveFileId('id2')).toBeUndefined()
    })
  })

  describe('generate then read', () => {
    it('generates and reads back a complete presentation', async () => {
      const genInput: PptxGenerateInput = {
        title: 'Integration Test Presentation',
        slides: [
          {
            layout: 'title',
            title: 'Welcome to the Integration Test',
            subtitle: 'Verifying generate → read flow',
          },
          {
            layout: 'titleAndContent',
            title: 'Key Points',
            content: [
              'First important point',
              'Second important point',
              'Third important point',
            ],
            notes: 'Remember to elaborate on each point',
          },
          {
            layout: 'twoColumn',
            title: 'Comparison',
            leftContent: ['Pros: Fast', 'Pros: Reliable'],
            rightContent: ['Cons: None', 'Cons: Also None'],
          },
          {
            layout: 'sectionHeader',
            title: 'Next Section',
            subtitle: 'Coming up...',
          },
          {
            layout: 'blank',
          },
        ],
      }

      const genResult = await generatePptx(genInput)

      expect(genResult.slideCount).toBe(5)
      expect(genResult.artifact.fileId).toBeDefined()
      expect(genResult.artifact.sizeBytes).toBeGreaterThan(0)

      const readResult = await readPptx(genResult.artifact.fileId, { includeNotes: true })

      expect(readResult.totalSlides).toBe(5)
      expect(readResult.slides).toHaveLength(5)

      expect(readResult.slides[0].content.length).toBeGreaterThan(0)
      expect(readResult.slides[1].content.length).toBeGreaterThan(0)

      for (const slide of readResult.slides) {
        expect(slide.slideNumber).toBeGreaterThanOrEqual(1)
        expect(slide.slideNumber).toBeLessThanOrEqual(5)
        expect(Array.isArray(slide.content)).toBe(true)
      }
    })

    it('generates with custom filename and reads back', async () => {
      const genInput: PptxGenerateInput = {
        title: 'Custom Filename Test',
        slides: [
          { layout: 'title', title: 'Test' },
        ],
        outputFileName: 'custom-report.pptx',
      }

      const genResult = await generatePptx(genInput)
      expect(genResult.artifact.fileName).toBe('custom-report.pptx')

      const readResult = await readPptx(genResult.artifact.fileId)
      expect(readResult.totalSlides).toBe(1)
    })
  })
})
