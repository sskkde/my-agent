import { describe, it, expect } from 'vitest';
import {
  generateToolPlaneProjection,
  generateRoutingToolProjection,
  generateExecutionToolProjection,
} from '../../../src/tools/tool-plane-prompt-projection.js';
import type { ToolDefinition, ToolCategory, ToolSensitivity } from '../../../src/tools/types.js';
import { createToolExposurePlans } from '../../../src/tools/tool-exposure-plan.js';

function createMockTool(
  name: string,
  category: ToolCategory,
  sensitivity: ToolSensitivity
): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    category,
    sensitivity,
    schema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
    },
    handler: async () => ({ success: true }),
  };
}

describe('generateToolPlaneProjection', () => {
  it('should generate projection with tool IDs', () => {
    const tools = [
      createMockTool('read_file', 'read', 'low'),
      createMockTool('write_file', 'write', 'medium'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
    });

    expect(projection.toolIds).toEqual(['read_file', 'write_file']);
  });

  it('should exclude denied tools', () => {
    const tools = [
      createMockTool('read_file', 'read', 'low'),
      createMockTool('delete_file', 'delete', 'high'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
      deniedToolIds: ['delete_file'],
    });

    expect(projection.toolIds).toEqual(['read_file']);
    expect(projection.toolIds).not.toContain('delete_file');
  });

  it('should filter by allowed tools when specified', () => {
    const tools = [
      createMockTool('read_file', 'read', 'low'),
      createMockTool('write_file', 'write', 'medium'),
      createMockTool('search_docs', 'search', 'low'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
      allowedToolIds: ['read_file', 'search_docs'],
    });

    expect(projection.toolIds).toEqual(['read_file', 'search_docs']);
  });

  it('routing mode should have toolSummaries but no tools array', () => {
    const tools = [
      createMockTool('read_file', 'read', 'low'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
    });

    expect(projection.toolSummaries).toBeDefined();
    expect(projection.tools).toBeUndefined();
  });

  it('execution mode should have tools array with full schemas', () => {
    const tools = [
      createMockTool('read_file', 'read', 'low'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'function_calling',
    });

    expect(projection.tools).toBeDefined();
    expect(projection.tools).toHaveLength(1);
    expect(projection.tools![0]).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'read_file tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
      },
    });
  });

  it('should sort tools by stable key (category, then name)', () => {
    const tools = [
      createMockTool('write_file', 'write', 'medium'),
      createMockTool('alpha_read', 'read', 'low'),
      createMockTool('read_file', 'read', 'low'),
    ];

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
    });

    expect(projection.toolIds).toEqual(['alpha_read', 'read_file', 'write_file']);
  });

  it('should handle empty tool list', () => {
    const projection = generateToolPlaneProjection({
      tools: [],
      mode: 'routing_json',
    });

    expect(projection.toolIds).toEqual([]);
  });

  it('should use provided exposure plans', () => {
    const tools = [
      createMockTool('admin_tool', 'admin', 'restricted'),
    ];

    const customPlans = createToolExposurePlans(tools);

    const projection = generateToolPlaneProjection({
      tools,
      mode: 'routing_json',
      exposurePlans: customPlans,
    });

    expect(projection.toolIds).toContain('admin_tool');
  });
});

describe('generateRoutingToolProjection', () => {
  it('should generate routing mode projection', () => {
    const tools = [createMockTool('test', 'read', 'low')];

    const projection = generateRoutingToolProjection(tools);

    expect(projection.toolSummaries).toBeDefined();
    expect(projection.tools).toBeUndefined();
  });
});

describe('generateExecutionToolProjection', () => {
  it('should generate execution mode projection', () => {
    const tools = [createMockTool('test', 'read', 'low')];

    const projection = generateExecutionToolProjection(tools);

    expect(projection.tools).toBeDefined();
    expect(projection.tools).toHaveLength(1);
  });
});

describe('hidden tools', () => {
  it('should not include denied tools in projection', () => {
    const deniedTool: ToolDefinition = {
      name: 'denied_tool',
      description: 'Denied tool',
      category: 'admin',
      sensitivity: 'restricted',
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    };

    const visibleTool = createMockTool('visible_tool', 'read', 'low');

    const projection = generateToolPlaneProjection({
      tools: [deniedTool, visibleTool],
      mode: 'routing_json',
      deniedToolIds: ['denied_tool'],
    });

    expect(projection.toolIds).toContain('visible_tool');
    expect(projection.toolIds).not.toContain('denied_tool');
  });

  it('should respect custom exposure plans with hidden level', () => {
    const hiddenTool: ToolDefinition = {
      name: 'hidden_tool',
      description: 'Hidden tool',
      category: 'admin',
      sensitivity: 'restricted',
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    };

    const visibleTool = createMockTool('visible_tool', 'read', 'low');

    const customPlans = new Map();
    customPlans.set('hidden_tool', {
      toolId: 'hidden_tool',
      exposureLevel: 'hidden' as const,
      riskLevel: 'restricted' as const,
      requiresApproval: true,
      schemaMode: 'card_only' as const,
      categories: ['admin'],
    });
    customPlans.set('visible_tool', {
      toolId: 'visible_tool',
      exposureLevel: 'always_on' as const,
      riskLevel: 'low' as const,
      requiresApproval: false,
      schemaMode: 'full' as const,
      categories: ['read'],
    });

    const projection = generateToolPlaneProjection({
      tools: [hiddenTool, visibleTool],
      mode: 'routing_json',
      exposurePlans: customPlans,
    });

    expect(projection.toolIds).toContain('visible_tool');
    expect(projection.toolIds).not.toContain('hidden_tool');
  });
});
