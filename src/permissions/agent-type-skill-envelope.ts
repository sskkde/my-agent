/**
 * AgentType Skill Envelope - Defines the hard security boundary for each
 * AgentType's access to documentation-only skills.
 *
 * A skill envelope is the MAXIMUM set of skill categories and IDs an AgentType
 * can ever access. Effective skill projection is computed as:
 *
 *   effective = AgentTypeSkillEnvelope ∩ AgentProfile.defaultSkillIds ∩ config ∩ policy
 *
 * The envelope is the outermost boundary — no profile or config can expand
 * beyond it.
 *
 * This mirrors {@link AgentTypeToolEnvelope} but operates on the skill plane
 * (documentation-only records), never the tool plane (executable functions).
 *
 * @module permissions/agent-type-skill-envelope
 */

import type { AgentType } from '../context/types.js'
import type { SkillCategory } from '../skills/types.js'

// ---------------------------------------------------------------------------
// Envelope definition
// ---------------------------------------------------------------------------

/**
 * A skill envelope for a given AgentType.
 *
 * `allowedCategories` defines which skill categories are permitted.
 * `deniedSkillIds` lists specific skill IDs that are always denied (hard block).
 * `allowedSkillIds` (optional) is an explicit allowlist; when set, only these
 * skill IDs are permitted regardless of category. When absent, categories govern.
 */
export interface AgentTypeSkillEnvelope {
  /** The AgentType this envelope applies to. */
  readonly agentType: AgentType
  /** Allowed skill categories for this AgentType. */
  readonly allowedCategories: ReadonlySet<SkillCategory>
  /** Explicit denylist — always denied, even if category is allowed. */
  readonly deniedSkillIds: ReadonlySet<string>
  /**
   * Optional explicit allowlist. When non-empty, ONLY these skill IDs are
   * permitted (category filter is bypassed). When empty/absent, category
   * filtering applies.
   */
  readonly allowedSkillIds?: ReadonlySet<string>
  /** Human-readable reason for audit trail. */
  readonly reason: string
}

// ---------------------------------------------------------------------------
// Envelope registry
// ---------------------------------------------------------------------------

export interface AgentTypeSkillEnvelopeRegistry {
  /** Get the envelope for an AgentType. Returns undefined if not registered. */
  getEnvelope(agentType: AgentType): AgentTypeSkillEnvelope | undefined

  /** Check if a skill ID is permitted by the envelope for the given AgentType. */
  isSkillAllowedByEnvelope(
    agentType: AgentType,
    skillId: string,
    skillCategory: SkillCategory,
  ): boolean

  /** Get all allowed skill IDs for an AgentType given a full skill catalog. */
  getAllowedSkillIds(
    agentType: AgentType,
    catalog: Array<{ id: string; category: SkillCategory }>,
  ): string[]
}

// ---------------------------------------------------------------------------
// Built-in envelopes
// ---------------------------------------------------------------------------

/**
 * SAFE_CATEGORIES: skill categories allowed for interactive (main) agent types.
 * Read-only, search, and internal skills — no side-effect guidance.
 */
const SAFE_CATEGORIES: ReadonlySet<SkillCategory> = new Set([
  'read',
  'search',
  'internal',
])

/**
 * SUBAGENT_CATEGORIES: skill categories allowed for subagent execution.
 * Extends safe with write and automation guidance.
 */
const SUBAGENT_CATEGORIES: ReadonlySet<SkillCategory> = new Set([
  'read',
  'search',
  'internal',
  'write',
  'automation',
])

/**
 * BACKGROUND_CATEGORIES: skill categories allowed for background tasks.
 * Limited to read/search/internal — no write/automation/admin.
 */
const BACKGROUND_CATEGORIES: ReadonlySet<SkillCategory> = new Set([
  'read',
  'search',
  'internal',
])

/**
 * WORKFLOW_STEP_CATEGORIES: skill categories allowed for workflow steps.
 * Extends safe with write and automation capability.
 */
const WORKFLOW_STEP_CATEGORIES: ReadonlySet<SkillCategory> = new Set([
  'read',
  'search',
  'internal',
  'write',
  'automation',
])

/**
 * REMOTE_EMPTY_SET: remote agent type has NO allowed categories.
 * Remote is hard-deny / audit-only.
 */
const REMOTE_EMPTY_SET: ReadonlySet<SkillCategory> = new Set<SkillCategory>([])

