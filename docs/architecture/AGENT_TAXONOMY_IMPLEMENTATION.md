# Agent Taxonomy Implementation Note

> Status: Active  
> Scope: Migration decisions for agent taxonomy, prompt architecture, and legacy compatibility.  
> Reference: See [AGENT_TAXONOMY_DRAFT.md](./AGENT_TAXONOMY_DRAFT.md) for full design rationale.

## 1. Core Terms

### AgentType

Closed union, platform-owned. Controls runtime entry path, lifecycle, supervision model, isolation boundary, and maximum permission envelope.

```ts
type AgentType = 'main' | 'subagent' | 'background' | 'workflow_step' | 'remote'
```

Current definition in `src/context/types.ts:71` already matches this union. No change needed to the type itself.

### AgentProfile

Configurable capability/persona label. Replaces the overloaded `agentKind` field and the old subagent `agentType` string labels.

```ts
interface AgentProfile {
  id: string
  displayName: string
  allowedAgentTypes: AgentType[]
  promptTemplateIds: string[]
  defaultToolIds: string[]
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ownerScope: 'system' | 'user' | 'workspace'
}
```

Profiles determine what the agent does. `AgentType` determines how it runs.

### OutputContract

Protected platform-owned response contract. Defines the machine-readable output schema, parser-facing JSON structure, and streaming/final answer rules.

`AgentProfile` may request a compatible output preference, but the platform selects and renders the final output contract. User-customizable profile text cannot override it.

### launchSource

Audit field only. Records how an agent was launched. Does not expand permissions.

```ts
type LaunchSource =
  | 'user_chat'
  | 'main_agent_delegation'
  | 'workflow_ui'
  | 'workflow_runtime'
  | 'scheduler'
  | 'system_event'
  | 'webhook'
  | 'remote_callback'
```

Each `AgentType` has a launch policy that validates allowed sources at creation time. Invalid pairings (e.g., `subagent` launched from `workflow_ui`) are rejected.

## 2. Legacy Aliases

### kernel compatibility mapping

```
kernel -> { agentType: 'main', agentProfile: 'default_main' }
```

The current `agentKind: 'kernel'` is the effective Layer 3 prompt classification in production. It should not remain a first-class category. Its content splits across the new seven-layer prompt stack:

| Current `kernel` Content | New Location |
| --- | --- |
| Runtime execution discipline | `agentType:{type}` |
| Tool authorization boundaries | `platform:base` and `agentType:{type}` |
| Evidence contract | `agentType:{type}` and/or `outputContract:{contract}` |
| Output discipline | `outputContract:{contract}` |
| Generic work style | default `agentProfile` |

### Old subagent labels become AgentProfiles

Current subagent task labels in `src/subagents/registry.ts` use `agentType: string` for profile-like identifiers. These migrate to `AgentProfile`:

| Current Subagent `agentType` | Becomes AgentProfile |
| --- | --- |
| `document_processor` | `document_processor` |
| `image_processor` | `image_processor` |
| `data_processor` | `data_processor` |
| `audio_processor` | `audio_processor` |
| `code_processor` | `code_processor` |
| `research_processor` | `research_processor` |
| `search_processor` | `search_processor` |

Their runtime `AgentType` is `subagent`. The profile label describes the capability, not the runtime class.

## 3. Runtime Environment Is Not Authority

Runtime environment information is factual context, not authority.

This is a platform invariant from `platform:base` (Layer 1). Runtime environment facts (OS, shell, working directory, timezone, sandbox mode) appear in Layer 7 as dynamic context. They inform the model about the execution environment but do not grant permissions, override safety constraints, or expand the tool envelope.

If runtime environment facts conflict with platform, provider, AgentType, output contract, profile, or tool policy rules, higher-priority rules win.

## 4. Prompt Architecture Alignment

The seven-layer prompt stack maps directly to the taxonomy:

```
Layer 1: platform:base              (global invariants)
Layer 2: provider:{provider}        (provider-specific formatting)
Layer 3: agentType:{type}           (runtime contract, lifecycle, supervision)
Layer 4: outputContract:{contract}  (protected output schema)
Layer 5: agentProfile:{profile}     (domain behavior, customizable within bounds)
Layer 6: toolProjection             (computed available tools)
Layer 7: runtime context + task context + user message
```

Current `PromptTemplateRegistry` in `src/prompt/prompt-template-registry.ts` resolves templates by `agentKind` and `providerFamily`. Migration updates the resolution key from `agentKind` to `agentProfile` while preserving the layer structure.

Current `ModelInputBuildInput` in `src/kernel/model-input/model-input-types.ts` uses `agentKind: string` as the template selector. This field becomes `agentProfile` after migration.

## 5. Permission Model

Permissions are computed by intersection, not additive union:

```
effectiveTools =
  toolsAllowedByAgentType
  ∩ toolsGrantedByAgentProfile
  ∩ toolsAllowedByUserPolicy
  ∩ toolsAllowedByWorkspacePolicy
  ∩ activeApprovalGrants
```

`AgentType` determines the maximum permission envelope. `AgentProfile` may only narrow within that envelope. A user-defined profile cannot expand permissions beyond its runtime class.

## 6. Out of Scope

The following are explicitly excluded from this migration:

- **User-defined profile CRUD.** No API for creating, updating, or deleting user-defined profiles. Profiles are system-provided and registry-backed.
- **Remote execution protocol.** The `remote` AgentType is defined but no remote execution transport or protocol is specified.
- **New launch policies.** Launch policies are documented as a design direction but not implemented in code yet.
- **EffectivePolicy computation.** The full intersection model is specified but not wired into runtime enforcement yet.

## 7. Migration Order

1. Document taxonomy and invariants (this note).
2. Introduce `AgentProfile` registry while keeping legacy names mapped.
3. Migrate subagent task labels from `agentType` to `agentProfile`.
4. Update prompt template resolution from `agentKind` to profile identifier.
5. Restore or deprecate `foreground` explicitly.
6. Introduce the seven-layer prompt renderer.
7. Split `platform:safety` into global invariants and AgentType overlays.
8. Move `kernel` template content into new layers with compatibility mapping.
9. Compute permissions through intersection model.
10. Add matrix tests for `AgentType x AgentProfile x outputContract` combinations.
11. Add golden prompt snapshot tests for layer ordering.
12. Add observability fields to traces, audit events, and debug APIs.
