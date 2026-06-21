/**
 * Prompt Template Registry - Immutable template records with resolution.
 *
 * Provides a Map-based registry for template metadata and
 * resolution by agent kind, provider family, and the new seven-layer
 * taxonomy (agentType, agentProfile, outputContract).
 *
 * @module prompt/prompt-template-registry
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_TEMPLATES_PATH = join(__dirname, 'templates')

// ─── Seven-Layer Taxonomy ────────────────────────────────────────────────────

/**
 * The seven layers of the prompt stack.
 *
 * Each layer fills a specific slot in the assembled prompt:
 * 1. platform — Platform base identity and safety rules
 * 2. provider — LLM provider-specific instructions
 * 3. agentType — Runtime agent class behavior
 * 4. outputContract — Output schema contract
 * 5. agentProfile — Capability/persona profile
 * 6. toolProjection — Tool selection policy and projected surface
 * 7. runtimeContext — Dynamic context bundle and summaries
 */
export type TaxonomyLayer =
  | 'platform'
  | 'provider'
  | 'agentType'
  | 'outputContract'
  | 'agentProfile'
  | 'toolProjection'
  | 'runtimeContext'

/**
 * Input for seven-layer template resolution.
 */
export interface SevenLayerInput {
  /** Runtime agent class: 'main' | 'subagent' | 'background' */
  agentType: string
  /** Capability/persona profile identifier (e.g., 'default_main', 'foreground') */
  agentProfile: string
  /** Provider family: 'openai' | 'deepseek' | 'ollama' */
  providerFamily: string
  /** Optional platform-owned output schema identifier */
  outputContract?: string
}

// ─── Template Record ─────────────────────────────────────────────────────────

export interface PromptTemplateRecord {
  /** Template ID in format "category:name" */
  id: string
  /** Version string in YYYY-MM-DD format */
  version: string
  /** File path relative to templates directory */
  path: string
  /** Agent kind this template applies to ('*' for all). */
  agentKind: string
  /** Provider family this template applies to ('*' for all) */
  providerFamily: string
  /** Layer number (1-4 for cached prefix, 5-7 for dynamic) */
  layer: number
  /** Optional inline content (for testing) */
  content?: string
  /** Human-readable description */
  description: string
  // ── New taxonomy fields (optional for backward compat) ──────────────────
  /** Which seven-layer slot this record fills. Undefined for legacy-only records. */
  taxonomyLayer?: TaxonomyLayer
  /** For agentType layer: which agentType this template applies to ('*' for all) */
  agentType?: string
  /** For agentProfile layer: which profile this template applies to ('*' for all) */
  agentProfile?: string
  /** For outputContract layer: which output contract this template applies to */
  outputContract?: string
}

export interface ResolvedTemplate {
  /** The template record */
  record: PromptTemplateRecord
  /** The loaded template content */
  content: string
}

const PLATFORM_BASE_TEMPLATE: PromptTemplateRecord = {
  id: 'platform:base',
  version: '2026-05-23',
  path: 'platform/base.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 1,
  description: 'Platform base template with core identity and rules',
  taxonomyLayer: 'platform',
}

const PLATFORM_SAFETY_TEMPLATE: PromptTemplateRecord = {
  id: 'platform:safety',
  version: '2026-05-23',
  path: 'platform/safety.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 1,
  description: 'Platform safety template with security boundaries',
  taxonomyLayer: 'platform',
}

const PROVIDER_OPENAI_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:openai',
  version: '2026-05-23',
  path: 'provider/openai.md',
  agentKind: '*',
  providerFamily: 'openai',
  layer: 2,
  description: 'OpenAI provider template with JSON mode and function calling',
  taxonomyLayer: 'provider',
}

const PROVIDER_DEEPSEEK_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:deepseek',
  version: '2026-05-23',
  path: 'provider/deepseek.md',
  agentKind: '*',
  providerFamily: 'deepseek',
  layer: 2,
  description: 'DeepSeek provider template with KV cache optimization',
  taxonomyLayer: 'provider',
}

