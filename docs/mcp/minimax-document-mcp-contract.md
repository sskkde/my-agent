# MiniMax Document MCP Contract

**Version:** 1.0.0
**Status:** Draft
**Last Updated:** 2026-06-24

This contract defines the MCP tool interface for MiniMax document generation and reading tools. It covers tool names, JSON schemas, artifact handling, timeout classes, error codes, and the format rollout plan.

---

## 1. Transport Layer

The MiniMax document tools are exposed through the standard MCP tool bridge transport defined in `src/connectors/mcp/mcp-tool-bridge.ts`.

### Transport Interface

```typescript
interface McpToolTransport {
  listTools(): Promise<MCPToolDescriptor[]> | MCPToolDescriptor[]
  callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> | unknown
}
```

### Descriptor-to-Tool Mapping

The bridge maps each `MCPToolDescriptor` to a `ToolDefinition`:

- **Name**: `mcp_{serverId}_{toolName}` after tool-name sanitization (e.g., `mcp_minimax-document-mcp_xlsx_read`)
- **Category**: `write` if `destructiveHint` is set, otherwise `read`
- **Sensitivity**: `high` if `destructiveHint` is set, otherwise `medium`
- **requiresPermission**: `true` unless `readOnlyHint` is set
- **idempotent**: from `idempotentHint`, defaults to `false`

### Normalized Response

All tool responses pass through `normalizeConnectorResponse`, producing a `NormalizedConnectorResult` with status: `completed`, `waiting`, `denied`, `failed`, `timeout`, or `cancelled`.

---

## 2. Tool Catalog

### Overview

| Tool Name | Category | Sensitivity | Status | Description |
|-----------|----------|-------------|--------|-------------|
| `xlsx.read` | read | medium | **MVP** | Read and extract data from XLSX files |
| `xlsx.validate` | read | medium | **MVP** | Validate XLSX structure and content |
| `pptx.generate` | write | high | **MVP** | Generate PPTX presentations from structured input |
| `pptx.read` | read | medium | **MVP** | Read and extract content from PPTX files |
| `pdf.generate` | write | high | **Deferred** | Generate PDF documents |
| `docx.generate` | write | high | **Deferred** | Generate DOCX documents |

### Naming Convention

MCP raw tool names use dot notation: `{format}.{action}`. When bridged into the platform tool registry, `McpToolBridge` prefixes `mcp.{serverId}.` and sanitizes the result, so `xlsx.read` on `minimax-document-mcp` becomes `mcp_minimax-document-mcp_xlsx_read`.

---

## 3. Tool Schemas

### 3.1 `xlsx.read`

Read and extract data from an XLSX file.

**Annotations:**
- `readOnlyHint: true`
- `idempotentHint: true`

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "inputPath": {
      "type": "string",
      "description": "Path to an XLSX file inside the MCP sandbox workspace"
    },
    "sheetName": {
      "type": "string",
      "description": "Specific sheet to read. If omitted, reads the first sheet."
    },
    "range": {
      "type": "string",
      "description": "Cell range in A1 notation (e.g., 'A1:D10'). If omitted, reads all data."
    },
    "headerRow": {
      "type": "number",
      "description": "1-indexed row number to use as column headers. Defaults to 1."
    },
    "maxRows": {
      "type": "number",
      "description": "Maximum number of data rows to return. Defaults to 1000."
    }
  },
  "required": ["inputPath"]
}
```

**Output Schema:**

```json
{
  "type": "object",
  "properties": {
    "sheetName": {
      "type": "string",
      "description": "Name of the sheet that was read"
    },
    "headers": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Column header names"
    },
    "rows": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": true
      },
      "description": "Data rows as objects keyed by header name"
    },
    "totalRows": {
      "type": "number",
      "description": "Total row count in the sheet (before maxRows truncation)"
    },
    "totalColumns": {
      "type": "number",
      "description": "Total column count in the sheet"
    },
    "truncated": {
      "type": "boolean",
      "description": "True if rows were truncated by maxRows limit"
    }
  },
  "required": ["sheetName", "headers", "rows", "totalRows", "totalColumns"]
}
```

---

### 3.2 `xlsx.validate`

Validate an XLSX file's structure and content against a set of rules.

**Annotations:**
- `readOnlyHint: true`
- `idempotentHint: true`

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "inputPath": {
      "type": "string",
      "description": "Path to an XLSX file inside the MCP sandbox workspace"
    },
    "rules": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "column": { "type": "string", "description": "Column header name" },
          "type": {
            "type": "string",
            "enum": ["string", "number", "boolean", "date", "email", "url", "required"],
            "description": "Expected data type or constraint"
          },
          "unique": { "type": "boolean", "description": "Whether values must be unique" },
          "min": { "type": "number", "description": "Minimum value (for numbers)" },
          "max": { "type": "number", "description": "Maximum value (for numbers)" },
          "pattern": { "type": "string", "description": "Regex pattern for string validation" }
        },
        "required": ["column", "type"]
      },
      "description": "Validation rules to apply"
    },
    "sheetName": {
      "type": "string",
      "description": "Specific sheet to validate. If omitted, validates the first sheet."
    }
  },
  "required": ["inputPath"]
}
```

