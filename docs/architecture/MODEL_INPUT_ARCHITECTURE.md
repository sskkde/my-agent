# Model Input Builder Architecture

> Version: 1.1.0
> Created: 2026-05-23
> Status: Implemented

---

## Overview

The ModelInputBuilder is a kernel-owned shared component that constructs LLM request messages from a seven-layer architecture. Its primary purpose is to maximize DeepSeek KV Cache prefix hit rates by ensuring stable, deterministic message prefixes across requests.

### Key Design Principles

1. **Seven Layers, Four Segments**: Content organized into layers for clarity, grouped into segments for caching
2. **Segment A Stability**: The static prefix (Layers 1-4) never changes for the same agent+provider combination
3. **Cache-Aware Design**: Segments A+B+C form the cache key; Segment D is always dynamic
4. **Three Modes**: Different LLM invocation patterns supported via mode selection

---

## Architecture Diagram

```
+------------------------------------------------------------------+
|                      ModelInputBuilder                            |
+------------------------------------------------------------------+
|                                                                   |
|  +-- Segment A (Cache Key Part 1) ----------------------------+   |
|  |                                                            |   |
|  |  Layer 1: Platform                                         |   |
|  |  - platform/base.md (identity, core rules)                 |   |
|  |  - platform/safety.md (security boundaries)                |   |
|  |                                                            |   |
|  |  Layer 2: Provider                                         |   |
|  |  - provider/openai.md (OpenAI-specific rules)              |   |
|  |  - provider/deepseek.md (DeepSeek KV cache optimization)   |   |
|  |                                                            |   |
|  |  Layer 3: Agent                                            |   |
|  |  - agents/foreground.md (ForegroundAgent routing)          |   |
|  |  - agents/kernel.md (Kernel execution engine)              |   |
|  |                                                            |   |
|  |  Layer 4: Output                                           |   |
|  |  - output/foreground.schema.md (Routing JSON contract)     |   |
|  |  - output/planner.schema.md (Planner output contract)      |   |
|  |                                                            |   |
|  +------------------------------------------------------------+   |
|                                                                   |
|  +-- Segment B (Cache Key Part 2) ----------------------------+   |
|  |                                                            |   |
|  |  Layer 5: Instruction                                      |   |
|  |  - AgentConfig.systemPrompt (custom behavior)              |   |
|  |  - AgentConfig.routingPrompt (routing instructions)        |   |
|  |  - Project-level instructions (future)                     |   |
|  |  - PersonaProjection (P10): personaId, styleGuidelines,    |   |
|  |    constraints, sourceProfile + safety prefix              |   |
|  |                                                            |   |
|  +------------------------------------------------------------+   |
|                                                                   |
|  +-- Segment C (Cache Key Part 3) ----------------------------+   |
|  |                                                            |   |
|  |  Layer 6: Tool Plane                                       |   |
|  |  - Tool IDs and summaries (routing_json mode)              |   |
|  |  - Full tool schemas (function_calling mode)               |   |
|  |  - Hidden/denied tools excluded                            |   |
|  |  - ToolSelectionPolicyProjection (P10, top-level):         |   |
|  |    heuristics, priorityRules, riskRules                    |   |
|  |                                                            |   |
|  +------------------------------------------------------------+   |
|                                                                   |
|  +-- Segment D (NOT Cached) ----------------------------------+   |
|  |                                                            |   |
|  |  Layer 7: Context Bundle                                   |   |
|  |  - pinnedItems, orderedItems, summaryBlocks                |   |
|  |  - planView, workflowStepView, backgroundRunView           |   |
|  |  - triggerView, transcript                                 |   |
|  |  - MemoryPolicyProjection (P10, at Segment D start):       |   |
|  |    useRules, invisibilityRules, priorityRules, tokenBudget |   |
|  |  - SummaryLayerProjection (P10): session, daily, weekly,   |   |
|  |    long-term, atomic-facts                                 |   |
|  |                                                            |   |
|  |  Dynamic Fields:                                           |   |
|  |  - currentDate, sessionId, runId, messageId, requestId     |   |
|  |  - currentUserMessage                                      |   |
|  |                                                            |   |
|  +------------------------------------------------------------+   |
|                                                                   |
+------------------------------------------------------------------+
```

---

## Layer Details

### Layer 1: Platform

**Purpose**: Define platform identity and core rules that apply to all agents and providers.

**Content Source**: 
- `src/prompt/templates/platform/base.md`
- `src/prompt/templates/platform/safety.md`

**Characteristics**:
- Identical for all requests
- Contains security boundaries (RBAC, Tenant, Approval, Audit)
- Never contains dynamic content