const PROVIDER_OLLAMA_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:ollama',
  version: '2026-06-21',
  path: 'provider/ollama.md',
  agentKind: '*',
  providerFamily: 'ollama',
  layer: 2,
  description: 'Ollama provider template for local model inference',
  taxonomyLayer: 'provider',
}

const PROVIDER_ANTHROPIC_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:anthropic',
  version: '2026-06-21',
  path: 'provider/anthropic.md',
  agentKind: '*',
  providerFamily: 'anthropic',
  layer: 2,
  description: 'Anthropic provider template for Claude model interaction',
  taxonomyLayer: 'provider',
}

const PROVIDER_GEMINI_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:gemini',
  version: '2026-06-21',
  path: 'provider/gemini.md',
  agentKind: '*',
  providerFamily: 'gemini',
  layer: 2,
  description: 'Gemini provider template for Google Gemini model interaction',
  taxonomyLayer: 'provider',
}



const PERSONA_DEFAULT_TEMPLATE: PromptTemplateRecord = {
  id: 'persona:default',
  version: '2026-05-24',
  path: 'persona/default.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 5,
  description: 'Default assistant persona with style guidelines and constraints',
  taxonomyLayer: 'agentProfile',
  agentProfile: '*',
}

const HEURISTICS_TOOL_USAGE_COMMON_TEMPLATE: PromptTemplateRecord = {
  id: 'heuristics:tool-usage.common',
  version: '2026-05-24',
  path: 'heuristics/tool-usage.common.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 6,
  description: 'Common tool usage heuristics for tool selection policy',
  taxonomyLayer: 'toolProjection',
}

const CONTEXT_MEMORY_USE_RULES_TEMPLATE: PromptTemplateRecord = {
  id: 'context:memory-use-rules',
  version: '2026-05-24',
  path: 'context/memory-use-rules.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Memory usage rules for context bundle policy',
  taxonomyLayer: 'runtimeContext',
}

const SUMMARY_SESSION_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:session',
  version: '2026-05-24',
  path: 'summary/session.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Session-level summary prompt for capturing decisions, actions, and state',
  taxonomyLayer: 'runtimeContext',
}

const SUMMARY_DAILY_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:daily',
  version: '2026-05-24',
  path: 'summary/daily.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Daily summary prompt for multi-session synthesis and patterns',
  taxonomyLayer: 'runtimeContext',
}

const SUMMARY_WEEKLY_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:weekly',
  version: '2026-05-24',
  path: 'summary/weekly.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Weekly summary prompt for high-level progress and strategic insights',
  taxonomyLayer: 'runtimeContext',
}

const SUMMARY_LONG_TERM_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:long-term',
  version: '2026-05-24',
  path: 'summary/long-term.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Long-term profile prompt for user preferences, goals, and expertise',
  taxonomyLayer: 'runtimeContext',
}

const SUMMARY_ATOMIC_FACTS_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:atomic-facts',
  version: '2026-05-24',
  path: 'summary/atomic-facts.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Atomic facts extraction prompt for independently-verifiable facts',
  taxonomyLayer: 'runtimeContext',
}

// ── Seven-Layer Taxonomy Records ─────────────────────────────────────────────

const AGENT_PROFILE_DOCUMENT_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:document_processor',
  version: '2026-06-21',
  path: 'agentProfile/document_processor.md',
  agentKind: 'agentProfile:document_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Document processor profile for text extraction, summarization, and analysis',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'document_processor',
}

const AGENT_PROFILE_IMAGE_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:image_processor',
  version: '2026-06-21',
  path: 'agentProfile/image_processor.md',
  agentKind: 'agentProfile:image_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Image processor profile for visual understanding, description, and analysis',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'image_processor',
}

const AGENT_PROFILE_DATA_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:data_processor',
  version: '2026-06-21',
  path: 'agentProfile/data_processor.md',
  agentKind: 'agentProfile:data_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Data processor profile for structured data conversion, analysis, and formatting',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'data_processor',
}