**Output Schema:**

```json
{
  "type": "object",
  "properties": {
    "valid": {
      "type": "boolean",
      "description": "True if all validation rules passed"
    },
    "errors": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "row": { "type": "number", "description": "1-indexed row number of the error" },
          "column": { "type": "string", "description": "Column name where the error occurred" },
          "rule": { "type": "string", "description": "The validation rule that was violated" },
          "value": { "description": "The actual value that failed validation" },
          "message": { "type": "string", "description": "Human-readable error description" }
        },
        "required": ["row", "column", "rule", "message"]
      },
      "description": "List of validation errors. Empty if valid."
    },
    "summary": {
      "type": "object",
      "properties": {
        "totalRows": { "type": "number" },
        "totalColumns": { "type": "number" },
        "errorCount": { "type": "number" },
        "columnsValidated": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["totalRows", "totalColumns", "errorCount"]
    }
  },
  "required": ["valid", "errors", "summary"]
}
```

---

### 3.3 `pptx.generate`

Generate a PPTX presentation from structured slide definitions.

**Annotations:**
- `destructiveHint: true`
- `idempotentHint: false`

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Presentation title"
    },
    "slides": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "layout": {
            "type": "string",
            "enum": ["title", "titleAndContent", "twoColumn", "blank", "comparison", "sectionHeader"],
            "description": "Slide layout template"
          },
          "title": { "type": "string", "description": "Slide title text" },
          "subtitle": { "type": "string", "description": "Slide subtitle text (for title layout)" },
          "content": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Bullet point content lines"
          },
          "notes": { "type": "string", "description": "Speaker notes for this slide" },
          "leftContent": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Left column content (for twoColumn/comparison layouts)"
          },
          "rightContent": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Right column content (for twoColumn/comparison layouts)"
          }
        },
        "required": ["layout"]
      },
      "minItems": 1,
      "description": "Array of slide definitions"
    },
    "template": {
      "type": "string",
      "description": "Optional template name or ID to apply styling"
    },
    "outputFileName": {
      "type": "string",
      "description": "Desired output filename (e.g., 'report.pptx'). Defaults to 'presentation.pptx'."
    }
  },
  "required": ["title", "slides"]
}
```

**Output Schema:**

```json
{
  "type": "object",
  "properties": {
    "artifact": {
      "type": "object",
      "properties": {
        "fileId": { "type": "string", "description": "MCP artifact file ID for the generated PPTX" },
        "fileName": { "type": "string", "description": "Name of the generated file" },
        "mimeType": { "type": "string", "description": "MIME type (application/vnd.openxmlformats-officedocument.presentationml.presentation)" },
        "sizeBytes": { "type": "number", "description": "File size in bytes" },
        "downloadUrl": { "type": "string", "description": "Artifact retrieval URL/reference exposed by the MCP artifact store" }
      },
      "required": ["fileId", "fileName", "mimeType", "sizeBytes", "downloadUrl"]
    },
    "slideCount": {
      "type": "number",
      "description": "Number of slides generated"
    },
    "warnings": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Non-fatal warnings (e.g., unsupported layout fallback)"
    }
  },
  "required": ["artifact", "slideCount"]
}
```

---

### 3.4 `pptx.read`

Read and extract content from a PPTX file.

**Annotations:**
- `readOnlyHint: true`
- `idempotentHint: true`

**Input Schema:**

```json
{
  "type": "object",
  "properties": {
    "fileId": {
      "type": "string",
      "description": "MCP artifact file ID from a previous pptx.generate response"
    },
    "includeNotes": {
      "type": "boolean",
      "description": "Whether to include speaker notes. Defaults to false."
    },
    "slideRange": {
      "type": "string",
      "description": "Slide range (e.g., '1-5', '1,3,7'). If omitted, reads all slides."
    }
  },
  "required": ["fileId"]
}
```

**Output Schema:**

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Presentation title from file metadata"
    },
    "slides": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "slideNumber": { "type": "number", "description": "1-indexed slide number" },
          "title": { "type": "string", "description": "Slide title text" },
          "content": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Extracted text content lines"
          },
          "notes": { "type": "string", "description": "Speaker notes (if requested)" }
        },
        "required": ["slideNumber", "content"]
      },
      "description": "Extracted slide content"
    },
    "totalSlides": {
      "type": "number",
      "description": "Total number of slides in the presentation"
    }
  },
  "required": ["slides", "totalSlides"]
}
```

