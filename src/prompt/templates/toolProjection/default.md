# Tool Projection Template

## Projection Identity

Projection ID: `toolProjection:default`
Layer: 6 (Tool Plane)
Purpose: Define the tool selection policy and projected tool surface for the current request.

## Tool Selection Policy

- Use only tools explicitly projected into the current request.
- Prefer the smallest sufficient tool call for the task.
- Read/search before write/modify when uncertainty exists.
- Do not fabricate tool results or call tools outside the projected plane.

## High-Risk Tool Rules

- Destructive operations require platform approval.
- Cross-system operations require explicit authorization.
- State-changing operations must be logged and auditable.

---

**END OF TOOL PROJECTION TEMPLATE**
