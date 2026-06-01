import { describe, it, expect } from 'vitest';
import type { ToolCall } from '../../../src/llm/types.js';
import type { ForegroundDecideParams } from '../../../src/foreground/foreground-decision-schema.js';
import type { ToolExecutionContext } from '../../../src/tools/types.js';
import {
  validateForegroundDecideParams,
  normalizeToForegroundDecision,
  type ValidateForegroundDecideOptions,
} from '../../../src/foreground/foreground-decision-validator.js';
import { extractForegroundDecideToolCall } from '../../../src/foreground/foreground-decide-extractor.js';
import { createForegroundDecideTool } from '../../../src/foreground/foreground-decide-tool.js';

// ---------------------------------------------------------------------------
// Shared test constants
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_CATALOG = [
  'web_search',
  'docs_search',
  'transcript_search',
  'memory_retrieve',
  'status_query',
  'file_read',
  'file_glob',
  'file_grep',
];

const DEFAULT_EFFECTIVE_TOOL_IDS = [...DEFAULT_TOOL_CATALOG];

function defaultOptions(overrides?: Partial<ValidateForegroundDecideOptions>): ValidateForegroundDecideOptions {
  return {
    toolCatalog: DEFAULT_TOOL_CATALOG,
    effectiveToolIds: DEFAULT_EFFECTIVE_TOOL_IDS,
    ...overrides,
  };
}

function validParams(overrides?: Partial<ForegroundDecideParams>): ForegroundDecideParams {
  return {
    schemaVersion: '1.0',
    route: 'answer_directly',
    requiresPlanner: false,
    reason: 'Test reason',
    ...overrides,
  };
}

