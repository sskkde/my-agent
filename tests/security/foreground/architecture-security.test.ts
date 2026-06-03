/**
 * Architecture Security Tests
 *
 * Regression tests protecting critical security invariants:
 *   1. runtimeAction injection rejected — LLM cannot create trusted runtime actions
 *   2. High-risk tools absent by default — least-privilege projection
 *   3. Redaction suite — sensitive fields (token, password, apiKey) redacted in transcripts
 *   4. Kernel failure does not invoke route-only fallback — no deprecated path resurrection
 *
 * @see src/foreground/foreground-decision-validator.ts — runtimeAction stripping
 * @see src/foreground/tool-projection-mapper.ts — projection builder
 * @see src/kernel/model-input/model-input-redactor.ts — redaction pipeline
 * @see src/foreground/tools/transcript-redaction-mapper.ts — transcript redaction
 */

import { describe, it, expect, vi } from 'vitest';
import { validateForegroundDecideParams, normalizeToForegroundDecision } from '../../../src/foreground/foreground-decision-validator.js';
import type { ForegroundDecideParams } from '../../../src/foreground/foreground-decision-schema.js';
import { FOREGROUND_DECIDE_SCHEMA } from '../../../src/foreground/foreground-decision-schema.js';
import { buildForegroundToolProjection, HIGH_RISK_TOOL_CATEGORIES } from '../../../src/foreground/tool-projection-mapper.js';
import { createModelInputRedactor } from '../../../src/kernel/model-input/model-input-redactor.js';
import { mapKernelResultToTranscript } from '../../../src/foreground/tools/transcript-redaction-mapper.js';
import { createForegroundAgent } from '../../../src/foreground/foreground-agent.js';
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { KernelRunResult } from '../../../src/kernel/types.js';
import type { ToolCategory, ToolSensitivity } from '../../../src/tools/types.js';
import type { RuntimeAction } from '../../../src/dispatcher/types.js';

// ─── Sentinel secrets for leak detection ──────────────────────────────────────

const SENTINEL_API_KEY = 'sk-test-arch-security-abcdef1234567890XYZ';
const SENTINEL_PASSWORD = 'arch-sec-pwd-supersecret-2024';
const SENTINEL_TOKEN = 'tok-arch-security-bearer-xyz987';
const SENTINEL_SECRET = 'secret-arch-security-whsec_abc123';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeValidDecideParams(overrides: Partial<ForegroundDecideParams> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    route: 'answer_directly',
    requiresPlanner: false,
    reason: 'Test routing decision',
    ...overrides,
  };
}

