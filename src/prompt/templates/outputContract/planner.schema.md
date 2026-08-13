# Output Contract: Planner Schema

<output_contract id="output:planner.schema">

## Contract Identity

Contract ID: `output:planner.schema`
Contract Purpose: Define the JSON contract for planner plan generation output.

## Contract Rules

- Output must be valid JSON matching the planner.execution.output schema.
- All required fields (id, goal, steps, successCriteria) must be present.
- Step IDs must be unique within a plan; plan IDs match `^plan_[a-zA-Z0-9_-]+$`.
- Dependencies must reference existing step IDs; no circular dependencies.
- Plan must have 1-10 steps (max 10 aligns with MAX_PLAN_STEPS).
- `kind` must be one of: agent_task, tool_call, subagent_task, workflow_step, user_approval, final_response.
- `executor` must be one of: agent_kernel, tool_plane, subagent, workflow_runtime, foreground.
- Every step MUST declare `expectedOutput` (verifiable result of completing the step).
- Write/delete steps MUST be preceded by a user*approval step carrying `approvalRequirementId` matching `^approval*[a-zA-Z0-9_-]+$`.

## JSON Schema Definition

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "planner.execution.output",
  "title": "Planner Execution Output",
  "description": "JSON contract for planner plan generation output",
  "type": "object",
  "required": ["id", "goal", "steps", "successCriteria"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^plan_[a-zA-Z0-9_-]+$"
    },
    "goal": {
      "type": "string",
      "description": "The goal as received from the foreground agent (already intent-resolved)",
      "minLength": 1,
      "maxLength": 2000
    },
    "assumptions": {
      "type": "array",
      "description": "Assumptions the plan rests on; if one turns out false during execution, stop and report",
      "items": { "type": "string", "maxLength": 500 },
      "maxItems": 10
    },
    "riskNotes": {
      "type": "array",
      "description": "Potential issues or risks identified",
      "items": { "type": "string", "maxLength": 500 },
      "maxItems": 10
    },
    "steps": {
      "type": "array",
      "description": "Atomic execution steps",
      "minItems": 1,
      "maxItems": 10,
      "items": { "$ref": "#/definitions/step" }
    },
    "successCriteria": {
      "type": "array",
      "description": "Acceptance criteria derived from the goal, not from the step list",
      "minItems": 1,
      "items": { "type": "string", "maxLength": 500 }
    }
  },
  "definitions": {
    "step": {
      "type": "object",
      "required": ["id", "title", "description", "kind", "executor", "expectedOutput"],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^step_[a-zA-Z0-9_-]+$"
        },
        "title": {
          "type": "string",
          "description": "Short title; a title containing 'and'/'then' means two tasks",
          "minLength": 1,
          "maxLength": 120
        },
        "description": {
          "type": "string",
          "description": "What this step accomplishes; include exact interface contracts it consumes",
          "minLength": 1,
          "maxLength": 1000
        },
        "kind": {
          "type": "string",
          "enum": ["agent_task", "tool_call", "subagent_task", "workflow_step", "user_approval", "final_response"]
        },
        "executor": {
          "type": "string",
          "enum": ["agent_kernel", "tool_plane", "subagent", "workflow_runtime", "foreground"]
        },
        "toolName": {
          "type": "string",
          "description": "Required when kind is tool_call; must be one of the provided available tools",
          "pattern": "^[a-z_]+$"
        },
        "dependsOn": {
          "type": "array",
          "description": "Step IDs that must complete before this step",
          "items": {
            "type": "object",
            "required": ["targetStepId"],
            "properties": {
              "type": {
                "type": "string",
                "enum": ["depends_on", "blocks", "references"]
              },
              "targetStepId": {
                "type": "string",
                "pattern": "^step_[a-zA-Z0-9_-]+$"
              }
            }
          }
        },
        "expectedOutput": {
          "type": "string",
          "description": "Verifiable result of completing this step (what 'done' produces)",
          "minLength": 1,
          "maxLength": 500
        },
        "outOfScope": {
          "type": "string",
          "description": "What looks related but must NOT be touched in this step",
          "maxLength": 500
        },
        "approvalRequirementId": {
          "type": "string",
          "description": "Present on write/delete steps and their preceding user_approval step",
          "pattern": "^approval_[a-zA-Z0-9_-]+$"
        }
      }
    }
  }
}
```

---

</output_contract>
