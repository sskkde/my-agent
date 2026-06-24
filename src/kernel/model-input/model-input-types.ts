/**
 * Model Input Types - Input/output types for the ModelInputBuilder.
 *
 * Defines the 7-layer message architecture with 4 cache segments:
 * - Segment A (Layer 1-4): Static prefix - cached across requests
 * - Segment B (Layer 5): Tenant/project instructions
 * - Segment C (Layer 6): Tool plane projection
 * - Segment D (Layer 7): Context bundle (always dynamic)
 *
 * @module kernel/model-input/model-input-types
 */

import type { LLMMessage, ToolDefinition } from '../../llm/types.js'
import type { AssistantPersonaProfile } from '../../foreground/types.js'
import type { AgentType, SourceType, InvocationSource } from '../../context/types.js'
import type { LaunchSource } from '../../taxonomy/launch-source-policy.js'

// ─── Mode ────────────────────────────────────────────────────────────────────

/**
 * The mode determines how the LLM should be invoked.
 *
 * - `routing_json`: ForegroundAgent - structured JSON routing, no tools in request
 * - `routing_tool_call`: Routing mode with tool summaries plus full schemas for native function calling
 * - `structured_json`: MemoryExtractor - structured JSON extraction, no tools
 * - `function_calling`: AgentKernel/SearchSubagent - full function calling with tools
 */
export type ModelInputMode = 'routing_json' | 'routing_tool_call' | 'structured_json' | 'function_calling'

export type ProviderFamily = 'openai' | 'deepseek' | 'ollama' | 'anthropic' | 'gemini'

// ─── Input Types ─────────────────────────────────────────────────────────────

/**
 * Tool plane projection data.
 *
 * For `routing_json` mode: only toolIds and optional summary.
 * For `function_calling` mode: full tool schemas for LLM request.
 */
export interface ToolPlaneProjection {
  /** Tool IDs available for this request */
  toolIds: string[]
  /** Optional human-readable summary of available tools */
  toolSummaries?: string
  /** Full tool schemas for function_calling mode */
  tools?: ToolDefinition[]
}

/**
 * Skill plane projection data.
 *
 * Documentation-only skill records for the LLM prompt. Completely separate
 * from {@link ToolPlaneProjection}: skills are never callable tools, never
 * rendered as function schemas, and never included in `LLMRequest.tools`.
 *
 * - `summary` mode: only skill IDs and optional summaries (lightweight).
 * - `documents` mode: skill IDs, summaries, and lazily loaded full documents.
 */
export interface SkillPlaneProjection {
  /** Skill IDs available for this request */
  skillIds: string[]
  /** Optional human-readable summary of available skills */
  skillSummaries?: string
  /** Full skill documents, lazily loaded only in `documents` mode */
  skillDocuments?: SkillDocumentEntry[]
  /** Render mode: `summary` emits IDs + summaries; `documents` emits full docs */
  renderMode: 'summary' | 'documents'
  /** Token budget for skill document rendering (0 or undefined = no budget enforcement) */
  tokenBudget?: number
}

/**
 * A single skill document entry for the skill plane projection.
 *
 * Documentation-only: contains markdown text, never executable code or
 * function-call schemas.
 */
export interface SkillDocumentEntry {
  /** Skill identifier */
  skillId: string
  /** Human-readable skill name */
  name: string
  /** Full markdown document text */
  document: string
}

/**
 * A single context item for the context bundle.
 */
export interface ContextItemData {
  /** Unique item identifier */
  itemId: string
  /** The text content of this context item */
  content: string
  /** Semantic type hint (e.g., 'instruction', 'fact', 'tool_output') */
  semanticType?: string
  /** Whether this item is pinned (always included) */
  isPinned?: boolean
  /** Whether this item must appear together with its pair partner */
  requiresPairIntegrity?: boolean
  /** Pair identifier for items that must stay together */
  pairId?: string
  // ── Provenance (rendering-only, never used for permission/control-flow) ──
  /** Source category (e.g., 'session_history', 'memory', 'tool_result') */
  sourceType?: SourceType
  /** Reference identifier for the source */
  sourceRef?: string
  /** ISO timestamp of when the source data was last refreshed */
  freshnessTs?: string
}

