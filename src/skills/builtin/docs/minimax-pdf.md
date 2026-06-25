# MiniMax PDF

## Purpose

This skill provides guidance for generating PDF documents via the MiniMax Document MCP server. It covers PDF creation from structured content including text, headings, tables, and formatted layouts.

## When to Apply

- When the user requests a PDF document.
- When content needs to be rendered as a portable, print-ready format.
- When a report, invoice, or formal document must be generated as PDF.
- When document fidelity across platforms is required.

## MCP Tools

This skill operates through the following MCP tools:

| Tool | Description |
|------|-------------|
| `pdf.generate` | Generate a PDF file from structured document definitions. Returns an artifact reference. |

### Tool Details

#### pdf.generate

Generates a PDF document from structured input.

- **Input**: Document definition with title, sections, content blocks, tables, and optional styling.
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
