/**
 * Tests for attachment upload/download guardrails.
 *
 * Covers:
 * - Path validation (absolute, traversal, empty, safe relative)
 * - Download strategy (ordinary vs. oversized attachments)
 */

import { describe, it, expect } from 'vitest'
import {
  validateAttachmentPath,
  validateDownloadOutputDir,
  isOversizedAttachment,
  getAttachmentDownloadStrategy,
} from '../../../../src/connectors/agently-mail/attachment-policy.js'
import type { AgentlyMailAttachment } from '../../../../src/connectors/agently-mail/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAttachment(
  overrides: Partial<AgentlyMailAttachment> = {},
): AgentlyMailAttachment {
  return {
    untrusted: true,
    attachment_id: 'att_abc123' as AgentlyMailAttachment['attachment_id'],
    filename: 'report.pdf',
    mime_type: 'application/pdf',
    size: 1024,
    download_url: null,
    ...overrides,
  }
}

// ─── validateAttachmentPath ───────────────────────────────────────────────────

describe('validateAttachmentPath', () => {
  it('Given a simple filename, When validated, Then it is accepted', () => {
    const result = validateAttachmentPath('file.pdf')
    expect(result).toEqual({ valid: true })
  })

  it('Given a relative path with ./, When validated, Then it is accepted', () => {
    const result = validateAttachmentPath('./file.pdf')
    expect(result).toEqual({ valid: true })
  })

  it('Given a relative subdirectory path, When validated, Then it is accepted', () => {
    const result = validateAttachmentPath('subdir/file.pdf')
    expect(result).toEqual({ valid: true })
  })

  it('Given an absolute path, When validated, Then it is rejected', () => {
    const result = validateAttachmentPath('/etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Absolute paths are not allowed')
  })

  it('Given a path with .. traversal, When validated, Then it is rejected', () => {
    const result = validateAttachmentPath('../secret')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Path traversal detected')
  })

  it('Given a path with nested .. traversal, When validated, Then it is rejected', () => {
    const result = validateAttachmentPath('subdir/../../etc/passwd')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Path traversal detected')
  })

  it('Given an empty string, When validated, Then it is rejected', () => {
    const result = validateAttachmentPath('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('must not be empty')
  })

  it('Given a whitespace-only string, When validated, Then it is rejected', () => {
    const result = validateAttachmentPath('   ')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('must not be empty')
  })
})

// ─── validateDownloadOutputDir ────────────────────────────────────────────────

describe('validateDownloadOutputDir', () => {
  it('Given current directory ".", When validated, Then it is accepted', () => {
    const result = validateDownloadOutputDir('.')
    expect(result).toEqual({ valid: true })
  })

  it('Given a relative directory, When validated, Then it is accepted', () => {
    const result = validateDownloadOutputDir('./downloads')
    expect(result).toEqual({ valid: true })
  })

  it('Given an absolute path, When validated, Then it is rejected', () => {
    const result = validateDownloadOutputDir('/tmp/output')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Absolute paths are not allowed')
  })

  it('Given a path with .. traversal, When validated, Then it is rejected', () => {
    const result = validateDownloadOutputDir('../outside')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Path traversal detected')
  })

  it('Given an empty string, When validated, Then it is rejected', () => {
    const result = validateDownloadOutputDir('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('must not be empty')
  })
})

// ─── isOversizedAttachment ────────────────────────────────────────────────────

describe('isOversizedAttachment', () => {
  it('Given an ordinary attachment with attachment_id, When checked, Then it is not oversized', () => {
    const attachment = makeAttachment()
    expect(isOversizedAttachment(attachment)).toBe(false)
  })

  it('Given an oversized attachment with download_url and no attachment_id, When checked, Then it is oversized', () => {
    const attachment = makeAttachment({
      attachment_id: null,
      download_url: 'https://example.com/download/abc123',
    })
    expect(isOversizedAttachment(attachment)).toBe(true)
  })

  it('Given an attachment with both attachment_id and download_url, When checked, Then it is not oversized', () => {
    const attachment = makeAttachment({
      download_url: 'https://example.com/download/abc123',
    })
    expect(isOversizedAttachment(attachment)).toBe(false)
  })
})

// ─── getAttachmentDownloadStrategy ────────────────────────────────────────────

describe('getAttachmentDownloadStrategy', () => {
  it('Given an ordinary attachment, When strategy is determined, Then it returns cli with attachment_id', () => {
    const attachment = makeAttachment({
      attachment_id: 'att_xyz789' as AgentlyMailAttachment['attachment_id'],
    })
    const strategy = getAttachmentDownloadStrategy(attachment)
    expect(strategy).toEqual({ type: 'cli', value: 'att_xyz789' })
  })

  it('Given an oversized attachment, When strategy is determined, Then it returns url with download_url', () => {
    const downloadUrl = 'https://storage.example.com/big-file.zip?token=abc'
    const attachment = makeAttachment({
      attachment_id: null,
      download_url: downloadUrl,
    })
    const strategy = getAttachmentDownloadStrategy(attachment)
    expect(strategy).toEqual({ type: 'url', value: downloadUrl })
  })
})
