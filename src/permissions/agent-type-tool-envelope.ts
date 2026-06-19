/**
 * AgentType Tool Envelope - Defines the hard security boundary for each AgentType.
 *
 * An envelope is the MAXIMUM set of tools an AgentType can ever access.
 * Effective tool projection is computed as:
 *
 *   effective = AgentTypeEnvelope ∩ AgentProfile.defaultToolIds ∩ policy ∩ approvals
 *
 * The envelope is the outermost boundary — no profile or policy can expand beyond it.
 *
 * @module permissions/agent-type-tool-envelope
 */

import type { AgentType } from '../context/types.js'
import type { ToolCategory } from '../tools/types.js'

// ---------------------------------------------------------------------------
// Envelope definition
// ---------------------------------------------------------------------------

/**
 * A tool envelope for a given AgentType.
 *
 * `allowedCategories` defines which tool categories are permitted.
 * `deniedToolIds` lists specific tool IDs that are always denied (hard block).
 * `allowedToolIds` (optional) is an explicit allowlist; when set, only these
 * tool IDs are permitted regardless of category. When absent, categories govern.
 */
export interface AgentTypeToolEnvelope {
  /** The AgentType this envelope applies to. */
  readonly agentType: AgentType
  /** Allowed tool categories for this AgentType. */
  readonly allowedCategories: ReadonlySet<ToolCategory>
  /** Explicit denylist — always denied, even if category is allowed. */
  readonly deniedToolIds: ReadonlySet<string>
  /**
   * Optional explicit allowlist. When non-empty, ONLY these tool IDs are
   * permitted (category filter is bypassed). When empty/absent, category
   * filtering applies.
   */
  readonly allowedToolIds?: ReadonlySet<string>
  /** Human-readable reason for audit trail. */
  readonly reason: string
}

// ---------------------------------------------------------------------------
// Envelope registry
// ---------------------------------------------------------------------------

export interface AgentTypeToolEnvelopeRegistry {
  /** Get the envelope for an AgentType. Returns undefined if not registered. */
  getEnvelope(agentType: AgentType): AgentTypeToolEnvelope | undefined

  /** Check if a tool ID is permitted by the envelope for the given AgentType. */
  isToolAllowedByEnvelope(agentType: AgentType, toolId: string, toolCategory: ToolCategory): boolean

  /** Get all allowed tool IDs for an AgentType given a full tool catalog. */
  getAllowedToolIds(
    agentType: AgentType,
    catalog: Array<{ id: string; category: ToolCategory }>,
  ): string[]
}

// ---------------------------------------------------------------------------
// Built-in envelopes
// ---------------------------------------------------------------------------

/**
 * SAFE_CATEGORIES: categories allowed for interactive (main) agent types.
 * Read-only, search, and internal tools — no side effects.
 */
const SAFE_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'read',
  'search',
  'internal',
])

/**
 * SUBAGENT_CATEGORIES: categories allowed for subagent execution.
 * Extends safe with write capability (artifacts, etc.).
 */
const SUBAGENT_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'read',
  'search',
  'internal',
  'write',
])

/**
 * BACKGROUND_CATEGORIES: categories allowed for background tasks.
 * Limited to read/search/internal — no write/execute/admin.
 */
const BACKGROUND_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'read',
  'search',
  'internal',
])

/**
 * WORKFLOW_STEP_CATEGORIES: categories allowed for workflow steps.
 * Extends safe with write and limited execute capability.
 */
const WORKFLOW_STEP_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'read',
  'search',
  'internal',
  'write',
  'execute',
])

/**
 * REMOTE_EMPTY_SET: remote agent type has NO allowed categories.
 * Remote is hard-deny / audit-only.
 */
const REMOTE_EMPTY_SET: ReadonlySet<ToolCategory> = new Set<ToolCategory>([])

/**
 * Main agent envelope — interactive foreground use.
 * Safe categories only; no side-effect tools.
 */
const MAIN_ENVELOPE: AgentTypeToolEnvelope = {
  agentType: 'main',
  allowedCategories: SAFE_CATEGORIES,
  deniedToolIds: new Set<string>(),
  reason: 'Main agent: read/search/internal only — no side effects in interactive mode',
}

/**
 * Subagent envelope — spawned by main agent for delegated tasks.
 * Can write artifacts, but cannot execute arbitrary commands or admin.
 */
const SUBAGENT_ENVELOPE: AgentTypeToolEnvelope = {
  agentType: 'subagent',
  allowedCategories: SUBAGENT_CATEGORIES,
  deniedToolIds: new Set<string>(['exec', 'bash', 'code_execution', 'admin_config', 'manage_users']),
  reason: 'Subagent: read/search/internal/write — no shell exec or admin tools',
}

