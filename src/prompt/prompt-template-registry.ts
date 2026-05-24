/**
 * Prompt Template Registry - Immutable template records with resolution.
 *
 * Provides a Map-based registry for template metadata and
 * resolution by agent kind and provider family.
 *
 * @module prompt/prompt-template-registry
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_TEMPLATES_PATH = join(__dirname, 'templates');

export interface PromptTemplateRecord {
  /** Template ID in format "category:name" */
  id: string;
  /** Version string in YYYY-MM-DD format */
  version: string;
  /** File path relative to templates directory */
  path: string;
  /** Agent kind this template applies to ('*' for all) */
  agentKind: string;
  /** Provider family this template applies to ('*' for all) */
  providerFamily: string;
  /** Layer number (1-4 for cached prefix, 5-7 for dynamic) */
  layer: number;
  /** Optional inline content (for testing) */
  content?: string;
  /** Human-readable description */
  description: string;
}

export interface ResolvedTemplate {
  /** The template record */
  record: PromptTemplateRecord;
  /** The loaded template content */
  content: string;
}

const PLATFORM_BASE_TEMPLATE: PromptTemplateRecord = {
  id: 'platform:base',
  version: '2026-05-23',
  path: 'platform/base.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 1,
  description: 'Platform base template with core identity and rules',
};

const PLATFORM_SAFETY_TEMPLATE: PromptTemplateRecord = {
  id: 'platform:safety',
  version: '2026-05-23',
  path: 'platform/safety.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 1,
  description: 'Platform safety template with security boundaries',
};

const PROVIDER_OPENAI_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:openai',
  version: '2026-05-23',
  path: 'provider/openai.md',
  agentKind: '*',
  providerFamily: 'openai',
  layer: 2,
  description: 'OpenAI provider template with JSON mode and function calling',
};

const PROVIDER_DEEPSEEK_TEMPLATE: PromptTemplateRecord = {
  id: 'provider:deepseek',
  version: '2026-05-23',
  path: 'provider/deepseek.md',
  agentKind: '*',
  providerFamily: 'deepseek',
  layer: 2,
  description: 'DeepSeek provider template with KV cache optimization',
};

const AGENTS_FOREGROUND_TEMPLATE: PromptTemplateRecord = {
  id: 'agents:foreground',
  version: '2026-05-23',
  path: 'agents/foreground.md',
  agentKind: 'foreground',
  providerFamily: '*',
  layer: 3,
  description: 'Foreground agent template for message routing',
};

const AGENTS_KERNEL_TEMPLATE: PromptTemplateRecord = {
  id: 'agents:kernel',
  version: '2026-05-23',
  path: 'agents/kernel.md',
  agentKind: 'kernel',
  providerFamily: '*',
  layer: 3,
  description: 'Kernel agent template for execution engine',
};

const OUTPUT_FOREGROUND_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'output:foreground.schema',
  version: '2026-05-23',
  path: 'output/foreground.schema.md',
  agentKind: 'foreground',
  providerFamily: '*',
  layer: 4,
  description: 'Foreground output schema for routing JSON contract',
};

const OUTPUT_PLANNER_SCHEMA_TEMPLATE: PromptTemplateRecord = {
  id: 'output:planner.schema',
  version: '2026-05-23',
  path: 'output/planner.schema.md',
  agentKind: 'planner',
  providerFamily: '*',
  layer: 4,
  description: 'Planner output schema for execution plan JSON contract',
};

const PERSONA_DEFAULT_TEMPLATE: PromptTemplateRecord = {
  id: 'persona:default',
  version: '2026-05-24',
  path: 'persona/default.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 5,
  description: 'Default assistant persona with style guidelines and constraints',
};

const HEURISTICS_TOOL_USAGE_COMMON_TEMPLATE: PromptTemplateRecord = {
  id: 'heuristics:tool-usage.common',
  version: '2026-05-24',
  path: 'heuristics/tool-usage.common.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 6,
  description: 'Common tool usage heuristics for tool selection policy',
};

const CONTEXT_MEMORY_USE_RULES_TEMPLATE: PromptTemplateRecord = {
  id: 'context:memory-use-rules',
  version: '2026-05-24',
  path: 'context/memory-use-rules.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Memory usage rules for context bundle policy',
};

const SUMMARY_SESSION_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:session',
  version: '2026-05-24',
  path: 'summary/session.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Session-level summary prompt for capturing decisions, actions, and state',
};

const SUMMARY_DAILY_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:daily',
  version: '2026-05-24',
  path: 'summary/daily.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Daily summary prompt for multi-session synthesis and patterns',
};

const SUMMARY_WEEKLY_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:weekly',
  version: '2026-05-24',
  path: 'summary/weekly.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Weekly summary prompt for high-level progress and strategic insights',
};

