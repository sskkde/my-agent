# Tool Usage Heuristics

> Version: 1.0.0
> Created: 2026-05-24
> Status: Implemented

---

## Overview

The Tool Usage Heuristics architecture provides structured guidance for tool selection decisions through the `ToolSelectionPolicyProjection` interface. This policy helps the LLM make better tool choices by encoding best practices as heuristics, priority rules, and risk rules.

---

## ToolSelectionPolicyProjection Interface

### Definition

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

### Field Descriptions

| Field           | Type     | Required | Description                             |
| --------------- | -------- | -------- | --------------------------------------- |
| `heuristics`    | string   | Yes      | Core heuristic rules for tool selection |
| `priorityRules` | string[] | No       | Ordered priority rules                  |
| `riskRules`     | string[] | No       | Risk assessment rules                   |

---

## Common Heuristics Template

### File: `src/prompt/templates/heuristics/tool-usage.common.md`

```markdown
# 工具使用启发式

- 直接回答优先于工具调用
- 读/查优先于写/改
- 低风险优先
- 精确读取优先于搜索
- 跨系统写入需审批
- 同类选便宜快稳的
- 整合结果不倾倒
```

### Heuristic Explanations

| Heuristic | Chinese                | English                               | Rationale                          |
| --------- | ---------------------- | ------------------------------------- | ---------------------------------- |
| 1         | 直接回答优先于工具调用 | Direct answer over tool call          | Avoid unnecessary tool invocations |
| 2         | 读/查优先于写/改       | Read/query over write/modify          | Prefer non-destructive operations  |
| 3         | 低风险优先             | Low risk first                        | Minimize potential harm            |
| 4         | 精确读取优先于搜索     | Precise read over search              | Targeted access is more efficient  |
| 5         | 跨系统写入需审批       | Cross-system writes need approval     | Enforce change control             |
| 6         | 同类选便宜快稳的       | Among similar, pick cheap/fast/stable | Optimize resource usage            |
| 7         | 整合结果不倾倒         | Integrate results, don't dump         | Synthesize, don't overwhelm        |

---

## Rendering Function

### renderToolSelectionPolicy()

```typescript
export function renderToolSelectionPolicy(policy: ToolSelectionPolicyProjection): string {
  const parts: string[] = []

  // Core heuristics
  parts.push('Tool Selection Policy:')
  parts.push(policy.heuristics)

  // Priority rules (optional)
  if (policy.priorityRules && policy.priorityRules.length > 0) {
    parts.push('\nPriority Rules:')
    parts.push(policy.priorityRules.map((r) => `- ${r}`).join('\n'))
  }

  // Risk rules (optional)
  if (policy.riskRules && policy.riskRules.length > 0) {
    parts.push('\nRisk Rules:')
    parts.push(policy.riskRules.map((r) => `- ${r}`).join('\n'))
  }

  return parts.join('\n')
}
```

### Example Output

```
Tool Selection Policy:
- 直接回答优先于工具调用
- 读/查优先于写/改
- 低风险优先
- 精确读取优先于搜索
- 跨系统写入需审批
- 同类选便宜快稳的
- 整合结果不倾倒

Priority Rules:
- web.search before file.glob for external information
- memory.retrieve before web.search for user-specific data

Risk Rules:
- file.write requires user confirmation
- web.search with PII requires sanitization
```

---

## Heuristic Categories

### Web Tools

| Heuristic            | Description                            |
| -------------------- | -------------------------------------- |
| Cache before fetch   | Check local cache before web requests  |
| Rate limit awareness | Respect API rate limits                |
| Result pagination    | Handle paginated results efficiently   |
| Error fallback       | Graceful degradation on network errors |

### File Tools

| Heuristic             | Description                           |
| --------------------- | ------------------------------------- |
| Read before write     | Verify file state before modification |
| Backup critical files | Create backups for important changes  |
| Path validation       | Validate paths before access          |
| Encoding detection    | Handle various file encodings         |

### Memory Tools (Planned)

| Heuristic         | Description                        |
| ----------------- | ---------------------------------- |
| Recent first      | Prefer recent memories over old    |
| Relevance scoring | Use relevance scores for retrieval |
| Deduplication     | Avoid redundant memory storage     |
| Privacy respect   | Honor user privacy preferences     |

---

## Policy Projection Interface

### Strategy/Data Separation

The `ToolSelectionPolicyProjection` is a **strategy** projection, distinct from the **data** projection `ToolPlaneProjection`:

```
ModelInputBuildInput
├── toolSelectionPolicy     ← Strategy (heuristics, rules)
└── toolProjection          ← Data (toolIds, tools[])
```

### Why Separate?

| Aspect       | ToolSelectionPolicy    | ToolPlaneProjection       |
| ------------ | ---------------------- | ------------------------- |
| Content      | Rules and heuristics   | Tool IDs and schemas      |
| Purpose      | Guide selection        | Enable execution          |
| Mutability   | Rarely changes         | Changes per request       |
| Cache Impact | Affects Segment C hash | Part of Segment C content |

