/**
 * Instruction Hash - Deterministic hash computation for instruction blocks.
 * @module instructions/instruction-hash
 */

import { createHash } from 'node:crypto'
import type { InstructionBlock } from './instruction-types.js'

/**
 * Computes a deterministic SHA-256 hash for instruction blocks with tenant isolation.
 *
 * The hash includes:
 * 1. tenantId (for tenant isolation - different tenants always produce different hashes)
 * 2. Sorted blocks by priority, then source
 * 3. Each block's source and content
 *
 * This ensures:
 * - Same blocks + same tenantId → same hash
 * - Different tenantId → different hash (even if blocks are identical)
 * - Block order doesn't affect hash (blocks are sorted)
 */
export function computeInstructionHash(blocks: InstructionBlock[], tenantId: string): string {
  const sortedBlocks = [...blocks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.source.localeCompare(b.source)
  })

  const parts: string[] = [`tenant:${tenantId}`]

  for (const block of sortedBlocks) {
    parts.push(`source:${block.source}`)
    parts.push(`content:${block.content}`)
  }

  const combined = parts.join('\n')
  return createHash('sha256').update(combined, 'utf8').digest('hex')
}
