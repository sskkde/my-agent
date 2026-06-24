# Artifact Workflow

## Purpose

This skill provides guidance for creating, updating, and managing artifacts produced during agent runs. Artifacts are persistent outputs — files, documents, code, or structured data — that survive beyond a single conversation turn.

## When to Apply

- When the user requests creation of a deliverable (document, code file, report).
- When an existing artifact needs updating based on new information.
- When multiple artifacts need coordination within a workflow.

## Guidelines

### Creation

- Identify the artifact type and target location before writing.
- Prefer structured formats (JSON, YAML, Markdown) over opaque binary.
- Include metadata: author, timestamp, version, and purpose.

### Update

- Read the existing artifact before modifying.
- Preserve backward-compatible structure unless explicitly instructed otherwise.
- Record what changed and why in a changelog or commit message.

### Lifecycle

- Artifacts may be referenced by subsequent turns — keep IDs stable.
- Avoid deleting artifacts unless the user explicitly requests removal.
- Large artifacts should be chunked or linked, not inlined in conversation.

## Boundaries

This skill is documentation-only. It does not execute file writes, shell commands, or code. All actual artifact operations are performed by tools in the tool plane.