---

## Integration with ModelInputBuilder

### Segment C Construction

```typescript
private buildSegmentC(input: ModelInputBuildInput) {
  const projection = input.toolProjection;
  const policy = input.toolSelectionPolicy;
  const parts: string[] = [];

  // Tool plane data
  if (projection) {
    if (mode === 'routing_json') {
      parts.push(this.renderRoutingToolPlane(projection));
    } else if (mode === 'function_calling') {
      parts.push(this.renderFunctionCallingToolPlane(projection));
    }
  }

  // Tool selection policy (P10)
  if (policy) {
    parts.push(renderToolSelectionPolicy(policy));
  }

  const content = parts.join('\n\n');
  const hash = computeTemplateHash(content);
  return { content, hash };
}
```

---

## Cache Hash Implications

### Segment C Hash

```
SegmentC = SHA-256(toolProjection + toolSelectionPolicy)
```

### Hash Stability

| Scenario                    | Hash Impact | Cache Impact         |
| --------------------------- | ----------- | -------------------- |
| Same policy across requests | No change   | Cache hit            |
| Different policy per agent  | Changes     | Cache miss per agent |
| Policy update               | Changes     | New cache entry      |

### Best Practices

1. **Stable heuristics**: Use consistent heuristics per agent kind
2. **Version in content**: Include version indicator for policy updates
3. **Agent-level caching**: Cache policy per agent to minimize changes

---

## Example Usage

### Creating a Tool Selection Policy

```typescript
const toolSelectionPolicy: ToolSelectionPolicyProjection = {
  heuristics: `
- 直接回答优先于工具调用
- 读/查优先于写/改
- 低风险优先
- 精确读取优先于搜索
- 跨系统写入需审批
- 同类选便宜快稳的
- 整合结果不倾倒
  `.trim(),
  priorityRules: [
    'web.search before file.glob for external information',
    'memory.retrieve before web.search for user-specific data',
    'file.read before file.glob when path is known',
  ],
  riskRules: [
    'file.write requires user confirmation',
    'web.search with PII requires sanitization',
    'memory.store with sensitive data requires encryption',
  ],
}
```

### Building Model Input with Policy

```typescript
const built = await builder.build({
  mode: 'function_calling',
  agentKind: 'kernel',
  providerFamily: 'openai',
  toolProjection: {
    toolIds: ['web.search', 'file.read', 'file.write', 'memory.retrieve'],
    tools: [
      /* full schemas */
    ],
  },
  toolSelectionPolicy: toolSelectionPolicy,
})
```

---

## Feature Flag Interaction

### PROMPT_MEMORY_P0_ENABLED

When OFF:

- `toolSelectionPolicy` must be `undefined`
- Segment C hash equals P9 baseline
- No policy content in prompt

When ON:

- `toolSelectionPolicy` is rendered
- Segment C hash includes policy content
- Policy affects tool selection behavior

---

## Planned Extensions (P10.1)

### 1. Web Tool Heuristics Template

```markdown
# Web Tool Heuristics

- Check cache before fetching
- Respect rate limits
- Handle pagination efficiently
- Fallback gracefully on errors
- Sanitize PII before queries
```

### 2. File Tool Heuristics Template

```markdown
# File Tool Heuristics

- Read before write
- Validate paths before access
- Backup before critical changes
- Detect encoding automatically
- Handle large files with streaming
```

### 3. Memory Tool Heuristics Template

```markdown
# Memory Tool Heuristics

- Recent memories first
- Use relevance scoring
- Deduplicate before storage
- Respect privacy preferences
- Validate before persisting
```

---

## Security Considerations

### 1. Risk Rules Enforcement

Risk rules provide explicit guidance for dangerous operations:

- `file.write requires user confirmation`
- `web.search with PII requires sanitization`

### 2. Priority Rules Validation

Priority rules are validated before rendering:

- No circular dependencies
- No conflicting rules
- Valid tool references

### 3. Heuristic Audit

All heuristics are logged in prompt snapshots:

- Full policy visible in audit logs
- Changes tracked over time
- Rollback possible via policy versioning

---

## File References

| File                                                   | Lines | Description                                          |
| ------------------------------------------------------ | ----- | ---------------------------------------------------- |
| `src/kernel/model-input/model-input-types.ts`          | 402   | ToolSelectionPolicyProjection interface and renderer |
| `src/kernel/model-input/model-input-builder.ts`        | 311   | Segment C rendering with policy                      |
| `src/prompt/templates/heuristics/tool-usage.common.md` | 9     | Common tool usage heuristics                         |

---

## Future Extensions

1. **Tool-Specific Heuristics**: Per-tool heuristic templates
2. **Dynamic Priority Rules**: Generate rules based on context
3. **Risk Scoring**: Quantitative risk assessment for tool calls
4. **Learning from Usage**: Adapt heuristics based on tool usage patterns
5. **Conflict Resolution**: Automated resolution for conflicting rules
