import { describe, it, expect } from 'vitest'
import {
  buildForegroundToolProjection,
  toToolPlaneProjection,
  applyEnvelopeToProjection,
} from '../../../src/foreground/tool-projection-mapper.js'
import type { ForegroundTurnInput } from '../../../src/foreground/foreground-runner-types.js'
import type { ToolCategory, ToolSensitivity } from '../../../src/tools/types.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { createSessionHistoryTool } from '../../../src/tools/builtins/session-history.js'
import { createTranscriptSearchTool } from '../../../src/tools/builtins/transcript-search.js'
import { createStatusQueryTool } from '../../../src/tools/builtins/status-query.js'
import { createSessionStore } from '../../../src/storage/session-store.js'
import { createTranscriptStore } from '../../../src/storage/transcript-store.js'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'

describe('buildForegroundToolProjection', () => {
  const createMockInput = (): ForegroundTurnInput => ({
    userId: 'test-user',
    sessionId: 'test-session',
    turnId: 'test-turn',
    message: 'test message',
    timestamp: new Date().toISOString(),
    hydratedState: {} as any,
    foregroundState: {} as any,
  })

  const createTool = (
    name: string,
    category: ToolCategory,
    sensitivity: ToolSensitivity,
    description: string = 'Test tool',
  ) => ({
    name,
    category,
    sensitivity,
    description,
  })

  describe('default projection excludes high-risk tools', () => {
    it('should only include read/search/internal tools with low/medium sensitivity', () => {
      const allTools = [
        createTool('web_search', 'search', 'low'),
        createTool('file_read', 'read', 'low'),
        createTool('status_query', 'internal', 'low'),
        createTool('ask_user', 'internal', 'low'),
        createTool('file_write', 'write', 'medium'),
        createTool('file_delete', 'delete', 'high'),
        createTool('execute_command', 'execute', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['web_search', 'file_read', 'status_query', 'ask_user'])
      expect(result.projectionMode).toBe('function_calling')
    })

    it('should exclude write category tools by default', () => {
      const allTools = [
        createTool('artifact_create', 'write', 'medium'),
        createTool('artifact_update', 'write', 'medium'),
        createTool('email_send_draft', 'write', 'high'),
        createTool('calendar_create_event', 'write', 'medium'),
        createTool('file_read', 'read', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['file_read'])
      expect(result.allowedToolIds).not.toContain('artifact_create')
      expect(result.allowedToolIds).not.toContain('artifact_update')
      expect(result.allowedToolIds).not.toContain('email_send_draft')
      expect(result.allowedToolIds).not.toContain('calendar_create_event')
    })

    it('should exclude delete category tools by default', () => {
      const allTools = [
        createTool('file_delete', 'delete', 'high'),
        createTool('record_delete', 'delete', 'medium'),
        createTool('file_read', 'read', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['file_read'])
      expect(result.allowedToolIds).not.toContain('file_delete')
      expect(result.allowedToolIds).not.toContain('record_delete')
    })

    it('should exclude execute category tools by default', () => {
      const allTools = [
        createTool('run_script', 'execute', 'high'),
        createTool('bash_command', 'execute', 'high'),
        createTool('status_query', 'internal', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['status_query'])
      expect(result.allowedToolIds).not.toContain('run_script')
      expect(result.allowedToolIds).not.toContain('bash_command')
    })

    it('should exclude admin category tools by default', () => {
      const allTools = [
        createTool('configure_system', 'admin', 'restricted'),
        createTool('manage_users', 'admin', 'high'),
        createTool('web_search', 'search', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['web_search'])
      expect(result.allowedToolIds).not.toContain('configure_system')
      expect(result.allowedToolIds).not.toContain('manage_users')
    })

    it('should exclude tools with high or restricted sensitivity even in safe categories', () => {
      const allTools = [
        createTool('safe_tool', 'search', 'low'),
        createTool('high_sens_tool', 'search', 'high'),
        createTool('restricted_tool', 'read', 'restricted'),
        createTool('medium_sens_tool', 'internal', 'medium'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual(['safe_tool', 'medium_sens_tool'])
      expect(result.allowedToolIds).not.toContain('high_sens_tool')
      expect(result.allowedToolIds).not.toContain('restricted_tool')
    })

    it('should generate tool definitions for function calling mode', () => {
      const allTools = [
        createTool('web_search', 'search', 'low', 'Search the web'),
        createTool('status_query', 'internal', 'low', 'Query status'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.toolDefinitions).toHaveLength(2)
      expect(result.toolDefinitions[0]).toEqual({
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web',
          parameters: { type: 'object', properties: {} },
        },
      })
      expect(result.toolDefinitions[1]).toEqual({
        type: 'function',
        function: {
          name: 'status_query',
          description: 'Query status',
          parameters: { type: 'object', properties: {} },
        },
      })
    })

    it('should expose session_history tool with correct schema including sessionId parameter', () => {
      // Create ToolRegistry with real tool definitions
      const connection = createConnectionManager(':memory:')
      connection.open()
      const sessionStore = createSessionStore(connection)
      const transcriptStore = createTranscriptStore(connection)
      const toolRegistry = createToolRegistry()
      toolRegistry.register(createSessionHistoryTool(sessionStore, transcriptStore))

      const allTools = [createTool('session_history', 'read', 'medium', 'Get session message history')]

      const result = buildForegroundToolProjection(createMockInput(), allTools, toolRegistry)

      expect(result.allowedToolIds).toContain('session_history')
      expect(result.toolDefinitions).toHaveLength(1)

      const sessionHistoryDef = result.toolDefinitions[0]
      expect(sessionHistoryDef.function.name).toBe('session_history')

      expect(sessionHistoryDef.function.parameters).toHaveProperty('properties')
      expect(sessionHistoryDef.function.parameters).toHaveProperty('required')

      const properties = sessionHistoryDef.function.parameters.properties as Record<string, unknown>
      expect(properties).toHaveProperty('sessionId')
      expect(properties.sessionId).toMatchObject({
        type: 'string',
        description: expect.stringContaining('Session ID'),
      })

      const required = sessionHistoryDef.function.parameters.required as string[]
      expect(required).toContain('sessionId')
    })

    it('should expose transcript_search tool with correct schema including query parameter', () => {
      // Create ToolRegistry with real tool definitions
      const connection = createConnectionManager(':memory:')
      connection.open()
      const transcriptStore = createTranscriptStore(connection)
      const toolRegistry = createToolRegistry()
      toolRegistry.register(createTranscriptSearchTool(transcriptStore))

      const allTools = [
        createTool('transcript_search', 'search', 'medium', 'Search transcript records for matching content'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools, toolRegistry)

      expect(result.allowedToolIds).toContain('transcript_search')
      expect(result.toolDefinitions).toHaveLength(1)

      const transcriptSearchDef = result.toolDefinitions[0]
      expect(transcriptSearchDef.function.name).toBe('transcript_search')

      expect(transcriptSearchDef.function.parameters).toHaveProperty('properties')
      expect(transcriptSearchDef.function.parameters).toHaveProperty('required')

      const properties = transcriptSearchDef.function.parameters.properties as Record<string, unknown>
      expect(properties).toHaveProperty('query')
      expect(properties.query).toMatchObject({
        type: 'string',
        description: expect.stringContaining('Search query'),
      })

      const required = transcriptSearchDef.function.parameters.required as string[]
      expect(required).toContain('query')
    })

    it('should NOT project high-risk tools like exec and file_write in default foreground', () => {
      const allTools = [
        createTool('exec', 'execute', 'high', 'Execute shell command'),
        createTool('bash', 'execute', 'high', 'Execute bash command'),
        createTool('file_write', 'write', 'high', 'Write content to file'),
        createTool('file_delete', 'delete', 'high', 'Delete file'),
        createTool('web_search', 'search', 'low', 'Search the web'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).not.toContain('exec')
      expect(result.allowedToolIds).not.toContain('bash')
      expect(result.allowedToolIds).not.toContain('file_write')
      expect(result.allowedToolIds).not.toContain('file_delete')

      expect(result.allowedToolIds).toEqual(['web_search'])
      expect(result.toolDefinitions).toHaveLength(1)
      expect(result.toolDefinitions[0].function.name).toBe('web_search')
    })

    it('should expose status_query tool with optional targetId parameter (no required fields)', () => {
      const toolRegistry = createToolRegistry()
      toolRegistry.register(createStatusQueryTool())

      const allTools = [createTool('status_query', 'internal', 'low', 'Query active work status')]

      const result = buildForegroundToolProjection(createMockInput(), allTools, toolRegistry)

      expect(result.allowedToolIds).toContain('status_query')
      expect(result.toolDefinitions).toHaveLength(1)

      const statusQueryDef = result.toolDefinitions[0]
      expect(statusQueryDef.function.name).toBe('status_query')

      expect(statusQueryDef.function.parameters).toHaveProperty('properties')
      expect(statusQueryDef.function.parameters).toHaveProperty('required')

      const properties = statusQueryDef.function.parameters.properties as Record<string, unknown>
      expect(properties).toHaveProperty('targetId')
      expect(properties.targetId).toMatchObject({
        type: 'string',
        description: expect.stringContaining('Optional'),
      })

      const required = statusQueryDef.function.parameters.required as string[]
      expect(required).toEqual([])
    })
  })

  describe('unprojected call handling', () => {
    it('should produce empty projection when no tools are safe', () => {
      const allTools = [
        createTool('dangerous_write', 'write', 'high'),
        createTool('dangerous_delete', 'delete', 'high'),
        createTool('dangerous_execute', 'execute', 'restricted'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toEqual([])
      expect(result.toolDefinitions).toEqual([])
    })

    it('should convert to ToolPlaneProjection format correctly', () => {
      const allTools = [createTool('web_search', 'search', 'low'), createTool('file_read', 'read', 'medium')]

      const projectionResult = buildForegroundToolProjection(createMockInput(), allTools)
      const planeProjection = toToolPlaneProjection(projectionResult)

      expect(planeProjection.toolIds).toEqual(['web_search', 'file_read'])
      expect(planeProjection.tools).toHaveLength(2)
      expect(planeProjection.tools?.[0].function.name).toBe('web_search')
      expect(planeProjection.tools?.[1].function.name).toBe('file_read')
    })
  })

  describe('edge cases', () => {
    it('should handle empty tool array', () => {
      const result = buildForegroundToolProjection(createMockInput(), [])

      expect(result.allowedToolIds).toEqual([])
      expect(result.toolDefinitions).toEqual([])
    })

    it('should handle tools with all safe categories', () => {
      const allTools = [
        createTool('web_search', 'search', 'low'),
        createTool('file_glob', 'search', 'low'),
        createTool('file_read', 'read', 'low'),
        createTool('status_query', 'internal', 'low'),
        createTool('ask_user', 'internal', 'low'),
        createTool('docs_search', 'search', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toHaveLength(6)
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).toContain('file_glob')
      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('status_query')
      expect(result.allowedToolIds).toContain('ask_user')
      expect(result.allowedToolIds).toContain('docs_search')
    })
  })

  describe('envelope enforcement', () => {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

    it('main envelope: filters out write/execute/admin tools from projection', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('web_search', 'search', 'low'),
        createTool('status_query', 'internal', 'low'),
        createTool('file_write', 'write', 'medium'),
        createTool('exec', 'execute', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
      ]

      const projection = buildForegroundToolProjection(createMockInput(), allTools)
      const result = applyEnvelopeToProjection(projection, 'main', envelopeRegistry, allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).toContain('status_query')
      expect(result.allowedToolIds).not.toContain('file_write')
      expect(result.allowedToolIds).not.toContain('exec')
      expect(result.allowedToolIds).not.toContain('admin_config')
    })

    it('remote envelope: filters out ALL tools', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('web_search', 'search', 'low'),
        createTool('status_query', 'internal', 'low'),
      ]

      const projection = buildForegroundToolProjection(createMockInput(), allTools)
      const result = applyEnvelopeToProjection(projection, 'remote', envelopeRegistry, allTools)

      expect(result.allowedToolIds).toEqual([])
      expect(result.toolDefinitions).toEqual([])
    })

    it('subagent envelope: filters tools that pass foreground projection', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('web_search', 'search', 'low'),
        createTool('artifact_create', 'write', 'medium'),
        createTool('exec', 'execute', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
      ]

      const projection = buildForegroundToolProjection(createMockInput(), allTools)
      const result = applyEnvelopeToProjection(projection, 'subagent', envelopeRegistry, allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).not.toContain('artifact_create')
      expect(result.allowedToolIds).not.toContain('exec')
      expect(result.allowedToolIds).not.toContain('admin_config')
    })

    it('background envelope: filters tools that pass foreground projection', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('web_search', 'search', 'low'),
        createTool('artifact_create', 'write', 'medium'),
      ]

      const projection = buildForegroundToolProjection(createMockInput(), allTools)
      const result = applyEnvelopeToProjection(projection, 'background', envelopeRegistry, allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).not.toContain('artifact_create')
    })

    it('workflow_step envelope: filters tools that pass foreground projection', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('web_search', 'search', 'low'),
        createTool('artifact_create', 'write', 'medium'),
        createTool('exec', 'execute', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
      ]

      const projection = buildForegroundToolProjection(createMockInput(), allTools)
      const result = applyEnvelopeToProjection(projection, 'workflow_step', envelopeRegistry, allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).not.toContain('artifact_create')
      expect(result.allowedToolIds).not.toContain('exec')
      expect(result.allowedToolIds).not.toContain('admin_config')
    })
  })

  describe('workdir file tool projection', () => {
    const createMockInputWithWorkdir = (workDirRoot?: string): ForegroundTurnInput => ({
      userId: 'test-user',
      sessionId: 'test-session',
      turnId: 'test-turn',
      message: 'test message',
      timestamp: new Date().toISOString(),
      hydratedState: {} as any,
      foregroundState: {} as any,
      workDirRoot,
      workDirId: 'test-workdir',
    })

    it('should include file_write in projection when workDirRoot is set', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('file_write', 'write', 'high'),
        createTool('file_edit', 'write', 'high'),
        createTool('file_apply_patch', 'write', 'high'),
        createTool('file_glob', 'search', 'low'),
        createTool('file_grep', 'search', 'medium'),
        createTool('web_search', 'search', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInputWithWorkdir('/data/workdirs'), allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('file_write')
      expect(result.allowedToolIds).toContain('file_edit')
      expect(result.allowedToolIds).toContain('file_apply_patch')
      expect(result.allowedToolIds).toContain('file_glob')
      expect(result.allowedToolIds).toContain('file_grep')
      expect(result.allowedToolIds).toContain('web_search')
    })

    it('should NOT include file_write in projection when workDirRoot is not set', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('file_write', 'write', 'high'),
        createTool('file_edit', 'write', 'high'),
        createTool('web_search', 'search', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInput(), allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('web_search')
      expect(result.allowedToolIds).not.toContain('file_write')
      expect(result.allowedToolIds).not.toContain('file_edit')
    })

    it('should NOT include exec tools in projection even with workDirRoot', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('file_write', 'write', 'high'),
        createTool('exec', 'execute', 'high'),
        createTool('bash', 'execute', 'high'),
        createTool('code_execution', 'execute', 'high'),
      ]

      const result = buildForegroundToolProjection(createMockInputWithWorkdir('/data/workdirs'), allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('file_write')
      expect(result.allowedToolIds).not.toContain('exec')
      expect(result.allowedToolIds).not.toContain('bash')
      expect(result.allowedToolIds).not.toContain('code_execution')
    })

    it('should NOT include admin/connector tools in projection even with workDirRoot', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('file_write', 'write', 'high'),
        createTool('admin_config', 'admin', 'restricted'),
        createTool('manage_users', 'admin', 'high'),
        createTool('connector_send', 'send', 'high'),
      ]

      const result = buildForegroundToolProjection(createMockInputWithWorkdir('/data/workdirs'), allTools)

      expect(result.allowedToolIds).toContain('file_read')
      expect(result.allowedToolIds).toContain('file_write')
      expect(result.allowedToolIds).not.toContain('admin_config')
      expect(result.allowedToolIds).not.toContain('manage_users')
      expect(result.allowedToolIds).not.toContain('connector_send')
    })

    it('should generate tool definitions for workdir file tools in projection', () => {
      const allTools = [
        createTool('file_read', 'read', 'low', 'Read a file'),
        createTool('file_write', 'write', 'high', 'Write to a file'),
      ]

      const result = buildForegroundToolProjection(createMockInputWithWorkdir('/data/workdirs'), allTools)

      expect(result.toolDefinitions).toHaveLength(2)
      expect(result.toolDefinitions[0].function.name).toBe('file_read')
      expect(result.toolDefinitions[1].function.name).toBe('file_write')
    })

    it('should not duplicate tools when workDirRoot is set and tools are already safe', () => {
      const allTools = [
        createTool('file_read', 'read', 'low'),
        createTool('file_glob', 'search', 'low'),
        createTool('web_search', 'search', 'low'),
      ]

      const result = buildForegroundToolProjection(createMockInputWithWorkdir('/data/workdirs'), allTools)

      const readCount = result.allowedToolIds.filter((id) => id === 'file_read').length
      expect(readCount).toBe(1)
    })
  })
})
