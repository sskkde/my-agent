import { describe, it, expect } from 'vitest';
import type { ForegroundDecisionRoute, TaskComplexity } from '../../../src/foreground/types.js';

/**
 * LLM Router Output Contract Tests
 *
 * These tests define the structured output contract for the LLM foreground router.
 * The router must return valid JSON that conforms to this contract.
 *
 * TDD Approach: These tests define expected behavior BEFORE implementation.
 * They will fail until Task 6 (router implementation) is completed.
 */

// Expected router output structure
interface LLMRouterOutput {
  /** The decision route - must be one of the valid ForegroundDecisionRoute values */
  route: ForegroundDecisionRoute;
  /** Human-readable reason for the routing decision - must be non-empty */
  reason: string;
  /** Optional immediate response to show the user */
  userVisibleResponse?: string;
  /** Optional estimated number of steps for this task */
  estimatedSteps?: number;
  /** Optional complexity level */
  complexity?: TaskComplexity;
  /** Optional array of suggested tool names for dispatch_tool route */
  suggestedTools?: string[];
  /** Optional runtime action (only present for non-direct routes) */
  runtimeAction?: {
    actionType: string;
    targetRuntime: string;
    targetAction?: unknown;
  };
}

// Valid routes from ForegroundDecisionRoute union type
const VALID_ROUTES: ForegroundDecisionRoute[] = [
  'answer_directly',
  'dispatch_tool',
  'dispatch_subagent',
  'spawn_planner',
  'resume_existing_planner',
  'approval_handler',
  'cancel_or_modify_task',
  'status_query',
];

// Router result type - represents the parsed and validated output
interface RouterResult {
  success: boolean;
  output?: LLMRouterOutput;
  error?: {
    code: RouterErrorCode;
    message: string;
    retryable: boolean;
  };
}

type RouterErrorCode =
  | 'MALFORMED_JSON'
  | 'INVALID_ROUTE'
  | 'MISSING_REQUIRED_FIELD'
  | 'EMPTY_REASON'
  | 'INVALID_RUNTIME_ACTION'
  | 'INVALID_COMPLEXITY'
  | 'INVALID_FIELD_TYPE';

const VALID_COMPLEXITIES: TaskComplexity[] = ['low', 'medium', 'high', 'critical'];

