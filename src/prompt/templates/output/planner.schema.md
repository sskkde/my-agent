# Planner Output Schema Template

## Schema Identity

Schema Name: `planner.execution.output`
Schema Version: `{schemaVersion}`
Schema Purpose: Define the JSON contract for PlannerAgent execution plans

## JSON Schema Definition

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "planner.execution.output",
  "title": "Planner Execution Output",
  "description": "JSON contract for PlannerAgent execution plans",
  "type": "object",
  "required": ["planId", "objective", "steps", "status"],
  "additionalProperties": false,
  "properties": {
    "planId": {
      "type": "string",
      "description": "Unique identifier for this plan",
      "pattern": "^plan_[a-zA-Z0-9_-]+$"
    },
    "objective": {
      "type": "string",
      "description": "The overall objective of this plan",
      "minLength": 1,
      "maxLength": 2000
    },
    "steps": {
      "type": "array",
      "description": "Ordered list of execution steps",
      "minItems": 1,
      "maxItems": 50,
      "items": {
        "$ref": "#/definitions/step"
      }
    },
    "missingPreferences": {
      "type": "array",
      "description": "Information needed from user before execution",
      "items": {
        "type": "string",
        "maxLength": 500
      },
      "maxItems": 10
    },
    "risks": {
      "type": "array",
      "description": "Potential issues or risks identified",
      "items": {
        "type": "string",
        "maxLength": 500
      },
      "maxItems": 10
    },
    "status": {
      "type": "string",
      "description": "Current plan status",
      "enum": ["draft", "ready", "executing", "completed", "failed", "cancelled"]
    }
  },
  "definitions": {
    "step": {
      "type": "object",
      "required": ["stepId", "description", "successCriteria"],
      "additionalProperties": false,
      "properties": {
        "stepId": {
          "type": "string",
          "description": "Unique identifier for this step",
          "pattern": "^step_[a-zA-Z0-9_-]+$"
        },
        "description": {
          "type": "string",
          "description": "What this step accomplishes",
          "minLength": 1,
          "maxLength": 1000
        },
        "dependencies": {
          "type": "array",
          "description": "Step IDs that must complete before this step",
          "items": {
            "type": "string",
            "pattern": "^step_[a-zA-Z0-9_-]+$"
          }
        },
        "successCriteria": {
          "type": "string",
          "description": "How to verify this step succeeded",
          "minLength": 1,
          "maxLength": 500
        },
        "estimatedComplexity": {
          "type": "string",
          "description": "Estimated complexity of this step",
          "enum": ["low", "medium", "high"]
        },
        "tools": {
          "type": "array",
          "description": "Tools needed for this step",
          "items": {
            "type": "string",
            "pattern": "^[a-z_]+$"
          }
        },
        "rollback": {
          "type": "string",
          "description": "How to undo this step if needed",
          "maxLength": 500
        }
      }
    }
  }
}
```

## Plan Structure

### Plan Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `planId` | string | Yes | Unique plan identifier |
| `objective` | string | Yes | Overall goal |
| `status` | string | Yes | Current status |

### Step Structure

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stepId` | string | Yes | Unique step identifier |
| `description` | string | Yes | What this step does |
| `dependencies` | string[] | No | Prerequisite steps |
| `successCriteria` | string | Yes | Success verification |
| `estimatedComplexity` | string | No | low/medium/high |
| `tools` | string[] | No | Required tools |
| `rollback` | string | No | Undo procedure |

## Status Definitions

### draft

Plan is being created or modified. Not ready for execution.

Conditions:
- Steps may be incomplete
- Dependencies may be invalid
- Missing preferences may exist

### ready

Plan is complete and ready for execution.

Conditions:
- All steps have valid dependencies
- No circular dependencies
- All required tools available
- No missing preferences

### executing

Plan is currently being executed.

Conditions:
- At least one step in progress
- Progress updates being generated
- Can be cancelled

### completed

All steps completed successfully.

Conditions:
- All steps have success status
- All success criteria met
- Evidence collected

### failed

Execution failed and cannot continue.

Conditions:
- At least one step failed
- Failure reason documented
- Partial results available

### cancelled

Execution was cancelled by user or system.

Conditions:
- Cancellation reason documented
- Partial results available
- Cleanup performed

## Example Plans

### Simple Plan

