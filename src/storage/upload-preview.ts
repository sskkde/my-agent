/**
 * Bounded text preview extraction for uploaded files.
 *
 * Extracts short text previews from text-like MIME types (text/plain,
 * text/markdown, text/csv, application/json). Binary, image, and PDF
 * files are skipped. Preview text is bounded by a configurable byte
 * limit, line endings are normalized, and trailing whitespace is trimmed.
 */

import type { FilePreviewStatus } from './file-upload-store.js'
import { getUploadConfig } from '../config/upload-config.js'

/**
 * Result of a preview extraction attempt.
 */
export interface PreviewResult {
  /** Extracted preview text, or undefined if skipped/failed. */
  previewText: string | undefined
  /** Status of the preview generation. */
  previewStatus: FilePreviewStatus
}

/**
 * Interface for extracting bounded text previews from file buffers.
 */
export interface UploadPreviewExtractor {
  /**
   * Extract a text preview from a file buffer.
   *
   * @param buffer - Raw file bytes.
   * @param mimeType - MIME type of the file.
   * @param maxBytes - Maximum bytes to extract (default from config).
   * @returns Preview text and status.
   */
  extract(buffer: Buffer, mimeType: string, maxBytes?: number): PreviewResult
}

// ── MIME type classification ────────────────────────────────────────────────

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
])

const BINARY_MIME_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf']

/**
 * Return true if the MIME type is eligible for text preview extraction.
 */
function isTextLikeMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.has(mimeType)
}

/**
 * Return true if the MIME type is a known binary type that should be skipped.
 */
function isBinaryMimeType(mimeType: string): boolean {
  return BINARY_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
}

// ── Implementation ──────────────────────────────────────────────────────────

class UploadPreviewExtractorImpl implements UploadPreviewExtractor {
  extract(buffer: Buffer, mimeType: string, maxBytes?: number): PreviewResult {
    const limit = maxBytes ?? getUploadConfig().previewMaxBytes

    // Binary/image/PDF → skip
    if (isBinaryMimeType(mimeType)) {
      return { previewText: undefined, previewStatus: 'skipped' }
    }

    // Not a recognized text type → skip
    if (!isTextLikeMimeType(mimeType)) {
      return { previewText: undefined, previewStatus: 'skipped' }
    }

    // Empty buffer → empty preview
    if (buffer.length === 0) {
      return { previewText: '', previewStatus: 'generated' }
    }

    try {
      // Slice to maxBytes boundary, decode with replacement for invalid sequences
      const slice = buffer.length > limit ? buffer.subarray(0, limit) : buffer
      const text = decodeBufferSafely(slice)

      // Normalize: CRLF → LF, trailing whitespace per line, overall trailing whitespace
      const normalized = normalizeText(text)

      return { previewText: normalized, previewStatus: 'generated' }
    } catch {
      // Any unexpected decoding/normalization failure → mark as failed
      return { previewText: undefined, previewStatus: 'failed' }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decode a buffer to a string, replacing invalid UTF-8 sequences with U+FFFD.
 */
function decodeBufferSafely(buffer: Buffer): string {
  return buffer.toString('utf-8')
}

/**
 * Normalize text: convert CRLF/CR to LF, trim trailing whitespace on each
 * line, then trim trailing blank lines at the end.
 */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an UploadPreviewExtractor.
 */
export function createUploadPreviewExtractor(): UploadPreviewExtractor {
  return new UploadPreviewExtractorImpl()
}