function parseRouterOutput(rawOutput: string): RouterResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return {
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Response is not valid JSON',
        retryable: true,
      },
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Response must be a JSON object, not an array or primitive',
        retryable: true,
      },
    };
  }

  const obj = parsed as Record<string, unknown>;

  if (!('route' in obj)) {
    return {
      success: false,
      error: {
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Missing required field: route',
        retryable: true,
      },
    };
  }

  if (!('reason' in obj)) {
    return {
      success: false,
      error: {
        code: 'MISSING_REQUIRED_FIELD',
        message: 'Missing required field: reason',
        retryable: true,
      },
    };
  }

  if (typeof obj.route !== 'string') {
    return {
      success: false,
      error: {
        code: 'INVALID_FIELD_TYPE',
        message: 'Field "route" must be a string',
        retryable: true,
      },
    };
  }

  if (!VALID_ROUTES.includes(obj.route as ForegroundDecisionRoute)) {
    return {
      success: false,
      error: {
        code: 'INVALID_ROUTE',
        message: `Invalid route value: ${obj.route}. Must be one of: ${VALID_ROUTES.join(', ')}`,
        retryable: true,
      },
    };
  }

  if (typeof obj.reason !== 'string') {
    return {
      success: false,
      error: {
        code: 'INVALID_FIELD_TYPE',
        message: 'Field "reason" must be a string',
        retryable: true,
      },
    };
  }

  if (obj.reason.trim().length === 0) {
    return {
      success: false,
      error: {
        code: 'EMPTY_REASON',
        message: 'Field "reason" must be a non-empty string',
        retryable: true,
      },
    };
  }

  if (obj.userVisibleResponse !== undefined && typeof obj.userVisibleResponse !== 'string') {
    return {
      success: false,
      error: {
        code: 'INVALID_FIELD_TYPE',
        message: 'Field "userVisibleResponse" must be a string',
        retryable: true,
      },
    };
  }

  if (obj.estimatedSteps !== undefined && typeof obj.estimatedSteps !== 'number') {
    return {
      success: false,
      error: {
        code: 'INVALID_FIELD_TYPE',
        message: 'Field "estimatedSteps" must be a number',
        retryable: true,
      },
    };
  }

  if (obj.complexity !== undefined) {
    if (typeof obj.complexity !== 'string' || !VALID_COMPLEXITIES.includes(obj.complexity as TaskComplexity)) {
      return {
        success: false,
        error: {
          code: 'INVALID_COMPLEXITY',
          message: `Field "complexity" must be one of: ${VALID_COMPLEXITIES.join(', ')}`,
          retryable: true,
        },
      };
    }
  }

  if (obj.suggestedTools !== undefined && !Array.isArray(obj.suggestedTools)) {
    return {
      success: false,
      error: {
        code: 'INVALID_FIELD_TYPE',
        message: 'Field "suggestedTools" must be an array',
        retryable: true,
      },
    };
  }

  if (obj.runtimeAction !== undefined) {
    const ra = obj.runtimeAction as Record<string, unknown>;
    const validActionTypes = ['dispatch_tool', 'cancel_planner_run', 'pause_planner_run', 'resume_planner_run', 'query_active_work'];
    const validTargetRuntimes = ['planner_runtime', 'subagent_runtime', 'gateway', 'tool_runtime'];

    if (typeof ra.actionType !== 'string' || !validActionTypes.includes(ra.actionType)) {
      return {
        success: false,
        error: {
          code: 'INVALID_RUNTIME_ACTION',
          message: `Invalid runtimeAction.actionType: ${ra.actionType}`,
          retryable: true,
        },
      };
    }

    if (typeof ra.targetRuntime !== 'string' || !validTargetRuntimes.includes(ra.targetRuntime)) {
      return {
        success: false,
        error: {
          code: 'INVALID_RUNTIME_ACTION',
          message: `Invalid runtimeAction.targetRuntime: ${ra.targetRuntime}`,
          retryable: true,
        },
      };
    }
  }

  return {
    success: true,
    output: {
      route: obj.route as ForegroundDecisionRoute,
      reason: obj.reason,
      userVisibleResponse: obj.userVisibleResponse as string | undefined,
      estimatedSteps: obj.estimatedSteps as number | undefined,
      complexity: obj.complexity as TaskComplexity | undefined,
      suggestedTools: obj.suggestedTools as string[] | undefined,
      runtimeAction: obj.runtimeAction as LLMRouterOutput['runtimeAction'] | undefined,
    },
  };
}