### Layer 2: Provider

**Purpose**: Provider-specific instructions for JSON output and tool calling.

**Content Source**:
- `src/prompt/templates/provider/openai.md`
- `src/prompt/templates/provider/deepseek.md`

**Selection Logic**:
- Determined by `providerFamily` parameter
- DeepSeek templates include KV cache optimization hints

### Layer 3: Agent

**Purpose**: Agent-specific behavior instructions.

**Content Source**:
- `src/prompt/templates/agents/foreground.md`
- `src/prompt/templates/agents/kernel.md`

**Selection Logic**:
- Determined by `agentKind` parameter
- ForegroundAgent: routing and delegation
- Kernel: execution engine behavior

### Layer 4: Output

**Purpose**: JSON schema contracts for structured output.

**Content Source**:
- `src/prompt/templates/output/foreground.schema.md`
- `src/prompt/templates/output/planner.schema.md`

**Characteristics**:
- Defines expected JSON structure
- Used for JSON mode and response parsing

### Layer 5: Instruction

**Purpose**: Custom instructions from AgentConfig.

**Content Source**:
- `AgentConfig.systemPrompt` (priority 10)
- `AgentConfig.routingPrompt` (priority 20)
- Future: project-level instructions

**Key Features**:
- Tenant isolation: different tenants have different hashes
- Priority ordering for conflict resolution
- Computed via `InstructionResolver`

### Layer 6: Tool Plane

**Purpose**: Expose available tools to the LLM.

**Content Source**:
- `ToolRegistry` -> `ToolPlaneProjection`
- Filtered by exposure level, permissions, and denial rules

**Mode-Dependent Rendering**:
- `routing_json`: Tool IDs + capability summaries only
- `function_calling`: Full schemas in `LLMRequest.tools`
- `structured_json`: Tool IDs only

### Layer 7: Context Bundle

**Purpose**: Dynamic context specific to the current request.

**Content Source**:
- `ContextBundleData` input parameter
- Dynamic fields (currentDate, sessionId, etc.)

**Key Features**:
- All optional fields have deterministic ordering
- Pair integrity protection for tool_use/tool_result
- SemanticType to role mapping

---

## P10 Strategy Projections

Phase 10 introduces three strategy projections that separate policy configuration from data containers. These projections are top-level `ModelInputBuildInput` fields, never embedded in data containers like `ToolPlaneProjection` or `ContextBundleData`.

### PersonaProjection (Layer 5, Segment B)

**Purpose**: Define structured persona with safety-aware rendering.

**Fields**:
- `personaId`: Unique identifier for the persona
- `styleGuidelines`: Writing style and tone preferences
- `constraints`: Behavioral constraints and boundaries
- `sourceProfile`: Original profile the persona was derived from

**Rendering**: Via `renderPersonaProjection()` with safety prefix to prevent injection.

**Segment**: Part of Segment B (Cache Key Part 2), affecting cache key computation.

### ToolSelectionPolicyProjection (Layer 6, Segment C)

**Purpose**: Guide tool selection with structured heuristics.

**Fields**:
- `heuristics`: General selection heuristics
- `priorityRules`: Rules for prioritizing certain tools
- `riskRules`: Risk-based restrictions on tool usage

**Important**: This is a top-level `ModelInputBuildInput` field, NOT embedded in `ToolPlaneProjection`.

**Segment**: Part of Segment C (Cache Key Part 3).

### MemoryPolicyProjection (Layer 7, Segment D)

**Purpose**: Control memory access and visibility.

**Fields**:
- `useRules`: Rules for when to use stored memories
- `invisibilityRules`: Rules for hiding certain memory content
- `priorityRules`: Rules for memory retrieval prioritization
- `tokenBudget`: Token budget for memory content

**Rendering**: Rendered at Segment D start, before other context bundle content.

### SummaryLayerProjection (Layer 7, Segment D)

**Purpose**: Provide layered summary context for the current request.

**Layers**:
- `session`: Current session summary
- `daily`: Daily aggregated summary
- `weekly`: Weekly aggregated summary
- `long-term`: Long-term memory summary
- `atomic-facts`: Atomic fact references

**Rendering**: Rendered after MemoryPolicyProjection in Segment D.

**Segment**: Part of Segment D (NOT Cached), always fresh computation.

---

## Three Modes

### routing_json

**Use Case**: ForegroundAgent message routing

**Characteristics**:
- No tools in `LLMRequest`
- Tool summaries in prompt
- JSON output expected

**Request Structure**:
```typescript
{
  messages: [Segment A, B, C, D messages],
  responseFormat: { type: 'json_object' }
  // No tools field
}
```