/**
 * Main agent envelope — interactive foreground use.
 * Safe categories only; no side-effect guidance skills.
 */
const MAIN_ENVELOPE: AgentTypeSkillEnvelope = {
  agentType: 'main',
  allowedCategories: SAFE_CATEGORIES,
  deniedSkillIds: new Set<string>(),
  reason: 'Main agent: read/search/internal skills only — no side-effect guidance in interactive mode',
}

/**
 * Subagent envelope — spawned by main agent for delegated tasks.
 * Can access write/automation guidance, but not admin skills.
 */
const SUBAGENT_ENVELOPE: AgentTypeSkillEnvelope = {
  agentType: 'subagent',
  allowedCategories: SUBAGENT_CATEGORIES,
  deniedSkillIds: new Set<string>(['admin_config', 'manage_users']),
  reason: 'Subagent: read/search/internal/write/automation — no admin skills',
}

/**
 * Background envelope — long-running background tasks.
 * Most restrictive non-remote envelope.
 */
const BACKGROUND_ENVELOPE: AgentTypeSkillEnvelope = {
  agentType: 'background',
  allowedCategories: BACKGROUND_CATEGORIES,
  deniedSkillIds: new Set<string>(),
  reason: 'Background: read/search/internal only — no side-effect guidance in unattended mode',
}

/**
 * Workflow step envelope — step in a workflow execution.
 * Can read, write, and automate, but not admin.
 */
const WORKFLOW_STEP_ENVELOPE: AgentTypeSkillEnvelope = {
  agentType: 'workflow_step',
  allowedCategories: WORKFLOW_STEP_CATEGORIES,
  deniedSkillIds: new Set<string>(['admin_config', 'manage_users']),
  reason: 'Workflow step: read/search/internal/write/automation — no admin skills',
}

/**
 * Remote envelope — hard-deny / audit-only placeholder.
 * Remote agents cannot access ANY skills. All calls are audited and denied.
 */
const REMOTE_ENVELOPE: AgentTypeSkillEnvelope = {
  agentType: 'remote',
  allowedCategories: REMOTE_EMPTY_SET,
  deniedSkillIds: new Set<string>(), // everything is denied because allowedCategories is empty
  reason: 'Remote: hard-deny — no skills permitted, audit-only placeholder',
}

// ---------------------------------------------------------------------------
// All built-in envelopes
// ---------------------------------------------------------------------------

const ALL_ENVELOPES: readonly AgentTypeSkillEnvelope[] = [
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
 * Create an AgentTypeSkillEnvelopeRegistry with built-in envelopes.
 */
export function createAgentTypeSkillEnvelopeRegistry(): AgentTypeSkillEnvelopeRegistry {
  const envelopeMap = new Map<AgentType, AgentTypeSkillEnvelope>()
  for (const envelope of ALL_ENVELOPES) {
    envelopeMap.set(envelope.agentType, envelope)
  }

  return {
    getEnvelope(agentType: AgentType): AgentTypeSkillEnvelope | undefined {
      return envelopeMap.get(agentType)
    },

    isSkillAllowedByEnvelope(
      agentType: AgentType,
      skillId: string,
      skillCategory: SkillCategory,
    ): boolean {
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
      if (envelope.deniedSkillIds.has(skillId)) {
        return false
      }

      // If explicit allowlist is set, only those skills are permitted
      if (envelope.allowedSkillIds && envelope.allowedSkillIds.size > 0) {
        return envelope.allowedSkillIds.has(skillId)
      }

      // Category-based filtering
      return envelope.allowedCategories.has(skillCategory)
    },

    getAllowedSkillIds(
      agentType: AgentType,
      catalog: Array<{ id: string; category: SkillCategory }>,
    ): string[] {
      return catalog
        .filter((skill) => this.isSkillAllowedByEnvelope(agentType, skill.id, skill.category))
        .map((skill) => skill.id)
    },
  }
}

// ---------------------------------------------------------------------------
// Pure function for intersection
// ---------------------------------------------------------------------------

/**
 * Compute the intersection of multiple skill ID sets.
 *
 * Given N sets of skill IDs, returns only IDs present in ALL sets.
 * If any set is empty, returns empty (nothing is permitted).
 * If a set is undefined, it is treated as "no restriction" (skip).
 */
export function intersectSkillIdSets(
  ...sets: Array<Set<string> | string[] | undefined>
): string[] {
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