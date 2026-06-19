# Prompt × Memory Enhancement Architecture

> Version: 1.1.0
> Created: 2026-05-24
> Updated: 2026-06-19
> Status: Implemented (P0/P1 Complete, P2 Decision-gated, prompt migration aligned)

---

## Overview

The P10 Prompt × Memory Enhancement introduces three structured projection interfaces that enhance the ModelInputBuilder with persona, tool selection policy, and memory policy capabilities. These projections follow a strict strategy/data separation principle to maintain cache stability and clean architecture boundaries.

---

## Strategy/Data Separation Principle

### Core Principle

Strategy projections (rules, heuristics, policies) are **top-level fields** in `ModelInputBuildInput`, while data projections (tool lists, context items) remain in their respective containers.

```
ModelInputBuildInput
├── personaProjection          ← Strategy (Layer 5, Segment B3)
├── toolSelectionPolicy        ← Strategy (Layer 6, Segment C)
├── memoryPolicyProjection     ← Strategy (Layer 7, Segment D)
├── summaryLayers              ← Strategy (Layer 7, Segment D, top-level)
├── toolProjection             ← Data (Layer 6)
│   └── toolIds, tools[]
└── contextBundle              ← Data (Layer 7)
    └── pinnedItems, orderedItems, summaryBlocks
```

### Why This Separation?

| Aspect       | Strategy Projections        | Data Projections          |
| ------------ | --------------------------- | ------------------------- |
| Content      | Rules, heuristics, policies | Tool lists, context items |
| Mutability   | Rarely changes              | Changes per request       |
| Cache Impact | Affects segment hash        | Part of dynamic content   |
| Rendering    | Template-based              | Direct inclusion          |
| Layer        | B (5), C (6), D (7)         | C (6), D (7)              |
| Placement    | Top-level on input          | Inside data containers    |

### Anti-Patterns Avoided

1. **NOT**: `toolProjection.heuristics` — Heuristics belong in `toolSelectionPolicy`
2. **NOT**: `contextBundle.memoryRules` — Rules belong in `memoryPolicyProjection`
3. **NOT**: `personaProjection` as raw string — Must be structured interface
4. **NOT**: `contextBundle.summaryLayers` — Summary layers are a top-level strategy projection on `ModelInputBuildInput` (deprecated nested copy kept for backward compat only)

---

## Three Projection Interfaces

### 1. PersonaProjection (Layer 5)

```typescript
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
```

**Purpose**: Affects expression style and preferences, but cannot override system rules, safety constraints, tool authorization, output schemas, or tenant boundaries.

**Rendering**: `renderPersonaProjection()` adds safety prefix before style guidelines.

### 2. ToolSelectionPolicyProjection (Layer 6)

```typescript
export interface ToolSelectionPolicyProjection {
  /** Core heuristics for tool selection */
  heuristics: string
  /** Priority rules for tool selection (optional) */
  priorityRules?: string[]
  /** Risk rules for tool selection (optional) */
  riskRules?: string[]
}
```

**Purpose**: Provides heuristics and rules for tool selection decisions.

**Rendering**: `renderToolSelectionPolicy()` formats heuristics with optional priority and risk rules.

### 3. MemoryPolicyProjection (Layer 7)

```typescript
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
```

**Purpose**: Provides rules for memory usage in context bundle.

**Rendering**: `renderMemoryPolicyProjection()` formats use rules with optional invisibility and priority rules.

---

## ModelInputBuildInput Structure

### Complete Interface

