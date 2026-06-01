/**
 * Foreground Decision Validator
 *
 * Validates raw `ForegroundDecideParams` from the LLM, normalizes them into a
 * `ForegroundDecision`, and enforces security invariants:
 *   - `runtimeAction` is always rejected/ignored (server creates all runtime actions)
 *   - Privileged `targetRef` fields are stripped (server-assigned only)
 *   - `suggestedTools` are filtered against the known tool catalog AND effective allowlist
 *
 * This module is stateless and side-effect-free — it accepts all dependencies
 * as parameters rather than calling getToolCatalog() directly.
 */

import type { ForegroundDecideParams } from './foreground-decision-schema.js';
import type {
  ForegroundDecision,
  ForegroundDecisionRoute,
  ForegroundTargetRef,
  TaskComplexity,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid routing decisions for `foreground_decide` */
const VALID_ROUTES: readonly ForegroundDecisionRoute[] = [
  'answer_directly',
  'dispatch_tool',
  'dispatch_subagent',
  'spawn_planner',
  'resume_existing_planner',
  'approval_handler',
  'cancel_or_modify_task',
  'status_query',
] as const;

/** Valid task complexity levels */
const VALID_COMPLEXITIES: readonly TaskComplexity[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

/** Maximum allowed length for the `reason` field */
const MAX_REASON_LENGTH = 1000;

/**
 * Tool alias map — resolves common shorthand names to canonical tool IDs.
 * Copied from foreground-agent.ts to keep the validator self-contained.
 * Alias values use underscore-separated canonical names (LLM-safe).
 */
const TOOL_ALIASES: Record<string, string[]> = {
  search: ['docs_search'],
  'web.search': ['web_search'],
  'internet.search': ['web_search'],
  web: ['web_search'],
  docs: ['docs_search'],
  'documentation.search': ['docs_search'],
  transcript: ['transcript_search'],
  'memory.search': ['memory_retrieve'],
  memory: ['memory_retrieve'],
  status: ['status_query'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured error codes for validation failures */
export type ForegroundDecideErrorCode =
  | 'INVALID_PARAMS'
  | 'INVALID_ROUTE'
  | 'EMPTY_REASON'
  | 'INVALID_COMPLEXITY'
  | 'INVALID_ESTIMATED_STEPS'
  | 'INVALID_SCHEMA_VERSION'
  | 'INVALID_TOOLS';

/**
 * Result of validating `ForegroundDecideParams`.
 *
 * On success, `valid` is `true` and `decision` contains the normalized
 * `ForegroundDecision`. On failure, `valid` is `false` and `error` contains
 * a structured error code and human-readable message.
 */
export interface ForegroundDecideValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** The normalized decision (only present when `valid` is true) */
  decision?: ForegroundDecision;
  /** Structured error info (only present when `valid` is false) */
  error?: {
    /** Machine-readable error code */
    code: ForegroundDecideErrorCode;
    /** Human-readable error message */
    message: string;
  };
}

/** Options for the validation function */
export interface ValidateForegroundDecideOptions {
  /** Known tool names from the tool catalog (e.g. from getToolCatalog()) */
  toolCatalog: string[];
  /** Effective allowed tool IDs for this session (the allowlist) */
  effectiveToolIds: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate raw `ForegroundDecideParams` and produce a normalized
 * `ForegroundDecision`.
 *
 * Performs the following checks:
 * 1. `params` is a non-null object
 * 2. `schemaVersion` equals `"1.0"`
 * 3. `route` is a valid `ForegroundDecisionRoute`
 * 4. `reason` is a non-empty string (max 1000 chars)
 * 5. `requiresPlanner` is boolean
 * 6. `userVisibleResponse` is string if present
 * 7. `suggestedTools` is string[] if present, filtered against catalog + allowlist
 * 8. `estimatedSteps` is number in 1–50 if present
 * 9. `complexity` is a valid `TaskComplexity` if present
 * 10. `runtimeAction` is silently ignored (never propagated)
 *
 * @param params - Raw params from the LLM tool call (unknown — not trusted)
 * @param options - Tool catalog and effective allowlist for filtering
 * @returns Structured validation result with normalized decision or error
 */
export function validateForegroundDecideParams(
  params: unknown,
  options: ValidateForegroundDecideOptions,
): ForegroundDecideValidationResult {
  // ── 1. Must be a non-null, non-array object ──────────────────────────────
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return invalid('INVALID_PARAMS', 'Parameters must be a non-null JSON object');
  }

  const obj = params as Record<string, unknown>;

  // ── 2. Schema version ────────────────────────────────────────────────────
  if (obj.schemaVersion !== '1.0') {
    return invalid(
      'INVALID_SCHEMA_VERSION',
      `schemaVersion must be "1.0", got: ${JSON.stringify(obj.schemaVersion)}`,
    );
  }

  // ── 3. Route ─────────────────────────────────────────────────────────────
  if (typeof obj.route !== 'string' || !isValidRoute(obj.route)) {
    return invalid(
      'INVALID_ROUTE',
      `route must be one of: ${VALID_ROUTES.join(', ')}. Got: ${JSON.stringify(obj.route)}`,
    );
  }
  const route = obj.route as ForegroundDecisionRoute;

  // ── 4. Reason ────────────────────────────────────────────────────────────
  if (typeof obj.reason !== 'string') {
    return invalid('EMPTY_REASON', 'reason must be a string');
  }
  const trimmedReason = obj.reason.trim();
  if (trimmedReason.length === 0) {
    return invalid('EMPTY_REASON', 'reason must be a non-empty string');
  }
  if (trimmedReason.length > MAX_REASON_LENGTH) {
    return invalid(
      'EMPTY_REASON',
      `reason must be at most ${MAX_REASON_LENGTH} characters, got: ${trimmedReason.length}`,
    );
  }

  // ── 5. requiresPlanner ───────────────────────────────────────────────────
  if (typeof obj.requiresPlanner !== 'boolean') {
    return invalid('INVALID_PARAMS', 'requiresPlanner must be a boolean');
  }

  // ── 6. userVisibleResponse (optional) ────────────────────────────────────
  if (obj.userVisibleResponse !== undefined && typeof obj.userVisibleResponse !== 'string') {
    return invalid('INVALID_PARAMS', 'userVisibleResponse must be a string if present');
  }

  // ── 7. suggestedTools (optional) ─────────────────────────────────────────
  let filteredTools: string[] | undefined;
  if (obj.suggestedTools !== undefined) {
    if (!Array.isArray(obj.suggestedTools) || !obj.suggestedTools.every(isString)) {
      return invalid('INVALID_TOOLS', 'suggestedTools must be an array of strings');
    }
    filteredTools = filterAllowedTools(
      obj.suggestedTools as string[],
      options.toolCatalog,
      options.effectiveToolIds,
    );
  }

  // ── 8. estimatedSteps (optional) ─────────────────────────────────────────
  if (obj.estimatedSteps !== undefined) {
    if (typeof obj.estimatedSteps !== 'number' || !Number.isInteger(obj.estimatedSteps)) {
      return invalid('INVALID_ESTIMATED_STEPS', 'estimatedSteps must be an integer');
    }
    if (obj.estimatedSteps < 1 || obj.estimatedSteps > 50) {
      return invalid(
        'INVALID_ESTIMATED_STEPS',
        `estimatedSteps must be between 1 and 50, got: ${obj.estimatedSteps}`,
      );
    }
  }

  // ── 9. complexity (optional) ─────────────────────────────────────────────
  if (obj.complexity !== undefined) {
    if (typeof obj.complexity !== 'string' || !isValidComplexity(obj.complexity)) {
      return invalid(
        'INVALID_COMPLEXITY',
        `complexity must be one of: ${VALID_COMPLEXITIES.join(', ')}. Got: ${JSON.stringify(obj.complexity)}`,
      );
    }
  }

  // ── 10. SECURITY: Strip runtimeAction ────────────────────────────────────
  // The LLM may hallucinate a runtimeAction — we never trust it.
  // The server creates all runtime actions based on the route.

  // ── Build normalized decision ────────────────────────────────────────────
  const decision = normalizeToForegroundDecision(
    {
      schemaVersion: obj.schemaVersion as string,
      route,
      requiresPlanner: obj.requiresPlanner as boolean,
      reason: trimmedReason,
      userVisibleResponse: obj.userVisibleResponse as string | undefined,
      suggestedTools: obj.suggestedTools as string[] | undefined,
      estimatedSteps: obj.estimatedSteps as number | undefined,
      complexity: obj.complexity as TaskComplexity | undefined,
      targetRef: obj.targetRef as ForegroundDecideParams['targetRef'],
    },
    filteredTools,
  );

  return { valid: true, decision };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize `ForegroundDecideParams` into a `ForegroundDecision`.
 *
 * This function:
 * - Maps schema fields to decision fields
 * - NEVER includes `runtimeAction` (even if the LLM provided one)
 * - Strips privileged `targetRef` fields, keeping only `plannerRunId` and `planId`
 * - Uses pre-filtered suggested tools if provided, otherwise passes through raw tools
 *
 * @param params - Validated `ForegroundDecideParams`
 * @param filteredTools - Pre-filtered suggested tools (from validation step)
 * @returns A clean `ForegroundDecision` safe for server-side use
 */
export function normalizeToForegroundDecision(
  params: ForegroundDecideParams,
  filteredTools?: string[],
): ForegroundDecision {
  const decision: ForegroundDecision = {
    route: params.route,
    requiresPlanner: params.requiresPlanner,
    reason: params.reason,
  };

  // Optional string fields
  if (params.userVisibleResponse !== undefined) {
    decision.userVisibleResponse = params.userVisibleResponse;
  }

  // Optional numeric/enum fields
  if (params.estimatedSteps !== undefined) {
    decision.estimatedSteps = params.estimatedSteps;
  }
  if (params.complexity !== undefined) {
    decision.complexity = params.complexity;
  }

  // Suggested tools — use pre-filtered version if available
  if (filteredTools !== undefined) {
    decision.suggestedTools = filteredTools;
  } else if (params.suggestedTools !== undefined) {
    decision.suggestedTools = params.suggestedTools;
  }

  // SECURITY: Only keep non-privileged targetRef fields
  if (params.targetRef) {
    const safeRef: ForegroundTargetRef = {};
    if (params.targetRef.plannerRunId !== undefined) {
      safeRef.plannerRunId = params.targetRef.plannerRunId;
    }
    if (params.targetRef.planId !== undefined) {
      safeRef.planId = params.targetRef.planId;
    }
    // Intentionally omit: runtimeActionId, subagentRunId, workflowRunId
    // These are server-assigned and must not come from the LLM
    decision.targetRef = safeRef;
  }

  // SECURITY: NEVER include runtimeAction — server creates all runtime actions
  // Even if the LLM hallucinated one in params, it is not propagated.

  return decision;
}

// ---------------------------------------------------------------------------
// Tool filtering
// ---------------------------------------------------------------------------

/**
 * Filter suggested tools against the known tool catalog AND the effective
 * allowlist, resolving aliases along the way.
 *
 * A tool passes filtering if and only if:
 *   1. It resolves (via alias or direct match) to a tool in `toolCatalog`, AND
 *   2. The resolved canonical name is in `effectiveToolIds`
 *
 * Results are deduplicated.
 *
 * @param suggestedTools - Raw tool IDs from the LLM
 * @param toolCatalog - Known tool names from the catalog
 * @param effectiveToolIds - Effective allowed tool IDs (allowlist)
 * @returns Filtered, deduplicated list of allowed tool IDs
 */
function filterAllowedTools(
  suggestedTools: string[],
  toolCatalog: string[],
  effectiveToolIds: string[],
): string[] {
  const catalogSet = new Set(toolCatalog);
  const effectiveSet = new Set(effectiveToolIds);

  const resolved: string[] = [];
  for (const toolId of suggestedTools) {
    // If the tool is directly in the catalog, use it as-is
    if (catalogSet.has(toolId)) {
      resolved.push(toolId);
      continue;
    }
    // Otherwise, try to resolve via aliases
    const aliases = TOOL_ALIASES[toolId];
    if (aliases) {
      for (const alias of aliases) {
        if (catalogSet.has(alias)) {
          resolved.push(alias);
        }
      }
    }
    // If neither direct nor alias matches a catalog tool, skip it
  }

  // Deduplicate and filter against effective allowlist
  return [...new Set(resolved)].filter((id) => effectiveSet.has(id));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a string is a valid `ForegroundDecisionRoute` */
function isValidRoute(value: string): value is ForegroundDecisionRoute {
  return (VALID_ROUTES as readonly string[]).includes(value);
}

/** Check if a string is a valid `TaskComplexity` */
function isValidComplexity(value: string): value is TaskComplexity {
  return (VALID_COMPLEXITIES as readonly string[]).includes(value);
}

/** Type guard: check if a value is a string */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Create an invalid validation result */
function invalid(
  code: ForegroundDecideErrorCode,
  message: string,
): ForegroundDecideValidationResult {
  return { valid: false, error: { code, message } };
}
