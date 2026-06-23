# Runtime Context Template

<runtime_context>

## Context Identity

Context ID: `runtimeContext:default`
Layer: 7 (Context Bundle)
Purpose: Provide runtime environment facts and dynamic context for the current request.

## Context Rules

- Runtime environment facts (hostname, OS, runtime version) are volatile and excluded from cache-stable prefix.
- Context bundle includes pinned items, ordered items, summary blocks, and transcript.
- Memory policy governs which memory items are included and their priority.
- Summary layers provide compressed context at session, daily, weekly, and long-term granularity.
- Runtime context is lower priority than platform constraints, the active output contract, the current user message, and validated tool results as defined by the Platform Base Template.

---

</runtime_context>
