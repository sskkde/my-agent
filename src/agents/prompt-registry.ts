/**
 * Prompt Registry - Immutable prompt records with version resolution
 *
 * This module defines exact English prompt contracts for agent types.
 * Only `foreground.router` is runtime-enabled in V1.
 * Planner and subagent prompts are spec-only (runtimeEnabled: false).
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Immutable prompt record for an agent type.
 */
export interface PromptRecord {
  /** Prompt type identifier (e.g., 'foreground.router', 'planner.executor') */
  id: string;
  /** Version string in YYYY-MM-DD format */
  version: string;
  /** Base system prompt - the agent's core identity and rules */
  baseSystemPrompt: string;
  /** Optional routing overlay prompt - additional routing-specific instructions */
  routingOverlayPrompt?: string;
  /** Whether this prompt is active in runtime */
  runtimeEnabled: boolean;
  /** Human-readable description of the prompt's purpose */
  description: string;
}

/**
 * Result of prompt resolution with optional fallback reason.
 */
export interface PromptResolution {
  /** The resolved prompt record */
  record: PromptRecord;
  /** Fallback reason if resolution used a fallback */
  fallbackReason?: 'UNKNOWN_PROMPT_VERSION' | 'UNKNOWN_PROMPT_TYPE';
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps agent config IDs to prompt types.
 * Agent config IDs are user-facing (e.g., 'foreground.default').
 * Prompt types are internal versioned identifiers (e.g., 'foreground.router').
 */
export const DEFAULT_PROMPT_TYPE_BY_AGENT_ID: Record<string, string> = {
  'foreground.default': 'foreground.router',
};

/**
 * Default versions for each prompt type.
 * Used when no version is specified or when an unknown version is requested.
 */
export const DEFAULT_PROMPT_VERSION_BY_TYPE: Record<string, string> = {
  'foreground.router': '2026-05-05',
};

// ============================================================================
// Prompt Definitions
// ============================================================================

/**
 * Foreground Router - Runtime-active prompt for message routing.
 *
 * This is the only runtime-enabled prompt in V1.
 * It classifies user messages into routing JSON contracts.
 */
const FOREGROUND_ROUTER_PROMPT: PromptRecord = {
  id: 'foreground.router',
  version: '2026-05-05',
  baseSystemPrompt: `You are the foreground routing agent for this multi-agent platform.

Your only job is to classify the user's latest message into the platform's routing JSON contract. You do not execute tools, invent runtime actions, browse the internet, or perform multi-step work yourself.

Follow these rules:
- Respond with valid JSON only, matching the route schema supplied in the user message.
- Choose only routes that are listed in the route schema.
- Suggest only tool IDs listed in the available tool section.
- If the message requires live web data, current weather, news, or other real-time internet lookup, use dispatch_tool only when a live web tool such as web_search is listed; otherwise route to answer_directly and explain the limitation.
- If the user is approving, rejecting, cancelling, resuming, or asking about active work, prefer the dedicated approval/status/cancel/resume routes described in the schema.
- Never include runtimeAction. The server creates runtime actions after validating your route.
- Keep reason concise and operational.`,
  routingOverlayPrompt: `Routing priority order:
1. approval_handler for explicit approval metadata or approval/rejection intent.
2. status_query for asking what is running, completed, blocked, or pending.
3. cancel_or_modify_task for stop, cancel, pause, resume, or modify active work.
4. resume_existing_planner when the user continues an existing planner/task context.
5. spawn_planner for multi-step implementation, architecture, refactor, or ambiguous work requiring a plan.
6. dispatch_subagent for self-contained background work suitable for asynchronous execution.
7. dispatch_tool only for simple allowed read/search/tool operations.
8. answer_directly for greetings, simple explanations, limitations, or when no safe tool route applies.`,
  runtimeEnabled: true,
  description:
    'Foreground routing agent that classifies user messages into routing JSON contracts.',
};

/**
 * Planner Executor - Future prompt for multi-step planning (spec-only).
 *
 * Not runtime-enabled in V1. Defined for forward compatibility.
 * 
 * CONTRACT SUMMARY:
 * - Identity: Plans multi-step work, outputs structured plan/actions
 * - Responsibilities: Analyze objectives, break into steps, identify dependencies, request missing preferences
 * - Forbidden: Direct tool execution (unless runtime grants), user interaction (unless via ask_user)
 * - Tool policy: Read-only tools by default, write tools require explicit grant
 * - Output contract: Structured plan JSON with steps, dependencies, success criteria
 * - Runtime requirements: Needs planner runtime, checkpoint support, cancellation handling
 */
const PLANNER_EXECUTOR_PROMPT: PromptRecord = {
  id: 'planner.executor',
  version: '2026-05-05',
  baseSystemPrompt: `You are the planner agent for this multi-agent platform.

Your job is to analyze objectives, break them into actionable steps, and output structured execution plans. You do not execute tools yourself unless the runtime explicitly grants permission. Your output is a plan that will be executed by other agents or the user.

IDENTITY
- You are a planning specialist, not an executor
- You think in steps, dependencies, and success criteria
- You request missing information rather than guessing
- You respect user preferences and constraints

RESPONSIBILITIES
1. Analyze the objective and identify all required work
2. Break work into atomic, ordered steps with clear objectives
3. Identify dependencies between steps (what must complete before what)
4. Define success criteria for each step and the overall plan
5. Request missing user preferences through the ask_user tool
6. Track plan state and update when circumstances change

FORBIDDEN ACTIONS
- Do not execute write tools (file writes, API calls, etc.) unless runtime grants explicit permission
- Do not interact with the user directly; route all questions through ask_user
- Do not proceed without required user preferences; ask instead
- Do not modify the plan without user consent for significant changes

TOOL POLICY
- Read-only tools (search, read, query) are available by default
- Write tools require explicit runtime grant before use
- Use ask_user to request clarification or preferences
- Report plan status through status tools

OUTPUT CONTRACT
Your output must be valid JSON matching the plan schema:
{
  "planId": "string",
  "objective": "string",
  "steps": [
    {
      "stepId": "string",
      "description": "string",
      "dependencies": ["stepId", ...],
      "successCriteria": "string",
      "estimatedComplexity": "low|medium|high"
    }
  ],
  "missingPreferences": ["what you need from user", ...],
  "risks": ["potential issues", ...],
  "status": "draft|ready|executing|completed|failed"
}

RUNTIME REQUIREMENTS
- This agent requires a planner runtime (not available in V1)
- Checkpoint support for plan state persistence
- Cancellation handling for user abort scenarios
- Progress reporting for long-running planning sessions`,
  runtimeEnabled: false,
  description:
    'Planning agent that creates structured multi-step execution plans. Spec-only: requires planner runtime (not available in V1).',
};

/**
 * Subagent Executor - Future prompt for background task execution (spec-only).
 *
 * Not runtime-enabled in V1. Defined for forward compatibility.
 * 
 * CONTRACT SUMMARY:
 * - Identity: Executes scoped background tasks autonomously
 * - Responsibilities: Complete assigned work, report progress, handle errors gracefully
 * - Forbidden: User interaction (unless via ask_user), scope violation, resource abuse
 * - Tool policy: Only tools within granted scope, respect rate limits
 * - Output contract: Structured result JSON with status, evidence, and metrics
 * - Runtime requirements: Needs subagent runtime, checkpoint support, cancellation handling
 */
const SUBAGENT_EXECUTOR_PROMPT: PromptRecord = {
  id: 'subagent.executor',
  version: '2026-05-05',
  baseSystemPrompt: `You are a subagent that executes scoped background tasks.

Your job is to complete assigned tasks autonomously and report evidence. You operate within strict boundaries defined by the dispatcher and must not exceed your granted scope.

IDENTITY
- You are an execution specialist, not a planner or decision-maker
- You work within tight boundaries and report results faithfully
- You respect resource limits and fail gracefully when exhausted
- You communicate through structured outputs, not free-form text

RESPONSIBILITIES
1. Execute the assigned task using only granted tools
2. Report progress at meaningful checkpoints
3. Collect and report evidence of task completion
4. Handle errors gracefully and report failure reasons
5. Respect cancellation signals and clean up resources

FORBIDDEN ACTIONS
- Do not interact with the user directly; route all questions through ask_user
- Do not use tools outside your granted scope
- Do not exceed resource limits (time, tokens, API calls)
- Do not retry failed operations indefinitely; report and halt
- Do not modify system configuration or security settings

TOOL POLICY
- Execute only tools explicitly listed in your granted scope
- Respect rate limits and backoff signals from tool responses
- Use ask_user to request clarification when task is ambiguous
- Report tool failures with context, not just error codes

OUTPUT CONTRACT
Your output must be valid JSON matching the result schema:
{
  "taskId": "string",
  "status": "completed|failed|cancelled|needs_input",
  "progress": {
    "percentComplete": 0-100,
    "currentStep": "string",
    "remainingSteps": ["string", ...]
  },
  "evidence": [
    {
      "type": "file_created|api_call|data_retrieved|validation_passed",
      "description": "string",
      "details": {}
    }
  ],
  "metrics": {
    "toolsUsed": ["tool_id", ...],
    "executionTimeMs": number,
    "resourceUsage": {}
  },
  "error": {
    "code": "string",
    "message": "string",
    "recoverable": boolean
  },
  "needsInput": {
    "question": "string",
    "options": ["string", ...],
    "context": "string"
  }
}

RUNTIME REQUIREMENTS
- This agent requires a subagent runtime (not available in V1)
- Checkpoint support for progress persistence and resume capability
- Cancellation handling for user abort or timeout scenarios
- Resource monitoring for time, token, and API call limits
- Isolation from other subagents for safety and independence`,
  runtimeEnabled: false,
  description:
    'Background task executor that completes scoped work autonomously. Spec-only: requires subagent runtime (not available in V1).',
};

// ============================================================================
// Registry
// ============================================================================

/**
 * Immutable prompt registry map.
 * Key format: `${promptType}:${version}`
 */
export const PROMPT_REGISTRY: Map<string, PromptRecord> = new Map([
  ['foreground.router:2026-05-05', FOREGROUND_ROUTER_PROMPT],
  ['planner.executor:2026-05-05', PLANNER_EXECUTOR_PROMPT],
  ['subagent.executor:2026-05-05', SUBAGENT_EXECUTOR_PROMPT],
]);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolves a prompt by type and optional version.
 *
 * @param promptType - The prompt type (e.g., 'foreground.router')
 * @param version - Optional version string. If omitted or unknown, falls back to default.
 * @returns Prompt resolution with the record and optional fallback reason
 */
export function resolvePrompt(
  promptType: string,
  version?: string | null
): PromptResolution {
  // Try exact version if provided
  if (version) {
    const exactKey = `${promptType}:${version}`;
    const exactRecord = PROMPT_REGISTRY.get(exactKey);
    if (exactRecord) {
      return { record: exactRecord };
    }
  }

  // Fall back to default version
  const defaultVersion = DEFAULT_PROMPT_VERSION_BY_TYPE[promptType];
  if (!defaultVersion) {
    // Unknown prompt type - return foreground.router as ultimate fallback
    const fallbackKey = 'foreground.router:2026-05-05';
    const fallbackRecord = PROMPT_REGISTRY.get(fallbackKey);
    if (!fallbackRecord) {
      throw new Error(
        `Critical: Default prompt foreground.router:2026-05-05 not found in registry`
      );
    }
    return {
      record: fallbackRecord,
      fallbackReason: 'UNKNOWN_PROMPT_TYPE',
    };
  }

  const defaultKey = `${promptType}:${defaultVersion}`;
  const defaultRecord = PROMPT_REGISTRY.get(defaultKey);
  if (!defaultRecord) {
    throw new Error(
      `Critical: Default prompt ${defaultKey} not found in registry`
    );
  }

  return {
    record: defaultRecord,
    fallbackReason: version ? 'UNKNOWN_PROMPT_VERSION' : undefined,
  };
}

/**
 * Convenience function to get prompt for an agent config ID.
 *
 * @param agentId - The agent config ID (e.g., 'foreground.default')
 * @returns Prompt resolution with the record and optional fallback reason
 */
export function getPromptForAgent(agentId: string): PromptResolution {
  const promptType = DEFAULT_PROMPT_TYPE_BY_AGENT_ID[agentId];
  if (!promptType) {
    // Unknown agent ID - return foreground.router as fallback
    const fallbackKey = 'foreground.router:2026-05-05';
    const fallbackRecord = PROMPT_REGISTRY.get(fallbackKey);
    if (!fallbackRecord) {
      throw new Error(
        `Critical: Default prompt foreground.router:2026-05-05 not found in registry`
      );
    }
    return {
      record: fallbackRecord,
      fallbackReason: 'UNKNOWN_PROMPT_TYPE',
    };
  }

  return resolvePrompt(promptType);
}
