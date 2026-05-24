# Prompt × Memory Enhancement Architecture

> Version: 1.0.0
> Created: 2026-05-24
> Status: Implemented (P0/P1 Complete, P2 Decision-gated)

---

## Overview

The P10 Prompt × Memory Enhancement introduces three structured projection interfaces that enhance the ModelInputBuilder with persona, tool selection policy, and memory policy capabilities. These projections follow a strict strategy/data separation principle to maintain cache stability and clean architecture boundaries.

---

## Strategy/Data Separation Principle

### Core Principle

Strategy projections (rules, heuristics, policies) are **top-level fields** in `ModelInputBuildInput`, while data projections (tool lists, context items) remain in their respective containers.

```
ModelInputBuildInput
├── personaProjection          ← Strategy (Layer 5)
├── toolSelectionPolicy        ← Strategy (Layer 6)
├── memoryPolicyProjection     ← Strategy (Layer 7)
├── toolProjection             ← Data (Layer 6)
│   └── toolIds, tools[]
└── contextBundle              ← Data (Layer 7)
    └── pinnedItems, orderedItems, summaryBlocks
```

### Why This Separation?

| Aspect | Strategy Projections | Data Projections |
|--------|---------------------|------------------|
| Content | Rules, heuristics, policies | Tool lists, context items |
| Mutability | Rarely changes | Changes per request |
| Cache Impact | Affects segment hash | Part of dynamic content |
| Rendering | Template-based | Direct inclusion |
| Layer | B (5), C (6), D (7) | C (6), D (7) |

### Anti-Patterns Avoided

1. **NOT**: `toolProjection.heuristics` — Heuristics belong in `toolSelectionPolicy`
2. **NOT**: `contextBundle.memoryRules` — Rules belong in `memoryPolicyProjection`
3. **NOT**: `personaProjection` as raw string — Must be structured interface

---

## Three Projection Interfaces

### 1. PersonaProjection (Layer 5)

```typescript
export interface PersonaProjection {
  /** Unique identifier for the persona */
  personaId: string;
  /** Style guidelines for the persona's expression */
  styleGuidelines: string;
  /** Constraints that cannot be overridden by the persona */
  constraints: string[];
  /** Optional source profile with additional persona details */
  sourceProfile?: AssistantPersonaProfile;
}
```

**Purpose**: Affects expression style and preferences, but cannot override system rules, safety constraints, tool authorization, output schemas, or tenant boundaries.

**Rendering**: `renderPersonaProjection()` adds safety prefix before style guidelines.

### 2. ToolSelectionPolicyProjection (Layer 6)

```typescript
export interface ToolSelectionPolicyProjection {
  /** Core heuristics for tool selection */
  heuristics: string;
  /** Priority rules for tool selection (optional) */
  priorityRules?: string[];
  /** Risk rules for tool selection (optional) */
  riskRules?: string[];
}
```

**Purpose**: Provides heuristics and rules for tool selection decisions.

**Rendering**: `renderToolSelectionPolicy()` formats heuristics with optional priority and risk rules.

### 3. MemoryPolicyProjection (Layer 7)

```typescript
export interface MemoryPolicyProjection {
  /** Core rules for memory usage */
  useRules: string;
  /** Rules for invisible memory items (optional) */
  invisibilityRules?: string[];
  /** Priority rules for memory items (optional) */
  priorityRules?: string[];
  /** Token budget for memory items (optional) */
  tokenBudget?: number;
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
  mode: ModelInputMode;
  agentKind: string;
  providerFamily: string;

  // Layer 5 (Instruction) - Segment B
  systemPrompt?: string;
  routingPrompt?: string;
  personaProjection?: PersonaProjection;        // ← P10 Strategy

  // Layer 6 (Tool Plane) - Segment C
  toolProjection?: ToolPlaneProjection;         // ← Data
  toolSelectionPolicy?: ToolSelectionPolicyProjection;  // ← P10 Strategy

  // Layer 7 (Context Bundle) - Segment D
  contextBundle?: ContextBundleData;            // ← Data
  memoryPolicyProjection?: MemoryPolicyProjection;  // ← P10 Strategy

  // Dynamic fields (Segment D only)
  currentUserMessage?: string;
  currentDate?: string;
  sessionId?: string;
  runId?: string;
  messageId?: string;
  requestId?: string;
  transcript?: LLMMessage[];
}
```

### Field Placement Rationale

