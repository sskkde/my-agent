import { describe, it, expect, beforeEach } from 'vitest'

import {
  createUploadPreviewExtractor,
  type UploadPreviewExtractor,
} from '../../../src/storage/upload-preview.js'
import { resetUploadConfigCache } from '../../../src/config/upload-config.js'

describe('UploadPreviewExtractor', () => {
  let extractor: UploadPreviewExtractor

  beforeEach(() => {
    resetUploadConfigCache()
    extractor = createUploadPreviewExtractor()
  })

  // ── text/plain ─────────────────────────────────────────────────────────

  describe('text/plain', () => {
    it('extracts preview from plain text buffer', () => {
      const buffer = Buffer.from('Hello, world!')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('Hello, world!')
      expect(result.previewStatus).toBe('generated')
    })

    it('normalizes CRLF line endings to LF', () => {
      const buffer = Buffer.from('line1\r\nline2\r\nline3')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('line1\nline2\nline3')
    })

    it('normalizes bare CR line endings to LF', () => {
      const buffer = Buffer.from('line1\rline2\rline3')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('line1\nline2\nline3')
    })

    it('trims trailing whitespace per line', () => {
      const buffer = Buffer.from('hello   \nworld   ')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('hello\nworld')
    })

    it('trims trailing blank lines', () => {
      const buffer = Buffer.from('content\n\n\n')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('content')
    })
  })

  // ── application/json ───────────────────────────────────────────────────

  describe('application/json', () => {
    it('extracts preview from JSON buffer', () => {
      const json = JSON.stringify({ name: 'test', value: 42 }, null, 2)
      const buffer = Buffer.from(json)

      const result = extractor.extract(buffer, 'application/json')

      expect(result.previewText).toBe(json)
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── text/markdown ──────────────────────────────────────────────────────

  describe('text/markdown', () => {
    it('extracts preview from markdown buffer', () => {
      const md = '# Title\n\nSome **bold** text.'
      const buffer = Buffer.from(md)

      const result = extractor.extract(buffer, 'text/markdown')

      expect(result.previewText).toBe(md)
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── text/csv ───────────────────────────────────────────────────────────

  describe('text/csv', () => {
    it('extracts preview from CSV buffer', () => {
      const csv = 'name,age\nAlice,30\nBob,25'
      const buffer = Buffer.from(csv)

      const result = extractor.extract(buffer, 'text/csv')

      expect(result.previewText).toBe(csv)
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── binary/image/PDF skipping ──────────────────────────────────────────

  describe('binary/image/PDF skipping', () => {
    it('skips image/png', () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG header

      const result = extractor.extract(buffer, 'image/png')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips image/jpeg', () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff]) // JPEG header

      const result = extractor.extract(buffer, 'image/jpeg')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips image/gif', () => {
      const buffer = Buffer.from('GIF89a')

      const result = extractor.extract(buffer, 'image/gif')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips image/webp', () => {
      const buffer = Buffer.from('RIFF')

      const result = extractor.extract(buffer, 'image/webp')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips application/pdf', () => {
      const buffer = Buffer.from('%PDF-1.4')

      const result = extractor.extract(buffer, 'application/pdf')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })
  })

  // ── unknown MIME types ─────────────────────────────────────────────────

  describe('unknown MIME types', () => {
    it('skips application/octet-stream', () => {
      const buffer = Buffer.from([0x00, 0x01, 0x02])

      const result = extractor.extract(buffer, 'application/octet-stream')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips application/x-executable', () => {
      const buffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46]) // ELF header

      const result = extractor.extract(buffer, 'application/x-executable')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips video/mp4', () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x1c])

      const result = extractor.extract(buffer, 'video/mp4')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })

    it('skips audio/mpeg', () => {
      const buffer = Buffer.from([0xff, 0xfb])

      const result = extractor.extract(buffer, 'audio/mpeg')

      expect(result.previewText).toBeUndefined()
      expect(result.previewStatus).toBe('skipped')
    })
  })

  // ── empty file ─────────────────────────────────────────────────────────

  describe('empty text file', () => {
    it('returns empty string preview for empty text buffer', () => {
      const buffer = Buffer.alloc(0)

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('')
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── oversized text truncation ──────────────────────────────────────────

  describe('oversized text truncation', () => {
    it('truncates text at maxBytes (default from config)', () => {
      // Default is 4096; create a 5000-byte text
      const longText = 'A'.repeat(5000)
      const buffer = Buffer.from(longText)

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toHaveLength(4096)
      expect(result.previewStatus).toBe('generated')
    })

    it('truncates text at custom maxBytes', () => {
      const text = 'Hello, this is a longer text that should be truncated.'
      const buffer = Buffer.from(text)

      const result = extractor.extract(buffer, 'text/plain', 10)

      expect(result.previewText).toBe('Hello, thi')
      expect(result.previewStatus).toBe('generated')
    })

    it('does not truncate when text is shorter than maxBytes', () => {
      const text = 'short'
      const buffer = Buffer.from(text)

      const result = extractor.extract(buffer, 'text/plain', 100)

      expect(result.previewText).toBe('short')
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── invalid UTF-8 handling ─────────────────────────────────────────────

  describe('invalid UTF-8 handling', () => {
    it('replaces invalid UTF-8 sequences with replacement character', () => {
      // 0xFF is never valid in UTF-8
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xff, 0x21])

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('Hello\ufffd!')
      expect(result.previewStatus).toBe('generated')
    })

    it('handles truncated multi-byte sequence safely', () => {
      // 0xC0 starts a 2-byte sequence but is followed by invalid continuation
      const buffer = Buffer.from([0x48, 0x69, 0xc0])

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewText).toBe('Hi\ufffd')
      expect(result.previewStatus).toBe('generated')
    })
  })

  // ── preview status correctness ─────────────────────────────────────────

  describe('preview status', () => {
    it('returns generated for valid text files', () => {
      const buffer = Buffer.from('valid text')

      const result = extractor.extract(buffer, 'text/plain')

      expect(result.previewStatus).toBe('generated')
    })

    it('returns skipped for binary MIME types', () => {
      const buffer = Buffer.from([0x00])

      const result = extractor.extract(buffer, 'image/png')

      expect(result.previewStatus).toBe('skipped')
    })

    it('returns skipped for unknown MIME types', () => {
      const buffer = Buffer.from([0x00])

      const result = extractor.extract(buffer, 'application/unknown')

      expect(result.previewStatus).toBe('skipped')
    })
  })
})
