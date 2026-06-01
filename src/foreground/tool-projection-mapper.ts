/**
 * Tool Projection Mapper - Maps suggested tool names to ToolPlaneProjection.
 *
 * Provides a pure function for filtering suggested tools against a tool catalog
 * and creating a ToolPlaneProjection for the model input builder.
 *
 * @module foreground/tool-projection-mapper
 */

import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js';

/**
 * Maps suggested tool names to a ToolPlaneProjection.
 *
 * This is a pure function that filters suggested tools against a known tool catalog,
 * returning only the tools that exist in the catalog. If either input is empty,
 * returns an empty projection.
 *
 * @param suggestedTools - Array of tool names suggested by the router
 * @param toolCatalog - Array of valid tool names from the catalog
 * @returns ToolPlaneProjection with filtered toolIds
 *
 * @example
 * ```typescript
 * const suggested = ['file_read', 'web_search', 'unknown.tool'];
 * const catalog = ['file_read', 'web_search', 'memory_retrieve'];
 * const projection = mapSuggestedToolsToProjection(suggested, catalog);
 * // projection.toolIds = ['file_read', 'web_search']
 * ```
 */
export function mapSuggestedToolsToProjection(
  suggestedTools: string[],
  toolCatalog: string[]
): ToolPlaneProjection {
  if (suggestedTools.length === 0 || toolCatalog.length === 0) {
    return { toolIds: [] };
  }

  const filteredToolIds = suggestedTools.filter((toolId) => toolCatalog.includes(toolId));

  return { toolIds: filteredToolIds };
}