function makeDecideToolCall(params?: Partial<ForegroundDecideParams>): ToolCall {
  return {
    id: 'tc-001',
    type: 'function',
    function: {
      name: 'foreground_decide',
      arguments: JSON.stringify(validParams(params)),
    },
  };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('validateForegroundDecideParams', () => {
  describe('valid params accepted', () => {
    it('should accept minimal valid params (required fields only)', () => {
      const result = validateForegroundDecideParams(validParams(), defaultOptions());
      expect(result.valid).toBe(true);
      expect(result.decision).toBeDefined();
      expect(result.decision?.route).toBe('answer_directly');
      expect(result.decision?.requiresPlanner).toBe(false);
      expect(result.decision?.reason).toBe('Test reason');
    });

    it('should accept all optional fields', () => {
      const params = validParams({
        userVisibleResponse: 'Hello!',
        suggestedTools: ['web_search'],
        estimatedSteps: 5,
        complexity: 'high',
        targetRef: { plannerRunId: 'pr-001', planId: 'p-001' },
      });
      const result = validateForegroundDecideParams(params, defaultOptions());
      expect(result.valid).toBe(true);
      expect(result.decision?.userVisibleResponse).toBe('Hello!');
      expect(result.decision?.estimatedSteps).toBe(5);
      expect(result.decision?.complexity).toBe('high');
      expect(result.decision?.targetRef?.plannerRunId).toBe('pr-001');
      expect(result.decision?.targetRef?.planId).toBe('p-001');
    });

    it('should accept all valid routes', () => {
      const routes = [
        'answer_directly',
        'dispatch_tool',
        'dispatch_subagent',
        'spawn_planner',
        'resume_existing_planner',
        'approval_handler',
        'cancel_or_modify_task',
        'status_query',
      ] as const;

      for (const route of routes) {
        const result = validateForegroundDecideParams(validParams({ route }), defaultOptions());
        expect(result.valid).toBe(true);
        expect(result.decision?.route).toBe(route);
      }
    });

    it('should accept all valid complexity levels', () => {
      const complexities = ['low', 'medium', 'high', 'critical'] as const;
      for (const complexity of complexities) {
        const result = validateForegroundDecideParams(validParams({ complexity }), defaultOptions());
        expect(result.valid).toBe(true);
        expect(result.decision?.complexity).toBe(complexity);
      }
    });
  });

  describe('invalid route rejected', () => {
    it('should reject unknown route string', () => {
      const result = validateForegroundDecideParams(
        validParams({ route: 'invalid_route' as any }),
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ROUTE');
    });

    it('should reject numeric route', () => {
      const result = validateForegroundDecideParams(
        { ...validParams(), route: 42 as any },
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ROUTE');
    });

    it('should reject null route', () => {
      const result = validateForegroundDecideParams(
        { ...validParams(), route: null as any },
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ROUTE');
    });
  });

  describe('empty reason rejected', () => {
    it('should reject empty string reason', () => {
      const result = validateForegroundDecideParams(validParams({ reason: '' }), defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
    });

    it('should reject whitespace-only reason', () => {
      const result = validateForegroundDecideParams(validParams({ reason: '   ' }), defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
    });

    it('should reject non-string reason', () => {
      const result = validateForegroundDecideParams(
        { ...validParams(), reason: 123 as any },
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
    });

    it('should reject reason exceeding 1000 characters', () => {
      const result = validateForegroundDecideParams(
        validParams({ reason: 'x'.repeat(1001) }),
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
    });
  });

  describe('schema version validation', () => {
    it('should reject missing schemaVersion', () => {
      const { schemaVersion, ...noVersion } = validParams();
      const result = validateForegroundDecideParams(noVersion, defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_SCHEMA_VERSION');
    });

    it('should reject wrong schemaVersion', () => {
      const result = validateForegroundDecideParams(
        validParams({ schemaVersion: '2.0' }),
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_SCHEMA_VERSION');
    });
  });

  describe('requiresPlanner validation', () => {
    it('should reject non-boolean requiresPlanner', () => {
      const result = validateForegroundDecideParams(
        { ...validParams(), requiresPlanner: 'yes' as any },
        defaultOptions(),
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_PARAMS');
    });
  });

  describe('estimatedSteps validation', () => {
    it('should reject estimatedSteps below 1', () => {
      const result = validateForegroundDecideParams(validParams({ estimatedSteps: 0 }), defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ESTIMATED_STEPS');
    });

    it('should reject estimatedSteps above 50', () => {
      const result = validateForegroundDecideParams(validParams({ estimatedSteps: 51 }), defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ESTIMATED_STEPS');
    });

    it('should reject non-integer estimatedSteps', () => {
      const result = validateForegroundDecideParams(validParams({ estimatedSteps: 3.5 }), defaultOptions());
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_ESTIMATED_STEPS');
    });
  });

  describe('runtimeAction silently ignored/stripped', () => {
    it('should strip runtimeAction even when LLM provides it', () => {
      const params = {
        ...validParams(),
        runtimeAction: {
          actionId: 'malicious-action',
          actionType: 'query_active_work',
          targetRuntime: 'gateway',
          targetAction: 'query',
          source: { sourceModule: 'foreground_agent' as const, sourceAction: 'status_query' },
          userId: 'user-123',
          sessionId: 'session-456',
          targetRef: {},
          payload: { queryType: 'active_work_status' },
          createdAt: '2024-01-15T10:00:00.000Z',
          updatedAt: '2024-01-15T10:00:00.000Z',
          status: 'created' as const,
        },
      };
      const result = validateForegroundDecideParams(params, defaultOptions());
      expect(result.valid).toBe(true);
      expect(result.decision).not.toHaveProperty('runtimeAction');
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeToForegroundDecision tests
// ---------------------------------------------------------------------------

describe('normalizeToForegroundDecision', () => {
  it('should produce a ForegroundDecision with no runtimeAction', () => {
    const params = validParams({
      suggestedTools: ['web_search'],
      estimatedSteps: 3,
      complexity: 'medium',
    });
    const decision = normalizeToForegroundDecision(params);
    expect(decision).not.toHaveProperty('runtimeAction');
    expect(decision.route).toBe('answer_directly');
    expect(decision.requiresPlanner).toBe(false);
    expect(decision.reason).toBe('Test reason');
  });

  it('should strip privileged targetRef fields', () => {
    const params = validParams({
      targetRef: {
        plannerRunId: 'pr-001',
        planId: 'p-001',
      },
    });
    const decision = normalizeToForegroundDecision(params);
    expect(decision.targetRef).toEqual({ plannerRunId: 'pr-001', planId: 'p-001' });
    expect(decision.targetRef).not.toHaveProperty('runtimeActionId');
    expect(decision.targetRef).not.toHaveProperty('subagentRunId');
    expect(decision.targetRef).not.toHaveProperty('workflowRunId');
  });

  it('should not include targetRef when not provided', () => {
    const params = validParams();
    const decision = normalizeToForegroundDecision(params);
    expect(decision.targetRef).toBeUndefined();
  });

  it('should use filteredTools when provided', () => {
    const params = validParams({ suggestedTools: ['web_search', 'nonexistent.tool'] });
    const filteredTools = ['web_search'];
    const decision = normalizeToForegroundDecision(params, filteredTools);
    expect(decision.suggestedTools).toEqual(['web_search']);
  });

  it('should pass through raw suggestedTools when filteredTools not provided', () => {
    const params = validParams({ suggestedTools: ['web_search', 'docs_search'] });
    const decision = normalizeToForegroundDecision(params);
    expect(decision.suggestedTools).toEqual(['web_search', 'docs_search']);
  });
});

// ---------------------------------------------------------------------------
// Tool extraction tests
// ---------------------------------------------------------------------------

describe('extractForegroundDecideToolCall', () => {
  describe('valid foreground.decide call consumed internally', () => {
    it('should extract a valid foreground.decide tool call', () => {
      const toolCalls = [makeDecideToolCall({ route: 'dispatch_tool', reason: 'Tool needed' })];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.decision.route).toBe('dispatch_tool');
        expect(result.decision.reason).toBe('Tool needed');
      }
    });

    it('should strip runtimeAction from extracted decision', () => {
      const paramsWithAction = {
        ...validParams(),
        runtimeAction: { actionId: 'injected', actionType: 'query_active_work' },
      };
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'foreground_decide',
          arguments: JSON.stringify(paramsWithAction),
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.decision).not.toHaveProperty('runtimeAction');
      }
    });
  });

  describe('wrong tool name triggers fallback', () => {
    it('should return non-retryable fallback for wrong tool name', () => {
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'some_other_tool',
          arguments: JSON.stringify(validParams()),
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('unexpected_tool_call');
        expect(result.canRetry).toBe(false);
        expect(result.detail).toContain('some_other_tool');
      }
    });
  });

  describe('multiple tool calls triggers fallback', () => {
    it('should return non-retryable fallback for multiple tool calls', () => {
      const toolCalls: ToolCall[] = [
        makeDecideToolCall(),
        {
          id: 'tc-002',
          type: 'function',
          function: {
            name: 'foreground_decide',
            arguments: JSON.stringify(validParams()),
          },
        },
      ];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('multiple_tool_calls');
        expect(result.canRetry).toBe(false);
        expect(result.detail).toContain('2');
      }
    });
  });

  describe('missing tool call triggers fallback', () => {
    it('should return non-retryable fallback for undefined toolCalls', () => {
      const result = extractForegroundDecideToolCall(undefined, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('missing_tool_call');
        expect(result.canRetry).toBe(false);
      }
    });

    it('should return non-retryable fallback for empty toolCalls array', () => {
      const result = extractForegroundDecideToolCall([], defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('missing_tool_call');
        expect(result.canRetry).toBe(false);
      }
    });
  });

  describe('malformed JSON args triggers fallback (retryable)', () => {
    it('should return retryable fallback for invalid JSON arguments', () => {
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'foreground_decide',
          arguments: '{not valid json',
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('malformed_args');
        expect(result.canRetry).toBe(true);
      }
    });
  });

  describe('invalid params triggers fallback with retryability', () => {
    it('should return retryable fallback for invalid route (retryable error code)', () => {
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'foreground_decide',
          arguments: JSON.stringify(validParams({ route: 'bad_route' as any })),
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('invalid_params');
        expect(result.canRetry).toBe(true);
        expect(result.detail).toContain('INVALID_ROUTE');
      }
    });

    it('should return non-retryable fallback for wrong schema version (non-retryable error code)', () => {
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'foreground_decide',
          arguments: JSON.stringify(validParams({ schemaVersion: '99.0' })),
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('invalid_params');
        expect(result.canRetry).toBe(false);
        expect(result.detail).toContain('INVALID_SCHEMA_VERSION');
      }
    });

    it('should return retryable fallback for empty reason', () => {
      const toolCalls: ToolCall[] = [{
        id: 'tc-001',
        type: 'function',
        function: {
          name: 'foreground_decide',
          arguments: JSON.stringify(validParams({ reason: '' })),
        },
      }];
      const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fallbackReason).toBe('invalid_params');
        expect(result.canRetry).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Tool filtering tests
// ---------------------------------------------------------------------------

describe('tool filtering', () => {
  it('should remove disallowed suggested tools', () => {
    const opts = defaultOptions({
      effectiveToolIds: ['web_search', 'docs_search'],
    });
    const params = validParams({
      suggestedTools: ['web_search', 'memory_retrieve', 'nonexistent.tool'],
    });
    const result = validateForegroundDecideParams(params, opts);
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('web_search');
    expect(result.decision?.suggestedTools).not.toContain('memory_retrieve');
    expect(result.decision?.suggestedTools).not.toContain('nonexistent.tool');
  });

  it('should remove tools not in toolCatalog even if in effectiveToolIds', () => {
    const opts = defaultOptions({
      toolCatalog: ['web_search'],
      effectiveToolIds: ['web_search', 'docs_search', 'memory_retrieve'],
    });
    const params = validParams({
      suggestedTools: ['web_search', 'docs_search', 'memory_retrieve'],
    });
    const result = validateForegroundDecideParams(params, opts);
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toEqual(['web_search']);
  });

  it('should handle empty suggestedTools array', () => {
    const params = validParams({ suggestedTools: [] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toEqual([]);
  });

  it('should produce undefined suggestedTools when not provided', () => {
    const params = validParams();
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toBeUndefined();
  });
});

describe('alias resolution', () => {
  it('should resolve "search" alias to "docs_search"', () => {
    const params = validParams({ suggestedTools: ['search'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('docs_search');
    expect(result.decision?.suggestedTools).not.toContain('search');
  });

  it('should resolve "web" alias to "web_search"', () => {
    const params = validParams({ suggestedTools: ['web'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('web_search');
  });

  it('should resolve "memory" alias to "memory_retrieve"', () => {
    const params = validParams({ suggestedTools: ['memory'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('memory_retrieve');
  });

  it('should resolve "transcript" alias to "transcript_search"', () => {
    const params = validParams({ suggestedTools: ['transcript'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('transcript_search');
  });

  it('should resolve "status" alias to "status_query"', () => {
    const params = validParams({ suggestedTools: ['status'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('status_query');
  });

  it('should resolve "internet.search" alias to "web_search"', () => {
    const params = validParams({ suggestedTools: ['internet.search'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toContain('web_search');
  });

  it('should deduplicate resolved aliases', () => {
    const params = validParams({ suggestedTools: ['web', 'web_search', 'internet.search'] });
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toEqual(['web_search']);
  });

  it('should skip aliases that do not resolve to a catalog tool', () => {
    const opts = defaultOptions({
      toolCatalog: ['docs_search'],
      effectiveToolIds: ['docs_search'],
    });
    const params = validParams({ suggestedTools: ['web'] });
    const result = validateForegroundDecideParams(params, opts);
    expect(result.valid).toBe(true);
    expect(result.decision?.suggestedTools).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runtimeAction rejection tests
// ---------------------------------------------------------------------------

describe('runtimeAction rejection', () => {
  it('should never include runtimeAction in validated decision', () => {
    const params = {
      ...validParams(),
      runtimeAction: {
        actionId: 'evil-action',
        actionType: 'query_active_work',
        targetRuntime: 'gateway',
      },
    };
    const result = validateForegroundDecideParams(params, defaultOptions());
    expect(result.valid).toBe(true);
    expect(result.decision).not.toHaveProperty('runtimeAction');
  });

  it('should never include runtimeAction in extracted decision', () => {
    const paramsWithAction = {
      ...validParams(),
      runtimeAction: { actionId: 'injected', actionType: 'arbitrary' },
    };
    const toolCalls: ToolCall[] = [{
      id: 'tc-001',
      type: 'function',
      function: {
        name: 'foreground_decide',
        arguments: JSON.stringify(paramsWithAction),
      },
    }];
    const result = extractForegroundDecideToolCall(toolCalls, defaultOptions());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.decision).not.toHaveProperty('runtimeAction');
    }
  });

  it('should never include runtimeAction from normalized decision', () => {
    const params = validParams();
    const decision = normalizeToForegroundDecision(params);
    expect(decision).not.toHaveProperty('runtimeAction');
  });
});

// ---------------------------------------------------------------------------
// createForegroundDecideTool tests
// ---------------------------------------------------------------------------

describe('createForegroundDecideTool', () => {
  const mockContext: ToolExecutionContext = {
    toolCallId: 'tc-001',
    toolName: 'foreground_decide',
    userId: 'user-123',
    sessionId: 'session-456',
    permissionContext: {
      userId: 'user-123',
      sessionId: 'session-456',
      mode: 'read_only',
      grants: [],
    },
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
  };

  it('should return a ToolDefinition with correct name', () => {
    const tool = createForegroundDecideTool();
    expect(tool.name).toBe('foreground_decide');
    expect(tool.category).toBe('internal');
    expect(tool.handler).toBeDefined();
  });

  it('should accept valid params and return success', () => {
    const tool = createForegroundDecideTool();
    const result = tool.handler(validParams(), mockContext) as { success: boolean; data?: unknown };
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as { decision: { route: string; reason: string } };
      expect(data.decision.route).toBe('answer_directly');
      expect(data.decision.reason).toBe('Test reason');
    }
  });

  it('should reject empty reason in handler', () => {
    const tool = createForegroundDecideTool();
    const result = tool.handler(validParams({ reason: '' }), mockContext) as { success: boolean; error?: { code: string; message: string } };
    expect(result.success).toBe(false);
    if (!result.success && result.error) {
      expect(result.error.code).toBe('INVALID_PARAMS');
      expect(result.error.message).toContain('reason');
    }
  });

  it('should not include runtimeAction in handler output', () => {
    const tool = createForegroundDecideTool();
    const paramsWithAction = {
      ...validParams(),
      runtimeAction: { actionId: 'evil' },
    };
    const result = tool.handler(paramsWithAction, mockContext) as { success: boolean; data?: unknown };
    if (result.success) {
      const data = result.data as { decision: Record<string, unknown> };
      expect(data.decision).not.toHaveProperty('runtimeAction');
    }
  });
});
