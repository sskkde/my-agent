/**
 * Attachment upload/download guardrails for the AgentlyMail connector.
 *
 * Validates relative attachment paths and output directories before they
 * reach the CLI subprocess.  Rejects absolute paths, `..` traversal, and
 * empty inputs.  Determines the download strategy (CLI vs. opaque URL)
 * based on whether the attachment is ordinary or oversized.
 *
 * Derived from: .omo/drafts/agently-mail-upstream-evidence.md
 */

import * as path from 'node:path'
import type { AgentlyMailAttachment } from './types.js'

// ─── Path validation ──────────────────────────────────────────────────────────

export interface PathValidationResult {
  readonly valid: boolean
  readonly error?: string
}

/**
 * Validates a relative attachment path (used for `--attachment` arguments).
 *
 * Rejects:
 * - Empty or whitespace-only strings
 * - Absolute paths (`/etc/passwd`, `C:\secret`)
 * - `..` traversal segments (`../secret`, `subdir/../../etc/passwd`)
 *
 * Accepts:
 * - `file.pdf`
 * - `./file.pdf`
 * - `subdir/file.pdf`
 */
export function validateAttachmentPath(filePath: string): PathValidationResult {
  const trimmed = filePath.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Attachment path must not be empty' }
  }

  if (path.isAbsolute(trimmed)) {
    return { valid: false, error: `Absolute paths are not allowed: ${trimmed}` }
  }

  const normalized = path.normalize(trimmed)
  const segments = normalized.split(path.sep)
  if (segments.includes('..')) {
    return { valid: false, error: `Path traversal detected: ${trimmed}` }
  }

  return { valid: true }
}

/**
 * Validates a download output directory (used for `--output` argument).
 *
 * Same rules as {@link validateAttachmentPath} — must be a relative path
 * without traversal.
 */
export function validateDownloadOutputDir(dir: string): PathValidationResult {
  const trimmed = dir.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Output directory must not be empty' }
  }

  if (path.isAbsolute(trimmed)) {
    return { valid: false, error: `Absolute paths are not allowed: ${trimmed}` }
  }

  const normalized = path.normalize(trimmed)
  const segments = normalized.split(path.sep)
  if (segments.includes('..')) {
    return { valid: false, error: `Path traversal detected: ${dir}` }
  }

  return { valid: true }
}

// ─── Attachment download strategy ─────────────────────────────────────────────

/**
 * An oversized attachment has no `attachment_id` and carries a `download_url`
 * that the caller must present to the user as-is — never fetched.
 */
export function isOversizedAttachment(attachment: AgentlyMailAttachment): boolean {
  return attachment.attachment_id === null && attachment.download_url !== null
}

export type DownloadStrategy =
  | { readonly type: 'cli'; readonly value: string }
  | { readonly type: 'url'; readonly value: string }

/**
 * Determines how to handle an attachment download.
 *
 * - **Ordinary** (has `attachment_id`): download via CLI
 *   `agently-cli attachment +download --msg <msg> --att <att_id> --output <dir>`
 * - **Oversized** (has `download_url`, no `attachment_id`): return the opaque
 *   URL to the user without fetching.
 */
export function getAttachmentDownloadStrategy(
  attachment: AgentlyMailAttachment,
): DownloadStrategy {
  if (isOversizedAttachment(attachment)) {
    return { type: 'url', value: attachment.download_url! }
  }
  return { type: 'cli', value: attachment.attachment_id! }
}
