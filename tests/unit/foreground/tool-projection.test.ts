import { describe, it, expect } from 'vitest';
import { buildForegroundToolProjection, toToolPlaneProjection } from '../../../src/foreground/tool-projection-mapper.js';
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js';
import type { ToolCategory, ToolSensitivity } from '../../../src/tools/types.js';

describe('buildForegroundToolProjection', () => {
  const createMockInput = (): ForegroundTurnInput => ({
    userId: 'test-user',
    sessionId: 'test-session',
    turnId: 'test-turn',
    message: 'test message',
    timestamp: new Date().toISOString(),
    hydratedState: {} as any,
    foregroundState: {} as any,
  });

  const createTool = (
    name: string,
    category: ToolCategory,
    sensitivity: ToolSensitivity,
    description: string = 'Test tool'
  ) => ({
    name,
    category,
    sensitivity,
    description,
  });

  describe('default projection excludes high-risk tools', () => {
    it('should only include read/search/internal tools with low/medium sensitivity', () => {
      const allTools = [
        createTool('web_search', 'search', 'low'),
        createTool('file_read', 'read', 'low'),
        createTool('status_query', 'internal', 'low'),
        createTool('ask_user', 'internal', 'low'),
        createTool('file_write', 'write', 'medium'),
        createTool('file_delete', 'delete', 'high'),
        createTool('execute_command', 'execute', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['web_search', 'file_read', 'status_query', 'ask_user']);
      expect(result.projectionMode).toBe('function_calling');
    });

    it('should exclude write category tools by default', () => {
      const allTools = [
        createTool('artifact_create', 'write', 'medium'),
        createTool('artifact_update', 'write', 'medium'),
        createTool('email_send_draft', 'write', 'high'),
        createTool('calendar_create_event', 'write', 'medium'),
        createTool('file_read', 'read', 'low'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['file_read']);
      expect(result.allowedToolIds).not.toContain('artifact_create');
      expect(result.allowedToolIds).not.toContain('artifact_update');
      expect(result.allowedToolIds).not.toContain('email_send_draft');
      expect(result.allowedToolIds).not.toContain('calendar_create_event');
    });

    it('should exclude delete category tools by default', () => {
      const allTools = [
        createTool('file_delete', 'delete', 'high'),
        createTool('record_delete', 'delete', 'medium'),
        createTool('file_read', 'read', 'low'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['file_read']);
      expect(result.allowedToolIds).not.toContain('file_delete');
      expect(result.allowedToolIds).not.toContain('record_delete');
    });

    it('should exclude execute category tools by default', () => {
      const allTools = [
        createTool('run_script', 'execute', 'high'),
        createTool('bash_command', 'execute', 'high'),
        createTool('status_query', 'internal', 'low'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['status_query']);
      expect(result.allowedToolIds).not.toContain('run_script');
      expect(result.allowedToolIds).not.toContain('bash_command');
    });

    it('should exclude admin category tools by default', () => {
      const allTools = [
        createTool('configure_system', 'admin', 'restricted'),
        createTool('manage_users', 'admin', 'high'),
        createTool('web_search', 'search', 'low'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['web_search']);
      expect(result.allowedToolIds).not.toContain('configure_system');
      expect(result.allowedToolIds).not.toContain('manage_users');
    });

    it('should exclude tools with high or restricted sensitivity even in safe categories', () => {
      const allTools = [
        createTool('safe_tool', 'search', 'low'),
        createTool('high_sens_tool', 'search', 'high'),
        createTool('restricted_tool', 'read', 'restricted'),
        createTool('medium_sens_tool', 'internal', 'medium'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual(['safe_tool', 'medium_sens_tool']);
      expect(result.allowedToolIds).not.toContain('high_sens_tool');
      expect(result.allowedToolIds).not.toContain('restricted_tool');
    });

    it('should generate tool definitions for function calling mode', () => {
      const allTools = [
        createTool('web_search', 'search', 'low', 'Search the web'),
        createTool('status_query', 'internal', 'low', 'Query status'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.toolDefinitions).toHaveLength(2);
      expect(result.toolDefinitions[0]).toEqual({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: { type: 'object', properties: {} },
        },
      });
      expect(result.toolDefinitions[1]).toEqual({
        type: 'function',
        function: {
          name: 'status_query',
          description: 'Query status',
          parameters: { type: 'object', properties: {} },
        },
      });
    });
  });

  describe('unprojected call handling', () => {
    it('should produce empty projection when no tools are safe', () => {
      const allTools = [
        createTool('dangerous_write', 'write', 'high'),
        createTool('dangerous_delete', 'delete', 'high'),
        createTool('dangerous_execute', 'execute', 'restricted'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toEqual([]);
      expect(result.toolDefinitions).toEqual([]);
    });

    it('should convert to ToolPlaneProjection format correctly', () => {
      const allTools = [
        createTool('web_search', 'search', 'low'),
        createTool('file_read', 'read', 'medium'),
      ];

      const projectionResult = buildForegroundToolProjection(createMockInput(), allTools);
      const planeProjection = toToolPlaneProjection(projectionResult);

      expect(planeProjection.toolIds).toEqual(['web_search', 'file_read']);
      expect(planeProjection.tools).toHaveLength(2);
      expect(planeProjection.tools?.[0].function.name).toBe('web_search');
      expect(planeProjection.tools?.[1].function.name).toBe('file_read');
    });
  });

  describe('edge cases', () => {
    it('should handle empty tool array', () => {
      const result = buildForegroundToolProjection(createMockInput(), []);

      expect(result.allowedToolIds).toEqual([]);
      expect(result.toolDefinitions).toEqual([]);
    });

    it('should handle tools with all safe categories', () => {
      const allTools = [
        createTool('web_search', 'search', 'low'),
        createTool('file_glob', 'search', 'low'),
        createTool('file_read', 'read', 'low'),
        createTool('status_query', 'internal', 'low'),
        createTool('ask_user', 'internal', 'low'),
        createTool('docs_search', 'search', 'low'),
      ];

      const result = buildForegroundToolProjection(createMockInput(), allTools);

      expect(result.allowedToolIds).toHaveLength(6);
      expect(result.allowedToolIds).toContain('web_search');
      expect(result.allowedToolIds).toContain('file_glob');
      expect(result.allowedToolIds).toContain('file_read');
      expect(result.allowedToolIds).toContain('status_query');
      expect(result.allowedToolIds).toContain('ask_user');
      expect(result.allowedToolIds).toContain('docs_search');
    });
  });
});
