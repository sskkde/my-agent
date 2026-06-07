import type { Importance, MemoryType } from '../storage/long-term-memory-store.js'
import type { ExtractedMemoryCandidate, AllowedLongTermMemoryType } from './long-term-memory-extraction.js'
import { AUTO_EXTRACTED_MEMORY_TYPES, VALID_IMPORTANCE, MIN_CONFIDENCE } from './long-term-memory-extraction.js'

export type MemoryWriteOrigin = 'auto_extraction' | 'explicit_user_save' | 'system_import' | 'manual_admin'

export type MemoryCandidateValidationResult = {
  valid: boolean
  errors: string[]
}

const STORAGE_MEMORY_TYPES: MemoryType[] = [
  'user_profile',
  'user_preference',
  'user_safety_rule',
  'relationship',
  'project_state',
  'routine',
  'workflow_preference',
  'durable_fact',
  'episodic_summary',
  'long_term_fact',
]

const SECRET_PATTERNS = [
  /\bpassword\s*[:=]/i,
  /\b(passphrase|private\s+key)\b/i,
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret[_-]?key)\s*[:=]/i,
  /-----BEGIN\s+(RSA\s+|OPENSSH\s+|EC\s+)?PRIVATE KEY-----/i,
  /\b(sk|pk)_(live|test)_[A-Za-z0-9]{12,}\b/,
]

function getAllowedTypesForOrigin(origin: MemoryWriteOrigin): readonly string[] {
  if (origin === 'auto_extraction') {
    return AUTO_EXTRACTED_MEMORY_TYPES
  }
  return STORAGE_MEMORY_TYPES
}

function containsSecretLikeContent(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Validates a memory candidate against type rules based on write origin.
 * Auto-extraction is restricted to the 5 allowed types.
 * Other origins (explicit_user_save, system_import, manual_admin) can use all storage-level types.
 */
export function validateMemoryCandidate(
  candidate: ExtractedMemoryCandidate,
  options?: { origin?: MemoryWriteOrigin },
): MemoryCandidateValidationResult {
  const origin: MemoryWriteOrigin = options?.origin ?? 'auto_extraction'
  const allowedTypes = getAllowedTypesForOrigin(origin)
  const errors: string[] = []

  if (!allowedTypes.includes(candidate.memoryType as AllowedLongTermMemoryType)) {
    errors.push(`unsupported_memory_type:${candidate.memoryType}`)
  }

  if (candidate.confidence < MIN_CONFIDENCE || candidate.confidence > 1.0) {
    errors.push(`confidence_out_of_range:${candidate.confidence}`)
  }

  if (!candidate.keywords || candidate.keywords.length === 0) {
    errors.push('keywords_empty')
  } else if (candidate.keywords.length > 12) {
    errors.push(`keywords_too_many:${candidate.keywords.length}`)
  } else if (candidate.keywords.some((k) => k === '')) {
    errors.push('keywords_contain_empty_string')
  }

  if (!candidate.sourceRefs.transcriptRefs || candidate.sourceRefs.transcriptRefs.length === 0) {
    errors.push('missing_transcript_refs')
  }

  if (candidate.sensitivity === 'restricted') {
    errors.push('restricted_sensitivity')
  }

  if (containsSecretLikeContent(candidate.text)) {
    errors.push('secret_like_content')
  }

  if (!VALID_IMPORTANCE.includes(candidate.importance as Importance)) {
    errors.push(`invalid_importance:${candidate.importance}`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