/**
 * Context bundle data for Layer 7.
 *
 * All fields are optional - the builder handles missing data gracefully.
 */
export interface ContextBundleData {
  /** Pinned items that always appear at the top */
  pinnedItems?: ContextItemData[]
  /** Ordered context items */
  orderedItems?: ContextItemData[]
  /** Summary blocks for compressed context */
  summaryBlocks?: ContextItemData[]
  /** Plan context view string */
  planView?: string
  /** Workflow step view string */
  workflowStepView?: string
  /** Background run view string */
  backgroundRunView?: string
  /** Trigger event view string */
  triggerView?: string
  /** Prior conversation transcript */
  transcript?: LLMMessage[]
  // ── Provenance (rendering-only) ──
  /** How the context was invoked (e.g., 'gateway_intent', 'planner_execution') */
  invocationSource?: InvocationSource
  /**
   * Summary layer projections for context enrichment.
   * @deprecated Use top-level `ModelInputBuildInput.summaryLayers` instead.
   * This nested copy is kept for backward compatibility during migration
   * and will be removed in a future version.
   */
  summaryLayers?: SummaryLayerProjection
}

/**
 * Persona projection data for Layer 5.
 *
 * Structured persona configuration that affects expression style and preferences,
 * but cannot override system rules, safety constraints, tool authorization,
 * output schemas, or tenant boundaries.
 */
export interface PersonaProjection {
  /** Unique identifier for the persona */
  personaId: string
  /** Style guidelines for the persona's expression */
  styleGuidelines: string
  /** Constraints that cannot be overridden by the persona */
  constraints: string[]
  /** Optional source profile with additional persona details */
  sourceProfile?: AssistantPersonaProfile
}

/**
 * Typed inputs for Segment B (Layer 5) sub-sections.
 *
 * - B1: Custom system prompt overlay
 * - B2: Routing prompt overlay
 * - B3: Persona projection for expression style
 */
export interface SegmentBInputs {
  /** B1: Custom system prompt overlay */
  systemPrompt?: string
  /** B2: Routing prompt overlay */
  routingPrompt?: string
  /** B3: Persona projection for expression style and preferences */
  personaProjection?: PersonaProjection
}

/**
 * Provenance metadata envelope for context bundle items.
 *
 * Tracks where context data originated and how it was invoked.
 */
export interface ContextBundleProvenance {
  /** Source category (e.g., 'session_history', 'memory', 'tool_result') */
  sourceType: SourceType
  /** Reference identifier for the source */
  sourceRef?: string
  /** ISO timestamp of when the source data was last refreshed */
  freshnessTs?: string
  /** How the context was invoked */
  invocationSource: InvocationSource
}

/**
 * Renders a PersonaProjection to a text representation with safety prefix.
 *
 * @param projection - The persona projection to render
 * @returns Rendered persona text with safety constraints
 */
