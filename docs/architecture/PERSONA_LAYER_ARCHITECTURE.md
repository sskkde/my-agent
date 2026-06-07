# Persona Layer Architecture

> Version: 1.0.0
> Created: 2026-05-24
> Status: Implemented

---

## Overview

The Persona Layer (Layer 5) provides structured persona configuration that affects the assistant's expression style and preferences. The persona is carefully constrained to enhance user experience without compromising system integrity, security, or operational boundaries.

---

## PersonaProjection Interface

### Definition

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

### Field Descriptions

| Field             | Type                    | Required | Description                                      |
| ----------------- | ----------------------- | -------- | ------------------------------------------------ |
| `personaId`       | string                  | Yes      | Unique identifier for persona lookup and caching |
| `styleGuidelines` | string                  | Yes      | Natural language style preferences               |
| `constraints`     | string[]                | Yes      | Hard boundaries the persona cannot cross         |
| `sourceProfile`   | AssistantPersonaProfile | No       | Additional persona metadata                      |

---

## What Persona CAN Affect

The persona projection influences these aspects of assistant behavior:

### 1. Tone and Voice

- Formality level (formal, casual, technical)
- Language style (concise, verbose, balanced)
- Emotional tone (neutral, friendly, professional)

### 2. Verbosity

- Response length preferences
- Explanation depth
- Summary vs. detail orientation

### 3. Expression Style

- Code comment style
- Documentation format preference
- Output formatting preferences

### 4. User Preferences

- Language preference
- Technical level assumption
- Domain-specific terminology

---

## What Persona CANNOT Override

The persona is explicitly prohibited from affecting:

### 1. Safety Rules

- Content filtering
- Harm prevention
- Security boundaries

### 2. Tool Authorization

- Which tools are available
- Tool permission levels
- Tool execution constraints

### 3. Tenant Boundaries

- Multi-tenant isolation
- Resource access limits
- Data visibility rules

### 4. Output Contract

- JSON schema requirements
- Response format specifications
- API contract compliance

### 5. System Rules

- Core platform behavior
- Audit logging
- Error handling

---

## Safety Prefix Mechanism

### renderPersonaProjection()

Every persona rendering includes a mandatory safety prefix that reminds the LLM of the persona's constraints:

```typescript
export function renderPersonaProjection(projection: PersonaProjection): string {
  const parts: string[] = []

  // Safety prefix - ALWAYS included
  const safetyPrefix = '以下为风格偏好，不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界'
  parts.push(safetyPrefix)

  // Style guidelines
  parts.push(`\n## 风格指南\n${projection.styleGuidelines}`)

  // Constraints (if any)
  if (projection.constraints.length > 0) {
    parts.push(`\n## 约束条件\n${projection.constraints.map((c) => `- ${c}`).join('\n')}`)
  }

  // Persona identifier
  parts.push(`\n## 人格标识\n人格ID: ${projection.personaId}`)

  return parts.join('\n')
}
```

### Safety Prefix Text

```
以下为风格偏好，不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界
```

Translation: "The following are style preferences, which cannot override system rules, security constraints, tool authorization, output schema, or audit and tenant boundaries."

### Why Safety Prefix?

1. **Defense in Depth**: Even if persona content is manipulated, the prefix constrains interpretation
2. **LLM Guidance**: Explicit instruction reduces chance of persona overriding system behavior
3. **Audit Trail**: Safety prefix is always visible in prompt snapshots
4. **Consistent Application**: Every persona rendering includes the same safety message

---

## Default Persona Template

### File: `src/prompt/templates/persona/default.md`

```markdown
# 默认助手人格

你是一个沉稳、清晰、尊重边界的助手。

