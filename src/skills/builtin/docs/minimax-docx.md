# MiniMax DOCX

## Purpose

This skill provides guidance for generating Word documents (.docx) via the MiniMax Document MCP server. It covers document creation from structured content including text, headings, lists, and tables.

## When to Apply

- When the user requests a Word document or report.
- When structured content needs to be formatted as a .docx file.
- When a document template must be populated with dynamic content.
- When formal documentation (proposals, contracts, reports) is required.

## MCP Tools

This skill operates through the following MCP tools:

| Tool | Description |
|------|-------------|
| `docx.generate` | Generate a .docx file from structured document definitions. Returns an artifact reference. |

### Tool Details

#### docx.generate

Generates a Word document from structured input.

- **Input**: Document definition with title, sections, paragraphs, headings, lists, and optional tables.
- **Output**: Artifact reference object — `{ fileId, fileName, mimeType, sizeBytes, downloadUrl }`.
- **Timeout**: 60 seconds (generation class).
- **Status**: Deferred — this tool is defined in the MCP contract but not yet implemented. Invoking it returns a `deferred_tool` error.

## Execution Model

All operations are performed through MCP tool calls. This skill does not contain executable code, shell commands, or scripts. The agent invokes MCP tools via the tool plane; the MCP server handles file generation in its sandboxed workspace.

## Boundaries

- **No shell execution**: This skill does not execute shell commands, scripts, or system calls.
- **No direct file I/O**: File operations happen inside the MCP server sandbox.
- **Artifact references only**: Generation tools return file references, not raw binary data.
- **Documentation-only**: This skill provides guidance text for the LLM. All execution is delegated to MCP tools.