```typescript
export interface ModelInputBuildInput {
  // Mode determination
  mode: ModelInputMode
  agentType?: AgentType
  agentProfile?: string
  providerFamily: string
  outputContract?: string

  // Legacy (deprecated)
  agentKind?: string

  // Layer 5 (Instruction) - Segment B (B1/B2/B3)
  systemPrompt?: string           // B1
  routingPrompt?: string          // B2
  personaProjection?: PersonaProjection // B3, P10 Strategy

  // Layer 6 (Tool Plane) - Segment C
  toolProjection?: ToolPlaneProjection // ← Data
  toolSelectionPolicy?: ToolSelectionPolicyProjection // ← P10 Strategy

  // Layer 7 (Context Bundle) - Segment D
  contextBundle?: ContextBundleData // ← Data
  memoryPolicyProjection?: MemoryPolicyProjection // ← P10 Strategy
  summaryLayers?: SummaryLayerProjection // ← P10 Strategy (top-level)

  // Dynamic fields (Segment D only)
  currentUserMessage?: string
  currentDate?: string
  sessionId?: string
  runId?: string
  messageId?: string
  requestId?: string
  transcript?: LLMMessage[]
}
```

### Field Placement Rationale

| Field                    | Placement | Reason                           |
| ------------------------ | --------- | -------------------------------- |
| `personaProjection`      | Top-level | Strategy, affects Segment B hash |
| `toolSelectionPolicy`    | Top-level | Strategy, affects Segment C hash |
| `memoryPolicyProjection` | Top-level | Strategy, affects Segment D hash |
| `summaryLayers`          | Top-level | Strategy, affects Segment D hash |
| `toolProjection`         | Top-level | Data container for tool plane    |
| `contextBundle`          | Top-level | Data container for context       |

---

## Rendering Flow

### Segment B Rendering (Layer 5)

```typescript
private buildSegmentB(input: ModelInputBuildInput) {
  const parts: string[] = [];

  if (input.systemPrompt) {
    parts.push(input.systemPrompt);
  }

  if (input.routingPrompt) {
    parts.push(input.routingPrompt);
  }

  if (input.personaProjection) {
    parts.push(renderPersonaProjection(input.personaProjection));
  }

  const content = parts.join('\n\n');
  const hash = computeTemplateHash(content);
  return { content, hash };
}
```

### Segment C Rendering (Layer 6)

```typescript
private buildSegmentC(input: ModelInputBuildInput) {
  const projection = input.toolProjection;
  const policy = input.toolSelectionPolicy;
  const parts: string[] = [];

  if (projection) {
    // Mode-dependent tool plane rendering
    if (mode === 'routing_json') {
      parts.push(this.renderRoutingToolPlane(projection));
    } else if (mode === 'function_calling') {
      parts.push(this.renderFunctionCallingToolPlane(projection));
    }
  }

  if (policy) {
    parts.push(renderToolSelectionPolicy(policy));
  }

  const content = parts.join('\n\n');
  const hash = computeTemplateHash(content);
  return { content, hash };
}
```

### Segment D Rendering (Layer 7)

```typescript
private buildSegmentD(input: ModelInputBuildInput) {
  const parts: string[] = []

  if (input.memoryPolicyProjection) {
    parts.push(renderMemoryPolicyProjection(input.memoryPolicyProjection))
  }

  // Summary layers: prefer top-level strategy projection,
  // fall back to nested contextBundle.summaryLayers for backward compatibility.
  const summaryLayersSource = input.summaryLayers ?? input.contextBundle?.summaryLayers
  if (summaryLayersSource) {
    const rendered = renderSummaryLayers(summaryLayersSource)
    if (rendered) parts.push(rendered)
  }

  // Dynamic fields and context items
  // ...

  const content = parts.join('\n\n')
  const hash = computeTemplateHash(content)
  return { content, hash }
}
```

---

## Feature Flags

### Flag Overview

| Flag                             | Default | Purpose                         |
| -------------------------------- | ------- | ------------------------------- |
| `PROMPT_MEMORY_P0_ENABLED`       | OFF     | Master flag for P10 projections |
| `MEMORY_SEMANTIC_POLICY_ENABLED` | OFF     | Enable memory semantic policy   |
| `HYBRID_RETRIEVAL_ENABLED`       | OFF     | Enable hybrid retrieval         |
| `LIFECYCLE_SCORING_SHADOW`       | OFF     | Enable lifecycle scoring shadow |
| `LIFECYCLE_POLICY_ENABLED`       | OFF     | Enable lifecycle policy         |
| `PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED` | OFF | T5 agentProfile template rendering |
| `PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED` | OFF | T6 toolProjection template rendering |
| `PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED` | OFF | T7 runtimeContext template rendering |
| `PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED` | OFF | B1/B2/B3 sub-section rendering |
| `PROMPT_SEGMENT_D_PROVENANCE_ENABLED` | OFF | Provenance header in Segment D |
| `PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED` | OFF | summaryLayers as top-level field |
| `PROMPT_RICH_PERSONA_ENABLED`    | OFF     | Rich persona field rendering    |