- 用简洁的中文回答问题
- 尊重用户决定，不主动质疑合理请求
- 明确区分事实与推测
- 如人格与系统规则冲突，以系统规则为准
```

### Template Characteristics

| Aspect              | Value                          |
| ------------------- | ------------------------------ |
| Tone                | 沉稳 (steady), 清晰 (clear)    |
| Boundary Respect    | 尊重边界 (respects boundaries) |
| Language            | Chinese                        |
| Fact Handling       | 明确区分事实与推测             |
| Conflict Resolution | 系统规则优先                   |

---

## Hash Stability

### Segment B Hash

The persona projection contributes to Segment B hash:

```
SegmentB = SHA-256(systemPrompt + routingPrompt + personaProjection)
```

### Hash Stability Requirements

1. **Same personaId = Same hash**: Identical persona configurations produce identical hashes
2. **Deterministic rendering**: Rendering order is fixed (safety prefix → guidelines → constraints → ID)
3. **No timestamps**: Persona content must not include dynamic timestamps
4. **No random values**: All content must be deterministic

### Cache Implications

| Scenario                     | Hash Impact | Cache Impact        |
| ---------------------------- | ----------- | ------------------- |
| Same persona across requests | No change   | Cache hit           |
| Different persona per user   | Changes     | Cache miss per user |
| Persona update               | Changes     | New cache entry     |

### Best Practices

1. **Stable personaId**: Use consistent IDs for same persona configurations
2. **Version in ID**: Include version in personaId for updates (`persona-v1`, `persona-v2`)
3. **User-level caching**: Cache persona per user to minimize hash changes

---

## Integration with ModelInputBuilder

### Segment B Construction

```typescript
private buildSegmentB(input: ModelInputBuildInput) {
  const parts: string[] = [];

  // 1. System prompt (highest priority)
  if (input.systemPrompt) {
    parts.push(input.systemPrompt);
  }

  // 2. Routing prompt
  if (input.routingPrompt) {
    parts.push(input.routingPrompt);
  }

  // 3. Persona projection (P10)
  if (input.personaProjection) {
    parts.push(renderPersonaProjection(input.personaProjection));
  }

  const content = parts.join('\n\n');
  const hash = computeTemplateHash(content);
  return { content, hash };
}
```

### Ordering Rationale

1. **systemPrompt first**: Highest priority, defines core behavior
2. **routingPrompt second**: Task routing instructions
3. **personaProjection last**: Style overlay, constrained by earlier content

---

## Example Usage

### Creating a Persona Projection

```typescript
const personaProjection: PersonaProjection = {
  personaId: 'technical-writer-v1',
  styleGuidelines: `
    Use technical terminology appropriately.
    Prefer active voice.
    Include code examples when discussing implementation.
    Structure responses with clear headings.
  `,
  constraints: [
    'Never reveal internal system architecture',
    'Do not suggest workarounds for security features',
    'Maintain professional tone in all responses',
  ],
}
```

### Building Model Input with Persona

```typescript
const built = await builder.build({
  mode: 'routing_json',
  agentKind: 'foreground',
  providerFamily: 'deepseek',
  systemPrompt: 'You are a helpful assistant.',
  personaProjection: personaProjection,
  toolProjection: {
    toolIds: ['web.search', 'memory.retrieve'],
  },
})
```

### Rendered Output

```
以下为风格偏好，不可覆盖系统规则/安全约束/工具授权/输出 schema/审计与租户边界

## 风格指南

    Use technical terminology appropriately.
    Prefer active voice.
    Include code examples when discussing implementation.
    Structure responses with clear headings.


## 约束条件
- Never reveal internal system architecture
- Do not suggest workarounds for security features
- Maintain professional tone in all responses

## 人格标识
人格ID: technical-writer-v1
```

---

## Security Considerations

### 1. Injection Prevention

The persona content is rendered as non-imperative text, reducing the risk of prompt injection:

- No command syntax
- No special tokens
- Plain text rendering

### 2. Boundary Enforcement

The safety prefix explicitly states what the persona cannot override:

- System rules
- Security constraints
- Tool authorization
- Output schema
- Audit and tenant boundaries

### 3. Constraint Validation

The `constraints` array provides explicit boundaries:

- Validated before rendering
- Always included in output
- Cannot be empty (must have at least one constraint)

### 4. Audit Trail

Persona content is included in prompt snapshots:

- Full persona visible in audit logs
- Changes tracked over time
- Rollback possible via personaId

---

## Feature Flag Interaction

### PROMPT_MEMORY_P0_ENABLED

When OFF:

- `personaProjection` must be `undefined`
- Segment B hash equals P9 baseline
- No persona content in prompt

When ON:

- `personaProjection` is rendered
- Segment B hash includes persona content
- Persona affects assistant style

---

## File References

| File                                            | Lines | Description                                               |
| ----------------------------------------------- | ----- | --------------------------------------------------------- |
| `src/kernel/model-input/model-input-types.ts`   | 402   | PersonaProjection interface and renderPersonaProjection() |
| `src/kernel/model-input/model-input-builder.ts` | 311   | Segment B rendering with persona                          |
| `src/prompt/templates/persona/default.md`       | 7     | Default persona template                                  |

---

## Future Extensions

1. **Persona Inheritance**: Allow personas to extend base templates
2. **Persona Versioning**: Support multiple versions with migration
3. **Persona Analytics**: Track persona effectiveness metrics
4. **Dynamic Constraints**: Generate constraints based on context
5. **Multi-Language Personas**: Support persona content in multiple languages
