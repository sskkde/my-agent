/**
 * Foreground Routing JSON Parser
 *
 * Parses and validates LLM router output from legacy routing_json mode.
 *
 * ## Security Invariant
 *
 * **CRITICAL**: `runtimeAction` is NEVER taken from LLM output. The server
 * creates all runtime actions based on the decided route. Any runtimeAction
 * present in the raw JSON is silently discarded during parsing.
 *
 * This module is used by the legacy routing_json path in ForegroundAgent.
 * In Phase 5, this module will be removed along with the legacy path.
 */

import type { ForegroundDecisionRoute, TaskComplexity } from './types.js';
import { getToolCatalog } from '../api/tool-catalog.js';

/**
 * LLM Router output structure
 * NOTE: runtimeAction from LLM is REJECTED - server creates all runtime actions
 */
export interface LLMRouterOutput {
  route: ForegroundDecisionRoute;
  reason: string;
  userVisibleResponse?: string;
  estimatedSteps?: number;
  complexity?: TaskComplexity;
  suggestedTools?: string[];
}

/**
 * Router error codes
 */
export type RouterErrorCode =
  | 'MALFORMED_JSON'
  | 'INVALID_ROUTE'
  | 'MISSING_REQUIRED_FIELD'
  | 'EMPTY_REASON'
  | 'INVALID_RUNTIME_ACTION'
  | 'INVALID_COMPLEXITY'
  | 'INVALID_FIELD_TYPE'
  | 'LLM_REQUEST_FAILED';

/**
 * Router result type
 */
export interface RouterResult {
  success: boolean;
  output?: LLMRouterOutput;
  error?: {
    code: RouterErrorCode;
    message: string;
    retryable: boolean;
  };
}

/**
 * Options for parsing router output
 */
export interface ParseRouterOutputOptions {
  /** Effective allowed tool IDs (filtered by agent config) */
  effectiveToolIds?: string[];
  /** Known tool catalog (if not provided, fetched from getToolCatalog()) */
  toolCatalog?: string[];
}

/**
 * Tool aliases for normalizing user-suggested tools
 */
const TOOL_ALIASES: Record<string, string[]> = {
  search: ['docs_search'],
  'web.search': ['web_search'],
  'internet.search': ['web_search'],
  web: ['web_search'],
  'docs': ['docs_search'],
  'documentation.search': ['docs_search'],
  'transcript': ['transcript_search'],
  'memory.search': ['memory_retrieve'],
  'memory': ['memory_retrieve'],
  status: ['status_query'],
};

/**
 * Valid route values for routing decisions
 */
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

/**
 * Valid complexity values
 */
const VALID_COMPLEXITIES: TaskComplexity[] = ['low', 'medium', 'high', 'critical'];

/**
 * Filter suggested tools against known tool catalog and allowed tools.
 *
 * SECURITY: Only allow tools that exist in the known catalog AND are in the allowed list.
 *
 * @param suggestedTools - Tools suggested by the LLM
 * @param effectiveToolIds - Allowed tool IDs after applying agent config
 * @param knownToolIds - Known tool IDs from the catalog
 * @returns Filtered list of valid, allowed tool IDs
 */
export function filterAllowedTools(
  suggestedTools: string[],
  effectiveToolIds: string[],
  knownToolIds: string[],
): string[] {
  const normalizedTools = suggestedTools.flatMap((toolId) =>
    knownToolIds.includes(toolId) ? [toolId] : (TOOL_ALIASES[toolId] ?? [])
  );
  return [...new Set(normalizedTools)].filter((id) => effectiveToolIds.includes(id));
}

/**
 * Parse and validate router output from LLM JSON response.
 *
 * SECURITY: The LLM output is parsed into `LLMRouterOutput` which intentionally
 * excludes `runtimeAction`. Any runtime actions in the raw JSON are discarded
 * during parsing. Server-side creation happens only in mapRouterOutputToDecision.
 *
 * @param rawOutput - Raw JSON string from LLM
 * @param options - Parsing options including effective tool IDs
 * @returns RouterResult with parsed output or error
 */
export function parseForegroundRoutingJsonOutput(
  rawOutput: string,
  options?: ParseRouterOutputOptions,
): RouterResult {
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

  // Validate required fields
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

  // Validate route type and value
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

  // Validate reason type and value
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

  // Validate optional fields
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

  // SECURITY: Reject LLM-provided runtimeAction - server creates all runtime actions
  // If LLM hallucinated a runtimeAction, we silently ignore it
  void obj.runtimeAction; // Explicitly mark as intentionally unused

  // Filter suggestedTools to only known tools (intersection with catalog)
  const rawSuggestedTools = obj.suggestedTools as string[] | undefined;
  const effectiveToolIds = options?.effectiveToolIds ?? [];
  const knownToolIds = options?.toolCatalog ?? getToolCatalog().map((t) => t.name);
  const filteredSuggestedTools = rawSuggestedTools
    ? filterAllowedTools(rawSuggestedTools, effectiveToolIds, knownToolIds)
    : undefined;

  return {
    success: true,
    output: {
      route: obj.route as ForegroundDecisionRoute,
      reason: obj.reason,
      userVisibleResponse: obj.userVisibleResponse as string | undefined,
      estimatedSteps: obj.estimatedSteps as number | undefined,
      complexity: obj.complexity as TaskComplexity | undefined,
      suggestedTools: filteredSuggestedTools,
    },
  };
}