### Flag Behavior

When `PROMPT_MEMORY_P0_ENABLED` is OFF:

- `personaProjection` must be `undefined` (not empty string)
- `toolSelectionPolicy` must be `undefined`
- `memoryPolicyProjection` must be `undefined`
- Hash stability equals P9 baseline (strictly identical)

When ON:

- Projections are rendered and included in segment hashes
- Hash changes reflect new content

---

## Cache Hash Implications

### Segment Hash Computation

```
SegmentA = SHA-256(Layer1 + Layer2 + Layer3 + Layer4)
SegmentB = SHA-256(systemPrompt + routingPrompt + personaProjection)
SegmentC = SHA-256(toolProjection + toolSelectionPolicy)
SegmentD = SHA-256(memoryPolicyProjection + contextBundle + dynamic)
```

### Persona Impact on Cache

When `personaProjection` changes:

- Segment B hash changes
- Cache key changes
- DeepSeek KV cache miss occurs

**Recommendation**: Use stable persona IDs across sessions for same user preferences.

### Tool Selection Policy Impact

When `toolSelectionPolicy` changes:

- Segment C hash changes
- Cache key changes

**Recommendation**: Use consistent heuristics per agent kind.

### Memory Policy Impact

When `memoryPolicyProjection` changes:

- Segment D hash changes
- No cache impact (Segment D is always dynamic)

---

## Template Registry

### P10 Templates

| Template ID                    | Layer | File                                                   |
| ------------------------------ | ----- | ------------------------------------------------------ |
| `persona:default`              | 5     | `src/prompt/templates/persona/default.md`              |
| `heuristics:tool-usage.common` | 6     | `src/prompt/templates/heuristics/tool-usage.common.md` |
| `context:memory-use-rules`     | 7     | `src/prompt/templates/context/memory-use-rules.md`     |

### Template Loading

Templates are loaded via `TemplateLoader` and registered in `PromptTemplateRegistry`:

```typescript
// Persona template
registry.register('persona:default', {
  layer: 5,
  path: 'src/prompt/templates/persona/default.md',
  description: 'Default assistant persona',
})

// Heuristics template
registry.register('heuristics:tool-usage.common', {
  layer: 6,
  path: 'src/prompt/templates/heuristics/tool-usage.common.md',
  description: 'Common tool usage heuristics',
})

// Memory rules template
registry.register('context:memory-use-rules', {
  layer: 7,
  path: 'src/prompt/templates/context/memory-use-rules.md',
  description: 'Memory usage rules',
})
```

---

## Summary Layer Projection

### SummaryLayerProjection Interface

```typescript
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
```

### Rendering

```typescript
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
```

---

## Integration Points

### ForegroundAgent

- Mode: `routing_json`
- Uses: `personaProjection`, `toolSelectionPolicy`
- Segment B/C affected by projections

### AgentKernel

- Mode: `function_calling`
- Uses: All three projections
- Full 7-layer support

### MemoryExtractor

- Mode: `structured_json`
- Uses: `memoryPolicyProjection`
- Summary layers for context

---

## File References

| File                                                   | Lines | Description                         |
| ------------------------------------------------------ | ----- | ----------------------------------- |
| `src/kernel/model-input/model-input-types.ts`          | 402   | Projection interfaces and renderers |
| `src/kernel/model-input/model-input-builder.ts`        | 311   | Builder with projection rendering   |
| `src/prompt/templates/persona/default.md`              | 7     | Default persona template            |
| `src/prompt/templates/heuristics/tool-usage.common.md` | 9     | Tool usage heuristics               |
| `src/prompt/templates/context/memory-use-rules.md`     | 8     | Memory use rules                    |