const SUMMARY_LONG_TERM_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:long-term',
  version: '2026-05-24',
  path: 'summary/long-term.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Long-term profile prompt for user preferences, goals, and expertise',
};

const SUMMARY_ATOMIC_FACTS_TEMPLATE: PromptTemplateRecord = {
  id: 'summary:atomic-facts',
  version: '2026-05-24',
  path: 'summary/atomic-facts.md',
  agentKind: '*',
  providerFamily: '*',
  layer: 7,
  description: 'Atomic facts extraction prompt for independently-verifiable facts',
};

export const PROMPT_TEMPLATE_REGISTRY: Map<string, PromptTemplateRecord> = new Map([
  ['platform:base', PLATFORM_BASE_TEMPLATE],
  ['platform:safety', PLATFORM_SAFETY_TEMPLATE],
  ['provider:openai', PROVIDER_OPENAI_TEMPLATE],
  ['provider:deepseek', PROVIDER_DEEPSEEK_TEMPLATE],
  ['agents:foreground', AGENTS_FOREGROUND_TEMPLATE],
  ['agents:kernel', AGENTS_KERNEL_TEMPLATE],
  ['output:foreground.schema', OUTPUT_FOREGROUND_SCHEMA_TEMPLATE],
  ['output:planner.schema', OUTPUT_PLANNER_SCHEMA_TEMPLATE],
  ['persona:default', PERSONA_DEFAULT_TEMPLATE],
  ['heuristics:tool-usage.common', HEURISTICS_TOOL_USAGE_COMMON_TEMPLATE],
  ['context:memory-use-rules', CONTEXT_MEMORY_USE_RULES_TEMPLATE],
  ['summary:session', SUMMARY_SESSION_TEMPLATE],
  ['summary:daily', SUMMARY_DAILY_TEMPLATE],
  ['summary:weekly', SUMMARY_WEEKLY_TEMPLATE],
  ['summary:long-term', SUMMARY_LONG_TERM_TEMPLATE],
  ['summary:atomic-facts', SUMMARY_ATOMIC_FACTS_TEMPLATE],
]);

export class PromptTemplateRegistry {
  private readonly templates: Map<string, PromptTemplateRecord>;
  private readonly basePath: string;

  constructor(templates?: Map<string, PromptTemplateRecord>, basePath?: string) {
    this.templates = templates ?? new Map(PROMPT_TEMPLATE_REGISTRY);
    this.basePath = basePath ?? DEFAULT_TEMPLATES_PATH;
  }

  /**
   * Registers a new template record.
   *
   * @param id - Template ID
   * @param record - Template record to register
   */
  register(id: string, record: PromptTemplateRecord): void {
    this.templates.set(id, record);
  }

  /**
   * Gets a template record by ID.
   *
   * @param id - Template ID
   * @returns Template record or undefined if not found
   */
  getTemplate(id: string): PromptTemplateRecord | undefined {
    return this.templates.get(id);
  }

  /**
   * Resolves templates for a specific agent kind and provider family.
   *
   * Returns all matching templates sorted by layer number.
   *
   * @param agentKind - Agent kind (e.g., 'foreground', 'kernel')
   * @param providerFamily - Provider family (e.g., 'openai', 'deepseek')
   * @returns Array of resolved templates sorted by layer
   */
  resolveTemplate(agentKind: string, providerFamily: string): PromptTemplateRecord[] {
    const matching: PromptTemplateRecord[] = [];

    for (const record of this.templates.values()) {
      const agentKindMatches =
        record.agentKind === '*' || record.agentKind === agentKind;
      const providerFamilyMatches =
        record.providerFamily === '*' || record.providerFamily === providerFamily;

      if (agentKindMatches && providerFamilyMatches) {
        matching.push(record);
      }
    }

    return matching.sort((a, b) => a.layer - b.layer);
  }

  /**
   * Gets all template IDs in the registry.
   *
   * @returns Array of template IDs
   */
  getAllTemplateIds(): string[] {
    return Array.from(this.templates.keys());
  }

  /**
   * Gets the base path for template files.
   *
   * @returns Base path string
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Checks if a template exists.
   *
   * @param id - Template ID
   * @returns True if template exists
   */
  hasTemplate(id: string): boolean {
    return this.templates.has(id);
  }

  /**
   * Gets templates by layer.
   *
   * @param layer - Layer number (1-7)
   * @returns Array of templates in the layer
   */
  getTemplatesByLayer(layer: number): PromptTemplateRecord[] {
    const matching: PromptTemplateRecord[] = [];

    for (const record of this.templates.values()) {
      if (record.layer === layer) {
        matching.push(record);
      }
    }

    return matching;
  }
}

export function createPromptTemplateRegistry(
  templates?: Map<string, PromptTemplateRecord>,
  basePath?: string
): PromptTemplateRegistry {
  return new PromptTemplateRegistry(templates, basePath);
}
