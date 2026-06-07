# Model Input Baseline Report

> Created: 2026-05-23
> Author: Sisyphus
> Phase: P9 - Model Input Optimization

---

## 1. Current Prompt Registry

### 1.1 Active Prompts

| Prompt ID           | Version    | Runtime Enabled   | Description                                            |
| ------------------- | ---------- | ----------------- | ------------------------------------------------------ |
| `foreground.router` | 2026-05-05 | ✅ Yes            | Foreground routing agent that classifies user messages |
| `planner.executor`  | 2026-05-05 | ❌ No (spec-only) | Planning agent for multi-step execution plans          |
| `subagent.executor` | 2026-05-05 | ❌ No (spec-only) | Background task executor                               |

### 1.2 FOREGROUND_ROUTER_PROMPT Structure

```typescript
{
  id: 'foreground.router',
  version: '2026-05-05',
  baseSystemPrompt: `You are the foreground routing agent for this multi-agent platform.

Your only job is to classify the user's latest message into the platform's routing JSON contract...`,
  routingOverlayPrompt: `Routing priority order:
 1. approval_handler for explicit approval metadata...
 2. status_query for asking what is running...
 ...
 8. answer_directly for greetings...`,
  runtimeEnabled: true,
  description: 'Foreground routing agent that classifies user messages into routing JSON contracts.'
}
```

### 1.3 Prompt Resolution

- Default mapping: `'foreground.default'` → `'foreground.router'`
- Default version: `'foreground.router'` → `'2026-05-05'`
- Fallback: Unknown types/versions fall back to `foreground.router:2026-05-05`

---

## 2. Current Foreground Prompt Builder

### 2.1 buildRoutingMessages() - 4 Layer Architecture

Location: `src/agents/prompt-builder.ts:173-226`

| Layer | Source                              | Role   | Condition  |
| ----- | ----------------------------------- | ------ | ---------- |
| 1     | `promptRecord.baseSystemPrompt`     | system | Always     |
| 2     | `promptRecord.routingOverlayPrompt` | system | If defined |
| 3     | `agentConfig.routingPrompt`         | system | If defined |
| 3b    | `agentConfig.systemPrompt`          | system | If defined |
| 4     | `buildDynamicRoutingPrompt()`       | user   | Always     |

### 2.2 Message Assembly Order

```typescript
messages = [
  { role: 'system', content: promptRecord.baseSystemPrompt }, // Layer 1
  { role: 'system', content: promptRecord.routingOverlayPrompt }, // Layer 2 (optional)
  { role: 'system', content: agentConfig.routingPrompt }, // Layer 3 (optional)
  { role: 'system', content: agentConfig.systemPrompt }, // Layer 3b (optional)
  { role: 'user', content: dynamicPrompt }, // Layer 4
]
```

### 2.3 Effective Tool IDs Computation

```typescript
const effectiveToolIds = computeEffectiveAllowedToolIds(agentConfig, toolCatalog)
// Intersection of: agentConfig.allowedToolIds ∩ toolCatalog
```

---

## 3. Current AgentKernel buildLLMRequest

Location: `src/kernel/agent-kernel.ts:119-153`

### 3.1 Message Assembly

```typescript
messages = [
  ...pinnedItems.map(contextItemToMessage), // Pinned context items
  ...orderedItems.map(contextItemToMessage), // Ordered context items
  ...transcriptEntries.map(toLLMMessage), // Transcript history
]
```

### 3.2 Transcript Entry Conversion

| Entry Type     | Converted To                                          |
| -------------- | ----------------------------------------------------- |
| `llm_response` | `{ role: 'assistant', content: entry.content }`       |
| `tool_result`  | `{ role: 'tool', content: result/error, toolCallId }` |

### 3.3 Default Parameters

```typescript
{
  model: 'default-model',
  messages: [...],
  temperature: 0.7
}
```

---

## 4. Current ContextManager/ContextBundle

