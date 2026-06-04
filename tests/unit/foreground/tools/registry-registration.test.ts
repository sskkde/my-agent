import { describe, it, expect, beforeEach } from 'vitest';
import { createToolRegistry } from '../../../../src/tools/tool-registry.js';
import {
  registerAllForegroundTools,
  getForegroundToolIds,
  getDefaultProjectionForegroundToolIds,
  getRequiresApprovalForegroundToolIds,
  STATUS_QUERY_TOOL_ID,
  SPAWN_PLANNER_TOOL_ID,
  RESUME_PLANNER_TOOL_ID,
  LAUNCH_SUBAGENT_TOOL_ID,
  CANCEL_MODIFY_TOOL_ID,
  APPROVAL_REQUEST_TOOL_ID,
  SEARCH_SUBAGENT_TOOL_ID,
} from '../../../../src/foreground/tools/index.js';
import { buildForegroundToolProjection } from '../../../../src/foreground/tool-projection-mapper.js';

describe('Foreground Tool Registry Registration', () => {
  let registry: ReturnType<typeof createToolRegistry>;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('Tool registry exposes new IDs', () => {
    it('should register all foreground tools', () => {
      registerAllForegroundTools(registry);

      expect(registry.hasTool(SEARCH_SUBAGENT_TOOL_ID)).toBe(true);
      expect(registry.hasTool(STATUS_QUERY_TOOL_ID)).toBe(true);
      expect(registry.hasTool(SPAWN_PLANNER_TOOL_ID)).toBe(true);
      expect(registry.hasTool(RESUME_PLANNER_TOOL_ID)).toBe(true);
      expect(registry.hasTool(LAUNCH_SUBAGENT_TOOL_ID)).toBe(true);
      expect(registry.hasTool(CANCEL_MODIFY_TOOL_ID)).toBe(true);
      expect(registry.hasTool(APPROVAL_REQUEST_TOOL_ID)).toBe(true);
    });

    it('should return all foreground tool IDs', () => {
      const ids = getForegroundToolIds();

      expect(ids).toContain(SEARCH_SUBAGENT_TOOL_ID);
      expect(ids).toContain(STATUS_QUERY_TOOL_ID);
      expect(ids).toContain(SPAWN_PLANNER_TOOL_ID);
      expect(ids).toContain(RESUME_PLANNER_TOOL_ID);
      expect(ids).toContain(LAUNCH_SUBAGENT_TOOL_ID);
      expect(ids).toContain(CANCEL_MODIFY_TOOL_ID);
      expect(ids).toContain(APPROVAL_REQUEST_TOOL_ID);
      expect(ids).toHaveLength(7);
    });

    it('should register search_subagent with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(SEARCH_SUBAGENT_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('search');
      expect(tool?.sensitivity).toBe('medium');
      expect(tool?.requiresPermission).toBe(false);
      expect(tool?.metadata?.requiresApproval).toBe(false);
    });

    it('should register foreground_status_query with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(STATUS_QUERY_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('read');
      expect(tool?.sensitivity).toBe('low');
      expect(tool?.requiresPermission).toBe(false);
      expect(tool?.metadata?.requiresApproval).toBe(false);
    });

    it('should register foreground_spawn_planner with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(SPAWN_PLANNER_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('write');
      expect(tool?.sensitivity).toBe('medium');
      expect(tool?.requiresPermission).toBe(true);
      expect(tool?.metadata?.requiresApproval).toBe(true);
    });

    it('should register foreground_resume_planner with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(RESUME_PLANNER_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('write');
      expect(tool?.sensitivity).toBe('medium');
      expect(tool?.requiresPermission).toBe(true);
      expect(tool?.metadata?.requiresApproval).toBe(true);
    });

    it('should register foreground_launch_subagent with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(LAUNCH_SUBAGENT_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('execute');
      expect(tool?.sensitivity).toBe('medium');
      expect(tool?.requiresPermission).toBe(true);
      expect(tool?.metadata?.requiresApproval).toBe(true);
    });

    it('should register foreground_cancel_or_modify_task with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(CANCEL_MODIFY_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('execute');
      expect(tool?.sensitivity).toBe('high');
      expect(tool?.requiresPermission).toBe(true);
      expect(tool?.metadata?.requiresApproval).toBe(true);
    });

    it('should register foreground_handle_approval with correct metadata', () => {
      registerAllForegroundTools(registry);

      const tool = registry.getTool(APPROVAL_REQUEST_TOOL_ID);
      expect(tool).not.toBeNull();
      expect(tool?.category).toBe('internal');
      expect(tool?.sensitivity).toBe('low');
      expect(tool?.requiresPermission).toBe(false);
      expect(tool?.metadata?.requiresApproval).toBe(false);
    });

    it('should have schema with required fields for each tool', () => {
      registerAllForegroundTools(registry);

      const searchSubagent = registry.getTool(SEARCH_SUBAGENT_TOOL_ID);
      expect(searchSubagent?.schema.type).toBe('object');
      expect(searchSubagent?.schema.required).toContain('originalQuestion');

      const spawnPlanner = registry.getTool(SPAWN_PLANNER_TOOL_ID);
      expect(spawnPlanner?.schema.type).toBe('object');
      expect(spawnPlanner?.schema.required).toContain('objective');

      const cancelModify = registry.getTool(CANCEL_MODIFY_TOOL_ID);
      expect(cancelModify?.schema.type).toBe('object');
      expect(cancelModify?.schema.required).toContain('reason');
      expect(cancelModify?.schema.required).toContain('interruptType');
    });
  });

  describe('Default foreground projection contains safe defaults only', () => {
    it('should include search_subagent and foreground_status_query in default projection', () => {
      registerAllForegroundTools(registry);
      const allTools = registry.listTools();

      const projection = buildForegroundToolProjection({} as any, allTools);

      expect(projection.allowedToolIds).toContain(SEARCH_SUBAGENT_TOOL_ID);
      expect(projection.allowedToolIds).toContain(STATUS_QUERY_TOOL_ID);
    });

    it('should NOT include foreground_cancel_or_modify_task in default projection', () => {
      registerAllForegroundTools(registry);
      const allTools = registry.listTools();

      const projection = buildForegroundToolProjection({} as any, allTools);

      expect(projection.allowedToolIds).not.toContain(CANCEL_MODIFY_TOOL_ID);
    });

    it('should NOT include web_search in default projection when search_subagent is available', () => {
      registerAllForegroundTools(registry);
      const allTools = registry.listTools();

      const projection = buildForegroundToolProjection({} as any, allTools);

      expect(projection.allowedToolIds).toContain(SEARCH_SUBAGENT_TOOL_ID);
      expect(projection.allowedToolIds).not.toContain('web_search');
    });

    it('should NOT include high-risk tools in default projection', () => {
      registerAllForegroundTools(registry);
      const allTools = registry.listTools();

      const projection = buildForegroundToolProjection({} as any, allTools);

      expect(projection.allowedToolIds).not.toContain(SPAWN_PLANNER_TOOL_ID);
      expect(projection.allowedToolIds).not.toContain(RESUME_PLANNER_TOOL_ID);
      expect(projection.allowedToolIds).not.toContain(LAUNCH_SUBAGENT_TOOL_ID);
      expect(projection.allowedToolIds).not.toContain(CANCEL_MODIFY_TOOL_ID);
    });

    it('should return correct default projection tool IDs', () => {
      const defaultIds = getDefaultProjectionForegroundToolIds();

      expect(defaultIds).toContain(SEARCH_SUBAGENT_TOOL_ID);
      expect(defaultIds).toContain(STATUS_QUERY_TOOL_ID);
      expect(defaultIds).toContain(APPROVAL_REQUEST_TOOL_ID);
    });

    it('should return correct requires-approval tool IDs', () => {
      const requiresApprovalIds = getRequiresApprovalForegroundToolIds();

      expect(requiresApprovalIds).toContain(SPAWN_PLANNER_TOOL_ID);
      expect(requiresApprovalIds).toContain(RESUME_PLANNER_TOOL_ID);
      expect(requiresApprovalIds).toContain(LAUNCH_SUBAGENT_TOOL_ID);
      expect(requiresApprovalIds).toContain(CANCEL_MODIFY_TOOL_ID);
      expect(requiresApprovalIds).not.toContain(SEARCH_SUBAGENT_TOOL_ID);
      expect(requiresApprovalIds).not.toContain(STATUS_QUERY_TOOL_ID);
      expect(requiresApprovalIds).not.toContain(APPROVAL_REQUEST_TOOL_ID);
    });
  });
});
