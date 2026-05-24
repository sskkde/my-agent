import type { Importance } from '../storage/long-term-memory-store.js';
import type { ExtractedMemoryCandidate, AllowedLongTermMemoryType } from './long-term-memory-extraction.js';
import { P0_MEMORY_TYPES, VALID_IMPORTANCE, MIN_CONFIDENCE } from './long-term-memory-extraction.js';

export type MemoryCandidateValidationResult = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates a memory candidate against P0 rules.
 * Single source of truth for basic memory candidate validation.
 */
export function validateMemoryCandidate(candidate: ExtractedMemoryCandidate): MemoryCandidateValidationResult {
  const errors: string[] = [];

  if (!P0_MEMORY_TYPES.includes(candidate.memoryType as AllowedLongTermMemoryType)) {
    errors.push(`unsupported_memory_type:${candidate.memoryType}`);
  }

  if (candidate.confidence < MIN_CONFIDENCE || candidate.confidence > 1.0) {
    errors.push(`confidence_out_of_range:${candidate.confidence}`);
  }

  if (!candidate.keywords || candidate.keywords.length === 0) {
    errors.push('keywords_empty');
  } else if (candidate.keywords.length > 12) {
    errors.push(`keywords_too_many:${candidate.keywords.length}`);
  } else if (candidate.keywords.some(k => k === '')) {
    errors.push('keywords_contain_empty_string');
  }

  if (!candidate.sourceRefs.transcriptRefs || candidate.sourceRefs.transcriptRefs.length === 0) {
    errors.push('missing_transcript_refs');
  }

  if (candidate.sensitivity === 'restricted') {
    errors.push('restricted_sensitivity');
  }

  if (!VALID_IMPORTANCE.includes(candidate.importance as Importance)) {
    errors.push(`invalid_importance:${candidate.importance}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
