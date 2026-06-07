/**
 * Tenant-Project Instruction Renderer - Formats InstructionProjection into Segment B string.
 * @module kernel/model-input/tenant-project-instruction-renderer
 */

import type { InstructionProjection } from '../../instructions/instruction-types.js'

/**
 * Renders instruction blocks into a single string for Layer 5 (Segment B).
 *
 * Format: Each block is formatted as `[Source: {source}]\n{content}\n`
 * Empty blocks array returns empty string.
 */
export function renderInstructions(projection: InstructionProjection): string {
  if (projection.blocks.length === 0) {
    return ''
  }

  const parts: string[] = []

  for (const block of projection.blocks) {
    parts.push(`[Source: ${block.source}]`)
    parts.push(block.content)
  }

  return parts.join('\n')
}
