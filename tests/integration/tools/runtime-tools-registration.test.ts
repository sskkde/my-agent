import { describe, it, expect, beforeEach } from 'vitest'
import { ToolRegistry } from '../../../src/tools/types.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js'
import { getFallbackToolCatalog } from '../../../src/tools/tool-catalog.js'
import { buildRiskPoliciesFromCatalog } from '../../../src/permissions/tool-risk-policy.js'

class MockToolRegistry implements ToolRegistry {
  private tools: Map<string, any> = new Map()

  register(definition: any): void {
    this.tools.set(definition.name, definition)
  }

  getTool(name: string): any | null {
    return this.tools.get(name) ?? null
  }

  listTools(): any[] {
    return Array.from(this.tools.values())
  }

  listToolsByCategory(category: string): any[] {
    return this.listTools().filter((t) => t.category === category)
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  hasTool(name: string): boolean {
    return this.tools.has(name)
  }
}

describe('runtime-tools-registration', () => {
  let registry: ToolRegistry
  let processSessionStore: ProcessSessionStore

  beforeEach(() => {
    registry = new MockToolRegistry()
    processSessionStore = new ProcessSessionStore()
  })

  it('registers all 4 runtime tools when enabled', () => {
    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
      processSessionStore,
      enableRuntimeTools: true,
    })

    expect(registry.hasTool('exec')).toBe(true)
    expect(registry.hasTool('bash')).toBe(true)
    expect(registry.hasTool('process')).toBe(true)
    expect(registry.hasTool('code_execution')).toBe(true)
  })

  it('each runtime tool has category execute and sensitivity high', () => {
    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
      processSessionStore,
      enableRuntimeTools: true,
    })

    const execTool = registry.getTool('exec')
    expect(execTool?.category).toBe('execute')
    expect(execTool?.sensitivity).toBe('high')

    const bashTool = registry.getTool('bash')
    expect(bashTool?.category).toBe('execute')
    expect(bashTool?.sensitivity).toBe('high')

    const processTool = registry.getTool('process')
    expect(processTool?.category).toBe('execute')
    expect(processTool?.sensitivity).toBe('high')

    const codeExecTool = registry.getTool('code_execution')
    expect(codeExecTool?.category).toBe('execute')
    expect(codeExecTool?.sensitivity).toBe('high')
  })

  it('getFallbackToolCatalog includes all 4 runtime tools', () => {
    const catalog = getFallbackToolCatalog()

    const execEntry = catalog.find((t) => t.name === 'exec')
    expect(execEntry).toBeDefined()
    expect(execEntry?.category).toBe('execute')
    expect(execEntry?.sensitivity).toBe('high')

    const bashEntry = catalog.find((t) => t.name === 'bash')
    expect(bashEntry).toBeDefined()

    const processEntry = catalog.find((t) => t.name === 'process')
    expect(processEntry).toBeDefined()

    const codeExecEntry = catalog.find((t) => t.name === 'code_execution')
    expect(codeExecEntry).toBeDefined()
  })

  it('risk policies: all 4 runtime tools have requiresApproval true and riskLevel high', () => {
    const catalog = getFallbackToolCatalog()
    const policies = buildRiskPoliciesFromCatalog(catalog)

    const execPolicy = policies.find((p) => p.toolName === 'exec')
    expect(execPolicy?.requiresApproval).toBe(true)
    expect(execPolicy?.riskLevel).toBe('high')

    const bashPolicy = policies.find((p) => p.toolName === 'bash')
    expect(bashPolicy?.requiresApproval).toBe(true)
    expect(bashPolicy?.riskLevel).toBe('high')

    const processPolicy = policies.find((p) => p.toolName === 'process')
    expect(processPolicy?.requiresApproval).toBe(true)
    expect(processPolicy?.riskLevel).toBe('high')

    const codeExecPolicy = policies.find((p) => p.toolName === 'code_execution')
    expect(codeExecPolicy?.requiresApproval).toBe(true)
    expect(codeExecPolicy?.riskLevel).toBe('high')
  })

  it('does not register runtime tools when enableRuntimeTools is false', () => {
    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
      processSessionStore,
      enableRuntimeTools: false,
    })

    expect(registry.hasTool('exec')).toBe(false)
    expect(registry.hasTool('bash')).toBe(false)
    expect(registry.hasTool('process')).toBe(false)
    expect(registry.hasTool('code_execution')).toBe(false)
  })

  it('registers todo tools when todoStore is provided', () => {
    const mockTodoStore: any = {
      findById: () => null,
      findBySession: () => [],
      create: () => ({}),
      update: () => null,
      remove: () => true,
      replace: () => [],
    }

    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
      todoStore: mockTodoStore,
    })

    expect(registry.hasTool('todolist')).toBe(true)
    expect(registry.hasTool('todowrite')).toBe(true)
  })

  it('does not register todo tools when todoStore is not provided', () => {
    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
    })

    expect(registry.hasTool('todolist')).toBe(false)
    expect(registry.hasTool('todowrite')).toBe(false)
  })

  it('todo tools have correct categories (todolist=read, todowrite=write)', () => {
    const mockTodoStore: any = {
      findById: () => null,
      findBySession: () => [],
      create: () => ({}),
      update: () => null,
      remove: () => true,
      replace: () => [],
    }

    registerBuiltInTools(registry, {
      artifactStore: {} as any,
      summaryStore: {} as any,
      transcriptStore: {} as any,
      planStore: {} as any,
      longTermMemoryStore: {} as any,
      sessionStore: {} as any,
      todoStore: mockTodoStore,
    })

    const todolistTool = registry.getTool('todolist')
    expect(todolistTool?.category).toBe('read')

    const todowriteTool = registry.getTool('todowrite')
    expect(todowriteTool?.category).toBe('write')
  })
})
