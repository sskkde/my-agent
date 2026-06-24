# Session Status

## Purpose

This skill provides guidance for querying and reporting session status, progress, and state information. It helps the agent understand where it is in a task, what has been completed, and what remains.

## When to Apply

- When the user asks about current progress or task state.
- When determining whether a task is complete or needs continuation.
- When reporting status to the user or to a parent workflow.

## Guidelines

### Status Queries

- Identify the session or run ID being queried.
- Report active, completed, and failed steps clearly.
- Include timestamps and durations when available.

### Progress Reporting

- Summarize completed work, in-progress work, and pending work.
- Use structured formats (bullet lists, tables) for multi-step status.
- Flag blockers or dependencies that prevent progress.

### State Introspection

- Distinguish between session-level state and task-level state.
- Note any approval gates or permission requirements.
- Report resource usage (token budget, API calls) when relevant.

## Boundaries

This skill is documentation-only. It does not execute status queries, database reads, or API calls. All actual status operations are performed by tools in the tool plane.