---

## Security Considerations

1. **Persona Boundary**: Persona cannot override safety rules, tool authorization, or tenant boundaries
2. **Safety Prefix**: Every persona rendering includes safety constraint reminder
3. **Flag Default OFF**: All features disabled by default, requires explicit enablement
4. **Hash Stability**: Flag OFF guarantees identical hash to P9 baseline

---

## Future Extensions (P10.1+)

1. **Web/File/Memory Heuristic Templates**: Specialized heuristic templates per tool category
2. **Semantic Layer API**: Add `semanticLayer` filter to memory retrieval
3. **MemorySemanticLayer Type**: Typed semantic layer for memory classification
4. **Persona Inheritance**: Allow persona inheritance from base templates
5. **Policy Versioning**: Support multiple policy versions for A/B testing

---

## Template-driven Projection Loading

### 概述

`PromptProjectionResolver` 是 P10 新增的核心组件，负责将模板内容解析为结构化的投影对象。该解析器实现了 Flag 门控逻辑，确保在不同配置下返回正确的投影数据。

### 核心组件

```typescript
// src/prompt/prompt-projection-resolver.ts
export function createPromptProjectionResolver(
  registry: PromptTemplateRegistry,
  loader: TemplateLoader,
): PromptProjectionResolver
```

**依赖关系**：

- `PromptTemplateRegistry`: 模板元数据注册表，用于检查模板是否存在
- `TemplateLoader`: 模板文件加载器，负责从文件系统读取模板内容

### Flag 交互矩阵

| PROMPT_MEMORY_P0_ENABLED | PROMPT_TEMPLATE_PROJECTION_ENABLED | 解析结果                                |
| ------------------------ | ---------------------------------- | --------------------------------------- |
| OFF (undefined/false)    | OFF                                | `{}` 空对象                             |
| OFF (undefined/false)    | ON                                 | `{}` 空对象（TEMPLATE 被 P0 门控）      |
| ON                       | OFF                                | Fallback Defaults（硬编码默认值）       |
| ON                       | ON                                 | Template-loaded Projections（模板加载） |

**关键行为**：

- `isPromptTemplateProjectionEnabled()` 内部已门控 `isPromptMemoryP0Enabled()`
- Flag OFF 时，投影字段必须为 `undefined`，保证 hash 稳定性

### 模板类别与 ID

| Template ID                    | Layer | 用途           | 硬编码约束                       |
| ------------------------------ | ----- | -------------- | -------------------------------- |
| `persona:default`              | 5     | 人格风格指南   | `PERSONA_CONSTRAINTS` 数组       |
| `heuristics:tool-usage.common` | 6     | 工具选择启发式 | 无                               |
| `context:memory-use-rules`     | 7     | 内存使用规则   | `MEMORY_INVISIBILITY_RULES` 数组 |

**硬编码约束说明**：

- `PERSONA_CONSTRAINTS`: 不可覆盖的安全边界（系统规则、安全约束、工具授权、输出 schema、租户边界）
- `MEMORY_INVISIBILITY_RULES`: 内存不可见性规则（私有背景上下文、用户询问时才提及、当前对话优先）

### 解析流程

```
┌─────────────────────────────────────────────────────────────┐
│                    resolve(input)                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ isPromptMemoryP0Enabled? │
                └───────────────────────┘
                      │           │
                     OFF          ON
                      │           │
                      ▼           ▼
              ┌───────────┐ ┌───────────────────────────────┐
              │ return {} │ │ isPromptTemplateProjectionEnabled? │
              └───────────┘ └───────────────────────────────┘
                                     │           │
                                    OFF          ON
                                     │           │
                                     ▼           ▼
                         ┌─────────────────┐ ┌─────────────────────┐
                         │ Return Fallback │ │ Load 3 Templates    │
                         │ Defaults        │ │ (parallel)          │
                         └─────────────────┘ └─────────────────────┘
                                     │           │
                                     │           ▼
                                     │   ┌─────────────────────────────┐
                                     │   │ Map to Structured Objects   │
                                     │   │ - PersonaProjection         │
                                     │   │ - ToolSelectionPolicy       │
                                     │   │ - MemoryPolicyProjection    │
                                     │   └─────────────────────────────┘
                                     │           │
                                     └─────┬─────┘
                                           │
                                           ▼
                              ┌──────────────────────────┐
                              │ Return ResolveResult     │
                              └──────────────────────────┘
```

