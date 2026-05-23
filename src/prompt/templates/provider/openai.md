# OpenAI Provider Template

## Provider Identity

Provider Family: `openai`
Compatible Providers: OpenAI, OpenRouter, Azure OpenAI, and OpenAI-compatible APIs

## JSON Output Mode

### Strict JSON Requirements

When operating in JSON mode, the following rules apply:

1. **Valid JSON Only**: The entire response must be valid JSON
2. **No Markdown Wrapping**: Do not wrap JSON in ```json blocks
3. **No Preamble**: Do not include text before the JSON object
4. **No Postscript**: Do not include text after the JSON object
5. **No Comments**: JSON does not support comments; do not include them

### JSON Schema Compliance

All JSON outputs must conform to the schema provided in the request:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["route", "reason"],
  "properties": {
    "route": {
      "type": "string",
      "enum": ["route1", "route2", "route3"]
    },
    "reason": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

### JSON Repair Protocol

If JSON parsing fails, the system may attempt repair:

1. Extract JSON from markdown code blocks if present
2. Remove common preambles ("Here is the JSON:", "```json")
3. Remove trailing text after the closing brace
4. Attempt to fix common syntax errors (trailing commas, missing quotes)
5. If repair fails, return error to agent for retry

## Function Calling

### Tool Definition Format

Tools are defined using OpenAI's function calling format:

```json
{
  "type": "function",
  "function": {
    "name": "tool_name",
    "description": "Tool description",
    "parameters": {
      "type": "object",
      "properties": {
        "param1": {
          "type": "string",
          "description": "Parameter description"
        }
      },
      "required": ["param1"]
    }
  }
}
```

### Tool Calling Rules

1. **Parallel Calls**: Multiple tools can be called in a single response
2. **Order Independence**: Tool call order does not affect execution
3. **Idempotency**: Tools should be idempotent where possible
4. **Error Handling**: Tool errors are returned to the model for retry

### Tool Response Format

Tool results are returned in the following format:

```json
{
  "tool_call_id": "call_abc123",
  "role": "tool",
  "content": "result or error message"
}
```

## Message Format

### System Message

The system message sets the behavior and constraints:

```
You are {agentKind} operating in {mode} mode.

{platformBaseTemplate}
{platformSafetyTemplate}
{agentTemplate}
{outputSchemaTemplate}

Follow these rules:
- {rule1}
- {rule2}
- {rule3}
```

### User Message

User messages contain the actual request:

```json
{
  "role": "user",
  "content": "User message content"
}
```

### Assistant Message

Assistant messages contain the model's response:

```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_xyz",
      "type": "function",
      "function": {
        "name": "tool_name",
        "arguments": "{\"param\": \"value\"}"
      }
    }
  ]
}
```

## Token Management

### Context Window

- Maximum context: {maxContextTokens} tokens
- System prompt allocation: {systemPromptTokens} tokens
- Tool definitions allocation: {toolDefinitionTokens} tokens
- Available for conversation: {availableTokens} tokens

### Token Estimation

Token counts are estimated as:
- English text: ~4 characters per token
- Code: ~3 characters per token
- JSON: ~3.5 characters per token

### Truncation Strategy

When context exceeds limits:
1. Preserve system message
2. Preserve tool definitions
3. Truncate oldest messages first
4. Keep last N messages if possible

## Error Handling

### API Errors

| Error Code | Meaning | Recovery |
|------------|---------|----------|
| 400 | Bad request | Fix request format |
| 401 | Invalid API key | Check credentials |
| 429 | Rate limited | Exponential backoff |
| 500 | Server error | Retry with backoff |
| 503 | Service unavailable | Retry with backoff |

### Retry Strategy

```
attempt = 1
max_attempts = {maxRetries}
base_delay = 1000ms

WHILE attempt <= max_attempts:
  result = call_api()
  IF result.success:
    RETURN result
  IF result.error is permanent:
    RETURN error
  delay = base_delay * 2^(attempt-1)
  SLEEP(delay)
  attempt += 1

RETURN error("Max retries exceeded")
```

## Streaming

### Streaming Protocol

When streaming is enabled:

1. Response is sent in chunks
2. Each chunk contains partial content
3. Final chunk includes finish_reason
4. Tool calls are accumulated across chunks

### Stream Processing

```
accumulated_content = ""
FOR chunk IN stream:
  IF chunk.delta.content:
    accumulated_content += chunk.delta.content
    yield chunk.delta.content
  IF chunk.finish_reason:
    BREAK

RETURN parse_json(accumulated_content)
```

## Model-Specific Behavior

### GPT-4 Series

- Best for complex reasoning
- Supports function calling
- Supports JSON mode
- Higher latency, higher quality

### GPT-3.5 Series

- Best for simple routing
- Supports function calling
- Supports JSON mode
- Lower latency, lower cost

### Model Selection

The model is selected based on:
- `{modelId}`: Explicit model override
- `{taskComplexity}`: Complexity-based selection
- `{costPreference}`: Cost vs quality tradeoff

## Immutable Declaration

This template is part of Layer 2 (Provider) of the ModelInputBuilder architecture.
Provider templates are selected based on the LLM provider family.
This template is strongly cached and must not contain dynamic content.

---

**END OF OPENAI PROVIDER TEMPLATE**
