/**
 * Model Input Cache Key - Cache key computation from segment hashes.
 *
 * The cache key is derived from Segments A+B+C (the "prefix" portion).
 * Segment D is always dynamic and never part of the cache key.
 *
 * @module kernel/model-input/model-input-cache-key
 */

import { createHash } from 'node:crypto';

export function computeCacheKey(
  segmentAHash: string,
  segmentBHash: string,
  segmentCHash: string
): string {
  const combined = `${segmentAHash}|${segmentBHash}|${segmentCHash}`;
  return createHash('sha256').update(combined, 'utf8').digest('hex');
}