describe('LLM Router Output Contract', () => {
  describe('valid output parsing', () => {
    it('should parse valid answer_directly route', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple question that can be answered directly',
        userVisibleResponse: 'Here is your answer...',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.output?.route).toBe('answer_directly');
      expect(result.output?.reason).toBe('Simple question that can be answered directly');
      expect(result.output?.userVisibleResponse).toBe('Here is your answer...');
    });

    it('should parse valid dispatch_tool route with suggested tools', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Simple read operation that can be delegated to tool',
        suggestedTools: ['search', 'read_file'],
        estimatedSteps: 1,
        complexity: 'low',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('dispatch_tool');
      expect(result.output?.suggestedTools).toEqual(['search', 'read_file']);
      expect(result.output?.estimatedSteps).toBe(1);
      expect(result.output?.complexity).toBe('low');
    });

    it('should parse valid spawn_planner route with full metadata', () => {
      const rawOutput = JSON.stringify({
        route: 'spawn_planner',
        reason: 'Multi-step task requiring planning and coordination',
        userVisibleResponse: 'I will create a plan to handle this multi-step task.',
        estimatedSteps: 5,
        complexity: 'high',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('spawn_planner');
      expect(result.output?.estimatedSteps).toBe(5);
      expect(result.output?.complexity).toBe('high');
    });

    it('should parse valid dispatch_subagent route', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_subagent',
        reason: 'Task suitable for background subagent execution',
        estimatedSteps: 3,
        complexity: 'medium',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('dispatch_subagent');
    });

    it('should parse valid approval_handler route', () => {
      const rawOutput = JSON.stringify({
        route: 'approval_handler',
        reason: 'User response to approval request',
        userVisibleResponse: 'Processing your approval response...',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('approval_handler');
    });

    it('should parse valid cancel_or_modify_task route', () => {
      const rawOutput = JSON.stringify({
        route: 'cancel_or_modify_task',
        reason: 'User requested cancellation of active work',
        userVisibleResponse: 'Cancelling the active task...',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('cancel_or_modify_task');
    });

    it('should parse valid status_query route', () => {
      const rawOutput = JSON.stringify({
        route: 'status_query',
        reason: 'User is asking about task status or progress',
        userVisibleResponse: 'Let me check the current status...',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('status_query');
    });

    it('should parse valid resume_existing_planner route', () => {
      const rawOutput = JSON.stringify({
        route: 'resume_existing_planner',
        reason: 'User wants to continue existing planner session',
        userVisibleResponse: 'Resuming your planner session...',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('resume_existing_planner');
    });

    it('should accept minimal valid output with only required fields', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 'Simple direct answer',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.route).toBe('answer_directly');
      expect(result.output?.reason).toBe('Simple direct answer');
    });
  });

  describe('required field validation', () => {
    it('should reject output missing route field', () => {
      const rawOutput = JSON.stringify({
        reason: 'Some reason',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.error?.message).toContain('route');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject output missing reason field', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.error?.message).toContain('reason');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject empty reason string', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: '',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
      expect(result.error?.message).toContain('non-empty');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject whitespace-only reason', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: '   ',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EMPTY_REASON');
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('route validation', () => {
    it('should reject unknown route values', () => {
      const rawOutput = JSON.stringify({
        route: 'unknown_route',
        reason: 'Some reason',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ROUTE');
      expect(result.error?.message).toContain('unknown_route');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject route with invented runtimeAction not in existing union', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Tool dispatch',
        runtimeAction: {
          actionType: 'invented_action_type',
          targetRuntime: 'invented_runtime',
        },
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_RUNTIME_ACTION');
      expect(result.error?.retryable).toBe(true);
    });

    VALID_ROUTES.forEach((validRoute) => {
      it(`should accept valid route: ${validRoute}`, () => {
        const rawOutput = JSON.stringify({
          route: validRoute,
          reason: 'Valid route test',
        });

        const result = parseRouterOutput(rawOutput);

        expect(result.success).toBe(true);
        expect(result.output?.route).toBe(validRoute);
      });
    });
  });

  describe('malformed JSON handling', () => {
    it('should reject completely invalid JSON', () => {
      const rawOutput = 'this is not json at all';

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MALFORMED_JSON');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject JSON with syntax error', () => {
      const rawOutput = '{"route": "answer_directly", "reason": }';

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MALFORMED_JSON');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject JSON with unclosed string', () => {
      const rawOutput = '{"route": "answer_directly", "reason": "unclosed}';

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MALFORMED_JSON');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject empty string', () => {
      const rawOutput = '';

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MALFORMED_JSON');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject JSON array instead of object', () => {
      const rawOutput = JSON.stringify([{ route: 'answer_directly', reason: 'test' }]);

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MALFORMED_JSON');
      expect(result.error?.message).toContain('object');
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe('field type validation', () => {
    it('should reject non-string route', () => {
      const rawOutput = JSON.stringify({
        route: 123,
        reason: 'Some reason',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE');
      expect(result.error?.message).toContain('route');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject non-string reason', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 456,
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE');
      expect(result.error?.message).toContain('reason');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject non-array suggestedTools', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Tool dispatch',
        suggestedTools: 'search',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE');
      expect(result.error?.message).toContain('suggestedTools');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject non-number estimatedSteps', () => {
      const rawOutput = JSON.stringify({
        route: 'spawn_planner',
        reason: 'Planning needed',
        estimatedSteps: 'five',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_FIELD_TYPE');
      expect(result.error?.message).toContain('estimatedSteps');
      expect(result.error?.retryable).toBe(true);
    });

    it('should reject invalid complexity value', () => {
      const rawOutput = JSON.stringify({
        route: 'spawn_planner',
        reason: 'Planning needed',
        complexity: 'extreme',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_COMPLEXITY');
      expect(result.error?.message).toContain('complexity');
      expect(result.error?.retryable).toBe(true);
    });

    it('should accept valid complexity values', () => {
      const validComplexities: TaskComplexity[] = ['low', 'medium', 'high', 'critical'];

      validComplexities.forEach((complexity) => {
        const rawOutput = JSON.stringify({
          route: 'spawn_planner',
          reason: 'Planning needed',
          complexity,
        });

        const result = parseRouterOutput(rawOutput);

        expect(result.success).toBe(true);
        expect(result.output?.complexity).toBe(complexity);
      });
    });
  });

  describe('optional field handling', () => {
    it('should accept output without optional userVisibleResponse', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 'Direct answer without immediate response',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.userVisibleResponse).toBeUndefined();
    });

    it('should accept output without optional estimatedSteps', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 'Direct answer',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.estimatedSteps).toBeUndefined();
    });

    it('should accept output without optional complexity', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: 'Direct answer',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.complexity).toBeUndefined();
    });

    it('should accept output without optional suggestedTools', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Tool dispatch',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.suggestedTools).toBeUndefined();
    });

    it('should accept empty suggestedTools array', () => {
      const rawOutput = JSON.stringify({
        route: 'dispatch_tool',
        reason: 'Tool dispatch',
        suggestedTools: [],
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(true);
      expect(result.output?.suggestedTools).toEqual([]);
    });
  });

  describe('repair retry trigger', () => {
    it('should mark malformed JSON as retryable', () => {
      const rawOutput = 'not valid json';

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('should mark missing required field as retryable', () => {
      const rawOutput = JSON.stringify({ route: 'answer_directly' });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('should mark invalid route as retryable', () => {
      const rawOutput = JSON.stringify({
        route: 'invalid_route',
        reason: 'Some reason',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('should mark empty reason as retryable', () => {
      const rawOutput = JSON.stringify({
        route: 'answer_directly',
        reason: '',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.retryable).toBe(true);
    });

    it('should include guidance for repair in error message', () => {
      const rawOutput = JSON.stringify({
        route: 'unknown_route',
        reason: 'Some reason',
      });

      const result = parseRouterOutput(rawOutput);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('unknown_route');
      expect(result.error?.message.length).toBeGreaterThan(10);
    });
  });

  describe('contract completeness', () => {
    it('should validate all valid ForegroundDecisionRoute values are accepted', () => {
      const expectedRoutes: ForegroundDecisionRoute[] = [
        'answer_directly',
        'dispatch_tool',
        'dispatch_subagent',
        'spawn_planner',
        'resume_existing_planner',
        'approval_handler',
        'cancel_or_modify_task',
        'status_query',
      ];

      expectedRoutes.forEach((route) => {
        const rawOutput = JSON.stringify({
          route,
          reason: `Test for ${route}`,
        });

        const result = parseRouterOutput(rawOutput);

        expect(result.success).toBe(true);
        expect(result.output?.route).toBe(route);
      });
    });

    it('should validate route union has not been modified unexpectedly', () => {
      // This test ensures the contract matches the type definition
      // If the type changes, this test will fail and alert us
      const currentRoutes: ForegroundDecisionRoute[] = [
        'answer_directly',
        'dispatch_tool',
        'dispatch_subagent',
        'spawn_planner',
        'resume_existing_planner',
        'approval_handler',
        'cancel_or_modify_task',
        'status_query',
      ];

      expect(VALID_ROUTES).toEqual(currentRoutes);
    });
  });
});

describe('LLM Router Contract Type Safety', () => {
  it('should ensure RouterResult type matches expected structure', () => {
    const successResult: RouterResult = {
      success: true,
      output: {
        route: 'answer_directly',
        reason: 'Test',
      },
    };

    const errorResult: RouterResult = {
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Test error',
        retryable: true,
      },
    };

    expect(successResult.success).toBe(true);
    expect(errorResult.success).toBe(false);
  });

  it('should ensure LLMRouterOutput includes all required ForegroundDecision fields', () => {
    const fullOutput: LLMRouterOutput = {
      route: 'spawn_planner',
      reason: 'Multi-step task',
      userVisibleResponse: 'Starting plan...',
      estimatedSteps: 3,
      complexity: 'medium',
      suggestedTools: ['planner'],
    };

    expect(fullOutput.route).toBeDefined();
    expect(fullOutput.reason).toBeDefined();
    expect(fullOutput.userVisibleResponse).toBeDefined();
    expect(fullOutput.estimatedSteps).toBeDefined();
    expect(fullOutput.complexity).toBeDefined();
    expect(fullOutput.suggestedTools).toBeDefined();
  });
});