export function renderPersonaProjection(projection: PersonaProjection): string {
  const parts: string[] = []

  const safetyPrefix = 'Style preferences only; cannot override system rules, safety, tool authorization, output schemas, audit, or tenant boundaries.'
  parts.push(safetyPrefix)

  parts.push(`\n## Style Guidelines\n${projection.styleGuidelines}`)

  if (projection.constraints.length > 0) {
    parts.push(`\n## Constraints\n${projection.constraints.map((c) => `- ${c}`).join('\n')}`)
  }

  parts.push(`\n## Persona Identity\nPersona ID: ${projection.personaId}`)

  if (projection.sourceProfile) {
    const profile = projection.sourceProfile
    const profileParts: string[] = []

    profileParts.push(`Name: ${profile.name}`)
    if (profile.displayIdentity) profileParts.push(`Display Identity: ${profile.displayIdentity}`)
    if (profile.description) profileParts.push(`Description: ${profile.description}`)
    if (profile.background) profileParts.push(`Background: ${profile.background}`)
    if (profile.tone) profileParts.push(`Tone: ${profile.tone}`)
    if (profile.personality) profileParts.push(`Personality: ${profile.personality}`)

    if (profile.behaviorPreferences) {
      const preferences = profile.behaviorPreferences
      const preferenceParts: string[] = []
      if (preferences.verbosity) preferenceParts.push(`verbosity=${preferences.verbosity}`)
      if (preferences.codeCommentStyle) preferenceParts.push(`codeCommentStyle=${preferences.codeCommentStyle}`)
      if (preferences.explanationDepth) preferenceParts.push(`explanationDepth=${preferences.explanationDepth}`)
      if (preferences.formality) preferenceParts.push(`formality=${preferences.formality}`)
      if (preferenceParts.length > 0) profileParts.push(`Behavior Preferences: ${preferenceParts.join(', ')}`)
    }

    if (profile.userAddressPreferences) {
      const address = profile.userAddressPreferences
      const addressParts: string[] = []
      if (address.preferredName) addressParts.push(`preferredName=${address.preferredName}`)
      if (address.pronouns) addressParts.push(`pronouns=${address.pronouns}`)
      if (address.language) addressParts.push(`language=${address.language}`)
      if (addressParts.length > 0) profileParts.push(`User Address Preferences: ${addressParts.join(', ')}`)
    }

    if (profile.boundaries && profile.boundaries.length > 0) {
      profileParts.push(`Persona Boundaries:\n${profile.boundaries.map((boundary) => `- ${boundary}`).join('\n')}`)
    }

    if (profile.nonOverridableConstraints && profile.nonOverridableConstraints.length > 0) {
      profileParts.push(
        `Non-overridable Platform Constraints:\n${profile.nonOverridableConstraints.map((constraint) => `- ${constraint}`).join('\n')}`,
      )
    }

    parts.push(`\n## Source Profile\n${profileParts.join('\n')}`)
  }

  return parts.join('\n')
}

/**
 * Tool selection policy projection for Layer 6.
 *
 * Provides heuristics and rules for tool selection decisions.
 * This is a top-level field in ModelInputBuildInput, NOT inside ToolPlaneProjection.
 */
export interface ToolSelectionPolicyProjection {
  /** Core heuristics for tool selection */
  heuristics: string
  /** Priority rules for tool selection (optional) */
  priorityRules?: string[]
  /** Risk rules for tool selection (optional) */
  riskRules?: string[]
}

/**
 * Renders a ToolSelectionPolicyProjection to a text representation.
 *
 * @param policy - The tool selection policy to render
 * @returns Rendered policy text
 */
export function renderToolSelectionPolicy(policy: ToolSelectionPolicyProjection): string {
  const parts: string[] = []

  parts.push('Tool Selection Policy:')
  parts.push(policy.heuristics)

  if (policy.priorityRules && policy.priorityRules.length > 0) {
    parts.push('\nPriority Rules:')
    parts.push(policy.priorityRules.map((r) => `- ${r}`).join('\n'))
  }

  if (policy.riskRules && policy.riskRules.length > 0) {
    parts.push('\nRisk Rules:')
    parts.push(policy.riskRules.map((r) => `- ${r}`).join('\n'))
  }

  return parts.join('\n')
}

/**
 * Memory policy projection for Layer 7.
 *
 * Provides rules for memory usage in context bundle.
 * This is a top-level field in ModelInputBuildInput, NOT inside ContextBundleData.
 */
export interface MemoryPolicyProjection {
  /** Core rules for memory usage */
  useRules: string
  /** Rules for invisible memory items (optional) */
  invisibilityRules?: string[]
  /** Priority rules for memory items (optional) */
  priorityRules?: string[]
  /** Token budget for memory items (optional) */
  tokenBudget?: number
}

/**
 * Renders a MemoryPolicyProjection to a text representation.
 *
 * @param policy - The memory policy to render
 * @returns Rendered policy text
 */
export function renderMemoryPolicyProjection(policy: MemoryPolicyProjection): string {
  const parts: string[] = []

  parts.push('Memory Policy:')
  parts.push(policy.useRules)

  if (policy.invisibilityRules && policy.invisibilityRules.length > 0) {
    parts.push('\nInvisibility Rules:')
    parts.push(policy.invisibilityRules.map((r) => `- ${r}`).join('\n'))
  }

  if (policy.priorityRules && policy.priorityRules.length > 0) {
    parts.push('\nPriority Rules:')
    parts.push(policy.priorityRules.map((r) => `- ${r}`).join('\n'))
  }

  return parts.join('\n')
}