const AGENT_PROFILE_AUDIO_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:audio_processor',
  version: '2026-06-21',
  path: 'agentProfile/audio_processor.md',
  agentKind: 'agentProfile:audio_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Audio processor profile for transcription, analysis, and content extraction',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'audio_processor',
}

const AGENT_PROFILE_CODE_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:code_processor',
  version: '2026-06-21',
  path: 'agentProfile/code_processor.md',
  agentKind: 'agentProfile:code_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Code processor profile for analysis, refactoring suggestions, and generation',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'code_processor',
}

const AGENT_TYPE_MAIN_TEMPLATE: PromptTemplateRecord = {
  id: 'agentType:main',
  version: '2026-06-18',
  path: 'agentType/main.md',
  agentKind: 'main',
  providerFamily: '*',
  layer: 3,
  description: 'Main agent type template for primary user-facing or kernel execution',
  taxonomyLayer: 'agentType',
  agentType: 'main',
}

const AGENT_TYPE_SUBAGENT_TEMPLATE: PromptTemplateRecord = {
  id: 'agentType:subagent',
  version: '2026-06-18',
  path: 'agentType/subagent.md',
  agentKind: 'subagent',
  providerFamily: '*',
  layer: 3,
  description: 'Subagent type template for isolated task execution',
  taxonomyLayer: 'agentType',
  agentType: 'subagent',
}

const AGENT_TYPE_BACKGROUND_TEMPLATE: PromptTemplateRecord = {
  id: 'agentType:background',
  version: '2026-06-18',
  path: 'agentType/background.md',
  agentKind: 'background',
  providerFamily: '*',
  layer: 3,
  description: 'Background agent type template for async deferred tasks',
  taxonomyLayer: 'agentType',
  agentType: 'background',
}

const AGENT_TYPE_WORKFLOW_STEP_TEMPLATE: PromptTemplateRecord = {
  id: 'agentType:workflow_step',
  version: '2026-06-21',
  path: 'agentType/workflow_step.md',
  agentKind: 'workflow_step',
  providerFamily: '*',
  layer: 3,
  description: 'Workflow step agent type template for orchestrated pipeline execution',
  taxonomyLayer: 'agentType',
  agentType: 'workflow_step',
}

const AGENT_TYPE_REMOTE_TEMPLATE: PromptTemplateRecord = {
  id: 'agentType:remote',
  version: '2026-06-21',
  path: 'agentType/remote.md',
  agentKind: 'remote',
  providerFamily: '*',
  layer: 3,
  description: 'Remote agent type template for externally-delegated execution',
  taxonomyLayer: 'agentType',
  agentType: 'remote',
}

const OUTPUT_CONTRACT_PLANNER_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'outputContract:planner.schema',
  version: '2026-06-18',
  path: 'outputContract/planner.schema.md',
  agentKind: 'outputContract:planner.schema',
  providerFamily: '*',
  layer: 4,
  description: 'Planner output contract for execution plan JSON schema',
  taxonomyLayer: 'outputContract',
  outputContract: 'output:planner.schema',
}

const OUTPUT_CONTRACT_MEMORY_CANDIDATE_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'outputContract:memory-candidate.schema',
  version: '2026-06-18',
  path: 'outputContract/memory-candidate.schema.md',
  agentKind: 'outputContract:memory-candidate.schema',
  providerFamily: '*',
  layer: 4,
  description: 'Memory candidate output contract for extraction JSON schema',
  taxonomyLayer: 'outputContract',
  outputContract: 'output:memory-candidate.schema',
}

const OUTPUT_CONTRACT_SEARCH_EVIDENCE_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'outputContract:search-evidence.schema',
  version: '2026-06-18',
  path: 'outputContract/search-evidence.schema.md',
  agentKind: 'outputContract:search-evidence.schema',
  providerFamily: '*',
  layer: 4,
  description: 'Search evidence output contract for search subagent answer generation',
  taxonomyLayer: 'outputContract',
  outputContract: 'output:search-evidence.schema',
}

