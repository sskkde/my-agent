# Todo 12: Layer Categorization Evidence

## Task Summary

Categorized existing `agents/kernel.md`, `agents/foreground.md`, `platform/safety.md`, and output schemas into the new seven-layer templates.

## Content Split Analysis

### Layer 1 (Platform) - No Changes Needed

`platform/safety.md` already contains all global invariants:
- Authorization and Scope
- Data Handling
- Tool Safety
- Prompt Injection Resistance
- Evidence and Honesty

`platform/base.md` contains:
- Runtime Contract
- Tool and Action Boundaries
- Work Style
- Context Priority

### Layer 3 (AgentType) - Updated

**agentType/main.md** enriched with kernel execution rules:
- Execute only operations inside the granted scope
- Do not authorize yourself, expand your scope, invent tools, or bypass server validation
- Stop and report the validated error when authorization, schema, resource, or tool constraints block execution
- Do not retry destructive or state-changing operations without explicit validated approval
- Preserve partial results and evidence when a task fails after some progress

### Layer 5 (AgentProfile) - Updated

**agentProfile/default_main.md** enriched with kernel capability details:
- Use the smallest sufficient tool call for the task
- Plan and Tool Handling section (single-tool, planned work, cancellation)
- Output Discipline section

**agentProfile/foreground.md** enriched with foreground tool patterns:
- Tool Usage Rules (authorized tools, failure handling)
- Specialized Tool Patterns (planner, subagent, status, search)
- Output Contract (natural language, no routing JSON)
- Clarification rules
- Limitations

### Layer 4 (OutputContract) - Updated

**outputContract/planner.schema.md** enriched with:
- Full JSON schema definition
- Status definitions (draft, ready, executing, completed, failed, cancelled)
- Validation rules (plan ID format, step ID format, unique step IDs, complexity, status)

**outputContract/memory-candidate.schema.md** enriched with:
- Full JSON schema definition
- All required fields and constraints

## Contradiction Check

No contradictory safety rules found across files. All files consistently enforce:
- Destructive/state-changing operations require approval
- No fabrication of tool results or evidence
- Read/search preferred over write/modify

## Test Results

```
Test Files  8 passed (8)
     Tests  139 passed (139)

Test Files  15 passed (15)
     Tests  245 passed (245)
```

All prompt unit tests and kernel model-input tests pass.

## Files Modified

1. `src/prompt/templates/agentType/main.md` - Added kernel execution rules
2. `src/prompt/templates/agentProfile/default_main.md` - Added kernel plan/tool handling
3. `src/prompt/templates/agentProfile/foreground.md` - Added foreground tool patterns
4. `src/prompt/templates/outputContract/planner.schema.md` - Added full JSON schema
5. `src/prompt/templates/outputContract/memory-candidate.schema.md` - Added full JSON schema

## Files Unchanged

1. `src/prompt/templates/platform/safety.md` - Already in Layer 1
2. `src/prompt/templates/platform/base.md` - Already in Layer 1
3. `src/prompt/templates/agents/kernel.md` - Legacy file preserved
4. `src/prompt/templates/agents/foreground.md` - Legacy file preserved
5. `src/prompt/templates/output/planner.schema.md` - Legacy file preserved
6. `src/prompt/templates/output/memory-candidate.schema.md` - Legacy file preserved