/**
 * Summary layer projection for Layer 7.
 *
 * Contains pre-computed summaries at different granularity levels.
 * All fields are optional - only include summaries that have been computed.
 */
export interface SummaryLayerProjection {
  /** Session-level summary (current session) */
  session?: string | null
  /** Daily summary (aggregated sessions from today) */
  daily?: string | null
  /** Weekly summary (aggregated daily summaries) */
  weekly?: string | null
  /** Long-term user profile */
  longTerm?: string | null
  /** Atomic facts extracted from conversations */
  atomicFacts?: string | null
}

/**
 * Renders a SummaryLayerProjection to a text representation.
 *
 * @param projection - The summary layers to render
 * @returns Rendered summary text, or empty string if no layers
 */
export function renderSummaryLayers(projection: SummaryLayerProjection): string {
  const parts: string[] = []

  if (projection.session) {
    parts.push('## Session Summary')
    parts.push(projection.session)
  }

  if (projection.daily) {
    parts.push('## Daily Summary')
    parts.push(projection.daily)
  }

  if (projection.weekly) {
    parts.push('## Weekly Summary')
    parts.push(projection.weekly)
  }

  if (projection.longTerm) {
    parts.push('## Long-Term Profile')
    parts.push(projection.longTerm)
  }

  if (projection.atomicFacts) {
    parts.push('## Atomic Facts')
    parts.push(projection.atomicFacts)
  }

  return parts.join('\n\n')
}

/**
 * Complete input to ModelInputBuilder.build().
 *
 * Fields are organized by which segment/layer they belong to:
 * - mode/agentType/agentProfile/providerFamily: determine template resolution
 * - systemPrompt/routingPrompt: Layer 5 (Segment B)
 * - toolProjection: Layer 6 (Segment C)
 * - contextBundle + dynamic fields: Layer 7 (Segment D)
 */
export interface ModelInputBuildInput {
  /** How the LLM should be invoked */
  mode: ModelInputMode

  // ── Taxonomy dimensions ────────────────────────────────────────────────
  /** Runtime agent class: 'main' | 'subagent' | 'background' | 'workflow_step' | 'remote'. Derived from agentKind via normalizer if omitted. */
  agentType?: AgentType
  /** Capability/persona profile identifier (e.g., 'default_main', 'foreground', 'planner'). Derived from agentKind via normalizer if omitted. */
  agentProfile?: string
  /** Provider family string used for provider-specific template selection */
  providerFamily: string
  /** Platform-owned output schema identifier (e.g., 'output:planner.schema') */
  outputContract?: string
  /** Audit-only entry path — records how agent was launched, does not expand permissions */
  launchSource?: LaunchSource
  /**
   * Volatile runtime environment facts (hostname, OS, runtime version, etc.).
   *
   * EXCLUDED from cache-stable prefix. Only rendered in Segment D (context bundle).
   * Never part of Segment A/B/C hash computation.
   */
  runtimeEnvironment?: Record<string, unknown>

  // ── Legacy (deprecated) ───────────────────────────────────────────────
  /**
   * @deprecated Use `agentType` + `agentProfile` instead.
   * Legacy agent kind string used for template resolution.
   * When provided without agentType/agentProfile, the normalizer derives them.
   */
  agentKind?: string

  // Layer 5 (Instruction) - Segment B
  /** Custom system prompt overlay */
  systemPrompt?: string
  /** Routing prompt overlay */
  routingPrompt?: string
  /** Persona projection for expression style and preferences */
  personaProjection?: PersonaProjection
  /** Grouped Segment B inputs (B1/B2/B3). Individual fields above take precedence when both are provided. */
  segmentB?: SegmentBInputs

  // Layer 6 (Tool Plane) - Segment C
  /** Tool plane projection data */
  toolProjection?: ToolPlaneProjection
  toolSelectionPolicy?: ToolSelectionPolicyProjection
  /**
   * Skill plane projection (documentation-only).
   *
   * Rendered in Segment C alongside the tool plane with explicit
   * `--- Skill Plane (documentation only) ---` / `--- Tool Plane (callable tools) ---`
   * headings. Skills are never callable tools and never appear in
   * `LLMRequest.tools`. Must NOT be rendered in Segment A (static prefix)
   * to preserve provider cache stability.
   */
  skillProjection?: SkillPlaneProjection