### 4.1 ContextBundle Fields (17 fields)

Location: `src/context/types.ts:349-366`

| Field               | Type                      | Description                    |
| ------------------- | ------------------------- | ------------------------------ |
| `bundleId`          | string                    | Unique bundle identifier       |
| `runId`             | string                    | Associated run ID              |
| `agentId`           | string                    | Agent identifier               |
| `agentType`         | string                    | Agent type classification      |
| `invocationSource`  | InvocationSource          | How this run was invoked       |
| `pinnedItems`       | ContextItem[]             | Always-included context items  |
| `orderedItems`      | ContextItem[]             | Priority-ordered context items |
| `summaryBlocks`     | ContextItem[]?            | Optional summary blocks        |
| `planView`          | PlanContextView?          | Active plan context            |
| `workflowStepView`  | WorkflowStepContextView?  | Workflow step context          |
| `backgroundRunView` | BackgroundRunContextView? | Background run context         |
| `triggerView`       | TriggerContextView?       | Trigger event context          |
| `artifactRefs`      | ArtifactRef[]?            | Artifact references            |
| `attachmentRefs`    | AttachmentRef[]?          | Attachment references          |
| `tokenEstimate`     | number                    | Estimated token count          |
| `compactHints`      | CompactHints?             | Compaction recommendations     |

### 4.2 ContextItem Fields (18 fields)

| Field                   | Type         | Description               |
| ----------------------- | ------------ | ------------------------- |
| `itemId`                | string       | Unique identifier         |
| `sourceType`            | SourceType   | Origin source type        |
| `sourceRef`             | string?      | Source reference          |
| `semanticType`          | SemanticType | Semantic classification   |
| `content`               | string       | Item content              |
| `structuredPayload`     | Record?      | Optional structured data  |
| `relatedRefs`           | RelatedRefs? | Related entity references |
| `priority`              | number?      | Priority score            |
| `recencyScore`          | number?      | Recency score             |
| `relevanceScore`        | number?      | Relevance score           |
| `authorityScore`        | number?      | Authority score           |
| `estimatedTokens`       | number?      | Token estimate            |
| `dedupeKey`             | string?      | Deduplication key         |
| `freshnessTs`           | string?      | Freshness timestamp       |
| `isPinned`              | boolean?     | Pinned flag               |
| `isCompressible`        | boolean?     | Compressible flag         |
| `isReplaceableByRef`    | boolean?     | Replaceable flag          |
| `requiresPairIntegrity` | boolean?     | Pair integrity flag       |
| `pairId`                | string?      | Pair identifier           |
| `validUntil`            | string?      | Expiry timestamp          |
| `supersedesKey`         | string?      | Supersedes key            |

---

## 5. Current Tool Plane Status

### 5.1 ToolSchemaProvider Modes

Location: `src/tools/schema/tool-schema-provider.ts`

| Mode         | Description                                | Token Threshold |
| ------------ | ------------------------------------------ | --------------- |
| `full`       | Complete schema with all properties        | ≤ 300 tokens    |
| `simplified` | Essential properties only                  | ≤ 1200 tokens   |
| `card_only`  | Minimal card (name, description, category) | > 1200 tokens   |
| `hidden`     | Not exposed to LLM                         | N/A             |

### 5.2 Token Thresholds

```typescript
TOKEN_THRESHOLDS = {
  FULL_MAX: 300, // Maximum tokens for full exposure
  SIMPLIFIED_MAX: 1200, // Maximum tokens for simplified exposure
}
```

### 5.3 High-Risk Classification

- **High-risk categories**: `['delete']`
- **High-risk sensitivities**: `['high', 'restricted']`
- High-risk tools default to `simplified` minimum (unless `trustedOverride`)

---

## 6. Current TokenUsage

Location: `src/llm/types.ts:85-89`

```typescript
interface TokenUsage {
  promptTokens: number // Input tokens
  completionTokens: number // Output tokens
  totalTokens: number // Total tokens
}
```

