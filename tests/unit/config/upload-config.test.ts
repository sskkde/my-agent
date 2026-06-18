/**
 * Upload configuration tests.
 *
 * Covers default values, env overrides, and invalid-env fallback behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getUploadConfig, resetUploadConfigCache } from '../../../src/config/upload-config.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'UPLOAD_DIR',
  'UPLOAD_MAX_FILE_SIZE_BYTES',
  'UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE',
  'UPLOAD_ALLOWED_MIME_TYPES',
  'UPLOAD_ALLOWED_EXTENSIONS',
  'UPLOAD_PER_SESSION_QUOTA_BYTES',
  'UPLOAD_PREVIEW_MAX_BYTES',
] as const

function clearUploadEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Upload Configuration', () => {
  beforeEach(() => {
    clearUploadEnv()
    resetUploadConfigCache()
  })

  afterEach(() => {
    clearUploadEnv()
    resetUploadConfigCache()
  })

  // =========================================================================
  // Default values
  // =========================================================================

  describe('Default values', () => {
    it('should return default uploadDir when no env set', () => {
      const config = getUploadConfig()
      expect(config.uploadDir).toBe('./data/uploads')
    })

    it('should return default maxFileSizeBytes (10 MiB)', () => {
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should return default maxAttachmentsPerMessage (5)', () => {
      const config = getUploadConfig()
      expect(config.maxAttachmentsPerMessage).toBe(5)
    })

    it('should return default allowedMimeTypes', () => {
      const config = getUploadConfig()
      expect(config.allowedMimeTypes).toContain('text/plain')
      expect(config.allowedMimeTypes).toContain('application/json')
      expect(config.allowedMimeTypes).toContain('image/png')
      expect(config.allowedMimeTypes).toContain('application/pdf')
      expect(config.allowedMimeTypes).toHaveLength(9)
    })

    it('should return default allowedExtensions', () => {
      const config = getUploadConfig()
      expect(config.allowedExtensions).toContain('.txt')
      expect(config.allowedExtensions).toContain('.json')
      expect(config.allowedExtensions).toContain('.png')
      expect(config.allowedExtensions).toContain('.pdf')
      expect(config.allowedExtensions).toHaveLength(10)
    })

    it('should return default perSessionQuotaBytes (100 MiB)', () => {
      const config = getUploadConfig()
      expect(config.perSessionQuotaBytes).toBe(100 * 1024 * 1024)
    })

    it('should return default previewMaxBytes (4096)', () => {
      const config = getUploadConfig()
      expect(config.previewMaxBytes).toBe(4096)
    })
  })

  // =========================================================================
  // Env overrides
  // =========================================================================

  describe('Environment variable overrides', () => {
    it('should use UPLOAD_DIR from env', () => {
      process.env.UPLOAD_DIR = '/custom/uploads'
      const config = getUploadConfig()
      expect(config.uploadDir).toBe('/custom/uploads')
    })

    it('should use UPLOAD_MAX_FILE_SIZE_BYTES from env', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '5242880'
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(5242880)
    })

    it('should use UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE from env', () => {
      process.env.UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE = '10'
      const config = getUploadConfig()
      expect(config.maxAttachmentsPerMessage).toBe(10)
    })

    it('should use UPLOAD_ALLOWED_MIME_TYPES from env', () => {
      process.env.UPLOAD_ALLOWED_MIME_TYPES = 'text/plain,image/png'
      const config = getUploadConfig()
      expect(config.allowedMimeTypes).toEqual(['text/plain', 'image/png'])
    })

    it('should use UPLOAD_ALLOWED_EXTENSIONS from env', () => {
      process.env.UPLOAD_ALLOWED_EXTENSIONS = '.txt,.png'
      const config = getUploadConfig()
      expect(config.allowedExtensions).toEqual(['.txt', '.png'])
    })

    it('should use UPLOAD_PER_SESSION_QUOTA_BYTES from env', () => {
      process.env.UPLOAD_PER_SESSION_QUOTA_BYTES = '52428800'
      const config = getUploadConfig()
      expect(config.perSessionQuotaBytes).toBe(52428800)
    })

    it('should use UPLOAD_PREVIEW_MAX_BYTES from env', () => {
      process.env.UPLOAD_PREVIEW_MAX_BYTES = '8192'
      const config = getUploadConfig()
      expect(config.previewMaxBytes).toBe(8192)
    })
  })

  // =========================================================================
  // Invalid env fallback
  // =========================================================================

  describe('Invalid numeric env var fallback', () => {
    it('should fall back to default for non-numeric UPLOAD_MAX_FILE_SIZE_BYTES', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = 'abc'
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should fall back to default for negative UPLOAD_MAX_FILE_SIZE_BYTES', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '-100'
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should fall back to default for zero UPLOAD_MAX_FILE_SIZE_BYTES', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '0'
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should fall back to default for float UPLOAD_MAX_FILE_SIZE_BYTES', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '1.5'
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should fall back to default for empty UPLOAD_MAX_FILE_SIZE_BYTES', () => {
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES = ''
      const config = getUploadConfig()
      expect(config.maxFileSizeBytes).toBe(10 * 1024 * 1024)
    })

    it('should fall back to default for non-numeric UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE', () => {
      process.env.UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE = 'many'
      const config = getUploadConfig()
      expect(config.maxAttachmentsPerMessage).toBe(5)
    })

    it('should fall back to default for non-numeric UPLOAD_PER_SESSION_QUOTA_BYTES', () => {
      process.env.UPLOAD_PER_SESSION_QUOTA_BYTES = 'unlimited'
      const config = getUploadConfig()
      expect(config.perSessionQuotaBytes).toBe(100 * 1024 * 1024)
    })

    it('should fall back to default for non-numeric UPLOAD_PREVIEW_MAX_BYTES', () => {
      process.env.UPLOAD_PREVIEW_MAX_BYTES = 'big'
      const config = getUploadConfig()
      expect(config.previewMaxBytes).toBe(4096)
    })
  })

  // =========================================================================
  // Invalid MIME type handling
  // =========================================================================

  describe('Invalid MIME type handling', () => {
    it('should fall back to defaults for empty UPLOAD_ALLOWED_MIME_TYPES', () => {
      process.env.UPLOAD_ALLOWED_MIME_TYPES = ''
      const config = getUploadConfig()
      expect(config.allowedMimeTypes).toEqual([
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/pdf',
      ])
    })

    it('should fall back to defaults for whitespace-only UPLOAD_ALLOWED_MIME_TYPES', () => {
      process.env.UPLOAD_ALLOWED_MIME_TYPES = '  ,  ,  '
      const config = getUploadConfig()
      expect(config.allowedMimeTypes).toEqual([
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
        'application/pdf',
      ])
    })

    it('should parse single MIME type from env', () => {
      process.env.UPLOAD_ALLOWED_MIME_TYPES = 'text/plain'
      const config = getUploadConfig()
      expect(config.allowedMimeTypes).toEqual(['text/plain'])
    })
  })

  // =========================================================================
  // Caching
  // =========================================================================

  describe('Config caching', () => {
    it('should return the same config object on subsequent calls', () => {
      const config1 = getUploadConfig()
      const config2 = getUploadConfig()
      expect(config1).toBe(config2)
    })

    it('should return fresh config after cache reset', () => {
      const config1 = getUploadConfig()
      resetUploadConfigCache()
      const config2 = getUploadConfig()
      expect(config1).not.toBe(config2)
      expect(config1).toEqual(config2)
    })
  })
})
