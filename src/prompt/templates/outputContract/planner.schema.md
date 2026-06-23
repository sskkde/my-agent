# Output Contract: Planner Schema

<output_contract id="output:planner.schema">

## Contract Identity

Contract ID: `output:planner.schema`
Contract Purpose: Define the JSON contract for PlannerAgent execution plans.

## Contract Rules

- Output must be valid JSON matching the planner.execution.output schema.
- All required fields (planId, objective, steps, status) must be present.
- Step IDs must be unique within a plan.
- Dependencies must reference existing step IDs.
- No circular dependencies allowed.
- Plan ID must match pattern `^plan_[a-zA-Z0-9_-]+$`.
- Step ID must match pattern `^step_[a-zA-Z0-9_-]+$`.
- Plan must have at least one step.
- `estimatedComplexity` must be one of: low, medium, high.
- `status` must be one of: draft, ready, executing, completed, failed, cancelled.

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

## Status Definitions

- **draft**: Plan is being created or modified. Steps may be incomplete, dependencies may be invalid, missing preferences may exist.
- **ready**: Plan is complete and ready for execution. All steps have valid dependencies, no circular dependencies, all required tools available, no missing preferences.
- **executing**: Plan is currently being executed. At least one step in progress, progress updates being generated, can be cancelled.
- **completed**: All steps completed successfully. All steps have success status, all success criteria met, evidence collected.
- **failed**: Execution failed and cannot continue. At least one step failed, failure reason documented, partial results available.
- **cancelled**: Execution was cancelled by user or system. Cancellation reason documented, partial results available, cleanup performed.

---

</output_contract>
