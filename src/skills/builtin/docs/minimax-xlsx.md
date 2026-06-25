# MiniMax XLSX

## Purpose

This skill provides guidance for reading and validating Excel spreadsheets (.xlsx) via the MiniMax Document MCP server. It covers extracting structured data from spreadsheets and validating file integrity.

## When to Apply

- When the user requests data extraction from an Excel file.
- When spreadsheet content needs to be parsed into structured JSON.
- When an .xlsx file requires validation before processing.
- When tabular data must be read for analysis or transformation.

## MCP Tools

This skill operates through the following MCP tools:

| Tool | Description |
|------|-------------|
| `xlsx.read` | Read and extract data from an .xlsx file. Returns headers and rows as structured JSON. |
| `xlsx.validate` | Validate an .xlsx file for structural integrity and format compliance. Returns validation status. |

### Tool Details

#### xlsx.read

Reads structured data from an Excel spreadsheet.

- **Input**: File reference (fileId or path), optional sheet name or index, optional row range.
- **Output**: Structured JSON — `{ headers: string[], rows: unknown[][], sheetName: string, totalRows: number }`.
- **Timeout**: 30 seconds (standard class).
- **Notes**: Returns structured data, not file references. Supports multi-sheet workbooks via sheet selection.

#### xlsx.validate

Validates an Excel file for format compliance.

- **Input**: File reference (fileId or path).
- **Output**: Validation result — `{ valid: boolean, errors?: string[], warnings?: string[] }`.
- **Timeout**: 10 seconds (fast class).

## Execution Model

All operations are performed through MCP tool calls. This skill does not contain executable code, shell commands, or scripts. The agent invokes MCP tools via the tool plane; the MCP server handles file parsing and validation in its sandboxed workspace.

## Boundaries

- **No shell execution**: This skill does not execute shell commands, scripts, or system calls.
- **No direct file I/O**: File operations happen inside the MCP server sandbox.
- **Structured data output**: Read operations return JSON data, not file artifacts.
- **Documentation-only**: This skill provides guidance text for the LLM. All execution is delegated to MCP tools.
