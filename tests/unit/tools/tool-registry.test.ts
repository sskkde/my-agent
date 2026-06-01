import { describe, it, expect, beforeEach } from 'vitest';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import type { ToolDefinition, ToolCategory, ToolSensitivity } from '../../../src/tools/types.js';

describe('ToolRegistry', () => {
  let registry: ReturnType<typeof createToolRegistry>;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('register', () => {
    it('should register a tool definition', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {},
        },
        handler: async () => ({ success: true }),
      };

      registry.register(tool);

      expect(registry.hasTool('test-tool')).toBe(true);
    });

    it('should throw when registering duplicate tool without overwrite option', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {},
        },
        handler: async () => ({ success: true }),
      };

      registry.register(tool);

      expect(() => registry.register(tool)).toThrow('Tool already registered: test-tool');
    });

    it('should allow overwriting when overwriteExisting is true', () => {
      const tool1: ToolDefinition = {
        name: 'test-tool',
        description: 'First version',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {},
        },
        handler: async () => ({ success: true, data: 'v1' }),
      };

      const tool2: ToolDefinition = {
        name: 'test-tool',
        description: 'Second version',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {},
        },
        handler: async () => ({ success: true, data: 'v2' }),
      };

      registry.register(tool1);
      registry.register(tool2, { overwriteExisting: true });

      const retrieved = registry.getTool('test-tool');
      expect(retrieved?.description).toBe('Second version');
    });
  });

  describe('getTool', () => {
    it('should return registered tool', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: {
          type: 'object',
          properties: {
            param1: { type: 'string' },
          },
        },
        handler: async () => ({ success: true }),
      };

      registry.register(tool);

      const retrieved = registry.getTool('test-tool');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-tool');
      expect(retrieved?.category).toBe('read');
    });

    it('should return null for unregistered tool', () => {
      const result = registry.getTool('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('listTools', () => {
    it('should return all registered tools', () => {
      const tool1: ToolDefinition = {
        name: 'tool-1',
        description: 'First tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      const tool2: ToolDefinition = {
        name: 'tool-2',
        description: 'Second tool',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      registry.register(tool1);
      registry.register(tool2);

      const tools = registry.listTools();

      expect(tools).toHaveLength(2);
      expect(tools.map(t => t.name).sort()).toEqual(['tool-1', 'tool-2']);
    });

    it('should return empty array when no tools registered', () => {
      const tools = registry.listTools();
      expect(tools).toEqual([]);
    });
  });

  describe('listToolsByCategory', () => {
    it('should return tools filtered by category', () => {
      const readTool: ToolDefinition = {
        name: 'read-tool',
        description: 'A read tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      const writeTool: ToolDefinition = {
        name: 'write-tool',
        description: 'A write tool',
        category: 'write' as ToolCategory,
        sensitivity: 'medium' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      registry.register(readTool);
      registry.register(writeTool);

      const readTools = registry.listToolsByCategory('read');
      expect(readTools).toHaveLength(1);
      expect(readTools[0].name).toBe('read-tool');
    });
  });

  describe('unregister', () => {
    it('should unregister a tool', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      registry.register(tool);
      expect(registry.hasTool('test-tool')).toBe(true);

      const result = registry.unregister('test-tool');

      expect(result).toBe(true);
      expect(registry.hasTool('test-tool')).toBe(false);
    });

    it('should return false when unregistering nonexistent tool', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('hasTool', () => {
    it('should return true for registered tool', () => {
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'A test tool',
        category: 'read' as ToolCategory,
        sensitivity: 'low' as ToolSensitivity,
        schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true }),
      };

      registry.register(tool);

      expect(registry.hasTool('test-tool')).toBe(true);
    });

    it('should return false for unregistered tool', () => {
      expect(registry.hasTool('nonexistent')).toBe(false);
    });
  });

  describe('name validation', () => {
    const makeTool = (name: string): ToolDefinition => ({
      name,
      description: 'test',
      category: 'read' as ToolCategory,
      sensitivity: 'low' as ToolSensitivity,
      schema: { type: 'object', properties: {} },
      handler: async () => ({ success: true }),
    });

    it('should reject names containing dots', () => {
      expect(() => registry.register(makeTool('my.tool'))).toThrow(/Invalid tool name/);
    });

    it('should reject empty names', () => {
      expect(() => registry.register(makeTool(''))).toThrow(/Invalid tool name/);
    });

    it('should reject names over 64 characters', () => {
      const long = 'a'.repeat(65);
      expect(() => registry.register(makeTool(long))).toThrow(/Invalid tool name/);
    });

    it('should accept legal names with hyphens and underscores', () => {
      expect(() => registry.register(makeTool('my-tool_v1'))).not.toThrow();
      expect(() => registry.register(makeTool('tool-123'))).not.toThrow();
      expect(() => registry.register(makeTool('_leading_underscore'))).not.toThrow();
    });
  });
});