function makeToolDef(
  name: string,
  category: ToolCategory,
  sensitivity: ToolSensitivity = 'low',
) {
  return {
    name,
    description: `Tool: ${name}`,
    category,
    sensitivity,
    schema: { type: 'object' as const, properties: {} },
    handler: vi.fn(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RuntimeAction Injection Rejected
// ═══════════════════════════════════════════════════════════════════════════════

describe('RuntimeAction injection rejected', () => {
  const fakeRuntimeAction: RuntimeAction = {
    actionId: 'injected-action-001',
    actionType: 'cancel_planner_run',
    targetRuntime: 'planner_runtime',
    source: { sourceModule: 'malicious_llm', sourceAction: 'injection' },
    userId: 'attacker-user',
    sessionId: 'attacker-session',
    targetRef: { runId: 'target-to-cancel' },
    targetAction: 'cancel',
    payload: { injected: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'created',
  };

  it('validator strips runtimeAction from LLM params — never propagated to decision', () => {
    const paramsWithInjection = makeValidDecideParams({
      route: 'cancel_or_modify_task',
      reason: 'Legitimate cancel request',
    });
    // Simulate LLM injecting runtimeAction (even though schema prevents it, validator is defense-in-depth)
    (paramsWithInjection as Record<string, unknown>).runtimeAction = fakeRuntimeAction;

    const result = validateForegroundDecideParams(paramsWithInjection, {
      toolCatalog: ['file_read', 'web_search'],
      effectiveToolIds: ['file_read', 'web_search'],
    });

    expect(result.valid).toBe(true);
    expect(result.decision).toBeDefined();
    // runtimeAction must NEVER appear in the validated decision
    expect(result.decision!.runtimeAction).toBeUndefined();
    // Verify the decision contains only safe fields
    expect(result.decision!.route).toBe('cancel_or_modify_task');
    expect(result.decision!.reason).toBe('Legitimate cancel request');
  });

  it('normalizeToForegroundDecision never includes runtimeAction even when passed in params', () => {
    const params: ForegroundDecideParams = {
      schemaVersion: '1.0',
      route: 'status_query',
      requiresPlanner: false,
      reason: 'Check status',
    };

    // Directly call normalize — must never produce runtimeAction
    const decision = normalizeToForegroundDecision(params);
    expect(decision).not.toHaveProperty('runtimeAction');
    expect(decision.route).toBe('status_query');
  });

  it('targetRef strips privileged fields (runtimeActionId, subagentRunId, workflowRunId)', () => {
    const paramsWithPrivilegedRef = makeValidDecideParams({
      route: 'answer_directly',
      reason: 'Test with privileged targetRef',
      targetRef: {
        plannerRunId: 'safe-planner-id',
        planId: 'safe-plan-id',
      },
    });
    // Simulate LLM injecting privileged targetRef fields
    const params = paramsWithPrivilegedRef as Record<string, unknown>;
    const targetRef = params.targetRef as Record<string, unknown>;
    targetRef.runtimeActionId = 'injected-runtime-action-id';
    targetRef.subagentRunId = 'injected-subagent-run-id';
    targetRef.workflowRunId = 'injected-workflow-run-id';

    const result = validateForegroundDecideParams(params, {
      toolCatalog: ['file_read'],
      effectiveToolIds: ['file_read'],
    });

    expect(result.valid).toBe(true);
    // Privileged fields must be stripped
    const ref = result.decision!.targetRef;
    expect(ref).toBeDefined();
    expect(ref!.plannerRunId).toBe('safe-planner-id');
    expect(ref!.planId).toBe('safe-plan-id');
    expect(ref).not.toHaveProperty('runtimeActionId');
    expect(ref).not.toHaveProperty('subagentRunId');
    expect(ref).not.toHaveProperty('workflowRunId');
  });

  it('FOREGROUND_DECIDE_SCHEMA has additionalProperties:false — blocks runtimeAction at schema level', () => {
    const schema = FOREGROUND_DECIDE_SCHEMA.function.parameters;
    // additionalProperties must be false to reject unknown fields
    expect(schema.additionalProperties).toBe(false);
    // runtimeAction must NOT be in the schema properties
    expect(schema.properties).not.toHaveProperty('runtimeAction');
    expect(schema.properties).not.toHaveProperty('targetRuntime');
    expect(schema.properties).not.toHaveProperty('actionId');
  });

  it('server creates runtimeAction for status_query route — never from LLM output', () => {
    // Validate LLM output without runtimeAction — server will create it
    const params = makeValidDecideParams({
      route: 'status_query',
      reason: 'User wants status',
    });

    const result = validateForegroundDecideParams(params, {
      toolCatalog: ['status_query'],
      effectiveToolIds: ['status_query'],
    });

    expect(result.valid).toBe(true);
    expect(result.decision!.route).toBe('status_query');
    // Decision has no runtimeAction — server creates it in mapRouterOutputToDecision
    expect(result.decision!.runtimeAction).toBeUndefined();
  });

  it('server creates runtimeAction for dispatch_subagent route — never from LLM output', () => {
    const params = makeValidDecideParams({
      route: 'dispatch_subagent',
      reason: 'Need specialized subagent',
      suggestedTools: ['web_search'],
    });

    const result = validateForegroundDecideParams(params, {
      toolCatalog: ['web_search'],
      effectiveToolIds: ['web_search'],
    });

    expect(result.valid).toBe(true);
    expect(result.decision!.route).toBe('dispatch_subagent');
    // No runtimeAction from LLM — server creates it in mapRouterOutputToDecision
    expect(result.decision!.runtimeAction).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. High-Risk Tools Absent by Default (Least-Privilege Projection)
// ═══════════════════════════════════════════════════════════════════════════════

describe('High-risk tools absent by default projection', () => {
  const mockInput = {
    userId: 'test-user',
    sessionId: 'test-session',
    turnId: 'test-turn',
    message: 'test',
    timestamp: new Date().toISOString(),
    hydratedState: {} as never,
    foregroundState: {} as never,
  };

  it('default projection excludes write-category tools', () => {
    const allTools = [
      makeToolDef('file_read', 'read', 'low'),
      makeToolDef('file_write', 'write', 'medium'),
      makeToolDef('web_search', 'search', 'low'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('file_read');
    expect(projection.allowedToolIds).toContain('web_search');
    expect(projection.allowedToolIds).not.toContain('file_write');
  });

  it('default projection excludes delete-category tools', () => {
    const allTools = [
      makeToolDef('docs_search', 'search', 'low'),
      makeToolDef('delete_data', 'delete', 'high'),
      makeToolDef('remove_item', 'delete', 'high'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('docs_search');
    expect(projection.allowedToolIds).not.toContain('delete_data');
    expect(projection.allowedToolIds).not.toContain('remove_item');
  });

  it('default projection excludes execute-category tools', () => {
    const allTools = [
      makeToolDef('status_query', 'internal', 'low'),
      makeToolDef('run_command', 'execute', 'high'),
      makeToolDef('deploy_service', 'execute', 'restricted'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('status_query');
    expect(projection.allowedToolIds).not.toContain('run_command');
    expect(projection.allowedToolIds).not.toContain('deploy_service');
  });

  it('default projection excludes admin-category tools', () => {
    const allTools = [
      makeToolDef('memory_retrieve', 'read', 'low'),
      makeToolDef('config_update', 'admin', 'high'),
      makeToolDef('user_manage', 'admin', 'restricted'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('memory_retrieve');
    expect(projection.allowedToolIds).not.toContain('config_update');
    expect(projection.allowedToolIds).not.toContain('user_manage');
  });

  it('default projection excludes send-category tools', () => {
    const allTools = [
      makeToolDef('transcript_search', 'search', 'low'),
      makeToolDef('send_email', 'send', 'medium'),
      makeToolDef('notify_user', 'send', 'low'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('transcript_search');
    expect(projection.allowedToolIds).not.toContain('send_email');
    expect(projection.allowedToolIds).not.toContain('notify_user');
  });

  it('default projection includes only safe categories (read, search, internal)', () => {
    const allTools = [
      makeToolDef('file_read', 'read', 'low'),
      makeToolDef('web_search', 'search', 'low'),
      makeToolDef('ask_user', 'internal', 'low'),
      makeToolDef('file_write', 'write', 'medium'),
      makeToolDef('delete_data', 'delete', 'high'),
      makeToolDef('send_email', 'send', 'medium'),
      makeToolDef('run_script', 'execute', 'high'),
      makeToolDef('config_update', 'admin', 'high'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toEqual(
      expect.arrayContaining(['file_read', 'web_search', 'ask_user']),
    );
    expect(projection.allowedToolIds).toHaveLength(3);
  });

  it('default projection excludes high-sensitivity tools even in safe categories', () => {
    const allTools = [
      makeToolDef('file_read', 'read', 'low'),
      makeToolDef('file_read_restricted', 'read', 'restricted'),
      makeToolDef('search_low', 'search', 'low'),
      makeToolDef('search_high', 'search', 'high'),
    ];

    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, allTools);

    expect(projection.allowedToolIds).toContain('file_read');
    expect(projection.allowedToolIds).toContain('search_low');
    // High/restricted sensitivity excluded even from safe categories
    expect(projection.allowedToolIds).not.toContain('file_read_restricted');
    expect(projection.allowedToolIds).not.toContain('search_high');
  });

  it('HIGH_RISK_TOOL_CATEGORIES constant contains expected categories', () => {
    expect(HIGH_RISK_TOOL_CATEGORIES.has('write')).toBe(true);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('delete')).toBe(true);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('send')).toBe(true);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('execute')).toBe(true);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('admin')).toBe(true);
    // Safe categories must NOT be in high-risk
    expect(HIGH_RISK_TOOL_CATEGORIES.has('read')).toBe(false);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('search')).toBe(false);
    expect(HIGH_RISK_TOOL_CATEGORIES.has('internal')).toBe(false);
  });

  it('empty tool catalog produces empty projection', () => {
    const projection = buildForegroundToolProjection(mockInput as unknown as ForegroundTurnInput, []);
    expect(projection.allowedToolIds).toEqual([]);
    expect(projection.toolDefinitions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Redaction Suite — Sensitive Fields Redacted in Transcript Persistence
// ═══════════════════════════════════════════════════════════════════════════════

describe('Redaction suite for foreground/search tool summaries', () => {
  it('redacts apiKey from tool result payload', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      toolName: 'connector_auth',
      result: {
        apiKey: SENTINEL_API_KEY,
        status: 'authenticated',
      },
    };

    const redacted = redactor.redact(payload);
    expect(redacted.result.apiKey).toBe('[REDACTED]');
    expect(redacted.result.status).toBe('authenticated');
  });

  it('redacts password from tool result payload', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      toolName: 'database_query',
      args: {
        password: SENTINEL_PASSWORD,
        host: 'localhost',
      },
    };

    const redacted = redactor.redact(payload);
    expect(redacted.args.password).toBe('[REDACTED]');
    expect(redacted.args.host).toBe('localhost');
  });

  it('redacts token from tool result payload', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      toolName: 'oauth_refresh',
      result: {
        token: SENTINEL_TOKEN,
        expiresIn: 3600,
      },
    };

    const redacted = redactor.redact(payload);
    expect(redacted.result.token).toBe('[REDACTED]');
    expect(redacted.result.expiresIn).toBe(3600);
  });

  it('redacts secret from tool result payload', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      toolName: 'webhook_setup',
      args: {
        secret: SENTINEL_SECRET,
        url: 'https://example.com/webhook',
      },
    };

    const redacted = redactor.redact(payload);
    expect(redacted.args.secret).toBe('[REDACTED]');
    expect(redacted.args.url).toBe('https://example.com/webhook');
  });

  it('redacts all sensitive fields in combined foreground tool payload', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      toolName: 'connector_config',
      args: {
        apiKey: SENTINEL_API_KEY,
        password: SENTINEL_PASSWORD,
        token: SENTINEL_TOKEN,
        secret: SENTINEL_SECRET,
        endpoint: 'https://api.example.com',
      },
      result: {
        accessToken: 'Bearer super-secret-access-token',
        refreshToken: 'refresh-super-secret',
        userId: 'user-123',
      },
    };

    const redacted = redactor.redact(payload);

    // All sensitive fields must be redacted
    expect(redacted.args.apiKey).toBe('[REDACTED]');
    expect(redacted.args.password).toBe('[REDACTED]');
    expect(redacted.args.token).toBe('[REDACTED]');
    expect(redacted.args.secret).toBe('[REDACTED]');
    expect(redacted.result.accessToken).toBe('[REDACTED]');
    expect(redacted.result.refreshToken).toBe('[REDACTED]');

    // Non-sensitive fields preserved
    expect(redacted.args.endpoint).toBe('https://api.example.com');
    expect(redacted.result.userId).toBe('user-123');
  });

  it('redacts apiKey patterns in string content', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      log: `Connector authenticated with api_key: "${SENTINEL_API_KEY}" successfully`,
    };

    const redacted = redactor.redact(payload);
    expect(redacted.log).not.toContain(SENTINEL_API_KEY);
    expect(redacted.log).toContain('[REDACTED]');
  });

  it('redacts password patterns in string content', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      log: `Database connection with password: "${SENTINEL_PASSWORD}" established`,
    };

    const redacted = redactor.redact(payload);
    expect(redacted.log).not.toContain(SENTINEL_PASSWORD);
    expect(redacted.log).toContain('[REDACTED]');
  });

  it('redacts authorization headers in content', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      log: `authorization: "Bearer ${SENTINEL_TOKEN}" sent to upstream`,
    };

    const redacted = redactor.redact(payload);
    expect(redacted.log).not.toContain(SENTINEL_TOKEN);
    expect(redacted.log).toContain('[REDACTED]');
  });

  it('transcript mapper never includes raw tool params or results', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      iterationsUsed: 2,
      finalResponse: 'Done',
      toolCalls: [
        {
          toolCallId: 'tc-1',
          toolName: 'connector_auth',
          params: { apiKey: SENTINEL_API_KEY, password: SENTINEL_PASSWORD },
        },
        {
          toolCallId: 'tc-2',
          toolName: 'web_search',
          params: { query: 'test search' },
        },
      ],
      transcript: [],
    };

    const summary = mapKernelResultToTranscript(kernelResult);

    expect(summary).toBeDefined();
    const summaries = summary!.toolCallSummaries!;
    expect(summaries).toHaveLength(2);

    // Verify NO raw params or results leak through
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(SENTINEL_API_KEY);
    expect(serialized).not.toContain(SENTINEL_PASSWORD);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect(serialized).not.toContain(SENTINEL_SECRET);
    expect(serialized).not.toContain('test search');

    // Only safe fields are present
    expect(summaries[0]!.toolCallId).toBe('tc-1');
    expect(summaries[0]!.toolName).toBe('connector_auth');
    expect(summaries[0]!.status).toBe('completed');
    expect(summaries[0]!.summary).toBe('Tool: connector_auth');
  });

  it('transcript mapper returns undefined for empty tool calls', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
    };

    const summary = mapKernelResultToTranscript(kernelResult);
    expect(summary).toBeUndefined();
  });

  it('transcript mapper returns undefined for undefined input', () => {
    const summary = mapKernelResultToTranscript(undefined);
    expect(summary).toBeUndefined();
  });

  it('redacts PEM private key blocks in tool output', () => {
    const redactor = createModelInputRedactor();
    const pemKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdef
-----END RSA PRIVATE KEY-----`;

    const payload = {
      toolName: 'key_generate',
      result: {
        privateKey: pemKey,
        keyId: 'key-123',
      },
    };

    const redacted = redactor.redact(payload);
    // privateKey field is redacted by key-based matching
    expect(redacted.result.privateKey).toBe('[REDACTED]');
    expect(redacted.result.keyId).toBe('key-123');
  });

  it('redacts credentials and authHeader fields', () => {
    const redactor = createModelInputRedactor();
    const payload = {
      credentials: { user: 'admin', pass: 'secret123' },
      authHeader: 'Bearer super-secret-token',
      normalField: 'visible',
    };

    const redacted = redactor.redact(payload);
    expect(redacted.credentials).toBe('[REDACTED]');
    expect(redacted.authHeader).toBe('[REDACTED]');
    expect(redacted.normalField).toBe('visible');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Kernel Failure Does Not Invoke Route-Only Fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('Kernel failure does not invoke route-only fallback', () => {
  function makeTurnInput(): ForegroundTurnInput {
    return {
      userId: 'test-user',
      sessionId: 'test-session',
      turnId: 'test-turn-001',
      message: 'Hello, what is the weather?',
      timestamp: new Date().toISOString(),
      hydratedState: {
        userContext: {
          userId: 'test-user',
          sessionId: 'test-session',
        },
        sessionContext: {
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      } as never,
      foregroundState: {
        conversationHistory: [],
        resolvedProvider: 'openrouter',
        resolvedModel: 'gpt-4o-mini',
        hydratedSession: {
          userContext: {
            userId: 'test-user',
            sessionId: 'test-session',
          },
          sessionContext: {
            activePlannerRunIds: [],
            activeBackgroundRunIds: [],
          },
        },
        activeWorkRefs: { activeRuns: [] },
      } as never,
    };
  }

  it('kernel.run() rejection propagates — processMessage is NOT called as fallback', async () => {
    const throwingKernel = {
      run: vi.fn().mockRejectedValue(new Error('Kernel exploded')),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: throwingKernel });
    const processMessageSpy = vi.spyOn(agent, 'processMessage');

    await expect(agent.runTurn!(makeTurnInput())).rejects.toThrow('Kernel exploded');

    expect(processMessageSpy).not.toHaveBeenCalled();
    processMessageSpy.mockRestore();
  });

  it('kernel.run() non-Error rejection propagates — processMessage is NOT called as fallback', async () => {
    const throwingKernel = {
      run: vi.fn().mockRejectedValue('string error thrown'),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: throwingKernel });
    const processMessageSpy = vi.spyOn(agent, 'processMessage');

    await expect(agent.runTurn!(makeTurnInput())).rejects.toBe('string error thrown');

    expect(processMessageSpy).not.toHaveBeenCalled();
    processMessageSpy.mockRestore();
  });

  it('kernel timeout produces safe failed result without route dispatch', async () => {
    const timeoutKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'timeout',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'TIMEOUT', message: 'Kernel timed out after 60000ms' },
      } satisfies KernelRunResult),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: timeoutKernel });
    const processMessageSpy = vi.spyOn(agent, 'processMessage');

    const result = await agent.runTurn!(makeTurnInput());

    expect(result.status).toBe('failed');
    expect(result.error!.code).toBe('TIMEOUT');
    // User message must not expose timeout duration
    expect(result.finalResponse).not.toContain('60000');
    expect(processMessageSpy).not.toHaveBeenCalled();

    processMessageSpy.mockRestore();
  });

  it('kernel max_iterations produces safe failed result without route dispatch', async () => {
    const maxIterKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 6,
        toolCalls: [
          {
            toolCallId: 'tc-1',
            toolName: 'web_search',
            params: { query: 'test' },
          },
        ],
        transcript: [],
        error: { code: 'MAX_ITERATIONS_EXCEEDED', message: 'Max iterations reached' },
      } satisfies KernelRunResult),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: maxIterKernel });
    const processMessageSpy = vi.spyOn(agent, 'processMessage');

    const result = await agent.runTurn!(makeTurnInput());

    expect(result.status).toBe('failed');
    expect(result.error!.code).toBe('MAX_ITERATIONS_EXCEEDED');
    // User message must not expose internal iteration count
    expect(result.finalResponse).not.toContain('6');
    expect(processMessageSpy).not.toHaveBeenCalled();

    processMessageSpy.mockRestore();
  });

  it('kernel failure result never leaks raw error messages to user', async () => {
    const detailedErrorKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'failed',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: {
          code: 'LLM_ERROR',
          message: 'Provider openrouter returned 429: rate limit exceeded for API key sk-or-v1-secret123',
        },
      } satisfies KernelRunResult),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: detailedErrorKernel });

    const result = await agent.runTurn!(makeTurnInput());

    expect(result.status).toBe('failed');
    // Final response must NOT contain sensitive details
    expect(result.finalResponse).not.toContain('sk-or-v1-secret123');
    expect(result.finalResponse).not.toContain('429');
    expect(result.finalResponse).not.toContain('rate limit');
    // Error code is present for diagnostics but user message is safe
    expect(result.error!.code).toBe('LLM_ERROR');
  });

  it('completed kernel result passes through without triggering processMessage', async () => {
    const successKernel = {
      run: vi.fn().mockResolvedValue({
        finalStatus: 'completed',
        iterationsUsed: 1,
        finalResponse: 'The weather is sunny today.',
        toolCalls: [
          {
            toolCallId: 'tc-1',
            toolName: 'web_search',
            params: { query: 'weather' },
          },
        ],
        transcript: [],
      } satisfies KernelRunResult),
    } as unknown as AgentKernel;

    const agent = createForegroundAgent({ agentKernel: successKernel });
    const processMessageSpy = vi.spyOn(agent, 'processMessage');

    const result = await agent.runTurn!(makeTurnInput());

    expect(result.status).toBe('completed');
    expect(result.finalResponse).toBe('The weather is sunny today.');
    expect(processMessageSpy).not.toHaveBeenCalled();

    processMessageSpy.mockRestore();
  });

  it('deprecated ForegroundKernelRunner delegates to runTurn — never to processMessage route switch', async () => {
    // Import the deprecated runner to verify it delegates correctly
    const { createForegroundKernelRunner } = await import('../../../src/foreground/foreground-kernel-runner.js');

    const mockRunTurn = vi.fn().mockResolvedValue({
      status: 'completed',
      finalResponse: 'Delegated to runTurn',
      decisionTrace: {
        route: 'answer_directly',
        requiresPlanner: false,
        reason: 'Delegated',
      },
    });

    const mockForegroundAgent = {
      runTurn: mockRunTurn,
      processMessage: vi.fn(),
      setAgentKernel: vi.fn(),
    };

    const runner = createForegroundKernelRunner({
      foregroundAgent: mockForegroundAgent as never,
      agentKernel: {} as never,
      runtimeDispatcher: {} as never,
      plannerRuntime: {} as never,
      llmAdapter: {} as never,
    });

    const result = await runner.runTurn(makeTurnInput());

    // Deprecated runner delegates to foregroundAgent.runTurn
    expect(mockRunTurn).toHaveBeenCalled();
    // processMessage is NEVER called by the runner
    expect(mockForegroundAgent.processMessage).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });
});