---

## 7. TEMPERATURE and MAX_TOKENS Defaults

### 7.1 ForegroundAgent (Router)

Location: `src/foreground/foreground-agent.ts:280-286`

```typescript
{
  model: resolvedModel,
  messages,
  temperature: 0.1,    // Low temperature for consistent routing
  maxTokens: 500,      // Sufficient for routing JSON response
  responseFormat: { type: 'json_object' }  // If provider supports
}
```

### 7.2 AgentKernel (Execution)

Location: `src/kernel/agent-kernel.ts:148-153`

```typescript
{
  model: 'default-model',
  messages,
  temperature: 0.7     // Moderate temperature for creative execution
}
```

### 7.3 SearchSubagent

Location: `src/search/search-subagent.ts:153-170`

```typescript
{
  model: searchLlmModel,
  messages: [
    { role: 'system', content: 'You are a search assistant...' },
    { role: 'user', content: input.query }
  ],
  tools: [WEB_SEARCH_TOOL],
  toolChoice: { type: 'function', function: { name: 'web.search' } }
}
```

**Note**: No explicit temperature/maxTokens - uses provider defaults.

### 7.4 LongTermMemoryExtractor

Location: `src/memory/long-term-memory-extractor-service.ts:177-181`

```typescript
{
  model: DEFAULT_MODEL,  // 'gpt-4o-mini'
  messages: [{ role: 'user', content: prompt }],
  responseFormat: { type: 'json_object' }
}
```

**Note**: No explicit temperature/maxTokens - uses provider defaults.

### 7.5 Summary Table

| Path                    | Temperature | MaxTokens | Notes                      |
| ----------------------- | ----------- | --------- | -------------------------- |
| ForegroundAgent         | 0.1         | 500       | Low for consistent routing |
| AgentKernel             | 0.7         | undefined | Moderate for execution     |
| SearchSubagent          | undefined   | undefined | Provider defaults          |
| LongTermMemoryExtractor | undefined   | undefined | Provider defaults          |

---

## 8. Four LLMRequest Paths

### 8.1 Path 1: ForegroundAgent (Routing)

**Purpose**: Classify user messages into routing JSON contracts.

**Flow**:

```
User Message
  → buildRoutingMessages() [4 layers]
  → callLLMRouter()
  → LLMRequest { temperature: 0.1, maxTokens: 500, responseFormat: json_object }
  → Parse JSON routing result
```

**Key Characteristics**:

- Low temperature (0.1) for deterministic routing
- Small maxTokens (500) - routing JSON is compact
- JSON mode enforced for structured output
- 4-layer prompt assembly (base + overlay + config + dynamic)

### 8.2 Path 2: AgentKernel (Execution)

**Purpose**: Execute agent logic with full context.

**Flow**:

```
ContextBundle
  → buildLLMRequest()
  → LLMRequest { temperature: 0.7 }
  → Execute with tools
  → Process tool calls
```

**Key Characteristics**:

- Moderate temperature (0.7) for balanced creativity
- Context from pinnedItems + orderedItems + transcript
- Tool execution loop
- No maxTokens limit (provider default)

### 8.3 Path 3: SearchSubagent (Web Search)

**Purpose**: Execute web search with tool calling.

**Flow**:

```
Search Query
  → LLMRequest { tools: [web.search], toolChoice: forced }
  → Execute web.search tool
  → Summarize results
```

**Key Characteristics**:

- Forced tool choice (web.search)
- Simple system prompt
- No temperature/maxTokens specified
- Model from agentConfig.searchLlmModel

### 8.4 Path 4: LongTermMemoryExtractor (Memory)

**Purpose**: Extract long-term memories from conversation.

**Flow**:

```
Conversation Window
  → buildLongTermMemoryExtractionPrompt()
  → LLMRequest { model: gpt-4o-mini, responseFormat: json_object }
  → Parse extracted candidates
  → Validate and store
```