const OUTPUT_CONTRACT_DEFAULT_CHAT_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'outputContract:default-chat.schema',
  version: '2026-06-18',
  path: 'outputContract/default-chat.schema.md',
  agentKind: 'outputContract:default-chat.schema',
  providerFamily: '*',
  layer: 4,
  description: 'Default chat output contract for foreground conversational responses',
  taxonomyLayer: 'outputContract',
  outputContract: 'output:default-chat.schema',
}

const AGENT_PROFILE_DEFAULT_MAIN_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:default_main',
  version: '2026-06-18',
  path: 'agentProfile/default_main.md',
  agentKind: 'agentProfile:default_main',
  providerFamily: '*',
  layer: 5,
  description: 'Default main agent profile for kernel execution',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'default_main',
}

const AGENT_PROFILE_FOREGROUND_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:foreground',
  version: '2026-06-18',
  path: 'agentProfile/foreground.md',
  agentKind: 'agentProfile:foreground',
  providerFamily: '*',
  layer: 5,
  description: 'Foreground agent profile for user-facing conversation',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'foreground',
}

const AGENT_PROFILE_PLANNER_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:planner',
  version: '2026-06-18',
  path: 'agentProfile/planner.md',
  agentKind: 'agentProfile:planner',
  providerFamily: '*',
  layer: 5,
  description: 'Planner agent profile for task planning and orchestration',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'planner',
}

const AGENT_PROFILE_MEMORY_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:memory',
  version: '2026-06-18',
  path: 'agentProfile/memory.md',
  agentKind: 'agentProfile:memory',
  providerFamily: '*',
  layer: 5,
  description: 'Memory agent profile for background extraction',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'memory',
}

const AGENT_PROFILE_SEARCH_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:search',
  version: '2026-06-18',
  path: 'agentProfile/search.md',
  agentKind: 'agentProfile:search',
  providerFamily: '*',
  layer: 5,
  description: 'Search agent profile for web search and retrieval',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'search',
}

const AGENT_PROFILE_RESEARCH_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:research_processor',
  version: '2026-06-18',
  path: 'agentProfile/research_processor.md',
  agentKind: 'agentProfile:research_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Research processor profile for deep multi-source aggregation',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'research_processor',
}

const AGENT_PROFILE_SEARCH_PROCESSOR_TEMPLATE: PromptTemplateRecord = {
  id: 'agentProfile:search_processor',
  version: '2026-06-18',
  path: 'agentProfile/search_processor.md',
  agentKind: 'agentProfile:search_processor',
  providerFamily: '*',
  layer: 5,
  description: 'Search processor profile for quick web search and summarization',
  taxonomyLayer: 'agentProfile',
  agentProfile: 'search_processor',
}

const TOOL_PROJECTION_DEFAULT_TEMPLATE: PromptTemplateRecord = {
  id: 'toolProjection:default',
  version: '2026-06-18',
  path: 'toolProjection/default.md',
  agentKind: '_toolProjection',
  providerFamily: '*',
  layer: 6,
  description: 'Default tool projection template for tool selection policy',
  taxonomyLayer: 'toolProjection',
}

const RUNTIME_CONTEXT_DEFAULT_TEMPLATE: PromptTemplateRecord = {
  id: 'runtimeContext:default',
  version: '2026-06-18',
  path: 'runtimeContext/default.md',
  agentKind: '_runtimeContext',
  providerFamily: '*',
  layer: 7,
  description: 'Default runtime context template for dynamic context bundle',
  taxonomyLayer: 'runtimeContext',
}