### Fallback Defaults

当 `PROMPT_TEMPLATE_PROJECTION_ENABLED=OFF` 时，解析器返回硬编码的默认值：

```typescript
// src/prompt/prompt-projection-defaults.ts
export const DEFAULT_PERSONA_PROJECTION: PersonaProjection = {
  personaId: 'default-assistant',
  styleGuidelines: '...',
  constraints: [...PERSONA_CONSTRAINTS],
}

export const DEFAULT_TOOL_SELECTION_POLICY: ToolSelectionPolicyProjection = {
  heuristics: '...',
}

export const DEFAULT_MEMORY_POLICY_PROJECTION: MemoryPolicyProjection = {
  useRules: '...',
  invisibilityRules: [...MEMORY_INVISIBILITY_RULES],
}
```

### 错误处理策略

模板加载采用优雅降级策略：

1. **注册表检查失败**: 返回空字符串，使用 fallback 默认值
2. **文件加载失败**: 捕获异常，console.warn，返回空字符串
3. **模板内容为空**: 使用 fallback 默认值填充结构化对象字段

```typescript
// 加载失败的容错逻辑
const personaContent = await loadTemplateContent(loader, 'persona:default', registry)
// 如果 personaContent 为空字符串，则使用 DEFAULT_PERSONA_PROJECTION.styleGuidelines
```

### 集成点

| 组件              | 使用方式                                          | 代码位置                             |
| ----------------- | ------------------------------------------------- | ------------------------------------ |
| `ForegroundAgent` | 构造函数注入，`resolveProjections()` 调用         | `src/foreground/foreground-agent.ts` |
| `AgentKernel`     | `KernelConfig` 配置注入，`buildLLMRequest()` 调用 | `src/kernel/agent-kernel.ts`         |
| `api/context.ts`  | 创建 resolver 实例，注入到 agent                  | `src/api/context.ts`                 |

### 模板加载性能

```typescript
// 并行加载三个模板，减少 I/O 等待时间
const [personaContent, heuristicsContent, memoryRulesContent] = await Promise.all([
  loadTemplateContent(loader, 'persona:default', registry),
  loadTemplateContent(loader, 'heuristics:tool-usage.common', registry),
  loadTemplateContent(loader, 'context:memory-use-rules', registry),
])
```

### 安全边界

模板内容永远不能覆盖的安全边界：

```typescript
const PERSONA_CONSTRAINTS = [
  '不可覆盖系统规则',
  '不可越过安全约束',
  '不可改变工具授权',
  '不可改变输出 schema',
  '不可改变租户边界',
] as const

const MEMORY_INVISIBILITY_RULES = [
  'Memory snippets are private background context',
  'Do not mention memory unless the user explicitly asks',
  'Current conversation overrides memory',
] as const
```

这些约束以硬编码数组形式注入到投影对象中，确保模板内容无法绕过平台安全策略。

### 文件引用

| 文件                                                   | 行数 | 描述              |
| ------------------------------------------------------ | ---- | ----------------- |
| `src/prompt/prompt-projection-resolver.ts`             | 127  | Resolver 核心实现 |
| `src/prompt/prompt-projection-types.ts`                | 59   | Resolver 类型定义 |
| `src/prompt/prompt-projection-defaults.ts`             | -    | Fallback 默认值   |
| `src/prompt/feature-flags.ts`                          | 25   | Flag 门控函数     |
| `src/prompt/templates/persona/default.md`              | 7    | 人格模板          |
| `src/prompt/templates/heuristics/tool-usage.common.md` | 9    | 工具启发式模板    |
| `src/prompt/templates/context/memory-use-rules.md`     | 8    | 内存规则模板      |
