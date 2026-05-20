/**
 * Route Policy - RBAC route-permission type definitions and mapping table.
 * Maps every v1 route to appropriate resource + action for RBAC enforcement.
 */

import { ResourceType, Action } from '../permissions/rbac-types.js';

/**
 * Extended resource types that include additional resources not in the base ResourceType enum.
 * These are used for route-to-permission mapping where the resource doesn't fit the standard categories.
 */
export type ExtendedResourceType = 
  | ResourceType
  | 'approval'
  | 'run'
  | 'provider'
  | 'agent-config'
  | 'tool-result';

/**
 * Route policy entry that maps a route pattern to required permission.
 */
export interface RoutePolicyEntry {
  method: string;
  pathPattern: string;
  resource: ExtendedResourceType;
  action: Action;
}

/**
 * Complete route-to-permission mapping table for all v1 routes.
 * Each entry maps a specific route pattern to the required RBAC permission.
 */
export const ROUTE_POLICY_MAP: RoutePolicyEntry[] = [
  // ===========================================
  // Sessions
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/sessions', resource: ResourceType.sessions, action: Action.create },
  { method: 'GET', pathPattern: '/api/v1/sessions', resource: ResourceType.sessions, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/sessions/:sessionId', resource: ResourceType.sessions, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/sessions/:sessionId/transcripts', resource: ResourceType.sessions, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/sessions/:sessionId/messages', resource: ResourceType.sessions, action: Action.execute },
  { method: 'POST', pathPattern: '/api/v1/sessions/:sessionId/resume', resource: ResourceType.sessions, action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/sessions/:sessionId', resource: ResourceType.sessions, action: Action.update },
  { method: 'GET', pathPattern: '/api/v1/sessions/:sessionId/timeline', resource: ResourceType.sessions, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/sessions/:sessionId/timeline/stream', resource: ResourceType.sessions, action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/sessions/:sessionId/model', resource: ResourceType.sessions, action: Action.update },
  { method: 'GET', pathPattern: '/api/v1/sessions/:sessionId/usage', resource: ResourceType.sessions, action: Action.read },

  // ===========================================
  // Status / Health
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/health', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/health/ready', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Approvals
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/approvals', resource: 'approval', action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/approvals/:approvalId', resource: 'approval', action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/approvals/:approvalId', resource: 'approval', action: Action.update },

  // ===========================================
  // Runs
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/runs', resource: 'run', action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/runs/stream', resource: 'run', action: Action.read },

  // ===========================================
  // Usage
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/usage', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Logs
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/logs', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/logs/stream', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Debug
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/debug/replay/:sessionId', resource: ResourceType.sessions, action: Action.read },

  // ===========================================
  // Instances
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/instances', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Channels
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/channels', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Skills
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/skills', resource: ResourceType.settings, action: Action.read },

  // ===========================================
  // Settings
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/settings', resource: ResourceType.settings, action: Action.read },

  // ===========================================
  // Setup
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/setup/status', resource: ResourceType.users, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/setup/user', resource: ResourceType.users, action: Action.create },

  // ===========================================
  // Auth
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/auth/login', resource: ResourceType.users, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/auth/logout', resource: ResourceType.users, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/auth/me', resource: ResourceType.users, action: Action.read },

  // ===========================================
  // Providers
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/providers', resource: 'provider', action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/providers', resource: 'provider', action: Action.create },
  { method: 'PATCH', pathPattern: '/api/v1/providers/:providerId', resource: 'provider', action: Action.update },
  { method: 'DELETE', pathPattern: '/api/v1/providers/:providerId', resource: 'provider', action: Action.delete },
  { method: 'POST', pathPattern: '/api/v1/providers/:providerId/test', resource: 'provider', action: Action.execute },

  // ===========================================
  // Models
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/models', resource: 'provider', action: Action.read },

  // ===========================================
  // Tools
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/tools', resource: ResourceType.settings, action: Action.read },

  // ===========================================
  // Memory
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/memory/debug/extraction-runs', resource: ResourceType.memory, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/memory/debug/extract', resource: ResourceType.memory, action: Action.execute },
  { method: 'GET', pathPattern: '/api/v1/memory', resource: ResourceType.memory, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/memory/:memoryId', resource: ResourceType.memory, action: Action.read },
  { method: 'DELETE', pathPattern: '/api/v1/memory/:memoryId', resource: ResourceType.memory, action: Action.delete },

  // ===========================================
  // Workflows - Drafts
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/workflows/drafts', resource: ResourceType.workflows, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/workflows/drafts/:draftId', resource: ResourceType.workflows, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/workflows/drafts', resource: ResourceType.workflows, action: Action.create },
  { method: 'PATCH', pathPattern: '/api/v1/workflows/drafts/:draftId', resource: ResourceType.workflows, action: Action.update },
  { method: 'POST', pathPattern: '/api/v1/workflows/drafts/:draftId/validate', resource: ResourceType.workflows, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/workflows/drafts/:draftId/publish', resource: ResourceType.workflows, action: Action.update },
  { method: 'DELETE', pathPattern: '/api/v1/workflows/drafts/:draftId', resource: ResourceType.workflows, action: Action.delete },

  // ===========================================
  // Workflows - Definitions
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/workflows/definitions', resource: ResourceType.workflows, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/workflows/definitions/:workflowId', resource: ResourceType.workflows, action: Action.read },

  // ===========================================
  // Workflows - Runs
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/workflows/runs', resource: ResourceType.workflows, action: Action.execute },
  { method: 'GET', pathPattern: '/api/v1/workflows/runs/:workflowRunId', resource: ResourceType.workflows, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/workflows/runs', resource: ResourceType.workflows, action: Action.read },

  // ===========================================
  // Tool Results
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/tool-results/:resultId', resource: 'tool-result', action: Action.read },

  // ===========================================
  // Triggers - Schedules
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/triggers/schedules', resource: ResourceType.triggers, action: Action.create },
  { method: 'GET', pathPattern: '/api/v1/triggers/schedules', resource: ResourceType.triggers, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/triggers/schedules/:scheduleId', resource: ResourceType.triggers, action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/triggers/schedules/:scheduleId', resource: ResourceType.triggers, action: Action.update },
  { method: 'DELETE', pathPattern: '/api/v1/triggers/schedules/:scheduleId', resource: ResourceType.triggers, action: Action.delete },

  // ===========================================
  // Triggers - Webhooks
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/triggers/webhooks', resource: ResourceType.triggers, action: Action.create },
  { method: 'GET', pathPattern: '/api/v1/triggers/webhooks', resource: ResourceType.triggers, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/triggers/webhooks/:webhookId', resource: ResourceType.triggers, action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/triggers/webhooks/:webhookId', resource: ResourceType.triggers, action: Action.update },
  { method: 'DELETE', pathPattern: '/api/v1/triggers/webhooks/:webhookId', resource: ResourceType.triggers, action: Action.delete },
  { method: 'POST', pathPattern: '/api/v1/webhooks/:webhookId/deliver', resource: ResourceType.triggers, action: Action.execute },

  // ===========================================
  // Connectors
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/connectors', resource: ResourceType.connectors, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/connectors/:id', resource: ResourceType.connectors, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/connectors/:id/instances', resource: ResourceType.connectors, action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/connectors/:id/instances/:iid/config', resource: ResourceType.connectors, action: Action.update },

  // ===========================================
  // Planner Runs
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/planner-runs/:plannerRunId/events', resource: 'run', action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/planner-runs/:plannerRunId/summary', resource: 'run', action: Action.read },

  // ===========================================
  // Observability
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/observability/runs', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/observability/runs/:runId/console', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/observability/runs/:runId/replay-preview', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/metrics', resource: ResourceType.observability, action: Action.read },

  // ===========================================
  // Alerts
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/alerts/rules', resource: ResourceType.observability, action: Action.read },
  { method: 'GET', pathPattern: '/api/v1/alerts/rules/:ruleId', resource: ResourceType.observability, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/alerts/rules', resource: ResourceType.observability, action: Action.create },
  { method: 'DELETE', pathPattern: '/api/v1/alerts/rules/:ruleId', resource: ResourceType.observability, action: Action.delete },
  { method: 'GET', pathPattern: '/api/v1/alerts/state', resource: ResourceType.observability, action: Action.read },
  { method: 'POST', pathPattern: '/api/v1/alerts/evaluate', resource: ResourceType.observability, action: Action.execute },

  // ===========================================
  // API Keys
  // ===========================================
  { method: 'POST', pathPattern: '/api/v1/api-keys', resource: ResourceType.apiKeys, action: Action.create },
  { method: 'GET', pathPattern: '/api/v1/api-keys', resource: ResourceType.apiKeys, action: Action.read },
  { method: 'DELETE', pathPattern: '/api/v1/api-keys/:id', resource: ResourceType.apiKeys, action: Action.delete },

  // ===========================================
  // Agents
  // ===========================================
  { method: 'GET', pathPattern: '/api/v1/agents/:agentId/config', resource: 'agent-config', action: Action.read },
  { method: 'PATCH', pathPattern: '/api/v1/agents/:agentId/config/global', resource: 'agent-config', action: Action.manage },
  { method: 'PATCH', pathPattern: '/api/v1/agents/:agentId/config/override', resource: 'agent-config', action: Action.update },
  { method: 'DELETE', pathPattern: '/api/v1/agents/:agentId/config/override', resource: 'agent-config', action: Action.delete },
];

/**
 * Converts a path pattern with parameters (e.g., "/api/v1/sessions/:sessionId")
 * to a regex pattern for matching actual paths.
 */
function pathPatternToRegex(pattern: string): RegExp {
  // Escape special regex characters except for the colon used in path params
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[a-zA-Z_][a-zA-Z0-9_]*/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

/**
 * Gets the required permission for a given method and path.
 * Matches the path against stored patterns and returns the corresponding
 * resource and action, or null if no match is found.
 *
 * @param method - HTTP method (GET, POST, PATCH, DELETE, etc.)
 * @param path - Actual request path (e.g., "/api/v1/sessions/session-123")
 * @returns The required permission { resource, action } or null if no match
 */
export function getRequiredPermission(
  method: string,
  path: string
): { resource: ExtendedResourceType; action: Action } | null {
  for (const entry of ROUTE_POLICY_MAP) {
    if (entry.method.toUpperCase() !== method.toUpperCase()) {
      continue;
    }

    const regex = pathPatternToRegex(entry.pathPattern);
    if (regex.test(path)) {
      return {
        resource: entry.resource,
        action: entry.action,
      };
    }
  }

  return null;
}