export const PROMPT_TEMPLATE_REGISTRY: Map<string, PromptTemplateRecord> = new Map([
  // ── Platform & Provider templates ────────────────────────────────────────
  ['platform:base', PLATFORM_BASE_TEMPLATE],
  ['platform:safety', PLATFORM_SAFETY_TEMPLATE],
  ['provider:openai', PROVIDER_OPENAI_TEMPLATE],
  ['provider:deepseek', PROVIDER_DEEPSEEK_TEMPLATE],
  ['provider:ollama', PROVIDER_OLLAMA_TEMPLATE],
  ['provider:anthropic', PROVIDER_ANTHROPIC_TEMPLATE],
  ['provider:gemini', PROVIDER_GEMINI_TEMPLATE],
  // ── Cross-cutting templates (taxonomy-tagged) ────────────────────────────
  ['persona:default', PERSONA_DEFAULT_TEMPLATE],
  ['heuristics:tool-usage.common', HEURISTICS_TOOL_USAGE_COMMON_TEMPLATE],
  ['context:memory-use-rules', CONTEXT_MEMORY_USE_RULES_TEMPLATE],
  ['summary:session', SUMMARY_SESSION_TEMPLATE],
  ['summary:daily', SUMMARY_DAILY_TEMPLATE],
  ['summary:weekly', SUMMARY_WEEKLY_TEMPLATE],
  ['summary:long-term', SUMMARY_LONG_TERM_TEMPLATE],
  ['summary:atomic-facts', SUMMARY_ATOMIC_FACTS_TEMPLATE],
  // ── Seven-layer taxonomy records ────────────────────────────────────────
  ['agentType:main', AGENT_TYPE_MAIN_TEMPLATE],
  ['agentType:subagent', AGENT_TYPE_SUBAGENT_TEMPLATE],
  ['agentType:background', AGENT_TYPE_BACKGROUND_TEMPLATE],
  ['agentType:workflow_step', AGENT_TYPE_WORKFLOW_STEP_TEMPLATE],
  ['agentType:remote', AGENT_TYPE_REMOTE_TEMPLATE],
  ['outputContract:planner.schema', OUTPUT_CONTRACT_PLANNER_SCHEMA_TEMPLATE],
  ['outputContract:memory-candidate.schema', OUTPUT_CONTRACT_MEMORY_CANDIDATE_SCHEMA_TEMPLATE],
  ['outputContract:search-evidence.schema', OUTPUT_CONTRACT_SEARCH_EVIDENCE_SCHEMA_TEMPLATE],
  ['outputContract:default-chat.schema', OUTPUT_CONTRACT_DEFAULT_CHAT_SCHEMA_TEMPLATE],
  ['agentProfile:default_main', AGENT_PROFILE_DEFAULT_MAIN_TEMPLATE],
  ['agentProfile:foreground', AGENT_PROFILE_FOREGROUND_TEMPLATE],
  ['agentProfile:planner', AGENT_PROFILE_PLANNER_TEMPLATE],
  ['agentProfile:memory', AGENT_PROFILE_MEMORY_TEMPLATE],
  ['agentProfile:search', AGENT_PROFILE_SEARCH_TEMPLATE],
  ['agentProfile:document_processor', AGENT_PROFILE_DOCUMENT_PROCESSOR_TEMPLATE],
  ['agentProfile:image_processor', AGENT_PROFILE_IMAGE_PROCESSOR_TEMPLATE],
  ['agentProfile:data_processor', AGENT_PROFILE_DATA_PROCESSOR_TEMPLATE],
  ['agentProfile:audio_processor', AGENT_PROFILE_AUDIO_PROCESSOR_TEMPLATE],
  ['agentProfile:code_processor', AGENT_PROFILE_CODE_PROCESSOR_TEMPLATE],
  ['agentProfile:research_processor', AGENT_PROFILE_RESEARCH_PROCESSOR_TEMPLATE],
  ['agentProfile:search_processor', AGENT_PROFILE_SEARCH_PROCESSOR_TEMPLATE],
  ['toolProjection:default', TOOL_PROJECTION_DEFAULT_TEMPLATE],
  ['runtimeContext:default', RUNTIME_CONTEXT_DEFAULT_TEMPLATE],
])

export class PromptTemplateRegistry {
  private readonly templates: Map<string, PromptTemplateRecord>
  private readonly basePath: string

