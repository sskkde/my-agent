# MiniMax Document MCP Server

MCP server for document generation and processing (XLSX, PPTX, PDF, DOCX).

## Overview

This is an external MCP server package that provides document processing capabilities to the agent platform. It runs as a separate process and communicates via the Model Context Protocol (MCP) over stdio.

The server is intentionally isolated from the main agent platform to keep heavy document runtimes out of the main bundle and enable independent deployment.

## Tool Status

### MVP Tools (Implemented)

| Tool | Description | Library | Timeout |
|------|-------------|---------|---------|
| `xlsx.read` | Read XLSX file and extract structured data (headers, rows, formulas) | ExcelJS | 10s |
| `xlsx.validate` | Validate XLSX content against typed rules (string, number, email, URL, etc.) | ExcelJS | 10s |
| `pptx.generate` | Generate PowerPoint presentations from slide definitions | pptxgenjs | 60s |
| `pptx.read` | Read PPTX file and extract text content, speaker notes | JSZip | 30s |

### Deferred Tools (Stubbed)

| Tool | Description | Planned Runtime | Status |
|------|-------------|-----------------|--------|
| `pdf.generate` | Generate PDF documents | Python + reportlab or .NET | Contract stub only. Returns `deferred_tool` error at runtime. |
| `docx.generate` | Generate Word documents | Python + python-docx or .NET | Contract stub only. Returns `deferred_tool` error at runtime. |

PDF and DOCX generation require additional runtimes (Python with reportlab/python-docx, or .NET SDK with DocumentFormat.OpenXml). These are not included in the current MVP. The MCP server will return a structured `deferred_tool` error if either tool is invoked.

## Prerequisites

- **Node.js** >= 20.0.0
- **npm** (comes with Node.js)

No Python, .NET SDK, or Playwright/Chromium installation is required for the current MVP tools.

## Local Development

### Install Dependencies

```bash
cd mcp-servers/minimax-document-mcp
npm install
```

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/` using `tsc`. Output includes `.js`, `.d.ts`, and `.js.map` files.

### Type Check

```bash
npm run typecheck
```

Runs `tsc --noEmit` to verify types without producing output.

### Run Tests

```bash
npm test
```

Runs all tests via Vitest (46 sandbox tests + 26 XLSX tests + 21 PPTX tests). Test files live alongside source in `src/` and `tests/`.

### Watch Mode

```bash
npm run dev
```

Starts `tsc --watch` for incremental rebuilds during development.

### Clean

```bash
npm run clean
```

Removes the `dist/` directory.

## Running the MCP Server

### Local Smoke Test

After building, the server starts on stdio and waits for MCP protocol messages:

```bash
# Build first
npm run build

# Start the server (reads from stdin, writes to stdout)
node dist/index.js
```

The server prints `minimax-document-mcp server started on stdio` to stderr when ready. It will block waiting for MCP protocol messages on stdin. Press `Ctrl+C` to stop.

### Dry-Run Verification

To verify the server binary loads without errors:

```bash
# Build and immediately kill after confirming it starts
npm run build && timeout 2 node dist/index.js 2>&1 || true
```

Expected output includes `minimax-document-mcp server started on stdio` on stderr.

### Running Tests Only

```bash
# All tests
npm test

# Specific test file
npx vitest run src/tools/xlsx.test.ts

# Watch mode for tests
npm run test:watch
```

## Dependency Check

### Verify Node Dependencies

```bash
# Check for missing or outdated packages
npm ls

# Check for vulnerabilities
npm audit

# Verify all dependencies resolve
npm ls --all
```

### Verify Build Output

```bash
# Confirm dist/ exists and has compiled files
ls dist/index.js dist/index.d.ts

# Verify the entry point loads
node -e "import('./dist/index.js').then(() => console.log('OK')).catch(e => console.error('FAIL:', e.message))"
```

### Runtime Dependency Matrix

| Dependency | Version | Purpose | Required For |
|------------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.12.1 | MCP protocol implementation | All tools |
| `exceljs` | ^4.4.0 | XLSX reading and parsing | `xlsx.read`, `xlsx.validate` |
| `jszip` | ^3.10.1 | ZIP extraction (PPTX files are ZIP archives) | `pptx.read` |
| `pptxgenjs` | ^4.0.1 | PowerPoint presentation generation | `pptx.generate` |
| `zod` | ^4.4.3 | Input/output schema validation | All tools |

### Future Runtime Dependencies (Deferred)

These are NOT installed in the current MVP. They will be added when PDF/DOCX tools are implemented.

| Runtime | Packages | Tools |
|---------|----------|-------|
| Python 3.x | `reportlab`, `pypdf` | `pdf.generate` |
| Python 3.x | `python-docx` | `docx.generate` |
| .NET SDK 6+ | `DocumentFormat.OpenXml` | Alternative for `docx.generate` |
| Playwright + Chromium | `playwright-core`, Chromium binary | PDF rendering (if browser-based approach chosen) |

### Dev Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `typescript` | ^5.9.3 | TypeScript compiler |
| `vitest` | ^4.1.8 | Test runner |
| `@types/node` | ^20.19.39 | Node.js type definitions |

## MCP Registration

To register this MCP server with the agent platform, add an entry to the MCP server registry. The platform uses the `McpServerRegistry` to discover and connect to MCP servers.

### Programmatic Registration

```typescript
import { createMcpServerRegistry } from '../src/connectors/mcp/mcp-server-registry.js'
import { createConnectionManager } from '../src/storage/connection.js'

