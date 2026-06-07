/**
 * Tool Plane Projection Renderer - Render tool projections for ModelInputBuilder Layer 6.
 *
 * Converts ToolPlaneProjection to textual representation for the LLM prompt.
 *
 * @module kernel/model-input/tool-plane-projection-renderer
 */

import type { ToolPlaneProjection } from './model-input-types.js'
import type { ToolDefinition } from '../../llm/types.js'

export interface RenderToolPlaneOptions {
  includeSummaries?: boolean
  includeSchemas?: boolean
}

export function renderToolPlane(
  toolProjection: ToolPlaneProjection,
  mode: 'routing_json' | 'function_calling' | 'structured_json' = 'function_calling',
  options: RenderToolPlaneOptions = {},
): string {
  if (toolProjection.toolIds.length === 0) {
    return ''
  }

  const { includeSummaries = true, includeSchemas = false } = options

  const parts: string[] = []

  parts.push(`Available Tool IDs: ${toolProjection.toolIds.join(', ')}`)

  if (mode === 'routing_json' && includeSummaries && toolProjection.toolSummaries) {
    parts.push(toolProjection.toolSummaries)
  }

  if (mode === 'function_calling' && includeSchemas && toolProjection.tools) {
    const schemaParts = renderToolSchemas(toolProjection.tools)
    if (schemaParts) {
      parts.push(schemaParts)
    }
  }

  return parts.join('\n\n')
}

function renderToolSchemas(tools: ToolDefinition[]): string {
  const parts: string[] = []

  for (const tool of tools) {
    const schemaStr = renderSingleToolSchema(tool)
    parts.push(schemaStr)
  }

  return parts.join('\n\n')
}

function renderSingleToolSchema(tool: ToolDefinition): string {
  const lines: string[] = []

  lines.push(`Tool: ${tool.function.name}`)
  lines.push(`Description: ${tool.function.description}`)

  if (tool.function.parameters) {
    lines.push('Parameters:')
    const paramsJson = JSON.stringify(tool.function.parameters, null, 2)
    lines.push(paramsJson)
  }

  return lines.join('\n')
}

export function renderRoutingToolPlane(projection: ToolPlaneProjection): string {
  return renderToolPlane(projection, 'routing_json', { includeSummaries: true })
}

export function renderExecutionToolPlane(projection: ToolPlaneProjection): string {
  return renderToolPlane(projection, 'function_calling', { includeSchemas: true })
}

export function renderMinimalToolPlane(projection: ToolPlaneProjection): string {
  if (projection.toolIds.length === 0) {
    return ''
  }
  return `Available Tool IDs: ${projection.toolIds.join(', ')}`
}
