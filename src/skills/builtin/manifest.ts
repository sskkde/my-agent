/**
 * Built-in skill manifest — source-controlled documentation-only skills.
 *
 * This manifest replaces the hard-coded skill lists that previously lived in
 * `src/api/routes/skills.ts` and `src/api/routes/agents.ts`. Every built-in
 * skill is a documentation-only record: metadata plus a lazily-loaded
 * markdown document. No handler, schema, command, or script.
 *
 * Old tool-like skill IDs (artifact_create, web_search, etc.) are preserved
 * only as deprecated aliases so existing agent configurations continue to
 * resolve. They are marked deprecated via the `tags` field and their
 * description carries a "Deprecated" prefix.
 *
 * @module skills/builtin/manifest
 */

import type { SkillDefinition, SkillRegistry } from '../types.js'

// ---------------------------------------------------------------------------
// Documentation skill definitions.
//
// Each entry corresponds to a markdown file under `docs/` with the same name
// as the skillId. The documentPath is a bare filename (e.g. "artifact_workflow.md")
// that the SkillDocumentLoader resolves against its basePath.
// ---------------------------------------------------------------------------

const BUILTIN_SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    skillId: 'artifact_workflow',
    name: 'Artifact Workflow',
    description:
      'Guidance for creating, updating, and managing artifacts produced during agent runs.',
    category: 'write',
    sensitivity: 'medium',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent', 'background', 'workflow_step'],
    defaultAgentProfiles: ['default'],
    documentPath: 'artifact_workflow.md',
    summary:
      'Covers artifact creation, update, and lifecycle management for agent-produced outputs.',
    tags: ['artifact', 'workflow', 'output'],
  },
  {
    skillId: 'memory_research',
    name: 'Memory Research',
    description:
      'Guidance for retrieving, searching, and leveraging memory context during agent tasks.',
    category: 'read',
    sensitivity: 'low',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent', 'background', 'workflow_step'],
    defaultAgentProfiles: ['default'],
    documentPath: 'memory_research.md',
    summary:
      'Covers memory retrieval, transcript search, and contextual recall for informed responses.',
    tags: ['memory', 'research', 'context'],
  },
  {
    skillId: 'session_status',
    name: 'Session Status',
    description:
      'Guidance for querying and reporting session status, progress, and state information.',
    category: 'read',
    sensitivity: 'low',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent', 'background', 'workflow_step'],
    defaultAgentProfiles: ['default'],
    documentPath: 'session_status.md',
    summary:
      'Covers status queries, progress reporting, and session state introspection.',
    tags: ['session', 'status', 'progress'],
  },
  {
    skillId: 'documentation_search',
    name: 'Documentation Search',
    description:
      'Guidance for searching internal documentation, knowledge bases, and reference materials.',
    category: 'search',
    sensitivity: 'low',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent', 'background', 'workflow_step'],
    defaultAgentProfiles: ['default'],
    documentPath: 'documentation_search.md',
    summary:
      'Covers documentation search strategies, knowledge base queries, and reference lookup.',
    tags: ['documentation', 'search', 'reference'],
  },
  {
    skillId: 'web_research_guidance',
    name: 'Web Research Guidance',
    description:
      'Guidance for conducting effective web research, search strategies, and source evaluation.',
    category: 'search',
    sensitivity: 'medium',
    enabled: true,
    source: 'builtin',
    allowedAgentTypes: ['main', 'subagent', 'background'],
    defaultAgentProfiles: ['default'],
    documentPath: 'web_research_guidance.md',
    summary:
      'Covers web search planning, source credibility evaluation, and result synthesis.',
    tags: ['web', 'research', 'search'],
  },
]

// ---------------------------------------------------------------------------
// Deprecated alias map.
//
// Maps old tool-like skill IDs to their replacement documentation skill IDs.
// These exist solely so existing agent configurations that reference the old
// IDs continue to resolve. Each alias is registered as a separate
// SkillDefinition with `deprecated` in its tags and a description that
// explicitly says "Deprecated alias of <newId>".
//
// Consumers should migrate configs to the new IDs. The alias entries are
// NOT enabled for new configurations by default — `enabled: false` signals
// that they are legacy-only.
// ---------------------------------------------------------------------------

export const DEPRECATED_SKILL_ALIASES: ReadonlyMap<string, string> = new Map([
  ['artifact_create', 'artifact_workflow'],
  ['artifact_update', 'artifact_workflow'],
  ['ask_user', 'session_status'],
  ['status_query', 'session_status'],
  ['memory_retrieve', 'memory_research'],
  ['transcript_search', 'memory_research'],
  ['plan_patch', 'artifact_workflow'],
  ['docs_search', 'documentation_search'],
  ['web_search', 'web_research_guidance'],
])

// ---------------------------------------------------------------------------
// Build deprecated alias definitions from the map.
// ---------------------------------------------------------------------------

function buildDeprecatedAliases(): SkillDefinition[] {
  const aliases: SkillDefinition[] = []

  for (const [oldId, newId] of DEPRECATED_SKILL_ALIASES) {
    const replacement = BUILTIN_SKILL_DEFINITIONS.find((s) => s.skillId === newId)
    if (!replacement) {
      // Defensive: the map must reference real skill IDs.
      throw new Error(
        `Deprecated alias "${oldId}" references unknown skill "${newId}".`,
      )
    }

    aliases.push({
      skillId: oldId,
      name: oldId,
      description: `Deprecated alias of ${newId}. Migrate configurations to use "${newId}" instead.`,
      category: replacement.category,
      sensitivity: replacement.sensitivity,
      enabled: false,
      source: 'builtin',
      allowedAgentTypes: replacement.allowedAgentTypes,
      defaultAgentProfiles: [],
      documentPath: replacement.documentPath,
      summary: `Deprecated alias — use "${newId}".`,
      tags: ['deprecated', `alias:${newId}`],
    })
  }

  return aliases
}

// ---------------------------------------------------------------------------
// All built-in skill definitions (real + deprecated aliases), sorted by
// skillId for deterministic ordering.
// ---------------------------------------------------------------------------

export const ALL_BUILTIN_SKILL_DEFINITIONS: SkillDefinition[] = [
  ...BUILTIN_SKILL_DEFINITIONS,
  ...buildDeprecatedAliases(),
].sort((a, b) => a.skillId.localeCompare(b.skillId))

// ---------------------------------------------------------------------------
// Only the active (non-deprecated) built-in skill definitions.
// ---------------------------------------------------------------------------

export const BUILTIN_ACTIVE_SKILL_DEFINITIONS: SkillDefinition[] =
  BUILTIN_SKILL_DEFINITIONS

// ---------------------------------------------------------------------------
// Register all built-in skills (active + deprecated aliases) into a registry.
// Uses overwriteExisting so re-registration is idempotent.
// ---------------------------------------------------------------------------

export function registerBuiltinSkills(registry: SkillRegistry): void {
  for (const definition of ALL_BUILTIN_SKILL_DEFINITIONS) {
    registry.register(definition, { overwriteExisting: true })
  }
}

// ---------------------------------------------------------------------------
// Resolve a skill ID that may be a deprecated alias to its canonical ID.
// Returns the original ID if no alias exists.
// ---------------------------------------------------------------------------

export function resolveSkillAlias(skillId: string): string {
  return DEPRECATED_SKILL_ALIASES.get(skillId) ?? skillId
}

// ---------------------------------------------------------------------------
// Check whether a skill ID is a deprecated alias.
// ---------------------------------------------------------------------------

export function isDeprecatedAlias(skillId: string): boolean {
  return DEPRECATED_SKILL_ALIASES.has(skillId)
}