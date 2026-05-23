# DeepSeek Provider Template

## Provider Identity

Provider Family: `deepseek`
Compatible Providers: DeepSeek API, DeepSeek local deployments

## Cache Prefix Stability

### Critical: Prefix Must Be Identical

DeepSeek uses a KV Cache optimization that requires identical prompt prefixes for cache hits.
**Any variation in the prefix will result in cache misses and increased latency/cost.**

### Prefix Construction Rules

The prompt prefix consists of:
1. **Layer 1**: Platform templates (base + safety) - ALWAYS IDENTICAL
2. **Layer 2**: Provider template (this file) - ALWAYS IDENTICAL
3. **Layer 3**: Agent template - ALWAYS IDENTICAL per agent type
4. **Layer 4**: Output schema - ALWAYS IDENTICAL per output type

### Forbidden Dynamic Content in Prefix

The following MUST NOT appear in Layers 1-4:

| Forbidden Content Category | Reason |
|---------------------------|--------|
| Tenant-specific identifiers | Varies per tenant |
| User-specific identifiers | Varies per user |
| Session-specific identifiers | Varies per session |
| Run-specific identifiers | Varies per run |
| Message-specific identifiers | Varies per message |
| Temporal values | Changes over time |
| Request-specific identifiers | Varies per request |
| Current user message content | Varies per message |
| Available tool lists | Varies per session |
| Retrieved memory content | Varies per context |
| Tool execution results | Varies per execution |

### Dynamic Content Placement

Dynamic content is placed in Layer 5-7:
- **Layer 5**: Tenant / Project Instruction Projection (tenant policy, organization policy, project instruction, workspace instruction, stable instruction)
- **Layer 6**: Tool Plane Projection (visible tool IDs, capability summaries, function schemas for execution mode, canonical tool schema ordering)
- **Layer 7**: ContextBundle Projection (current user message, current date, session/run/message/request IDs, selected memory, transcript summaries, tool result projections, workflow/trigger/background state)

### Layer Constraints

The current user message MUST NOT appear in Layer 1–6.
The current date, runId, requestId, and messageId MUST NOT appear in Layer 1–6.

## JSON Output Mode

### DeepSeek JSON Format

DeepSeek requires strict JSON output:

1. **Response Format**: Set `response_format: { type: "json_object" }`
2. **Valid JSON Only**: Entire response must be parseable JSON
3. **No Extraneous Text**: No text outside JSON structure

### JSON Schema Validation

DeepSeek responses are validated against:

```json
{
  "type": "object",
  "required": ["route"],
  "additionalProperties": true,
  "properties": {
    "route": { "type": "string" }
  }
}
```

### Common JSON Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Trailing comma | JavaScript style | Remove trailing commas |
| Single quotes | Non-standard | Use double quotes |
| Missing quotes | Unquoted keys | Quote all keys |
| Undefined | JS undefined | Use null instead |

## Stable Prefix Pattern

### Recommended Prefix Structure

```
[SYSTEM MESSAGE - LAYER 1-4 - NEVER CHANGES]

=== Platform Base Template ===
{platformBaseContent}

=== Platform Safety Template ===
{platformSafetyContent}

=== Provider Template (DeepSeek) ===
{providerContent}

=== Agent Template ===
{agentContent}

=== Output Schema ===
{outputSchemaContent}

[/SYSTEM MESSAGE - END OF CACHED PREFIX]

[USER MESSAGE - LAYER 5-7 - CHANGES PER REQUEST]

=== Tenant / Project Instruction Projection (Layer 5) ===
{currentInstruction}

=== Tool Plane Projection (Layer 6) ===
{availableTools}

=== ContextBundle Projection (Layer 7) ===
{contextBundle}

[/USER MESSAGE]
```

### Cache Hit Conditions

Cache hit occurs when:
1. Same model ID
2. Same system message prefix (Layers 1-4)
3. Same temperature and other parameters
4. Within cache TTL window

### Cache Miss Causes

Cache miss occurs when:
1. Different model ID
2. Any change in Layers 1-4
3. Different parameters
4. Cache TTL expired

## Function Calling

### DeepSeek Tool Format

Tools follow OpenAI-compatible format:

```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "Description",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
}
```

### Tool Calling Behavior

- DeepSeek supports parallel tool calls
- Tool results are returned in subsequent messages
- Tool errors should be handled gracefully

## Reasoning Model Support

### DeepSeek-R1 Specific

When using DeepSeek-R1 (reasoning model):

1. **Reasoning Tags**: Model outputs `<think>` tags for reasoning
2. **Separation**: Reasoning is separate from final answer
3. **Extraction**: System extracts content after `</think>`
4. **Token Budget**: Reasoning consumes tokens, budget accordingly

### Reasoning Extraction

```
response = model.generate(prompt)
IF "<think>" IN response:
  reasoning = extract_between(response, "<think>", "</think>")
  answer = extract_after(response, "</think>")
  RETURN { reasoning, answer }
ELSE:
  RETURN { reasoning: null, answer: response }
```

## Error Handling

### DeepSeek-Specific Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `invalid_prompt` | Malformed prompt | Fix prompt structure |
| `context_too_long` | Exceeds context limit | Truncate context |
| `rate_limit` | Too many requests | Backoff and retry |
| `model_overloaded` | Server capacity | Retry with delay |

### Retry Configuration

```
max_retries = {maxRetries}
initial_delay = 1000ms
max_delay = 30000ms
backoff_factor = 2

FOR attempt IN 1..max_retries:
  result = call_deepseek()
  IF success: RETURN result
  IF permanent_failure: RETURN error
  delay = min(initial_delay * backoff_factor^(attempt-1), max_delay)
  sleep(delay)
```

## Token Efficiency

### Token Optimization Strategies

1. **Cache Prefix**: Maximize cached prefix length
2. **Minimize Dynamic**: Keep dynamic content minimal
3. **Efficient JSON**: Use short field names, omit nulls
4. **Truncate History**: Keep only relevant context

### Token Budget Allocation

| Component | Allocation | Notes |
|-----------|------------|-------|
| System Prefix | ~2000 tokens | Cached, no per-request cost |
| Tools | ~500 tokens | Cached if stable |
| Context | ~3000 tokens | Dynamic, varies |
| Response | ~1000 tokens | Output budget |

## Model Selection

### Available Models

| Model | Context | Best For |
|-------|---------|----------|
| `deepseek-chat` | 64K | General routing |
| `deepseek-reasoner` | 64K | Complex reasoning |

### Model Configuration

Model is selected via:
- `{modelId}`: Explicit model ID
- `{providerConfig}`: Provider-specific settings

## Immutable Declaration

This template is part of Layer 2 (Provider) of the ModelInputBuilder architecture.
This template is designed for maximum KV Cache hit rate on DeepSeek.
**DO NOT add any dynamic content to this template.**
Dynamic content belongs in Layers 5-7.

---

**END OF DEEPSEEK PROVIDER TEMPLATE**