**Key Characteristics**:

- JSON mode for structured extraction
- Uses gpt-4o-mini by default
- No temperature/maxTokens specified
- Hash-based deduplication

---

## 9. Locked Design Decisions

### 9.1 Temperature Choices

| Decision                              | Rationale                                  | Locked |
| ------------------------------------- | ------------------------------------------ | ------ |
| ForegroundAgent uses 0.1              | Ensures consistent routing classification  | ✅ Yes |
| AgentKernel uses 0.7                  | Balances creativity and coherence          | ✅ Yes |
| SearchSubagent uses provider default  | Search summarization benefits from default | ✅ Yes |
| MemoryExtractor uses provider default | Memory extraction benefits from default    | ✅ Yes |

### 9.2 MaxTokens Choices

| Decision                              | Rationale                              | Locked |
| ------------------------------------- | -------------------------------------- | ------ |
| ForegroundAgent uses 500              | Routing JSON is compact (< 500 tokens) | ✅ Yes |
| AgentKernel uses provider default     | Execution needs full response          | ✅ Yes |
| SearchSubagent uses provider default  | Search summary varies in length        | ✅ Yes |
| MemoryExtractor uses provider default | Memory extraction varies in length     | ✅ Yes |

### 9.3 Prompt Architecture

| Decision                  | Rationale                                          | Locked |
| ------------------------- | -------------------------------------------------- | ------ |
| 4-layer prompt assembly   | Separates concerns: base, overlay, config, dynamic | ✅ Yes |
| Registry-first resolution | Immutable prompts with version control             | ✅ Yes |
| JSON mode for routing     | Structured output parsing reliability              | ✅ Yes |

### 9.4 Context Architecture

| Decision                   | Rationale                            | Locked |
| -------------------------- | ------------------------------------ | ------ |
| 17-field ContextBundle     | Comprehensive context representation | ✅ Yes |
| pinnedItems + orderedItems | Priority-based context selection     | ✅ Yes |
| Token estimation           | Budget-aware context assembly        | ✅ Yes |

---

## 10. Implementation Gaps

### 10.1 Identified from Metis Review

| Gap                                             | Severity | Status                 |
| ----------------------------------------------- | -------- | ---------------------- |
| No prompt token logging                         | Medium   | 🔨 This task addresses |
| No buildLLMRequest logging                      | Medium   | 🔨 This task addresses |
| No prompt hash stability verification           | Low      | 🔨 This task addresses |
| Temperature/maxTokens not configurable per-path | Low      | Future consideration   |
| No token budget enforcement in ForegroundAgent  | Medium   | Out of scope (P9-T3)   |
| No context compaction triggers logged           | Low      | Future consideration   |

### 10.2 Future Improvements (Out of Scope)

- **Dynamic temperature adjustment**: Based on task complexity
- **Path-specific maxTokens**: Configurable per execution path
- **Prompt versioning UI**: Visual prompt management
- **Token budget dashboards**: Real-time token usage visualization
- **Context compaction metrics**: Measure compaction effectiveness

---

## 11. Evidence Files

- `.sisyphus/evidence/task-2-baseline-report.txt` - This report
- `.sisyphus/evidence/task-2-prompt-hash-stability.txt` - Prompt hash verification

---

## 12. Dev-Only Logging Additions

### 12.1 ForegroundAgent callLLMRouter()

Added logging (only when `NODE_ENV !== 'production'`):

- Prompt token estimation
- Message count
- Effective config details

### 12.2 AgentKernel buildLLMRequest()

Added logging (only when `NODE_ENV !== 'production'`):

- Token estimation
- Context item counts
- Compact trigger info

---

## 13. Verification

- ✅ TypeScript strict mode compliance
- ✅ No production behavior changes
- ✅ Logging guarded by `NODE_ENV !== 'production'`
- ✅ Evidence files created
- ✅ Learnings documented