| Field | Placement | Reason |
|-------|-----------|--------|
| `personaProjection` | Top-level | Strategy, affects Segment B hash |
| `toolSelectionPolicy` | Top-level | Strategy, affects Segment C hash |
| `memoryPolicyProjection` | Top-level | Strategy, affects Segment D hash |
| `toolProjection` | Top-level | Data container for tool plane |
| `contextBundle` | Top-level | Data container for context |

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
  const parts: string[] = [];

  if (input.memoryPolicyProjection) {
    parts.push(renderMemoryPolicyProjection(input.memoryPolicyProjection));
  }

  // Summary layers from context bundle
  if (input.contextBundle?.summaryLayers) {
    const rendered = renderSummaryLayers(input.contextBundle.summaryLayers);
    if (rendered) parts.push(rendered);
  }

  // Dynamic fields and context items
  // ...

  const content = parts.join('\n\n');
  const hash = computeTemplateHash(content);
  return { content, hash };
}
```

---

## Feature Flags

### Flag Overview

| Flag | Default | Purpose |
|------|---------|---------|
| `PROMPT_MEMORY_P0_ENABLED` | OFF | Master flag for P10 projections |
| `MEMORY_SEMANTIC_POLICY_ENABLED` | OFF | Enable memory semantic policy |
| `HYBRID_RETRIEVAL_ENABLED` | OFF | Enable hybrid retrieval |
| `LIFECYCLE_SCORING_SHADOW` | OFF | Enable lifecycle scoring shadow |
| `LIFECYCLE_POLICY_ENABLED` | OFF | Enable lifecycle policy |

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

| Template ID | Layer | File |
|-------------|-------|------|
| `persona:default` | 5 | `src/prompt/templates/persona/default.md` |
| `heuristics:tool-usage.common` | 6 | `src/prompt/templates/heuristics/tool-usage.common.md` |
| `context:memory-use-rules` | 7 | `src/prompt/templates/context/memory-use-rules.md` |

### Template Loading

Templates are loaded via `TemplateLoader` and registered in `PromptTemplateRegistry`:

```typescript
// Persona template
registry.register('persona:default', {
  layer: 5,
  path: 'src/prompt/templates/persona/default.md',
  description: 'Default assistant persona'
});

// Heuristics template
registry.register('heuristics:tool-usage.common', {
  layer: 6,
  path: 'src/prompt/templates/heuristics/tool-usage.common.md',
  description: 'Common tool usage heuristics'
});

// Memory rules template
registry.register('context:memory-use-rules', {
  layer: 7,
  path: 'src/prompt/templates/context/memory-use-rules.md',
  description: 'Memory usage rules'
});
```

---

## Summary Layer Projection

### SummaryLayerProjection Interface

```typescript
export interface SummaryLayerProjection {
  /** Session-level summary (current session) */
  session?: string | null;
  /** Daily summary (aggregated sessions from today) */
  daily?: string | null;
  /** Weekly summary (aggregated daily summaries) */
  weekly?: string | null;
  /** Long-term user profile */
  longTerm?: string | null;
  /** Atomic facts extracted from conversations */
  atomicFacts?: string | null;
}
```

### Rendering

```typescript
export function renderSummaryLayers(projection: SummaryLayerProjection): string {
  const parts: string[] = [];

  if (projection.session) {
    parts.push('## Session Summary');
    parts.push(projection.session);
  }

  if (projection.daily) {
    parts.push('## Daily Summary');
    parts.push(projection.daily);
  }

  if (projection.weekly) {
    parts.push('## Weekly Summary');
    parts.push(projection.weekly);
  }

  if (projection.longTerm) {
    parts.push('## Long-Term Profile');
    parts.push(projection.longTerm);
  }

  if (projection.atomicFacts) {
    parts.push('## Atomic Facts');
    parts.push(projection.atomicFacts);
  }

  return parts.join('\n\n');
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

| File | Lines | Description |
|------|-------|-------------|
| `src/kernel/model-input/model-input-types.ts` | 402 | Projection interfaces and renderers |
| `src/kernel/model-input/model-input-builder.ts` | 311 | Builder with projection rendering |
| `src/prompt/templates/persona/default.md` | 7 | Default persona template |
| `src/prompt/templates/heuristics/tool-usage.common.md` | 9 | Tool usage heuristics |
| `src/prompt/templates/context/memory-use-rules.md` | 8 | Memory use rules |

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
