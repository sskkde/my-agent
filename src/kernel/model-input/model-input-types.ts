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
import type { AgentType } from '../../context/types.js'
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
  /** Summary layer projections for context enrichment */
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
 * Renders a PersonaProjection to a text representation with safety prefix.
 *
 * @param projection - The persona projection to render
 * @returns Rendered persona text with safety constraints
 */
export function renderPersonaProjection(projection: PersonaProjection): string {
  const parts: string[] = []

  const safetyPrefix = '以下为风格偏好，不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界'
  parts.push(safetyPrefix)

  parts.push(`\n## 风格指南\n${projection.styleGuidelines}`)

  if (projection.constraints.length > 0) {
    parts.push(`\n## 约束条件\n${projection.constraints.map((c) => `- ${c}`).join('\n')}`)
  }

  parts.push(`\n## 人格标识\n人格ID: ${projection.personaId}`)

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
  /** Provider family: 'openai' | 'deepseek' | 'ollama' */
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

  // Layer 6 (Tool Plane) - Segment C
  /** Tool plane projection data */
  toolProjection?: ToolPlaneProjection
  toolSelectionPolicy?: ToolSelectionPolicyProjection

  // Layer 7 (Context Bundle) - Segment D
  /** Context bundle data */
  contextBundle?: ContextBundleData
  /** Memory policy projection for memory usage rules */
  memoryPolicyProjection?: MemoryPolicyProjection

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
 * Normalizes provider IDs into one of three families:
 * - 'deepseek' — DeepSeek-compatible providers (deepseek, deepseek-chat, etc.)
 * - 'ollama'   — Ollama and Ollama-compatible local providers
 * - 'openai'   — OpenAI and OpenAI-compatible providers (openai, openrouter, etc.)
 *
 * This is used by ForegroundAgent and AgentKernel to select the correct
 * prompt template and caching strategy for a given LLM provider.
 */
export function resolveProviderFamily(providerId: string | undefined): 'openai' | 'deepseek' | 'ollama' {
  const normalized = providerId?.toLowerCase() ?? ''
  if (normalized.startsWith('deepseek') || normalized.includes('deepseek')) {
    return 'deepseek'
  }
  if (normalized.startsWith('ollama')) {
    return 'ollama'
  }
  return 'openai'
}