  // Layer 7 (Context Bundle) - Segment D
  /** Context bundle data */
  contextBundle?: ContextBundleData
  /** Memory policy projection for memory usage rules */
  memoryPolicyProjection?: MemoryPolicyProjection
  /** Top-level summary layer projection (strategy projection, not nested in contextBundle). Takes precedence over contextBundle.summaryLayers. */
  summaryLayers?: SummaryLayerProjection

  // Dynamic fields (only in Segment D)
  /** The current user message */
  currentUserMessage?: string
  /** ISO date string for current date */
  currentDate?: string
  /** Session identifier */
  sessionId?: string
  /** Run identifier */
  runId?: string
  /** Message identifier */
  messageId?: string
  /** Request identifier */
  requestId?: string

  /** Prior transcript messages for incremental context */
  transcript?: LLMMessage[]
}

// ─── Output Types ────────────────────────────────────────────────────────────

/**
 * Segment content and hashes for the built model input.
 */
export interface ModelInputSegments {
  /** Segment A: Layer 1-4 (static prefix) */
  staticPrefix: string
  /** Segment B: Layer 5 (tenant/project instructions) */
  tenantProject: string
  /** Segment C: Layer 6 (tool plane) */
  toolPlane: string
  /** Segment D: Layer 7 (context bundle + dynamic) */
  contextBundle: string
}

/**
 * SHA-256 hashes for each segment.
 */
export interface ModelInputSegmentHashes {
  /** SHA-256 hash of Segment A (static prefix) */
  segmentA: string
  /** SHA-256 hash of Segment B (tenant/project) */
  segmentB: string
  /** SHA-256 hash of Segment C (tool plane) */
  segmentC: string
  /** SHA-256 hash of Segment D (context bundle) */
  segmentD: string
}

/**
 * Metadata about the built model input.
 */
export interface ModelInputMetadata {
  /** The mode used to build */
  mode: ModelInputMode
  /** Agent kind (legacy, derived from agentProfile for backward compat) */
  agentKind: string
  /** Runtime agent class */
  agentType: AgentType
  /** Capability/persona profile identifier */
  agentProfile: string
  /** Provider family */
  providerFamily: string
  /** Total number of messages in the output */
  messageCount: number
  /** Platform-owned output schema identifier, if any */
  outputContract?: string
  /** Audit-only launch source, if any */
  launchSource?: LaunchSource
}

/**
 * Complete output of ModelInputBuilder.build().
 */
export interface BuiltModelInput {
  /** The assembled LLM messages array */
  messages: LLMMessage[]
  /** Content of each segment */
  segments: ModelInputSegments
  /** SHA-256 hashes of each segment */
  segmentHashes: ModelInputSegmentHashes
  /** Build metadata */
  metadata: ModelInputMetadata
}

/**
 * Resolve a provider ID to its family for model input template selection.
 *
 * Normalizes provider IDs into a registry-supported provider family:
 * - 'deepseek' — DeepSeek-compatible providers (deepseek, deepseek-chat, etc.)
 * - 'ollama'   — Ollama and Ollama-compatible local providers
 * - 'anthropic' — Anthropic/Claude-compatible providers
 * - 'gemini'   — Google Gemini-compatible providers
 * - 'openai'   — OpenAI and OpenAI-compatible providers (openai, openrouter, etc.)
 *
 * This is used by ForegroundAgent and AgentKernel to select the correct
 * prompt template and caching strategy for a given LLM provider.
 */
export function resolveProviderFamily(providerId: string | undefined): ProviderFamily {
  const normalized = providerId?.toLowerCase() ?? ''
  if (normalized.startsWith('deepseek') || normalized.includes('deepseek')) {
    return 'deepseek'
  }
  if (normalized.startsWith('ollama')) {
    return 'ollama'
  }
  if (normalized.includes('anthropic') || normalized.includes('claude')) {
    return 'anthropic'
  }
  if (normalized.includes('gemini') || normalized.includes('google')) {
    return 'gemini'
  }
  return 'openai'
}
