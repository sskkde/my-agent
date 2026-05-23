/**
 * Template Hash - SHA-256 hash utilities for template content.
 *
 * Provides stable hashing for template content to enable:
 * - Cache key generation
 * - Content deduplication
 * - Change detection
 *
 * @module prompt/template-hash
 */

import { createHash } from 'node:crypto';

/**
 * Normalizes template content for consistent hashing.
 *
 * @param content - The raw template content
 * @returns Normalized content suitable for hashing
 */
export function normalizeContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Computes SHA-256 hash of template content.
 *
 * Content is normalized before hashing so whitespace
 * differences don't affect the hash.
 *
 * @param content - The template content to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export function computeTemplateHash(content: string): string {
  const normalized = normalizeContent(content);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Computes a stable hash from multiple content segments.
 *
 * Useful for generating cache keys from multiple template layers.
 *
 * @param segments - Array of content segments to hash together
 * @returns Hex-encoded SHA-256 hash string
 */
export function computeStableHash(segments: string[]): string {
  const SEGMENT_DELIMITER = '\n\n---TEMPLATE_SEGMENT---\n\n';
  const combined = segments.join(SEGMENT_DELIMITER);
  return computeTemplateHash(combined);
}

/**
 * Computes a short hash (first 16 characters) for display purposes.
 *
 * Use for shorter identifiers with reasonable uniqueness.
 * For cache keys, use the full hash.
 *
 * @param content - The template content to hash
 * @returns First 16 characters of SHA-256 hash
 */
export function computeShortHash(content: string): string {
  return computeTemplateHash(content).slice(0, 16);
}

/**
 * Computes a short stable hash from multiple segments.
 *
 * @param segments - Array of content segments to hash together
 * @returns First 16 characters of SHA-256 hash
 */
export function computeShortStableHash(segments: string[]): string {
  return computeStableHash(segments).slice(0, 16);
}