/**
 * Background envelope — long-running background tasks.
 * Most restrictive non-remote envelope.
 */
const BACKGROUND_ENVELOPE: AgentTypeToolEnvelope = {
  agentType: 'background',
  allowedCategories: BACKGROUND_CATEGORIES,
  deniedToolIds: new Set<string>(),
  reason: 'Background: read/search/internal only — no side effects in unattended mode',
}

/**
 * Workflow step envelope — step in a workflow execution.
 * Can read, write, and execute, but not admin.
 */
const WORKFLOW_STEP_ENVELOPE: AgentTypeToolEnvelope = {
  agentType: 'workflow_step',
  allowedCategories: WORKFLOW_STEP_CATEGORIES,
  deniedToolIds: new Set<string>(['admin_config', 'manage_users']),
  reason: 'Workflow step: read/search/internal/write/execute — no admin tools',
}

/**
 * Remote envelope — hard-deny / audit-only placeholder.
 * Remote agents cannot access ANY tools. All calls are audited and denied.
 */
const REMOTE_ENVELOPE: AgentTypeToolEnvelope = {
  agentType: 'remote',
  allowedCategories: REMOTE_EMPTY_SET,
  deniedToolIds: new Set<string>(), // everything is denied because allowedCategories is empty
  reason: 'Remote: hard-deny — no tools permitted, audit-only placeholder',
}

// ---------------------------------------------------------------------------
// All built-in envelopes
// ---------------------------------------------------------------------------

const ALL_ENVELOPES: readonly AgentTypeToolEnvelope[] = [
  MAIN_ENVELOPE,
  SUBAGENT_ENVELOPE,
  BACKGROUND_ENVELOPE,
  WORKFLOW_STEP_ENVELOPE,
  REMOTE_ENVELOPE,
]

// ---------------------------------------------------------------------------
// Registry implementation
// ---------------------------------------------------------------------------

/**
 * Create an AgentTypeToolEnvelopeRegistry with built-in envelopes.
 */
export function createAgentTypeToolEnvelopeRegistry(): AgentTypeToolEnvelopeRegistry {
  const envelopeMap = new Map<AgentType, AgentTypeToolEnvelope>()
  for (const envelope of ALL_ENVELOPES) {
    envelopeMap.set(envelope.agentType, envelope)
  }

  return {
    getEnvelope(agentType: AgentType): AgentTypeToolEnvelope | undefined {
      return envelopeMap.get(agentType)
    },

    isToolAllowedByEnvelope(agentType: AgentType, toolId: string, toolCategory: ToolCategory): boolean {
      const envelope = envelopeMap.get(agentType)
      if (!envelope) {
        // Unknown agentType → deny by default
        return false
      }

      // Remote: hard deny everything
      if (agentType === 'remote') {
        return false
      }

      // Explicit denylist always wins
      if (envelope.deniedToolIds.has(toolId)) {
        return false
      }

      // If explicit allowlist is set, only those tools are permitted
      if (envelope.allowedToolIds && envelope.allowedToolIds.size > 0) {
        return envelope.allowedToolIds.has(toolId)
      }

      // Category-based filtering
      return envelope.allowedCategories.has(toolCategory)
    },

    getAllowedToolIds(
      agentType: AgentType,
      catalog: Array<{ id: string; category: ToolCategory }>,
    ): string[] {
      return catalog
        .filter((tool) => this.isToolAllowedByEnvelope(agentType, tool.id, tool.category))
        .map((tool) => tool.id)
    },
  }
}

// ---------------------------------------------------------------------------
// Pure function for intersection
// ---------------------------------------------------------------------------

/**
 * Compute the intersection of multiple tool ID sets.
 *
 * Given N sets of tool IDs, returns only IDs present in ALL sets.
 * If any set is empty, returns empty (nothing is permitted).
 * If a set is undefined, it is treated as "no restriction" (skip).
 */
export function intersectToolIdSets(...sets: Array<Set<string> | string[] | undefined>): string[] {
  const definedSets = sets.filter((s): s is Set<string> | string[] => s !== undefined)

  if (definedSets.length === 0) {
    return []
  }

  // Start with the first set as the base
  const baseSet = new Set<string>(definedSets[0])

  // Intersect with each subsequent set
  for (let i = 1; i < definedSets.length; i++) {
    const currentSet = new Set<string>(definedSets[i])
    for (const id of baseSet) {
      if (!currentSet.has(id)) {
        baseSet.delete(id)
      }
    }
  }

  return [...baseSet]
}
