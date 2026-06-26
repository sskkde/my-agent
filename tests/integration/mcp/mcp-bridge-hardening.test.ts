import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMcpSessionManager, type McpSessionManager } from '../../../src/connectors/mcp/mcp-session-manager.js'
import { McpToolBridge } from '../../../src/connectors/mcp/mcp-tool-bridge.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry } from '../../../src/tools/types.js'
import type { AuditRecorder, ToolCallAuditRequest, AuditRecord } from '../../../src/observability/audit-types.js'
import {
  MockMcpTransport,
  createMiniMaxDocumentMcpSetup,
  createMiniMaxDocumentMcpWithDeferredSetup,
  createMockMcpToolDescriptor,
} from '../../fixtures/phase3-mock-mcp.js'

const createMcpTables = (connection: ConnectionManager): void => {
  connection.exec(`CREATE TABLE mcp_servers (
    server_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    base_url TEXT NOT NULL,
    config_type TEXT NOT NULL CHECK(config_type IN ('stdio', 'http', 'streamable_http')),
    command TEXT,
    args TEXT,
    authentication_json TEXT,
    trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust_level IN ('trusted', 'verified', 'untrusted')),
    sandbox_policy TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'error')),
    tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  connection.exec(`CREATE TABLE mcp_sessions (
    session_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    connector_instance_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('connecting', 'connected', 'disconnected', 'error')),
    auth_token_ref TEXT,
    metadata TEXT,
    last_error TEXT,
    last_health_check TEXT,
    connected_at TEXT,
    last_activity_at TEXT,
    disconnected_at TEXT,
    tenant_id TEXT NOT NULL DEFAULT 'org_default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
}

function createMockAuditRecorder(): AuditRecorder & { calls: ToolCallAuditRequest[] } {
  const calls: ToolCallAuditRequest[] = []
  return {
    calls,
    recordToolCall(toolCall: ToolCallAuditRequest): AuditRecord {
      calls.push(toolCall)
      return {
        auditId: crypto.randomUUID(),
        auditType: 'tool_call',
        timestamp: new Date().toISOString(),
        userId: toolCall.userId,
        sessionId: toolCall.sessionId,
        sourceModule: 'connector',
        sourceAction: 'mcp_tool_call',
        actionSummary: `${toolCall.toolName} ${toolCall.status}`,
        status: toolCall.status === 'success' ? 'completed' : 'failed',
        payload: { params: toolCall.params, result: toolCall.result },
        riskLevel: 'medium',
        sensitivity: 'medium',
      }
    },
    recordUserInput: vi.fn() as unknown as AuditRecorder['recordUserInput'],
    recordAssistantOutput: vi.fn() as unknown as AuditRecorder['recordAssistantOutput'],
    recordExternalWrite: vi.fn() as unknown as AuditRecorder['recordExternalWrite'],
    recordPermissionDecision: vi.fn() as unknown as AuditRecorder['recordPermissionDecision'],
    recordApprovalRequest: vi.fn() as unknown as AuditRecorder['recordApprovalRequest'],
    recordApprovalResponse: vi.fn() as unknown as AuditRecorder['recordApprovalResponse'],
    recordWorkflowChange: vi.fn() as unknown as AuditRecorder['recordWorkflowChange'],
    recordSubagentRun: vi.fn() as unknown as AuditRecorder['recordSubagentRun'],
    recordConnectorAccess: vi.fn() as unknown as AuditRecorder['recordConnectorAccess'],
    recordMemoryWrite: vi.fn() as unknown as AuditRecorder['recordMemoryWrite'],
    recordSummaryWrite: vi.fn() as unknown as AuditRecorder['recordSummaryWrite'],
    recordDispatch: vi.fn() as unknown as AuditRecorder['recordDispatch'],
    getStore: vi.fn() as unknown as AuditRecorder['getStore'],
    getPolicy: vi.fn() as unknown as AuditRecorder['getPolicy'],
    setPolicy: vi.fn() as unknown as AuditRecorder['setPolicy'],
  }
}

describe('MCP Bridge Hardening - Permission, Audit, and Runtime Isolation', () => {
  let connection: ConnectionManager
  let sessionManager: McpSessionManager
  let toolRegistry: ToolRegistry

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    createMcpTables(connection)
    toolRegistry = createToolRegistry()
  })

  afterEach(() => {
    connection.close()
  })

  describe('destructiveHint/readOnlyHint sensitivity mapping', () => {
    it('xlsx.read: readOnlyHint=true → category=read, sensitivity=medium, requiresPermission=false', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const xlsxRead = toolRegistry.getTool('mcp_minimax-document-mcp_xlsx_read')
      expect(xlsxRead).not.toBeNull()
      expect(xlsxRead!.category).toBe('read')
      expect(xlsxRead!.sensitivity).toBe('medium')
      expect(xlsxRead!.requiresPermission).toBe(false)
      expect(xlsxRead!.idempotent).toBe(true)
    })

    it('xlsx.validate: readOnlyHint=true → category=read, sensitivity=medium, requiresPermission=false', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const xlsxValidate = toolRegistry.getTool('mcp_minimax-document-mcp_xlsx_validate')
      expect(xlsxValidate).not.toBeNull()
      expect(xlsxValidate!.category).toBe('read')
      expect(xlsxValidate!.sensitivity).toBe('medium')
      expect(xlsxValidate!.requiresPermission).toBe(false)
      expect(xlsxValidate!.idempotent).toBe(true)
    })

    it('pptx.generate: destructiveHint=true → category=write, sensitivity=high, requiresPermission=true', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const pptxGenerate = toolRegistry.getTool('mcp_minimax-document-mcp_pptx_generate')
      expect(pptxGenerate).not.toBeNull()
      expect(pptxGenerate!.category).toBe('write')
      expect(pptxGenerate!.sensitivity).toBe('high')
      expect(pptxGenerate!.requiresPermission).toBe(true)
      expect(pptxGenerate!.idempotent).toBe(false)
    })

    it('pptx.read: readOnlyHint=true → category=read, requiresPermission=false', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const pptxRead = toolRegistry.getTool('mcp_minimax-document-mcp_pptx_read')
      expect(pptxRead).not.toBeNull()
      expect(pptxRead!.category).toBe('read')
      expect(pptxRead!.sensitivity).toBe('medium')
      expect(pptxRead!.requiresPermission).toBe(false)
      expect(pptxRead!.idempotent).toBe(true)
    })

    it('pdf.generate (deferred): destructiveHint=true → category=write, requiresPermission=true', async () => {
      const setup = createMiniMaxDocumentMcpWithDeferredSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const pdfGenerate = toolRegistry.getTool('mcp_minimax-document-mcp_pdf_generate')
      expect(pdfGenerate).not.toBeNull()
      expect(pdfGenerate!.category).toBe('write')
      expect(pdfGenerate!.sensitivity).toBe('high')
      expect(pdfGenerate!.requiresPermission).toBe(true)
      expect(pdfGenerate!.idempotent).toBe(false)
    })

    it('docx.generate (deferred): destructiveHint=true → category=write, requiresPermission=true', async () => {
      const setup = createMiniMaxDocumentMcpWithDeferredSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })
      await bridge.registerTools(toolRegistry, session.sessionId)

      const docxGenerate = toolRegistry.getTool('mcp_minimax-document-mcp_docx_generate')
      expect(docxGenerate).not.toBeNull()
      expect(docxGenerate!.category).toBe('write')
      expect(docxGenerate!.sensitivity).toBe('high')
      expect(docxGenerate!.requiresPermission).toBe(true)
      expect(docxGenerate!.idempotent).toBe(false)
    })

    it('catches unsafe annotation: generate tool incorrectly marked readOnlyHint=true', async () => {
      const unsafeDescriptor = createMockMcpToolDescriptor({
        toolId: 'unsafe_generate',
        name: 'unsafe.generate',
        description: 'A generate tool incorrectly marked as read-only',
        annotations: {
          readOnlyHint: true,
          destructiveHint: true,
          idempotentHint: false,
        },
      })

      const unsafeTransport = new MockMcpTransport({
        serverId: 'unsafe-mcp',
        tools: [unsafeDescriptor],
      })
      sessionManager = createMcpSessionManager(connection, new Map([['unsafe-mcp', unsafeTransport]]))
      const session = sessionManager.openSession('unsafe-mcp')
      await unsafeTransport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'unsafe-mcp' ? unsafeTransport : undefined),
      })
      await bridge.discoverTools(session.sessionId)

      const tools = await bridge.discoverTools(session.sessionId)
      const unsafeTool = tools[0]!

      expect(unsafeTool.category).toBe('write')
      expect(unsafeTool.sensitivity).toBe('high')
      expect(unsafeTool.requiresPermission).toBe(true)

      expect(unsafeTool.requiresPermission).toBe(true)
      expect(unsafeTool.category).not.toBe('read')
    })

    it('no-annotation tool defaults to requiresPermission=true', async () => {
      const noAnnotationDescriptor = createMockMcpToolDescriptor({
        toolId: 'bare_tool',
        name: 'bare.tool',
        description: 'A tool with no annotations',
        annotations: undefined,
      })

      const bareTransport = new MockMcpTransport({
        serverId: 'bare-mcp',
        tools: [noAnnotationDescriptor],
      })
      sessionManager = createMcpSessionManager(connection, new Map([['bare-mcp', bareTransport]]))
      const session = sessionManager.openSession('bare-mcp')
      await bareTransport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'bare-mcp' ? bareTransport : undefined),
      })
      const tools = await bridge.discoverTools(session.sessionId)

      expect(tools).toHaveLength(1)
      const bareTool = tools[0]!
      expect(bareTool.requiresPermission).toBe(true)
      expect(bareTool.category).toBe('read')
      expect(bareTool.sensitivity).toBe('medium')
    })
  })

  describe('timeout returns normalized timeout response', () => {
    it('tool call exceeding timeoutMs returns timeout status with connector_timeout code', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const slowTransport: MockMcpTransport = {
        ...setup.transport,
        callTool: () => new Promise((resolve) => setTimeout(() => resolve({ data: 'too late' }), 200)),
        listTools: setup.transport.listTools.bind(setup.transport),
      } as unknown as MockMcpTransport

      const bridge = new McpToolBridge({
        sessionManager,
        timeoutMs: 10,
        getTransport: () => slowTransport as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('timeout')
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('connector_timeout')
      expect(result.error!.recoverable).toBe(true)
      expect(result.error!.category).toBe('timeout')
      expect(result.recoverability).toBe('retryable_later')
    })
  })

  describe('cancellation returns normalized cancelled response', () => {
    it('aborted signal before call returns cancelled status with synthetic flag', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      const controller = new AbortController()
      controller.abort()

      const result = await bridge.callTool(
        session.sessionId,
        'mcp_minimax-document-mcp_xlsx_read',
        { inputPath: '/test.xlsx' },
        { signal: controller.signal },
      )

      expect(result.status).toBe('cancelled')
      expect(result.synthetic).toBe(true)
    })

    it('abort during execution returns cancelled status', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      let resolveCall: (value: unknown) => void
      const callPromise = new Promise((resolve) => {
        resolveCall = resolve
      })

      const bridge = new McpToolBridge({
        sessionManager,
        timeoutMs: 5000,
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () => callPromise,
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const controller = new AbortController()
      const resultPromise = bridge.callTool(
        session.sessionId,
        'mcp_minimax-document-mcp_xlsx_read',
        { inputPath: '/test.xlsx' },
        { signal: controller.signal },
      )

      controller.abort()
      const result = await resultPromise

      expect(result.status).toBe('cancelled')
      expect(result.synthetic).toBe(true)

      resolveCall!({ data: 'never seen' })
    })
  })

  describe('disconnected session returns recoverable MCP error', () => {
    it('closed session returns mcp_session_disconnected with recoverable=true', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      sessionManager.closeSession(session.sessionId)

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('mcp_session_disconnected')
      expect(result.error!.recoverable).toBe(true)
      expect(result.error!.message).toContain('disconnected')
    })

    it('unhealthy session returns mcp_session_disconnected with recoverable=true', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      sessionManager.markUnhealthy(session.sessionId, 'connection lost')

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('mcp_session_disconnected')
      expect(result.error!.recoverable).toBe(true)
    })

    it('transport unavailable returns mcp_transport_unavailable with recoverable=true', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: () => undefined,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('mcp_transport_unavailable')
      expect(result.error!.recoverable).toBe(true)
      expect(result.error!.message).toContain('unavailable')
    })

    it('transport callTool exception returns mcp_tool_call_failed with recoverable=true', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () => {
            throw new Error('connection reset')
          },
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('mcp_tool_call_failed')
      expect(result.error!.recoverable).toBe(true)
      expect(result.error!.message).toContain('connection reset')
    })
  })

  describe('audit recorder receives tool call metadata', () => {
    it('successful tool call records audit with correct toolName, userId, params, and success status', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'test-user',
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      await bridge.discoverTools(session.sessionId)

      const result = await bridge.callTool(
        session.sessionId,
        'mcp_minimax-document-mcp_xlsx_read',
        { inputPath: '/test.xlsx' },
        { userId: 'user-123', executionSessionId: 'sess-456' },
      )

      expect(result.status).toBe('completed')
      expect(auditRecorder.calls).toHaveLength(1)

      const auditCall = auditRecorder.calls[0]!
      expect(auditCall.toolName).toBe('mcp_minimax-document-mcp_xlsx_read')
      expect(auditCall.userId).toBe('user-123')
      expect(auditCall.sessionId).toBe('sess-456')
      expect(auditCall.params).toEqual({ inputPath: '/test.xlsx' })
      expect(auditCall.status).toBe('success')
      expect(auditCall.toolCallId).toBeDefined()
    })

    it('failed tool call records audit with failure status', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'test-user',
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () => {
            throw new Error('boom')
          },
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_pptx_generate', {
        title: 'Test',
        slides: [],
      })

      expect(result.status).toBe('failed')
      expect(auditRecorder.calls).toHaveLength(1)

      const auditCall = auditRecorder.calls[0]!
      expect(auditCall.toolName).toBe('mcp_minimax-document-mcp_pptx_generate')
      expect(auditCall.status).toBe('failure')
      expect(auditCall.params).toEqual({ title: 'Test', slides: [] })
    })

    it('disconnected session still records audit entry', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'test-user',
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      sessionManager.closeSession(session.sessionId)

      await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(auditRecorder.calls).toHaveLength(1)
      const auditCall = auditRecorder.calls[0]!
      expect(auditCall.toolName).toBe('mcp_minimax-document-mcp_xlsx_read')
      expect(auditCall.status).toBe('failure')
    })

    it('timeout still records audit entry', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        timeoutMs: 10,
        defaultUserId: 'test-user',
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () => new Promise((resolve) => setTimeout(() => resolve({ data: 'late' }), 200)),
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(auditRecorder.calls).toHaveLength(1)
      const auditCall = auditRecorder.calls[0]!
      expect(auditCall.status).toBe('failure')
    })

    it('cancelled call still records audit entry', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'test-user',
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      const controller = new AbortController()
      controller.abort()

      await bridge.callTool(
        session.sessionId,
        'mcp_minimax-document-mcp_pptx_generate',
        { title: 'Test', slides: [] },
        { signal: controller.signal },
      )

      expect(auditRecorder.calls).toHaveLength(1)
      const auditCall = auditRecorder.calls[0]!
      expect(auditCall.toolName).toBe('mcp_minimax-document-mcp_pptx_generate')
      expect(auditCall.status).toBe('failure')
    })

    it('uses defaultUserId when no userId in options', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'system',
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(auditRecorder.calls).toHaveLength(1)
      expect(auditRecorder.calls[0]!.userId).toBe('system')
    })

    it('custom toolCallId is preserved in audit entry', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const auditRecorder = createMockAuditRecorder()
      const bridge = new McpToolBridge({
        sessionManager,
        auditRecorder,
        defaultUserId: 'system',
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      const customId = 'custom-call-id-789'
      await bridge.callTool(
        session.sessionId,
        'mcp_minimax-document-mcp_xlsx_read',
        { inputPath: '/test.xlsx' },
        { toolCallId: customId },
      )

      expect(auditRecorder.calls).toHaveLength(1)
      expect(auditRecorder.calls[0]!.toolCallId).toBe(customId)
    })
  })

  describe('MCP error result handling', () => {
    it('transport returning isError=true maps to failed status', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () =>
            Promise.resolve({
              isError: true,
              error: { code: 'file_not_found', message: 'File does not exist' },
            }),
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/missing.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('file_not_found')
      expect(result.error!.message).toBe('File does not exist')
      expect(result.error!.recoverable).toBe(false)
    })

    it('transport returning isError=true without error object uses defaults', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: () => ({
          listTools: () => setup.transport.listTools(),
          callTool: () => Promise.resolve({ isError: true }),
        }) as unknown as import('../../../src/connectors/mcp/mcp-tool-bridge.js').McpToolTransport,
      })

      const result = await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      expect(result.status).toBe('failed')
      expect(result.error!.code).toBe('mcp_tool_error')
      expect(result.error!.message).toBe('MCP tool returned an error')
    })
  })

  describe('callTool uses raw tool name for transport', () => {
    it('bridged name is reverse-resolved to raw tool name before transport call', async () => {
      const setup = createMiniMaxDocumentMcpSetup()
      sessionManager = createMcpSessionManager(connection, new Map([['minimax-document-mcp', setup.transport]]))
      const session = sessionManager.openSession('minimax-document-mcp')
      await setup.transport.connect()

      const bridge = new McpToolBridge({
        sessionManager,
        getTransport: (_sid, serverId) => (serverId === 'minimax-document-mcp' ? setup.transport : undefined),
      })

      await bridge.discoverTools(session.sessionId)

      await bridge.callTool(session.sessionId, 'mcp_minimax-document-mcp_xlsx_read', {
        inputPath: '/test.xlsx',
      })

      const history = setup.transport.getCallHistory()
      expect(history).toHaveLength(1)
      expect(history[0]!.toolName).toBe('xlsx.read')
    })
  })
})
