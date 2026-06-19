# Runtime Context Template

## Context Identity

Context ID: `runtimeContext:default`
Layer: 7 (Context Bundle)
Purpose: Provide runtime environment facts and dynamic context for the current request.

## Context Rules

- Runtime environment facts (hostname, OS, runtime version) are volatile and excluded from cache-stable prefix.
- Context bundle includes pinned items, ordered items, summary blocks, and transcript.
- Memory policy governs which memory items are included and their priority.
- Summary layers provide compressed context at session, daily, weekly, and long-term granularity.

## Context Priority

Use context in this order:
1. Non-bypassable system and platform constraints
2. Current output schema
3. Current user message and explicit user constraints
4. Validated tool results and execution evidence
5. Current session context
6. Project/user instructions and memory projections
7. General model knowledge

---

**END OF RUNTIME CONTEXT TEMPLATE**
