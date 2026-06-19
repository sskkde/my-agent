# Prompt Architecture Migration Spec

> Version: 1.0.0
> Created: 2026-06-19
> Status: Draft (target contracts)
> Scope: Locks terminology, render contracts, and migration boundaries for the prompt architecture alignment.

---

## Purpose

This spec defines the target state for the prompt architecture migration. It locks taxonomy terminology, Segment B sub-section names, rich persona field shape, per-mode template consumption, strategy projection placement, Segment D provenance format, and feature flag behavior. Every implementation task references this spec as the source of truth for naming and structure.

---

## 1. Taxonomy Layer Terminology (T1-T7)

The prompt stack uses seven numbered layers. The `T` prefix avoids collision with Segment labels (`A`, `B`, `C`, `D`) and layer numbers in template records.

| Short Name | Layer Number | `TaxonomyLayer` value | Purpose |
|---|---|---|---|
| T1 | 1 | `platform` | Platform base identity and safety rules |
| T2 | 2 | `provider` | LLM provider-specific instructions |
| T3 | 3 | `agentType` | Runtime agent class behavior |
| T4 | 4 | `outputContract` | Output schema contract |
| T5 | 5 | `agentProfile` | Capability/persona profile |
| T6 | 6 | `toolProjection` | Tool selection policy and projected surface |
| T7 | 7 | `runtimeContext` | Dynamic context bundle and summaries |

### Mapping to Segments

| Segment | Layers | Cache behavior |
|---|---|---|
| A (static prefix) | T1, T2, T3, T4 | Cached per agentType+providerFamily+outputContract |
| B (tenant/instruction) | T5 | Cached per tenant/persona |
| C (tool plane) | T6 | Cached per tool configuration |
| D (context bundle) | T7 | Never cached, always fresh |

### Current State

`StaticPrefixBuilder.buildStaticPrefix()` resolves `resolveSevenLayer()` but filters to `layer >= 1 && layer <= 4`, so T5/T6/T7 templates are registered in `PROMPT_TEMPLATE_REGISTRY` but do not enter the production builder path. The migration wires T5/T6/T7 consumption behind feature flags.

---

## 2. Segment B Sub-Sections (B1, B2, B3)

Segment B is the instruction/persona segment. It is divided into three ordered sub-sections:

| Sub-Section | Name | Content Source | Priority |
|---|---|---|---|
| B1 | Platform-owned agent profile | `systemPrompt` from `AgentConfig` (global or user override) | Highest. Defines core behavior. |
| B2 | Tenant/admin instructions | `routingPrompt` from `AgentConfig`, T5 `agentProfile:*` template content | Middle. Task routing and agent profile overlay. |
| B3 | User persona/preferences | `PersonaProjection` rendered via `renderPersonaProjection()` | Lowest. Style overlay, constrained by B1+B2. |

### Render Order

```
Segment B = B1 + B2 + B3
```

1. B1 (`systemPrompt`) renders first. It is the platform-owned agent profile that cannot be overridden by persona.
2. B2 (`routingPrompt` + T5 template content) renders second. It adds task routing instructions and agent profile behavior from the template registry.
3. B3 (`personaProjection`) renders last. It is a style overlay constrained by the safety prefix and by B1+B2 content.

### Current State

`ModelInputBuilder.buildSegmentB()` currently concatenates `systemPrompt`, `routingPrompt`, and `personaProjection` in that order. T5 `agentProfile:*` templates are registered but not consumed by Segment B. The migration adds T5 template consumption to B2 behind a feature flag.

---

## 3. Rich Persona Field Shape

`AssistantPersonaProfile` currently exists in two incompatible shapes:

- `src/foreground/types.ts:59-77` includes `directDelegationPolicy` and structured `constraints` (maxDirectResponseTokens, requirePlannerForMultiStep, requireApprovalsFor).
- `src/context/types.ts:231-235` has only `personaId`, `name`, `description`.