### function_calling

**Use Case**: AgentKernel, SearchSubagent execution

**Characteristics**:
- Full tool schemas in `LLMRequest.tools`
- Tool descriptions in prompt
- Function calling enabled

**Request Structure**:
```typescript
{
  messages: [Segment A, B, C, D messages],
  tools: [full schemas from ToolPlaneProjection]
}
```

### structured_json

**Use Case**: MemoryExtractor structured extraction

**Characteristics**:
- No tools
- JSON output expected
- Minimal tool information

**Request Structure**:
```typescript
{
  messages: [Segment A, B, C, D messages],
  responseFormat: { type: 'json_object' }
  // No tools field
}
```

---

## Cache Strategy

### Cache Key Computation

```
CacheKey = SHA-256(SegmentA_Hash | SegmentB_Hash | SegmentC_Hash)
```

**Segment Hashes**:
- Each segment has its own SHA-256 hash
- Content normalized before hashing (whitespace, line endings)
- Segments combined with delimiter for final key

### DeepSeek KV Cache Optimization

**Why Segment A Stability Matters**:
- DeepSeek uses KV cache for prefix tokens
- Identical prefix = cache hit = faster + cheaper
- Dynamic fields in Segment A would break cache

**What's Cached**:
- Segment A: Strongly cached (never changes)
- Segment B: Cached per tenant
- Segment C: Cached per tool configuration

**What's NOT Cached**:
- Segment D: Always fresh computation

### TokenUsage Extension

```typescript
interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  // DeepSeek cache metrics
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  cacheHitRate?: number;
}
```

---

## Integration Points

### ForegroundAgent

**Path**: `src/foreground/foreground-agent.ts`

**Integration**: Shadow mode (dual-path)
- Old path and new ModelInputBuilder run in parallel
- Comparison logging for verification
- Mode: `routing_json`

### AgentKernel

**Path**: `src/kernel/agent-kernel.ts`

**Integration**: Direct replacement
- `buildLLMRequest()` replaced with `ModelInputBuilder.build()`
- Injected via `KernelConfig.modelInputBuilder`
- Mode: `function_calling`

### SearchSubagent

**Path**: `src/search/search-subagent.ts`

**Integration**: Two-phase build
- Phase 1: Search planning
- Phase 2: Result summarization
- Mode: `function_calling`

### LongTermMemoryExtractor

**Path**: `src/memory/long-term-memory-extractor-service.ts`

**Integration**: Full 7-layer support
- Mode: `structured_json`
- No tools needed

---

## Security & Observability

### Snapshot Store

**Path**: `src/kernel/model-input/model-input-snapshot-store.ts`

**Purpose**: Record LLM calls for audit and debugging

**Features**:
- Records segment hashes for correlation
- Stores redacted input/output
- Links to TokenUsage metrics

### Redaction Pipeline

**Path**: `src/kernel/model-input/model-input-redactor.ts`

**Patterns Covered**:
- API keys (19 patterns)
- Passwords, tokens, secrets
- PEM certificates
- Authorization headers

**Integration**:
- Automatic redaction before snapshot storage
- Configurable via `RedactorOptions`

### Cache Metrics

**Path**: `src/observability/model-input-metrics.ts`

**Metrics Tracked**:
- Per-agent cache hit rates
- Token consumption
- Segment hash correlation

---

## File Reference

### Core Builder

| File | Lines | Description |
|------|-------|-------------|
| `src/kernel/model-input/model-input-builder.ts` | 289 | Core 7-layer builder |
| `src/kernel/model-input/model-input-types.ts` | 190 | Input/output types |
| `src/kernel/model-input/model-input-cache-key.ts` | 19 | Cache key computation |
| `src/kernel/model-input/static-prefix-builder.ts` | 54 | Layer 1-4 builder |

### Layer Renderers

| File | Lines | Description |
|------|-------|-------------|
| `src/kernel/model-input/context-bundle-projection.ts` | 126 | Layer 7 projection |
| `src/kernel/model-input/context-item-renderer.ts` | 40 | ContextItem to LLMMessage |
| `src/kernel/model-input/context-pair-integrity.ts` | 50 | Pair protection |
| `src/kernel/model-input/tool-plane-projection-renderer.ts` | 85 | Layer 6 renderer |
| `src/kernel/model-input/tenant-project-instruction-renderer.ts` | 27 | Layer 5 renderer |

### Observability

| File | Lines | Description |
|------|-------|-------------|
| `src/kernel/model-input/model-input-snapshot-store.ts` | 138 | Audit snapshots |
| `src/kernel/model-input/model-input-redactor.ts` | 173 | Secret redaction |
| `src/observability/model-input-metrics.ts` | 112 | Cache metrics |

