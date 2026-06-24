# Memory Research

## Purpose

This skill provides guidance for retrieving, searching, and leveraging memory context during agent tasks. Memory includes past conversation transcripts, stored facts, and contextual associations that inform current responses.

## When to Apply

- When the user references prior conversations or past decisions.
- When a task benefits from historical context or accumulated knowledge.
- When verifying consistency with earlier outputs.

## Guidelines

### Retrieval

- Identify the key entities, topics, or time ranges relevant to the query.
- Use targeted search terms rather than broad scans when possible.
- Cross-reference multiple memory sources for accuracy.

### Transcript Search

- Search transcripts by keyword, entity, or temporal window.
- Summarize relevant passages rather than quoting verbatim when possible.
- Note the session ID and timestamp for any cited memory.

### Contextual Recall

- Prioritize recent and directly relevant memories.
- Flag uncertainty when memory is incomplete or ambiguous.
- Avoid fabricating memories — state "no prior context found" when appropriate.

## Boundaries

This skill is documentation-only. It does not execute database queries, API calls, or memory operations. All actual memory access is performed by tools in the tool plane.