The migration unifies to a single rich shape. Storage/API schema changes are deferred; this defines the runtime type only.

### Target `AssistantPersonaProfile`

```typescript
interface AssistantPersonaProfile {
  // Identity
  personaId: string
  name: string
  displayIdentity?: string

  // Background
  description?: string
  background?: string

  // Expression
  tone?: string
  personality?: string

  // Behavior preferences
  behaviorPreferences?: {
    verbosity?: 'concise' | 'balanced' | 'verbose'
    codeCommentStyle?: 'minimal' | 'explanatory' | 'documented'
    explanationDepth?: 'brief' | 'moderate' | 'detailed'
    formality?: 'casual' | 'professional' | 'formal'
  }

  // User address preferences
  userAddressPreferences?: {
    preferredName?: string
    pronouns?: string
    language?: string
  }

  // Boundaries (persona cannot cross these)
  boundaries?: string[]

  // Non-overridable constraints (platform-enforced)
  nonOverridableConstraints?: string[]

  // Legacy fields (foreground compatibility, deprecated)
  directDelegationPolicy?: DirectDelegationPolicy
  constraints?: {
    maxDirectResponseTokens?: number
    requirePlannerForMultiStep?: boolean
    requireApprovalsFor?: string[]
  }
}
```

### Field Responsibilities

| Field | Segment | Overrideable by user? | Description |
|---|---|---|---|
| `personaId` | B3 | No | Unique identifier for lookup and caching |
| `name` | B3 | Yes | Human-readable persona name |
| `displayIdentity` | B3 | Yes | How the assistant refers to itself |
| `description` | B3 | Yes | Short description of the persona |
| `background` | B3 | Yes | Persona backstory or context |
| `tone` | B3 | Yes | Desired tone (e.g., "warm and professional") |
| `personality` | B3 | Yes | Personality traits |
| `behaviorPreferences` | B3 | Yes | Structured behavior knobs |
| `userAddressPreferences` | B3 | Yes | How to address the user |
| `boundaries` | B3 | Yes | Soft boundaries the persona should respect |
| `nonOverridableConstraints` | B3 + safety prefix | No | Hard constraints rendered with safety prefix |
| `directDelegationPolicy` | (legacy) | No | Foreground-only, retained for backward compat |
| `constraints` | (legacy) | No | Foreground-only, retained for backward compat |

### Rendering

