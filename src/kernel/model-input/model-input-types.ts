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

import type { LLMMessage, ToolDefinition } from '../../llm/types.js';

// ─── Mode ────────────────────────────────────────────────────────────────────

/**
 * The mode determines how the LLM should be invoked.
 *
 * - `routing_json`: ForegroundAgent - structured JSON routing, no tools in request
 * - `structured_json`: MemoryExtractor - structured JSON extraction, no tools
 * - `function_calling`: AgentKernel/SearchSubagent - full function calling with tools
 */
export type ModelInputMode = 'routing_json' | 'structured_json' | 'function_calling';

// ─── Input Types ─────────────────────────────────────────────────────────────

/**
 * Tool plane projection data.
 *
 * For `routing_json` mode: only toolIds and optional summary.
 * For `function_calling` mode: full tool schemas for LLM request.
 */
export interface ToolPlaneProjection {
  /** Tool IDs available for this request */
  toolIds: string[];
  /** Optional human-readable summary of available tools */
  toolSummaries?: string;
  /** Full tool schemas for function_calling mode */
  tools?: ToolDefinition[];
}

/**
 * A single context item for the context bundle.
 */
export interface ContextItemData {
  /** Unique item identifier */
  itemId: string;
  /** The text content of this context item */
  content: string;
  /** Semantic type hint (e.g., 'instruction', 'fact', 'tool_output') */
  semanticType?: string;
  /** Whether this item is pinned (always included) */
  isPinned?: boolean;
}

/**
 * Context bundle data for Layer 7.
 *
 * All fields are optional - the builder handles missing data gracefully.
 */
export interface ContextBundleData {
  /** Pinned items that always appear at the top */
  pinnedItems?: ContextItemData[];
  /** Ordered context items */
  orderedItems?: ContextItemData[];
  /** Summary blocks for compressed context */
  summaryBlocks?: ContextItemData[];
  /** Plan context view string */
  planView?: string;
  /** Workflow step view string */
  workflowStepView?: string;
  /** Background run view string */
  backgroundRunView?: string;
  /** Trigger event view string */
  triggerView?: string;
  /** Prior conversation transcript */
  transcript?: LLMMessage[];
}

/**
 * Complete input to ModelInputBuilder.build().
 *
 * Fields are organized by which segment/layer they belong to:
 * - mode/agentKind/providerFamily: determine template resolution
 * - systemPrompt/routingPrompt: Layer 5 (Segment B)
 * - toolProjection: Layer 6 (Segment C)
 * - contextBundle + dynamic fields: Layer 7 (Segment D)
 */
export interface ModelInputBuildInput {
  /** How the LLM should be invoked */
  mode: ModelInputMode;
  /** Agent kind: 'foreground' | 'kernel' | 'search' | 'memory' */
  agentKind: string;
  /** Provider family: 'openai' | 'deepseek' | 'ollama' */
  providerFamily: string;

  // Layer 5 (Instruction) - Segment B
  /** Custom system prompt overlay */
  systemPrompt?: string;
  /** Routing prompt overlay */
  routingPrompt?: string;

  // Layer 6 (Tool Plane) - Segment C
  /** Tool plane projection data */
  toolProjection?: ToolPlaneProjection;

  // Layer 7 (Context Bundle) - Segment D
  /** Context bundle data */
  contextBundle?: ContextBundleData;

  // Dynamic fields (only in Segment D)
  /** The current user message */
  currentUserMessage?: string;
  /** ISO date string for current date */
  currentDate?: string;
  /** Session identifier */
  sessionId?: string;
  /** Run identifier */
  runId?: string;
  /** Message identifier */
  messageId?: string;
  /** Request identifier */
  requestId?: string;

  /** Prior transcript messages for incremental context */
  transcript?: LLMMessage[];
}

// ─── Output Types ────────────────────────────────────────────────────────────

/**
 * Segment content and hashes for the built model input.
 */
export interface ModelInputSegments {
  /** Segment A: Layer 1-4 (static prefix) */
  staticPrefix: string;
  /** Segment B: Layer 5 (tenant/project instructions) */
  tenantProject: string;
  /** Segment C: Layer 6 (tool plane) */
  toolPlane: string;
  /** Segment D: Layer 7 (context bundle + dynamic) */
  contextBundle: string;
}

/**
 * SHA-256 hashes for each segment.
 */
export interface ModelInputSegmentHashes {
  /** SHA-256 hash of Segment A (static prefix) */
  segmentA: string;
  /** SHA-256 hash of Segment B (tenant/project) */
  segmentB: string;
  /** SHA-256 hash of Segment C (tool plane) */
  segmentC: string;
  /** SHA-256 hash of Segment D (context bundle) */
  segmentD: string;
}

/**
 * Metadata about the built model input.
 */
export interface ModelInputMetadata {
  /** The mode used to build */
  mode: ModelInputMode;
  /** Agent kind */
  agentKind: string;
  /** Provider family */
  providerFamily: string;
  /** Total number of messages in the output */
  messageCount: number;
}

/**
 * Complete output of ModelInputBuilder.build().
 */
export interface BuiltModelInput {
  /** The assembled LLM messages array */
  messages: LLMMessage[];
  /** Content of each segment */
  segments: ModelInputSegments;
  /** SHA-256 hashes of each segment */
  segmentHashes: ModelInputSegmentHashes;
  /** Build metadata */
  metadata: ModelInputMetadata;
}
