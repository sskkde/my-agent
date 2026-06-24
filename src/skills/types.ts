// Skill Domain Model Types
// Documentation-only skill records: metadata + lazily loaded markdown.
// Skills are NEVER executable — they carry no handler, schema, command, or script.
// This is the strict boundary between the tool plane (execution) and the
// skill plane (prompt-visible documentation).

// ---------------------------------------------------------------------------
// Categories — parallel to ToolCategory but scoped to documentation skills.
// ---------------------------------------------------------------------------

export type SkillCategory =
  | 'read' // Read-only / informational skills
  | 'write' // Skills that guide write operations
  | 'search' // Search-oriented skills
  | 'automation' // Skills describing automation workflows
  | 'admin' // Administrative / configuration skills
  | 'internal' // Internal system skills
  | 'custom' // User-defined custom skills

// ---------------------------------------------------------------------------
// Sensitivity — mirrors ToolSensitivity for permission parity.
// ---------------------------------------------------------------------------

export type SkillSensitivity = 'low' | 'medium' | 'high' | 'restricted'

// ---------------------------------------------------------------------------
// Source — where a skill definition originates.
// ---------------------------------------------------------------------------

export type SkillSource =
  | 'builtin' // Built into the platform
  | 'user' // User-defined
  | 'plugin' // Installed via plugin
  | 'remote' // Loaded from a remote registry

// ---------------------------------------------------------------------------
// Agent types that may reference a skill.
// Mirrors the per-agent-type skill pool model:
// main, subagent, background, workflow_step, remote.
// ---------------------------------------------------------------------------

export type SkillAgentType =
  | 'main'
  | 'subagent'
  | 'background'
  | 'workflow_step'
  | 'remote'

// ---------------------------------------------------------------------------
// SkillDefinition — the documentation-only record.
//
// REQUIRED fields:
//   skillId              — validated identifier (see skill-name.ts)
//   name                 — human-readable display name
//   description          — short description for prompt injection
//   category             — SkillCategory for classification
//   sensitivity          — SkillSensitivity for permission handling
//   enabled              — whether the skill is active
//   source               — SkillSource origin
//   allowedAgentTypes    — which agent types may reference this skill
//   defaultAgentProfiles — default profiles that include this skill
//   documentPath         — path to the lazily-loaded markdown document
//
// OPTIONAL fields:
//   summary              — longer summary for catalog display
//   tags                 — free-form tags for filtering
//
// EXPLICITLY ABSENT (executable fields — skills are documentation only):
//   handler, schema, command, script, or any function-calling field.
//   Adding any of these is a type-system violation of the skill/tool boundary.
// ---------------------------------------------------------------------------

export interface SkillDefinition {
  skillId: string
  name: string
  description: string
  category: SkillCategory
  sensitivity: SkillSensitivity
  enabled: boolean
  source: SkillSource
  allowedAgentTypes: SkillAgentType[]
  defaultAgentProfiles: string[]
  documentPath: string
  summary?: string
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Registration options — parallel to ToolRegistrationOptions.
// ---------------------------------------------------------------------------

export interface SkillRegistrationOptions {
  overwriteExisting?: boolean
}

// ---------------------------------------------------------------------------
// Skill registry interface — parallel to ToolRegistry but documentation-only.
// ---------------------------------------------------------------------------

export interface SkillRegistry {
  register(definition: SkillDefinition, options?: SkillRegistrationOptions): void
  get(skillId: string): SkillDefinition | null
  has(skillId: string): boolean
  list(): SkillDefinition[]
  listByCategory(category: SkillCategory): SkillDefinition[]
  listBySource(source: SkillSource): SkillDefinition[]
  unregister(skillId: string): boolean
}

// ---------------------------------------------------------------------------
// Error codes for skill operations.
// ---------------------------------------------------------------------------

export const SKILL_ERROR_CODES = {
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  INVALID_SKILL_ID: 'INVALID_SKILL_ID',
  SKILL_ALREADY_REGISTERED: 'SKILL_ALREADY_REGISTERED',
} as const

// ---------------------------------------------------------------------------
// Skill registry error.
// ---------------------------------------------------------------------------

export class SkillRegistryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SkillRegistryError'
  }
}