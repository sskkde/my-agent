/**
 * Tool Plane Projection Renderer - Render tool projections for ModelInputBuilder Layer 6.
 *
 * Converts ToolPlaneProjection to textual representation for the LLM prompt.
 *
 * function_calling: empty prompt plane (schemas live in LLMRequest.tools only).
 * structured_json: prompt-side Available Tool IDs allowlist (no request.tools).
 *
 * @module kernel/model-input/tool-plane-projection-renderer
 */

import type { ToolPlaneProjection } from './model-input-types.js'

export interface RenderToolPlaneOptions {
  includeIds?: boolean
}

/**
 * Render the prompt-side tool plane.
 *
 * @param mode - `function_calling` returns '' (tools only in request.tools).
 *               `structured_json` returns the ID allowlist when non-empty.
 */
export function renderToolPlane(
  toolProjection: ToolPlaneProjection,
  mode: 'function_calling' | 'structured_json' = 'function_calling',
  _options: RenderToolPlaneOptions = {},
): string {
  if (mode === 'function_calling') {
    return ''
  }
  return renderStructuredJsonToolPlane(toolProjection)
}

/** @deprecated Prefer renderToolPlane(..., 'function_calling') — kept for call-site clarity. */
export function renderExecutionToolPlane(_projection: ToolPlaneProjection): string {
  return ''
}

/** Prompt-side ID allowlist for structured_json (no request.tools). */
export function renderMinimalToolPlane(projection: ToolPlaneProjection): string {
  return renderStructuredJsonToolPlane(projection)
}

function renderStructuredJsonToolPlane(projection: ToolPlaneProjection): string {
  if (projection.toolIds.length === 0) {
    return ''
  }
  return `Available Tool IDs: ${projection.toolIds.join(', ')}`
}
