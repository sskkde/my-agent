/**
 * Tool Schema Canonicalizer - Deterministic JSON serialization for tool schemas.
 *
 * Ensures stable output for the same input by:
 * - Sorting all object keys alphabetically
 * - Removing undefined values
 * - Using deterministic JSON.stringify
 *
 * @module tools/tool-schema-canonicalizer
 */

import type { ToolDefinition, ToolCategory } from './types.js';
import { createHash } from 'crypto';

type SortableToolDefinition = ToolDefinition & {
  category: ToolCategory;
};

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined) {
      sorted[key] = sortObjectKeys(value);
    }
  }

  return sorted;
}

export function canonicalizeSchema(schema: Record<string, unknown>): string {
  const sorted = sortObjectKeys(schema);
  return JSON.stringify(sorted);
}

export function canonicalizeToolDefinition(tool: ToolDefinition): string {
  const sortable: SortableToolDefinition = tool as SortableToolDefinition;
  const canonical = {
    name: sortable.name,
    description: sortable.description,
    category: sortable.category,
    sensitivity: sortable.sensitivity,
    schema: sortObjectKeys(sortable.schema),
  };
  return JSON.stringify(canonical);
}

export function computeToolExposureHash(tools: ToolDefinition[]): string {
  const canonicalTools = tools
    .map(canonicalizeToolDefinition)
    .sort()
    .join('\n');

  return createHash('sha256').update(canonicalTools).digest('hex');
}

export function stableToolSort(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools].sort((a, b) => {
    const categoryOrder = getCategoryOrder(a.category) - getCategoryOrder(b.category);
    if (categoryOrder !== 0) return categoryOrder;

    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;

    return 0;
  });
}

function getCategoryOrder(category: ToolCategory): number {
  const order: Record<ToolCategory, number> = {
    read: 1,
    search: 2,
    internal: 3,
    write: 4,
    delete: 5,
    send: 6,
    automation: 7,
    execute: 8,
    admin: 9,
    connector: 10,
  };
  return order[category] ?? 99;
}

export function canonicalizeToolList(tools: ToolDefinition[]): string {
  const sorted = stableToolSort(tools);
  return sorted.map(canonicalizeToolDefinition).join('\n---\n');
}
