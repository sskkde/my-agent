/**
 * MiniMax Document MCP Server
 *
 * MCP server for document generation and processing (XLSX, PPTX, PDF, DOCX).
 * Provides tools for reading, validating, and generating document artifacts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readXlsx, validateXlsx } from "./tools/xlsx.js";
import { registerPptxTools } from "./tools/pptx.js";
import {
  createWorkspace,
  cleanupWorkspace,
  withTimeout,
  getTimeoutMs,
  isSandboxError,
  createSandboxError,
  type SandboxErrorResponse,
} from "./sandbox.js";

const server = new McpServer({
  name: "minimax-document-mcp",
  version: "0.1.0",
});

// ---------------------------------------------------------------------------
// Helper: Run tool in sandboxed workspace
// ---------------------------------------------------------------------------

async function runInSandbox<T>(
  fn: (workspaceRoot: string) => Promise<T>,
): Promise<T> {
  const workspace = await createWorkspace("mcp-tool");
  try {
    return await fn(workspace.root);
  } finally {
    await cleanupWorkspace(workspace);
  }
}

function formatSandboxError(error: unknown): { isError: boolean; content: Array<{ type: "text"; text: string }> } {
  if (isSandboxError(error)) {
    const sandboxErr = error as SandboxErrorResponse;
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify(sandboxErr, null, 2),
      }],
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  const structuredError = createSandboxError('workspace_error', `Internal error: ${message}`);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredError, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Tool: xlsx.read
// ---------------------------------------------------------------------------

const XlsxReadInputSchema = {
  inputPath: z.string().describe("Path to XLSX file within the workspace"),
  sheetName: z.string().optional().describe("Specific sheet to read. If omitted, reads the first sheet."),
  range: z.string().optional().describe("Cell range in A1 notation (e.g., 'A1:D10'). If omitted, reads all data."),
  headerRow: z.number().int().positive().optional().describe("1-indexed row number to use as column headers. Defaults to 1."),
  maxRows: z.number().int().positive().optional().describe("Maximum number of data rows to return. Defaults to 1000."),
};

const XlsxReadOutputSchema = z.object({
  sheetName: z.string(),
  headers: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
  totalRows: z.number(),
  totalColumns: z.number(),
  truncated: z.boolean(),
  sheetNames: z.array(z.string()),
  formulaSummary: z.object({
    totalFormulas: z.number(),
    formulaCells: z.array(z.object({
      sheet: z.string(),
      cell: z.string(),
      formula: z.string(),
    })),
  }),
});

server.registerTool(
  "xlsx.read",
  {
    title: "Read XLSX File",
    description: "Read and extract structured data from an XLSX file. Returns sheet names, column headers, data rows, and formula summary.",
    inputSchema: XlsxReadInputSchema,
    outputSchema: XlsxReadOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async (args) => {
    try {
      const result = await withTimeout(
        () => runInSandbox((workspaceRoot) =>
          readXlsx(
            {
              inputPath: args.inputPath,
              sheetName: args.sheetName,
              range: args.range,
              headerRow: args.headerRow,
              maxRows: args.maxRows,
            },
            workspaceRoot,
          ),
        ),
        getTimeoutMs("fast"),
        "xlsx.read",
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      return formatSandboxError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: xlsx.validate
// ---------------------------------------------------------------------------

const ValidationRuleSchema = z.object({
  column: z.string().describe("Column header name"),
  type: z.enum(["string", "number", "boolean", "date", "email", "url", "required"]).describe("Expected data type or constraint"),
  unique: z.boolean().optional().describe("Whether values must be unique"),
  min: z.number().optional().describe("Minimum value (for numbers)"),
  max: z.number().optional().describe("Maximum value (for numbers)"),
  pattern: z.string().optional().describe("Regex pattern for string validation"),
});

const XlsxValidateInputSchema = {
  inputPath: z.string().describe("Path to XLSX file within the workspace"),
  rules: z.array(ValidationRuleSchema).optional().describe("Validation rules to apply"),
  sheetName: z.string().optional().describe("Specific sheet to validate. If omitted, validates the first sheet."),
};

const XlsxValidateOutputSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({
    row: z.number(),
    column: z.string(),
    rule: z.string(),
    value: z.unknown().optional(),
    message: z.string(),
  })),
  summary: z.object({
    totalRows: z.number(),
    totalColumns: z.number(),
    errorCount: z.number(),
    columnsValidated: z.array(z.string()),
  }),
});

server.registerTool(
  "xlsx.validate",
  {
    title: "Validate XLSX File",
    description: "Validate an XLSX file's structure and content against a set of rules. Returns validation errors and summary.",
    inputSchema: XlsxValidateInputSchema,
    outputSchema: XlsxValidateOutputSchema,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async (args) => {
    try {
      const result = await withTimeout(
        () => runInSandbox((workspaceRoot) =>
          validateXlsx(
            {
              inputPath: args.inputPath,
              rules: args.rules as import("./tools/xlsx.js").ValidationRule[] | undefined,
              sheetName: args.sheetName,
            },
            workspaceRoot,
          ),
        ),
        getTimeoutMs("fast"),
        "xlsx.validate",
      );

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      return formatSandboxError(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Tools: pptx.generate, pptx.read
// ---------------------------------------------------------------------------

registerPptxTools(server);

// ---------------------------------------------------------------------------
// Deferred Tools: pdf.generate, docx.generate
//
// These tools are contract stubs only. They return a structured deferred_tool
// error at runtime. Implementation requires Python + reportlab/python-docx
// or .NET SDK + DocumentFormat.OpenXml, which are not included in the MVP.
// ---------------------------------------------------------------------------

server.registerTool(
  "pdf.generate",
  {
    title: "Generate PDF Document",
    description: "Generate a PDF document from structured content including text, tables, and formatted layouts. [DEFERRED: requires Python + reportlab or .NET runtime]",
    inputSchema: {
      title: z.string().describe("Document title"),
      content: z.string().describe("Document content (markdown)"),
      fileName: z.string().optional().describe("Output file name"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async () => {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "failed",
          error: {
            code: "deferred_tool",
            message: "pdf.generate is not yet implemented. Requires Python + reportlab or .NET + DocumentFormat.OpenXml runtime.",
            recoverable: false,
          },
        }, null, 2),
      }],
    };
  },
);

server.registerTool(
  "docx.generate",
  {
    title: "Generate DOCX Document",
    description: "Generate a Word document (.docx) from structured content including text, headings, lists, and tables. [DEFERRED: requires Python + python-docx or .NET runtime]",
    inputSchema: {
      title: z.string().describe("Document title"),
      content: z.string().describe("Document content (markdown)"),
      fileName: z.string().optional().describe("Output file name"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async () => {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          status: "failed",
          error: {
            code: "deferred_tool",
            message: "docx.generate is not yet implemented. Requires Python + python-docx or .NET + DocumentFormat.OpenXml runtime.",
            recoverable: false,
          },
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("minimax-document-mcp server started on stdio");
}

main().catch((error: unknown) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});

export { server };