  constructor(templates?: Map<string, PromptTemplateRecord>, basePath?: string) {
    this.templates = templates ?? new Map(PROMPT_TEMPLATE_REGISTRY)
    this.basePath = basePath ?? DEFAULT_TEMPLATES_PATH
  }

  /**
   * Registers a new template record.
   *
   * @param id - Template ID
   * @param record - Template record to register
   */
  register(id: string, record: PromptTemplateRecord): void {
    this.templates.set(id, record)
  }

  /**
   * Gets a template record by ID.
   *
   * @param id - Template ID
   * @returns Template record or undefined if not found
   */
  getTemplate(id: string): PromptTemplateRecord | undefined {
    return this.templates.get(id)
  }

  /**
   * Gets all template IDs in the registry.
   *
   * @returns Array of template IDs
   */
  getAllTemplateIds(): string[] {
    return Array.from(this.templates.keys())
  }

  /**
   * Gets the base path for template files.
   *
   * @returns Base path string
   */
  getBasePath(): string {
    return this.basePath
  }

  /**
   * Checks if a template exists.
   *
   * @param id - Template ID
   * @returns True if template exists
   */
  hasTemplate(id: string): boolean {
    return this.templates.has(id)
  }

  /**
   * Gets templates by layer.
   *
   * @param layer - Layer number (1-7)
   * @returns Array of templates in the layer
   */
  getTemplatesByLayer(layer: number): PromptTemplateRecord[] {
    const matching: PromptTemplateRecord[] = []

    for (const record of this.templates.values()) {
      if (record.layer === layer) {
        matching.push(record)
      }
    }

    return matching
  }

  /**
   * Resolves templates using the seven-layer taxonomy.
   *
   * Returns templates for all seven layers sorted by layer number.
   * Uses taxonomyLayer + agentType/agentProfile/outputContract fields for matching.
   *
   * @param input - Seven-layer resolution input
   * @returns Array of resolved templates sorted by layer
   */
  resolveSevenLayer(input: SevenLayerInput): PromptTemplateRecord[] {
    const matching: PromptTemplateRecord[] = []

    for (const record of this.templates.values()) {
      if (this.matchesSevenLayer(record, input)) {
        matching.push(record)
      }
    }

    return matching.sort((a, b) => a.layer - b.layer)
  }

  /**
   * Gets templates grouped by taxonomy layer.
   *
   * @param input - Seven-layer resolution input
   * @returns Map from layer number to templates in that layer
   */
  resolveSevenLayerGrouped(input: SevenLayerInput): Map<number, PromptTemplateRecord[]> {
    const sorted = this.resolveSevenLayer(input)
    const grouped = new Map<number, PromptTemplateRecord[]>()

    for (const record of sorted) {
      const existing = grouped.get(record.layer)
      if (existing) {
        existing.push(record)
      } else {
        grouped.set(record.layer, [record])
      }
    }

    return grouped
  }

  private matchesSevenLayer(record: PromptTemplateRecord, input: SevenLayerInput): boolean {
    const providerMatches =
      record.providerFamily === '*' || record.providerFamily === input.providerFamily

    if (!providerMatches) {
      return false
    }

    if (record.taxonomyLayer) {
      return this.matchesTaxonomyRecord(record, input)
    }

    return false
  }

  private matchesTaxonomyRecord(record: PromptTemplateRecord, input: SevenLayerInput): boolean {
    switch (record.taxonomyLayer) {
      case 'platform':
        return true
      case 'provider':
        return true
      case 'agentType':
        return record.agentType === '*' || record.agentType === input.agentType
      case 'outputContract':
        if (!input.outputContract) return false
        return record.outputContract === input.outputContract
      case 'agentProfile':
        return record.agentProfile === '*' || record.agentProfile === input.agentProfile
      case 'toolProjection':
        return true
      case 'runtimeContext':
        return true
      default:
        return false
    }
  }

  }

export function createPromptTemplateRegistry(
  templates?: Map<string, PromptTemplateRecord>,
  basePath?: string,
): PromptTemplateRegistry {
  return new PromptTemplateRegistry(templates, basePath)
}