### Prompt System

| File | Lines | Description |
|------|-------|-------------|
| `src/prompt/prompt-template-registry.ts` | 242 | Template registry |
| `src/prompt/template-loader.ts` | 114 | Template loader |
| `src/prompt/template-hash.ts` | 79 | SHA-256 hashing |

### Instructions

| File | Lines | Description |
|------|-------|-------------|
| `src/instructions/instruction-resolver.ts` | 59 | Instruction aggregation |
| `src/instructions/instruction-hash.ts` | 30 | Instruction hashing |
| `src/instructions/instruction-types.ts` | 40 | Type definitions |

### Tools

| File | Lines | Description |
|------|-------|-------------|
| `src/tools/tool-plane-prompt-projection.ts` | 148 | Tool projection |
| `src/tools/tool-exposure-plan.ts` | 186 | Exposure levels |
| `src/tools/tool-schema-canonicalizer.ts` | 98 | Canonical JSON |

### Templates

| File | Layer | Description |
|------|-------|-------------|
| `src/prompt/templates/platform/base.md` | 1 | Platform identity |
| `src/prompt/templates/platform/safety.md` | 1 | Security boundaries |
| `src/prompt/templates/provider/openai.md` | 2 | OpenAI rules |
| `src/prompt/templates/provider/deepseek.md` | 2 | DeepSeek KV cache |
| `src/prompt/templates/agents/foreground.md` | 3 | ForegroundAgent routing |
| `src/prompt/templates/agents/kernel.md` | 3 | Kernel execution |
| `src/prompt/templates/output/foreground.schema.md` | 4 | Routing JSON |
| `src/prompt/templates/output/planner.schema.md` | 4 | Planner output |

---

## Key Interfaces

### ModelInputBuildInput

```typescript
interface ModelInputBuildInput {
  mode: ModelInputMode;
  agentKind: string;
  providerFamily: string;
  
  // Layer 5
  systemPrompt?: string;
  routingPrompt?: string;
  personaProjection?: PersonaProjection;  // P10
  
  // Layer 6
  toolProjection?: ToolPlaneProjection;
  toolSelectionPolicy?: ToolSelectionPolicyProjection;  // P10, top-level
  
  // Layer 7
  contextBundle?: ContextBundleData;
  memoryPolicyProjection?: MemoryPolicyProjection;  // P10
  summaryLayers?: SummaryLayerProjection;  // P10
  currentUserMessage?: string;
  currentDate?: string;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  requestId?: string;
  transcript?: LLMMessage[];
}
```

### BuiltModelInput

```typescript
interface BuiltModelInput {
  messages: LLMMessage[];
  segments: {
    staticPrefix: string;
    tenantProject: string;
    toolPlane: string;
    contextBundle: string;
  };
  segmentHashes: {
    segmentA: string;
    segmentB: string;
    segmentC: string;
    segmentD: string;
  };
  metadata: {
    mode: ModelInputMode;
    agentKind: string;
    providerFamily: string;
    messageCount: number;
  };
}
```

> **P10 Strategy/Data Separation**: Policy projections (`personaProjection`, `toolSelectionPolicy`, `memoryPolicyProjection`, `summaryLayers`) are top-level `ModelInputBuildInput` fields, never embedded in data containers (`ToolPlaneProjection`, `ContextBundleData`). This separation ensures policy configuration remains independent of runtime data.

---

## Usage Example

```typescript
import { ModelInputBuilder } from './kernel/model-input/model-input-builder.js';
import { createPromptTemplateRegistry } from './prompt/prompt-template-registry.js';
import { createTemplateLoader } from './prompt/template-loader.js';

// Setup
const registry = createPromptTemplateRegistry();
const loader = createTemplateLoader();
const builder = new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader });

// Build for routing
const built = await builder.build({
  mode: 'routing_json',
  agentKind: 'foreground',
  providerFamily: 'deepseek',
  systemPrompt: 'You are a helpful assistant.',
  toolProjection: {
    toolIds: ['web.search', 'memory.retrieve'],
    toolSummaries: 'Available tools for search and retrieval.'
  },
  contextBundle: {
    pinnedItems: [{ itemId: '1', content: 'User prefers dark mode', isPinned: true }],
    orderedItems: []
  },
  currentUserMessage: 'Find recent AI papers on caching',
  currentDate: '2026-05-23',
  sessionId: 'session-123'
});

// Use built.messages in LLM request
console.log(built.segmentHashes.segmentA); // Stable across user messages
console.log(built.metadata.messageCount);  // Total messages generated
```
