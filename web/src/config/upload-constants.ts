/**
 * Client-side upload constants.
 *
 * Mirrors the backend default allowlist from src/config/upload-config.ts.
 * These are hard-coded defaults for preflight validation; the server
 * remains authoritative for final acceptance.
 */

/** File extensions allowed for upload (with leading dot). */
export const CLIENT_ALLOWED_EXTENSIONS: readonly string[] = [
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
] as const

/** Comma-separated accept string for <input type="file" accept="...">. */
export const CLIENT_ACCEPT_STRING: string = CLIENT_ALLOWED_EXTENSIONS.join(',')

/** Maximum size in bytes for a single file (default: 10 MiB). */
export const CLIENT_MAX_FILE_SIZE_BYTES: number = 10 * 1024 * 1024

/** Maximum number of file attachments per message. */
export const CLIENT_MAX_ATTACHMENTS_PER_MESSAGE: number = 5

/**
 * Return the file extension (lowercased, with leading dot) from a filename.
 * Returns empty string if no extension is found.
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return filename.slice(lastDot).toLowerCase()
}

/**
 * Validate a single file against client-side constraints.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateFile(file: File): string | null {
  const ext = getFileExtension(file.name)
  if (!ext || !CLIENT_ALLOWED_EXTENSIONS.includes(ext)) {
    return `"${file.name}": unsupported file type (${ext || 'no extension'})`
  }
  if (file.size > CLIENT_MAX_FILE_SIZE_BYTES) {
    return `"${file.name}": file too large (${(file.size / (1024 * 1024)).toFixed(1)} MB, max ${CLIENT_MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB)`
  }
  return null
}