The `PersonaProjection.sourceProfile` field carries the full `AssistantPersonaProfile`. `renderPersonaProjection()` renders the safety prefix, style guidelines, constraints, and persona ID. The rich profile fields feed into `styleGuidelines` and `constraints` via a profile-to-projection adapter (future work, not in this plan's storage scope).

---

## 4. Per-Mode T5/T6/T7 Template Consumption Matrix

Each LLM invocation mode consumes T5, T6, and T7 templates differently.

| Mode | T5 (agentProfile) | T6 (toolProjection) | T7 (runtimeContext) |
|---|---|---|---|
| `routing_json` | Rendered as text in Segment B | Tool IDs + capability summaries as text in Segment C | Context bundle rendered as text in Segment D |
| `function_calling` | Rendered as text in Segment B | Full tool schemas in `LLMRequest.tools`, policy text in Segment C prompt | Context bundle rendered as text in Segment D |
| `routing_tool_call` | Rendered as text in Segment B | Tool schemas in `LLMRequest.tools`, routing hints in Segment C prompt | Context bundle rendered as text in Segment D |
| `structured_json` | Rendered as text in Segment B | Tool IDs only as text in Segment C | Context bundle rendered as text in Segment D |

### T5 Consumption Rules

- T5 templates (`agentProfile:*`) are resolved by `PromptTemplateRegistry.resolveSevenLayer()` matching on `agentProfile` field.
- T5 content is appended to Segment B after B1 (`systemPrompt`) and alongside B2 (`routingPrompt`), before B3 (`personaProjection`).
- T5 templates are platform-authored. They describe agent capability and behavior, not user persona.

### T6 Consumption Rules

- T6 templates (`toolProjection:*`) are resolved by `resolveSevenLayer()` matching on `toolProjection` taxonomy layer.
- In `routing_json` mode, T6 content is rendered as text summaries in Segment C.
- In `function_calling` mode, T6 provides the `ToolSelectionPolicyProjection` rendered as text; tool schemas come from `ToolPlaneProjection` data.
- T6 policy projection is a top-level `ModelInputBuildInput` field (`toolSelectionPolicy`), not embedded in `ToolPlaneProjection`.

### T7 Consumption Rules

- T7 templates (`runtimeContext:*`) are resolved by `resolveSevenLayer()` matching on `runtimeContext` taxonomy layer.
- T7 content is rendered at the start of Segment D, before context bundle data.
- T7 renders memory policy, summary layers, and runtime environment facts.

---

## 5. Top-Level Strategy Projection Rule

Strategy projections are top-level fields on `ModelInputBuildInput`. They are never nested inside data containers.

### The Rule

`summaryLayers is a top-level strategy projection` on `ModelInputBuildInput`, not a nested field inside `ContextBundleData`.

### Current Violation

`ContextBundleData.summaryLayers` (at `src/kernel/model-input/model-input-types.ts:88`) nests the summary layer projection inside the context bundle data container. This contradicts the documented strategy/data separation.

### Target State

```typescript
// ModelInputBuildInput (target)
interface ModelInputBuildInput {
  // ... other fields ...

  // Layer 5 projections (top-level)
  personaProjection?: PersonaProjection

  // Layer 6 projections (top-level)
  toolSelectionPolicy?: ToolSelectionPolicyProjection

  // Layer 7 projections (top-level)
  memoryPolicyProjection?: MemoryPolicyProjection
  summaryLayers?: SummaryLayerProjection  // MOVED from ContextBundleData

  // Layer 7 data (NOT projections)
  contextBundle?: ContextBundleData  // summaryLayers REMOVED from here
}
```

### Migration Steps

1. Add `summaryLayers` field to `ModelInputBuildInput`.
2. Update `buildSegmentD()` to read `input.summaryLayers` instead of `input.contextBundle?.summaryLayers`.
3. Update all callers to pass `summaryLayers` at the top level.
4. Remove `summaryLayers` from `ContextBundleData` interface.
5. All in one atomic todo to avoid split state.

### Projection Inventory

| Projection | Layer | Segment | Currently top-level? | Target location |
|---|---|---|---|---|
| `PersonaProjection` | T5 | B | Yes | `ModelInputBuildInput.personaProjection` |
| `ToolSelectionPolicyProjection` | T6 | C | Yes | `ModelInputBuildInput.toolSelectionPolicy` |
| `MemoryPolicyProjection` | T7 | D | Yes | `ModelInputBuildInput.memoryPolicyProjection` |
| `SummaryLayerProjection` | T7 | D | **No** (nested in `ContextBundleData`) | `ModelInputBuildInput.summaryLayers` |

---

## 6. Segment D Provenance Header Format

Segment D includes a provenance header that records the origin and freshness of context data. This header appears at the start of Segment D, before any context bundle content.

### Format

```
## Provenance
sourceType: {sourceType}
sourceRef: {sourceRef}
freshnessTs: {ISO-8601 timestamp}
invocationSource: {invocationSource}
```

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceType` | string | Yes | Type of context source. Values: `session`, `memory`, `workflow`, `trigger`, `background_run`, `external` |
| `sourceRef` | string | Yes | Reference identifier for the source (session ID, memory ID, workflow run ID, etc.) |
| `freshnessTs` | string (ISO-8601) | Yes | Timestamp of when the context data was last computed or retrieved |
| `invocationSource` | string | Yes | How this context was invoked. Values: `user_turn`, `background_job`, `workflow_step`, `trigger_event`, `subagent_delegation` |

### Rendering

The provenance header is rendered as the first block in Segment D, before memory policy, summary layers, and context bundle data.

```
Segment D order:
1. Provenance header
2. MemoryPolicyProjection (if present)
3. SummaryLayerProjection (if present, top-level)
4. Dynamic fields (currentDate, sessionId, etc.)
5. Runtime environment (if present)
6. Context bundle items (pinned, ordered, summary blocks)
7. Views (plan, workflow step, background run, trigger)
8. Transcript
9. User message
```

### Current State

Provenance fields are not currently rendered in Segment D. The migration adds provenance rendering behind a feature flag.

---

## 7. Feature Flags and Rollback Behavior

All migration changes are gated behind feature flags. Each flag has a clear rollback path.

### Flag Definitions

| Flag | Default | Controls | Rollback |
|---|---|---|---|
| `PROMPT_T5_TEMPLATE_CONSUMPTION` | OFF | T5 `agentProfile:*` template rendering in Segment B | Set OFF. Segment B reverts to systemPrompt + routingPrompt + personaProjection only. |
| `PROMPT_T6_TEMPLATE_CONSUMPTION` | OFF | T6 `toolProjection:*` template rendering in Segment C | Set OFF. Segment C reverts to tool plane data + toolSelectionPolicy only. |
| `PROMPT_T7_TEMPLATE_CONSUMPTION` | OFF | T7 `runtimeContext:*` template rendering in Segment D | Set OFF. Segment D reverts to context bundle data only. |
| `PROMPT_SEGMENT_B_SUBSECTIONS` | OFF | B1/B2/B3 explicit sub-section rendering and T5 in B2 | Set OFF. Segment B reverts to flat concatenation. |
| `PROMPT_SEGMENT_D_PROVENANCE` | OFF | Provenance header rendering in Segment D | Set OFF. Segment D omits provenance header. |
| `PROMPT_SUMMARY_LAYERS_TOP_LEVEL` | OFF | `summaryLayers` as top-level `ModelInputBuildInput` field | Set OFF. Reverts to reading from `contextBundle.summaryLayers`. |
| `PROMPT_RICH_PERSONA` | OFF | Rich persona field rendering in B3 | Set OFF. Reverts to minimal PersonaProjection rendering. |

### Flag Interaction Rules

1. `PROMPT_SEGMENT_B_SUBSECTIONS` depends on `PROMPT_T5_TEMPLATE_CONSUMPTION`. T5 content enters B2 only when both flags are ON.
2. `PROMPT_RICH_PERSONA` is independent. It affects B3 rendering only.
3. `PROMPT_SEGMENT_D_PROVENANCE` is independent. It adds the provenance header before other Segment D content.
4. `PROMPT_SUMMARY_LAYERS_TOP_LEVEL` is a type/builder change, not a rendering change. It controls where the builder reads `summaryLayers` from.
5. All flags default to OFF. The production path is unchanged until flags are explicitly enabled.

### Rollback Procedure

1. Set the relevant flag to OFF.
2. No code revert needed. The builder skips the gated code path.
3. Segment hashes revert to pre-migration values, restoring cache hit rates.
4. If a flag causes a type error at build time, the flag gate wraps both the type usage and the builder logic.

### Existing Flag: `PROMPT_MEMORY_P0_ENABLED`

This flag already gates `personaProjection` and `toolSelectionPolicy` rendering. The new flags extend this pattern to T5/T6/T7 template consumption and Segment D provenance.

---

## 8. Template Registry Terminology Lock

### Template ID Format

All templates use colon-delimited IDs matching their taxonomy layer:

```
{taxonomyLayer}:{identifier}
```

Examples:
- `platform:base` (T1)
- `provider:openai` (T2)
- `agentType:main` (T3)
- `outputContract:planner.schema` (T4)
- `agentProfile:foreground` (T5)
- `toolProjection:default` (T6)
- `runtimeContext:default` (T7)

### Legacy ID Mapping

| Legacy ID | Taxonomy ID | Status |
|---|---|---|
| `agents:foreground` | `agentProfile:foreground` | Both registered. Legacy kept for backward compat. |
| `agents:kernel` | `agentType:main` + `agentProfile:default_main` | Legacy kept. Will retire after new-stack parity. |
| `agents:memory` | `agentProfile:memory` | Both registered. |
| `output:planner.schema` | `outputContract:planner.schema` | Both registered. |
| `output:memory-candidate.schema` | `outputContract:memory-candidate.schema` | Both registered. |
| `persona:default` | (no direct taxonomy equivalent) | Kept as-is. Persona rendering uses `PersonaProjection`, not template resolution. |

---

## 9. AgentKernel Projection Wiring

### Current State

`AgentKernel.buildLLMRequest()` extracts only `toolSelectionPolicy` from `PromptProjectionResolver`. The `personaProjection` and `memoryPolicyProjection` fields in the resolver result are not wired into the default production path.

### Target State

When `PROMPT_MEMORY_P0_ENABLED` (or successor flag) is ON:

```
PromptProjectionResolver.resolve()
  → personaProjection     → ModelInputBuildInput.personaProjection
  → toolSelectionPolicy   → ModelInputBuildInput.toolSelectionPolicy
  → memoryPolicyProjection → ModelInputBuildInput.memoryPolicyProjection
```

All three projections flow from the resolver to the builder input. The builder renders them in their respective segments (B, C, D).

---

## 10. Verification Checklist

Each item maps to a required verification string or structural check.

- [ ] `B1 Platform-owned agent profile` appears in this document as Segment B sub-section definition
- [ ] `B2 Tenant/admin instructions` appears in this document as Segment B sub-section definition
- [ ] `B3 User persona/preferences` appears in this document as Segment B sub-section definition
- [ ] `T5 agentProfile` appears in this document as taxonomy layer terminology
- [ ] `T6 toolProjection` appears in this document as taxonomy layer terminology
- [ ] `T7 runtimeContext` appears in this document as taxonomy layer terminology
- [ ] `summaryLayers is a top-level strategy projection` appears in this document as the strategy projection rule
- [ ] Provenance header format includes `sourceType`, `sourceRef`, `freshnessTs`, `invocationSource`
- [ ] Feature flags default to OFF with explicit rollback paths
- [ ] Rich persona shape includes `name`, `displayIdentity`, `background`, `tone`, `personality`, `behaviorPreferences`, `userAddressPreferences`, `boundaries`, `nonOverridableConstraints`

---

## File References

| File | Lines | Relevance |
|---|---|---|
| `src/kernel/model-input/model-input-builder.ts` | 65-297 | Current builder: buildSegmentB, buildSegmentC, buildSegmentD |
| `src/kernel/model-input/model-input-types.ts` | 70-345 | Current types: ContextBundleData, PersonaProjection, ModelInputBuildInput |
| `src/prompt/prompt-template-registry.ts` | 19-40, 457-493, 605-690 | Seven-layer taxonomy, registry entries, resolveSevenLayer() |
| `src/foreground/types.ts` | 59-90 | AssistantPersonaProfile (foreground version, with delegation policy) |
| `src/context/types.ts` | 212-247 | AssistantPersonaProfile (context version, minimal) |
| `src/kernel/agent-kernel.ts` | 249-308 | buildLLMRequest, projection wiring |
| `src/prompt/prompt-projection-types.ts` | 1-69 | PromptProjectionResolver interface |
| `src/kernel/model-input/static-prefix-builder.ts` | 41-70 | Layer 1-4 filtering in buildStaticPrefix |
| `docs/architecture/MODEL_INPUT_ARCHITECTURE.md` | Full | Existing architecture doc (style reference) |
| `docs/architecture/PERSONA_LAYER_ARCHITECTURE.md` | Full | Existing persona doc (style reference) |