const connection = createConnectionManager(':memory:')
connection.open()

const registry = createMcpServerRegistry(connection)

registry.registerServer({
  serverId: 'minimax-document-mcp',
  name: 'MiniMax Document MCP',
  version: '0.1.0',
  description: 'MCP server for document generation and processing (XLSX, PPTX)',
  baseUrl: 'stdio://minimax-document-mcp',
  configType: 'stdio',
  command: 'node',
  args: ['mcp-servers/minimax-document-mcp/dist/index.js'],
  capabilities: ['xlsx.read', 'xlsx.validate', 'pptx.generate', 'pptx.read'],
  supportedFormats: ['xlsx', 'pptx'],
  trustLevel: 'verified',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})
```

### Tool Name Mapping

After registration, the platform's MCP Tool Bridge discovers and exposes tools with prefixed names:

| MCP Tool Name | Bridged Tool Name |
|---------------|-------------------|
| `xlsx.read` | `mcp_minimax-document-mcp_xlsx_read` |
| `xlsx.validate` | `mcp_minimax-document-mcp_xlsx_validate` |
| `pptx.generate` | `mcp_minimax-document-mcp_pptx_generate` |
| `pptx.read` | `mcp_minimax-document-mcp_pptx_read` |

The bridge maps `destructiveHint` annotations to tool categories: `true` becomes `write` category, `false` becomes `read`. Tools with `readOnlyHint: true` skip permission approval.

### Integration Points

The main agent platform connects to this MCP server via:

- **MCP Tool Bridge** (`src/connectors/mcp/mcp-tool-bridge.ts`) - Handles tool discovery and execution
- **MCP Session Manager** (`src/connectors/mcp/mcp-session-manager.ts`) - Manages server connections
- **MCP Server Registry** (`src/connectors/mcp/mcp-server-registry.ts`) - Registers server configurations

## Architecture

```
mcp-servers/minimax-document-mcp/
├── package.json          # @agent-platform/minimax-document-mcp@0.1.0
├── tsconfig.json         # ES2022, ESNext modules, strict mode
├── vitest.config.ts      # Test configuration
├── README.md
├── src/
│   ├── index.ts          # MCP server entry point, tool registration
│   ├── sandbox.ts        # Workspace, path safety, timeout, error utilities
│   ├── sandbox.test.ts   # Sandbox utility tests (46 tests)
│   └── tools/
│       ├── xlsx.ts           # xlsx.read and xlsx.validate implementations
│       ├── xlsx.test.ts      # XLSX tool tests (26 tests)
│       ├── pptx.ts           # pptx.generate and pptx.read implementations
│       ├── pptx.test.ts      # PPTX tool tests (21 tests)
│       └── generate-fixtures.ts  # Test fixture generator
├── test-fixtures/        # XLSX test files (employees, formulas, multi-sheet, etc.)
└── dist/                 # Compiled output
```

### Sandbox Model

Every tool call runs in an isolated temporary workspace:

1. `createWorkspace()` creates a unique temp directory per call
2. `normalizePath()` rejects absolute paths and directory traversal
3. `enforceSizeLimit()` checks files against the 10 MiB limit
4. `withTimeout()` enforces per-tool timeout classes (fast/standard/generation/heavy)
5. `cleanupWorkspace()` removes the temp directory in a `finally` block

## Limitations

- **No PDF generation**: `pdf.generate` returns a `deferred_tool` error. Requires Python + reportlab or a .NET runtime.
- **No DOCX generation**: `docx.generate` returns a `deferred_tool` error. Requires Python + python-docx or .NET SDK.
- **No streaming**: All tool responses are returned as complete JSON, not streamed.
- **No external file hosting**: Generated files are stored in temporary workspaces. The platform's file upload API must be used for persistent storage.
- **No authentication**: The MCP server itself has no auth layer. Security is handled by the platform's MCP session manager and approval workflows.
- **Single-process stdio**: The server communicates over stdio only. HTTP transport is not supported.
- **Formula results**: XLSX formula cells may show `null` for `result` if the Excel file doesn't cache calculated values.
- **No chart/image extraction**: `pptx.read` extracts text only. Embedded charts, images, and shapes are not extracted.
- **No rich text preservation**: PPTX text extraction produces plain text from `<a:t>` tags. Formatting (bold, italic, fonts) is lost.
- **Platform-specific paths**: Path safety checks use `path.isAbsolute()` which is OS-specific. Windows absolute paths are not recognized on Linux.

## License

MIT
