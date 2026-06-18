/**
 * Upload configuration module.
 *
 * Reads file-upload limits from environment variables with safe defaults.
 * All numeric env vars are validated; invalid values fall back to defaults.
 */

export interface UploadConfig {
  /** Directory where uploaded file bytes are stored. Relative to cwd. */
  uploadDir: string
  /** Maximum size in bytes for a single file upload (default: 10 MiB). */
  maxFileSizeBytes: number
  /** Maximum number of file attachments per message (default: 5). */
  maxAttachmentsPerMessage: number
  /** MIME types allowed for upload. */
  allowedMimeTypes: string[]
  /** File extensions allowed for upload (including the leading dot). */
  allowedExtensions: string[]
  /** Maximum total bytes a single session may store (default: 100 MiB). */
  perSessionQuotaBytes: number
  /** Maximum bytes extracted for text previews (default: 4096). */
  previewMaxBytes: number
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_UPLOAD_DIR = './data/uploads'
const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MiB
const DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE = 5
const DEFAULT_PER_SESSION_QUOTA_BYTES = 100 * 1024 * 1024 // 100 MiB
const DEFAULT_PREVIEW_MAX_BYTES = 4096

const DEFAULT_ALLOWED_MIME_TYPES: string[] = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]

const DEFAULT_ALLOWED_EXTENSIONS: string[] = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return fallback
  }
  return parsed
}

function parseCommaSeparated(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return items.length > 0 ? items : fallback
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

let cachedConfig: UploadConfig | undefined

/**
 * Return the upload configuration, reading from env vars on first call.
 * Subsequent calls return the cached value.
 */
export function getUploadConfig(): UploadConfig {
  if (cachedConfig) {
    return cachedConfig
  }

  cachedConfig = {
    uploadDir: process.env.UPLOAD_DIR ?? DEFAULT_UPLOAD_DIR,
    maxFileSizeBytes: parsePositiveInt(process.env.UPLOAD_MAX_FILE_SIZE_BYTES, DEFAULT_MAX_FILE_SIZE_BYTES),
    maxAttachmentsPerMessage: parsePositiveInt(
      process.env.UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE,
      DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE,
    ),
    allowedMimeTypes: parseCommaSeparated(process.env.UPLOAD_ALLOWED_MIME_TYPES, DEFAULT_ALLOWED_MIME_TYPES),
    allowedExtensions: parseCommaSeparated(process.env.UPLOAD_ALLOWED_EXTENSIONS, DEFAULT_ALLOWED_EXTENSIONS),
    perSessionQuotaBytes: parsePositiveInt(process.env.UPLOAD_PER_SESSION_QUOTA_BYTES, DEFAULT_PER_SESSION_QUOTA_BYTES),
    previewMaxBytes: parsePositiveInt(process.env.UPLOAD_PREVIEW_MAX_BYTES, DEFAULT_PREVIEW_MAX_BYTES),
  }

  return cachedConfig
}

/**
 * Reset the cached config. Useful for testing.
 */
export function resetUploadConfigCache(): void {
  cachedConfig = undefined
}
