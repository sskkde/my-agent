# PPTX Generator

## Purpose

This skill provides guidance for generating and reading PowerPoint presentations (.pptx) via the MiniMax Document MCP server. It covers slide creation from structured content and extracting text/data from existing presentations.

## When to Apply

- When the user requests a PowerPoint presentation or slide deck.
- When content needs to be converted into a structured slide format.
- When text or data must be extracted from an existing .pptx file.
- When a presentation template needs to be populated with dynamic content.

## MCP Tools

This skill operates through the following MCP tools:

| Tool | Description |
|------|-------------|
| `pptx.generate` | Generate a .pptx file from structured slide definitions. Returns an artifact reference (fileId, fileName, mimeType, sizeBytes, downloadUrl). |
| `pptx.read` | Read and extract text content from an existing .pptx file. Returns structured slide data. |

### Tool Details

#### pptx.generate

Generates a PowerPoint presentation from structured input.

- **Input**: Slide definitions with titles, content blocks, layouts, and optional styling.
- **Output**: Artifact reference object — `{ fileId, fileName, mimeType, sizeBytes, downloadUrl }`.
- **Timeout**: 60 seconds (generation class).
- **Notes**: Raw binary/base64 is never returned. Download the file via the provided `downloadUrl`.

#### pptx.read

Reads text and structure from an existing PowerPoint file.

- **Input**: File reference (fileId or path).
- **Output**: Structured JSON with slide titles, text content, and layout metadata.
- **Timeout**: 30 seconds (standard class).

## Execution Model

All operations are performed through MCP tool calls. This skill does not contain executable code, shell commands, or scripts. The agent invokes MCP tools via the tool plane; the MCP server handles file generation and parsing in its sandboxed workspace.

## Boundaries

- **No shell execution**: This skill does not execute shell commands, scripts, or system calls.
- **No direct file I/O**: File operations happen inside the MCP server sandbox.
- **Artifact references only**: Generation tools return file references, not raw binary data.
- **Documentation-only**: This skill provides guidance text for the LLM. All execution is delegated to MCP tools.
