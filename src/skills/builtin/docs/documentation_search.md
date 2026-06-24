# Documentation Search

## Purpose

This skill provides guidance for searching internal documentation, knowledge bases, and reference materials. It helps the agent find relevant information from structured and unstructured documentation sources.

## When to Apply

- When the user asks about platform features, APIs, or configuration.
- When a task requires reference to existing documentation or specs.
- When verifying that a proposed approach aligns with documented guidelines.

## Guidelines

### Search Strategy

- Start with specific terms, then broaden if results are insufficient.
- Use category or section filters when the documentation is structured.
- Check multiple documentation sources when the answer spans domains.

### Knowledge Base Queries

- Identify the relevant knowledge base or documentation set.
- Use structured queries when the system supports them (tags, categories).
- Fall back to full-text search when structured queries return no results.

### Reference Lookup

- Cite the source document and section for any referenced information.
- Note version or last-updated dates when available.
- Flag when documentation may be outdated or incomplete.

## Boundaries

This skill is documentation-only. It does not execute search queries, database lookups, or API calls. All actual documentation access is performed by tools in the tool plane.