---

### 3.5 `pdf.generate` (Deferred)

Generate a PDF document from structured content.

**Status:** Deferred. Runtime not implemented in MVP. Contract stub provided for forward compatibility.

**Annotations:**
- `destructiveHint: true`
- `idempotentHint: false`

**Input Schema (Stub):**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": ["heading", "paragraph", "table", "image", "pageBreak", "list"],
            "description": "Content block type"
          },
          "text": { "type": "string", "description": "Text content for heading/paragraph/list items" },
          "level": { "type": "number", "description": "Heading level 1-6 (for heading type)" },
          "rows": {
            "type": "array",
            "items": {
              "type": "array",
              "items": { "type": "string" }
            },
            "description": "Table data as array of row arrays"
          },
          "fileId": { "type": "string", "description": "MCP artifact ID (for image type)" },
          "style": { "type": "string", "enum": ["bullet", "numbered"], "description": "List style (for list type)" }
        },
        "required": ["type"]
      },
      "minItems": 1,
      "description": "Ordered content blocks"
    },
    "outputFileName": {
      "type": "string",
      "description": "Desired output filename. Defaults to 'document.pdf'."
    },
    "pageSize": {
      "type": "string",
      "enum": ["A4", "Letter", "Legal"],
      "description": "Page size. Defaults to 'A4'."
    }
  },
  "required": ["content"]
}
```

**Output Schema (Stub):**

```json
{
  "type": "object",
  "properties": {
    "artifact": {
      "type": "object",
      "properties": {
        "fileId": { "type": "string" },
        "fileName": { "type": "string" },
        "mimeType": { "type": "string" },
        "sizeBytes": { "type": "number" },
        "downloadUrl": { "type": "string" }
      },
      "required": ["fileId", "fileName", "mimeType", "sizeBytes", "downloadUrl"]
    },
    "pageCount": { "type": "number" }
  },
  "required": ["artifact", "pageCount"]
}
```

---

### 3.6 `docx.generate` (Deferred)

Generate a DOCX document from structured content.

**Status:** Deferred. Runtime not implemented in MVP. Contract stub provided for forward compatibility.

**Annotations:**
- `destructiveHint: true`
- `idempotentHint: false`

**Input Schema (Stub):**

```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": ["heading", "paragraph", "table", "image", "pageBreak", "list", "codeBlock"],
            "description": "Content block type"
          },
          "text": { "type": "string", "description": "Text content" },
          "level": { "type": "number", "description": "Heading level 1-6" },
          "rows": {
            "type": "array",
            "items": {
              "type": "array",
              "items": { "type": "string" }
            },
            "description": "Table data"
          },
          "fileId": { "type": "string", "description": "MCP artifact ID for images" },
          "style": { "type": "string", "enum": ["bullet", "numbered"], "description": "List style" },
          "language": { "type": "string", "description": "Code language (for codeBlock type)" }
        },
        "required": ["type"]
      },
      "minItems": 1,
      "description": "Ordered content blocks"
    },
    "outputFileName": {
      "type": "string",
      "description": "Desired output filename. Defaults to 'document.docx'."
    },
    "template": {
      "type": "string",
      "description": "Optional template name or ID"
    }
  },
  "required": ["content"]
}
```

**Output Schema (Stub):**

```json
{
  "type": "object",
  "properties": {
    "artifact": {
      "type": "object",
      "properties": {
        "fileId": { "type": "string" },
        "fileName": { "type": "string" },
        "mimeType": { "type": "string" },
        "sizeBytes": { "type": "number" },
        "downloadUrl": { "type": "string" }
      },
      "required": ["fileId", "fileName", "mimeType", "sizeBytes", "downloadUrl"]
    },
    "pageCount": { "type": "number" }
  },
  "required": ["artifact", "pageCount"]
}
```

---

## 4. Artifact Policy

### Core Principle

Generated documents are returned as **file references**, not as raw binary or base64 data in the tool response.

### Artifact Object

Every generation tool (`pptx.generate`, `pdf.generate`, `docx.generate`) returns an `artifact` object:

| Field | Type | Description |
|-------|------|-------------|
| `fileId` | string | MCP artifact ID. Use this as the stable reference for later MCP document-read calls. |
| `fileName` | string | Suggested filename including extension. |
| `mimeType` | string | MIME type of the generated file. |
| `sizeBytes` | number | File size in bytes. |
| `downloadUrl` | string | Artifact retrieval URL/reference exposed by the MCP artifact store. |

### Download Flow

```
1. Tool call returns artifact.fileId
2. Later MCP tool calls pass the artifact.fileId when they need to read the generated document
3. If an HTTP artifact adapter is configured, downloadUrl can be resolved by that adapter; otherwise it is a stable reference, not raw binary content
```

### Size Limits

| Constraint | Value | Source |
|------------|-------|--------|
| Max file size | 10 MiB (10,485,760 bytes) | `UPLOAD_MAX_FILE_SIZE_BYTES` |
| Max attachments per message | 5 | `UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE` |
| Per-session quota | 100 MiB (104,857,600 bytes) | `UPLOAD_PER_SESSION_QUOTA_BYTES` |
| Allowed extensions | `.txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf` | `UPLOAD_ALLOWED_EXTENSIONS` |

### Why No Raw Binary in Response

- MCP tool responses are JSON. Base64 encoding a 10 MiB PPTX would produce ~14 MiB of JSON text, blowing context windows.
- The MCP artifact store keeps binary bytes outside model-visible text while preserving a stable reference for follow-up tools.
- File references compose cleanly with the existing session attachment system.

### XLSX Read Output Exception

`xlsx.read` and `xlsx.validate` return structured JSON data (headers + rows), not file artifacts. This is intentional. The data is small enough for JSON and more useful as structured content than as a file reference.

---

## 5. Timeout Classes

| Class | Duration | Applicable Tools | Rationale |
|-------|----------|------------------|-----------|
| **Fast** | 10s | `xlsx.read`, `xlsx.validate` | Pure in-memory parsing, no external calls |
| **Standard** | 30s | `pptx.read` | File parsing with potential image extraction |
| **Generation** | 60s | `pptx.generate` | Template rendering and file assembly |
| **Heavy** | 120s | `pdf.generate`, `docx.generate` | Complex layout engine (when implemented) |

Timeout is configured via `McpToolBridgeOptions.timeoutMs` and can be overridden per-tool in the connector instance configuration.

When a timeout fires, the bridge creates a synthetic `ConnectorResponse` with `status: 'timeout'` and `error.code: 'connector_timeout'`. The normalizer maps this to a `NormalizedConnectorResult` with `status: 'timeout'` and `recoverability: 'retryable_later'`.

---

## 6. Error Codes

All errors flow through `normalizeConnectorResponse` and map to `NormalizedConnectorResult.error.code`.

### Tool-Specific Errors

| Code | Status | Recoverable | Description | Applicable Tools |
|------|--------|-------------|-------------|------------------|
| `file_not_found` | failed | no | The provided `fileId` or sandbox input path does not exist or was deleted | All read tools |
| `file_too_large` | failed | no | Input file exceeds the 10 MiB limit | All read tools |
| `unsupported_format` | failed | no | File is not a valid XLSX/PPTX/PDF/DOCX | All read tools |
| `sheet_not_found` | failed | no | Named sheet does not exist in the workbook | `xlsx.read`, `xlsx.validate` |
| `invalid_range` | failed | no | A1 notation range is malformed or out of bounds | `xlsx.read` |
| `validation_rule_error` | failed | no | A validation rule references a column that doesn't exist | `xlsx.validate` |
| `generation_failed` | failed | varies | Internal error during document generation | All generate tools |
| `template_not_found` | failed | no | Referenced template does not exist | `pptx.generate`, `docx.generate` |
| `quota_exceeded` | failed | no | Session storage quota (100 MiB) would be exceeded | All generate tools |
| `invalid_slide_range` | failed | no | Slide range string is malformed | `pptx.read` |
| `deferred_tool` | failed | no | Tool is in deferred status, not yet implemented | `pdf.generate`, `docx.generate` |

### System Errors (from `normalizeConnectorResponse`)

| Code | Status | Recoverable | Category |
|------|--------|-------------|----------|
| `connector_timeout` | timeout | yes | timeout |
| `service_unavailable` | failed | yes | system_internal_error |
| `internal_error` | failed | yes | system_internal_error |
| `connection_failed` | failed | yes | system_internal_error |
| `rate_limited` | failed | yes | connector_rate_limited |
| `invalid_credentials` | failed | yes | connector_auth_error |
| `permission_denied` | denied | varies | permission_error |

### Error Response Shape

Every error follows the normalized shape:

```json
{
  "status": "failed",
  "error": {
    "code": "file_not_found",
    "message": "File with ID 'abc-123' not found",
    "recoverable": false,
    "category": "tool_validation_error"
  },
  "recoverability": "non_recoverable",
  "metadata": {
    "sensitivity": "medium"
  }
}
```

---

## 7. Format Rollout Plan

### Phase 1: MVP (Current)

| Tool | Status | Notes |
|------|--------|-------|
| `xlsx.read` | Active | Full implementation |
| `xlsx.validate` | Active | Full implementation |
| `pptx.generate` | Active | Full implementation with basic layouts |
| `pptx.read` | Active | Full implementation |
| `pdf.generate` | **Deferred** | Contract stub only. Returns `deferred_tool` error at runtime. |
| `docx.generate` | **Deferred** | Contract stub only. Returns `deferred_tool` error at runtime. |

### Phase 2: PDF Support

- Implement `pdf.generate` runtime
- Content blocks: heading, paragraph, table, image, pageBreak, list
- Page size support: A4, Letter, Legal
- Estimated complexity: Medium (layout engine needed)

### Phase 3: DOCX Support

- Implement `docx.generate` runtime
- Same content block model as PDF, plus codeBlock with syntax highlighting
- Template support for corporate branding
- Estimated complexity: Medium-High (template engine needed)

### Deferred Tool Behavior

When a deferred tool is called, the bridge returns:

```json
{
  "status": "failed",
  "error": {
    "code": "deferred_tool",
    "message": "pdf.generate is not yet implemented. See contract docs/mcp/minimax-document-mcp-contract.md for the planned schema.",
    "recoverable": false,
    "category": "tool_validation_error"
  },
  "recoverability": "non_recoverable"
}
```

This allows downstream code to handle the error gracefully and display a "coming soon" message to users.

---

## 8. MCPToolDescriptor Mapping

Each tool maps to an `MCPToolDescriptor` as follows:

| Tool | name | readOnlyHint | destructiveHint | idempotentHint | category |
|------|------|-------------|-----------------|----------------|----------|
| `xlsx.read` | `xlsx.read` | true | false | true | read |
| `xlsx.validate` | `xlsx.validate` | true | false | true | read |
| `pptx.generate` | `pptx.generate` | false | true | false | write |
| `pptx.read` | `pptx.read` | true | false | true | read |
| `pdf.generate` | `pdf.generate` | false | true | false | write |
| `docx.generate` | `docx.generate` | false | true | false | write |

When bridged with server ID `minimax`, the platform tool names become:
- `minimax_xlsx.read`
- `minimax_xlsx.validate`
- `minimax_pptx.generate`
- `minimax_pptx.read`
- `minimax_pdf.generate`
- `minimax_docx.generate`

---

## 9. Schema Validation

The contract includes a validation script at `tests/contracts/validate-minimax-document-mcp.mjs` that verifies:

1. All schema examples in this document are valid JSON
2. Required fields are present in each schema
3. Deferred tools have matching input/output schema stubs
4. Error codes follow the naming convention (snake_case)

Run with:

```bash
node tests/contracts/validate-minimax-document-mcp.mjs
```

---

## 10. References

- `src/connectors/mcp/mcp-tool-bridge.ts` - Transport interface and descriptor-to-tool mapping
- `src/connectors/types.ts` - `MCPToolDescriptor` interface
- `src/connectors/runtime/connector-response-normalizer.ts` - Response normalization and error mapping
- `README.md` - File upload API and size/quota configuration
- `docs/deployment/env-reference.md` - Environment variable documentation