```json
{
  "planId": "plan_read_config",
  "objective": "Read and parse configuration file",
  "steps": [
    {
      "stepId": "step_read_file",
      "description": "Read the configuration file",
      "successCriteria": "File contents retrieved successfully",
      "estimatedComplexity": "low",
      "tools": ["file_read"]
    },
    {
      "stepId": "step_parse",
      "description": "Parse the configuration",
      "dependencies": ["step_read_file"],
      "successCriteria": "Configuration parsed without errors",
      "estimatedComplexity": "low"
    }
  ],
  "status": "ready"
}
```

### Complex Plan

```json
{
  "planId": "plan_refactor_auth",
  "objective": "Refactor authentication module to use OAuth2",
  "steps": [
    {
      "stepId": "step_analyze_current",
      "description": "Analyze current authentication implementation",
      "successCriteria": "Current implementation fully understood",
      "estimatedComplexity": "medium",
      "tools": ["file_read", "file_glob", "file_grep"]
    },
    {
      "stepId": "step_design_oauth",
      "description": "Design OAuth2 integration architecture",
      "dependencies": ["step_analyze_current"],
      "successCriteria": "Architecture documented and reviewed",
      "estimatedComplexity": "high"
    },
    {
      "stepId": "step_implement",
      "description": "Implement OAuth2 authentication",
      "dependencies": ["step_design_oauth"],
      "successCriteria": "All tests passing",
      "estimatedComplexity": "high",
      "tools": ["file_read", "file_write"]
    },
    {
      "stepId": "step_test",
      "description": "Write and run integration tests",
      "dependencies": ["step_implement"],
      "successCriteria": "All integration tests pass",
      "estimatedComplexity": "medium"
    },
    {
      "stepId": "step_document",
      "description": "Update documentation",
      "dependencies": ["step_test"],
      "successCriteria": "Documentation updated and reviewed",
      "estimatedComplexity": "low"
    }
  ],
  "risks": [
    "Breaking existing authentication flows",
    "OAuth provider compatibility issues"
  ],
  "status": "draft"
}
```

## Dependency Rules

### Rule 1: No Self-Dependency

A step cannot depend on itself.

```
FOR step IN steps:
  IF step.stepId IN step.dependencies:
    ERROR "Self-dependency not allowed"
```

### Rule 2: No Circular Dependencies

Dependency graph must be acyclic.

```
IF hasCycle(buildDependencyGraph(steps)):
  ERROR "Circular dependencies detected"
```

### Rule 3: Valid References

Dependencies must reference existing steps.

```
FOR step IN steps:
  FOR dep IN step.dependencies:
    IF NOT existsStep(steps, dep):
      ERROR "Invalid dependency reference: " + dep
```

### Rule 4: Execution Order

Steps execute in topological order.

```
order = topologicalSort(buildDependencyGraph(steps))
FOR stepId IN order:
  executeStep(stepId)
```

## Validation Rules

### Rule 1: Plan ID Format

Plan ID must match pattern `^plan_[a-zA-Z0-9_-]+$`.

### Rule 2: Step ID Format

Step ID must match pattern `^step_[a-zA-Z0-9_-]+$`.

### Rule 3: At Least One Step

Plan must have at least one step.

### Rule 4: Unique Step IDs

All step IDs must be unique within a plan.

### Rule 5: Valid Complexity

`estimatedComplexity` must be one of: low, medium, high.

### Rule 6: Valid Status

`status` must be one of the enumerated values.

## Missing Preferences

When a plan requires user input before execution:

```json
{
  "missingPreferences": [
    "OAuth provider choice (Google, GitHub, or custom)",
    "Token expiration policy",
    "Redirect URI configuration"
  ],
  "status": "draft"
}
```

The planner should use `ask_user` tool to gather these preferences.

## Risk Documentation

Document identified risks:

```json
{
  "risks": [
    "Breaking existing authentication flows",
    "OAuth provider compatibility issues",
    "Token refresh edge cases"
  ]
}
```

Each risk should be actionable and specific.

## Immutable Declaration

This template is part of Layer 4 (Output Schema) of the ModelInputBuilder architecture.
Output schema templates define the JSON contract for agent responses.
This template is strongly cached and must not contain dynamic content.

---

**END OF PLANNER OUTPUT SCHEMA TEMPLATE**
