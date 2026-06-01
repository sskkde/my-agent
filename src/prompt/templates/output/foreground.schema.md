# Foreground Output Schema Template

## Schema Identity

Schema Name: `foreground.routing.output`
Schema Version: `{schemaVersion}`
Schema Purpose: Define the JSON contract for ForegroundAgent routing responses

## JSON Schema Definition

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "foreground.routing.output",
  "title": "Foreground Routing Output",
  "description": "JSON contract for ForegroundAgent routing decisions",
  "type": "object",
  "required": ["route", "reason"],
  "additionalProperties": false,
  "properties": {
    "route": {
      "type": "string",
      "description": "The routing decision",
      "enum": [
        "answer_directly",
        "dispatch_tool",
        "spawn_planner",
        "resume_existing_planner",
        "cancel_or_modify_task",
        "status_query",
        "dispatch_subagent",
        "approval_handler"
      ]
    },
    "reason": {
      "type": "string",
      "description": "Brief explanation of the routing decision",
      "minLength": 1,
      "maxLength": 500
    },
    "userVisibleResponse": {
      "type": "string",
      "description": "Optional immediate response to show the user",
      "maxLength": 2000
    },
    "estimatedSteps": {
      "type": "integer",
      "description": "Estimated number of steps for the task",
      "minimum": 1,
      "maximum": 100
    },
    "complexity": {
      "type": "string",
      "description": "Task complexity level",
      "enum": ["low", "medium", "high", "critical"]
    },
    "suggestedTools": {
      "type": "array",
      "description": "Tool IDs suggested for execution",
      "items": {
        "type": "string",
        "pattern": "^[a-z_]+$"
      },
      "maxItems": 20
    }
  }
}
```

## Route Definitions

### answer_directly

Used for:
- Simple factual questions
- Greetings and pleasantries
- Explanations that don't require tools
- Limitation explanations when tools unavailable

Required fields:
- `route`: "answer_directly"
- `reason`: string

Optional fields:
- `userVisibleResponse`: Direct response to show user

Example:
```json
{
  "route": "answer_directly",
  "reason": "Simple greeting, no action required",
  "userVisibleResponse": "Hello! How can I help you today?"
}
```

### dispatch_tool

Used for:
- Single tool operations
- Read/search operations
- Simple queries

Required fields:
- `route`: "dispatch_tool"
- `reason`: string
- `suggestedTools`: array (at least one)

Example:
```json
{
  "route": "dispatch_tool",
  "reason": "File read operation requested",
  "suggestedTools": ["file_read"]
}
```

### spawn_planner

Used for:
- Multi-step tasks
- Complex implementations
- Architecture changes
- Refactoring work

Required fields:
- `route`: "spawn_planner"
- `reason`: string

Recommended fields:
- `estimatedSteps`: number
- `complexity`: string

Example:
```json
{
  "route": "spawn_planner",
  "reason": "Multi-step refactoring task",
  "estimatedSteps": 5,
  "complexity": "high"
}
```

### resume_existing_planner

Used for:
- Continuing previous work
- User references earlier task
- Natural continuation of planning

Required fields:
- `route`: "resume_existing_planner"
- `reason`: string

Example:
```json
{
  "route": "resume_existing_planner",
  "reason": "User continuing previous refactoring task"
}
```

### cancel_or_modify_task

Used for:
- Cancel active work
- Pause/resume tasks
- Modify running operations

Required fields:
- `route`: "cancel_or_modify_task"
- `reason`: string

Example:
```json
{
  "route": "cancel_or_modify_task",
  "reason": "User requested cancellation of active task"
}
```

### status_query

Used for:
- Checking running tasks
- Progress inquiries
- Status of background work

Required fields:
- `route`: "status_query"
- `reason`: string

Example:
```json
{
  "route": "status_query",
  "reason": "User asking about current task status"
}
```

### dispatch_subagent

Used for:
- Background tasks
- Asynchronous operations
- Scoped execution

Required fields:
- `route`: "dispatch_subagent"
- `reason`: string

Example:
```json
{
  "route": "dispatch_subagent",
  "reason": "Background analysis task suitable for async execution"
}
```

### approval_handler

Used for:
- Approval responses
- Rejection responses
- Pending operation decisions

Required fields:
- `route`: "approval_handler"
- `reason`: string

Example:
```json
{
  "route": "approval_handler",
  "reason": "User approved pending file write operation"
}
```

## Validation Rules

### Rule 1: Route Required

The `route` field is required and must be one of the enumerated values.

### Rule 2: Reason Required

The `reason` field is required and must be non-empty.

### Rule 3: Tools for dispatch_tool

When `route` is "dispatch_tool", `suggestedTools` must be non-empty.

### Rule 4: Valid Tool IDs

All tool IDs in `suggestedTools` must match the pattern `^[a-z_]+$`.

### Rule 5: Complexity for spawn_planner

When `route` is "spawn_planner", `complexity` is recommended.

### Rule 6: Steps Range

`estimatedSteps` must be between 1 and 100 inclusive.

## Error Responses

### Invalid Route

```json
{
  "error": "invalid_route",
  "message": "Route 'invalid_route' is not in available routes",
  "availableRoutes": ["answer_directly", "dispatch_tool", ...]
}
```

### Missing Required Field

```json
{
  "error": "missing_field",
  "message": "Required field 'reason' is missing",
  "requiredFields": ["route", "reason"]
}
```

### Invalid Tool ID

```json
{
  "error": "invalid_tool_id",
  "message": "Tool 'InvalidTool' does not match pattern ^[a-z_]+$",
  "pattern": "^[a-z_]+$"
}
```

## Server-Side Validation

After the LLM returns a routing decision, the server validates:

1. **Route Validity**: Route must be in the route catalog
2. **Tool Authorization**: Suggested tools must be in allowed tools
3. **Field Constraints**: All field constraints must be satisfied
4. **Business Rules**: Route-specific business rules must be met

### Tool Intersection

```
validatedTools = suggestedTools ∩ allowedTools ∩ knownTools
```

If `validatedTools` is empty and route requires tools, return error.

## Immutable Declaration

This template is part of Layer 4 (Output Schema) of the ModelInputBuilder architecture.
Output schema templates define the JSON contract for agent responses.
This template is strongly cached and must not contain dynamic content.

---

**END OF FOREGROUND OUTPUT SCHEMA TEMPLATE**
