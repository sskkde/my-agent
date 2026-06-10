import { describe, it, expect } from 'vitest'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { buildToolProjection } from '../../../src/subagents/kernel-adapter.js'
import type { SubagentDefinition } from '../../../src/subagents/registry.js'
import type { SubagentTaskSpec } from '../../../src/subagents/types.js'
import type { ToolDefinition } from '../../../src/tools/types.js'

describe('kernel-adapter tool projection', () => {
  function createTestTool(name: string, description: string = `Test tool ${name}`): ToolDefinition {
    return {
      name,
      description,
      category: 'internal',
      sensitivity: 'low',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query parameter' },
        },
        required: ['query'],
      },
      handler: async () => ({ success: true, data: {} }),
    }
  }

  function createDefinition(allowedToolIds: string[]): SubagentDefinition {
    return {
      agentType: 'test_agent',
      displayName: 'Test Agent',
      description: 'A test subagent',
      modality: 'text',
      promptId: 'test-prompt',
      allowedToolIds,
      defaultMaxIterations: 10,
      defaultTimeoutMs: 60000,
      supportedExecutionModes: ['sync'],
      canRunInBackground: false,
      providerPolicy: {
        fallbackMode: 'any_compatible',
      },
      permissionProfile: 'read_only',
      summaryPolicy: {
        returnMode: 'summary_only',
        maxSummaryTokens: 500,
      },
    }
  }

  function createTaskSpec(tools?: string[]): SubagentTaskSpec {
    return {
      objective: 'Test task',
      tools,
    }
  }

  it('should project allowed tools with full schemas', () => {
    const registry = createToolRegistry()
    const tool1 = createTestTool('file_read')
    const tool2 = createTestTool('file_glob')
    registry.register(tool1)
    registry.register(tool2)

    const definition = createDefinition(['file_read', 'file_glob'])
    const taskSpec = createTaskSpec()
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual(['file_read', 'file_glob'])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(2)
    expect(projection.tools![0].function.name).toBe('file_read')
    expect(projection.tools![0].function.parameters).toBeDefined()
    expect(projection.tools![0].function.parameters).toHaveProperty('type', 'object')
  })

  it('should not project tools outside allowedToolIds', () => {
    const registry = createToolRegistry()
    const allowedTool = createTestTool('file_read')
    const forbiddenTool = createTestTool('exec')
    registry.register(allowedTool)
    registry.register(forbiddenTool)

    const definition = createDefinition(['file_read'])
    const taskSpec = createTaskSpec()
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual(['file_read'])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(1)
    expect(projection.tools![0].function.name).toBe('file_read')
  })

  it('should filter by requested tools within allowed set', () => {
    const registry = createToolRegistry()
    const tool1 = createTestTool('file_read')
    const tool2 = createTestTool('file_glob')
    const tool3 = createTestTool('file_grep')
    registry.register(tool1)
    registry.register(tool2)
    registry.register(tool3)

    const definition = createDefinition(['file_read', 'file_glob', 'file_grep'])
    const taskSpec = createTaskSpec(['file_read', 'file_glob'])
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual(['file_read', 'file_glob'])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(2)
  })

  it('should skip missing registry tools safely', () => {
    const registry = createToolRegistry()
    const tool1 = createTestTool('file_read')
    registry.register(tool1)

    const definition = createDefinition(['file_read', 'missing_tool'])
    const taskSpec = createTaskSpec()
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual(['file_read', 'missing_tool'])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(1)
    expect(projection.tools![0].function.name).toBe('file_read')
  })

  it('should return empty tools when no allowed tools specified', () => {
    const registry = createToolRegistry()
    const tool = createTestTool('file_read')
    registry.register(tool)

    const definition = createDefinition([])
    const taskSpec = createTaskSpec()
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual([])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(0)
  })

  it('should return empty tools when allowed tools not in registry', () => {
    const registry = createToolRegistry()

    const definition = createDefinition(['nonexistent_tool'])
    const taskSpec = createTaskSpec()
    const projection = buildToolProjection(definition, taskSpec, registry)

    expect(projection.toolIds).toEqual(['nonexistent_tool'])
    expect(projection.tools).toBeDefined()
    expect(projection.tools!.length).toBe(0)
  })
})
