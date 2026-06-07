import { describe, it, expect, beforeEach } from 'vitest'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import type { ToolRegistry } from '../../../src/tools/types.js'
import { getFallbackToolCatalog, buildRuntimeToolCatalog } from '../../../src/tools/tool-catalog.js'
import { buildDefaultRiskPolicies, buildRiskPoliciesFromCatalog } from '../../../src/permissions/tool-risk-policy.js'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createArtifactStore } from '../../../src/storage/artifact-store.js'
import { createSummaryStore } from '../../../src/storage/summary-store.js'
import { createTranscriptStore } from '../../../src/storage/transcript-store.js'
import { createPlanStore } from '../../../src/storage/plan-store.js'
import { createLongTermMemoryStore } from '../../../src/storage/long-term-memory-store.js'
import { createSessionStore } from '../../../src/storage/session-store.js'

describe('Tool Catalog Consistency', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    const connection = createConnectionManager(':memory:')
    connection.open()

    const artifactStore = createArtifactStore(connection)
    const summaryStore = createSummaryStore(connection)
    const transcriptStore = createTranscriptStore(connection)
    const planStore = createPlanStore(connection)
    const longTermMemoryStore = createLongTermMemoryStore(connection)
    const sessionStore = createSessionStore(connection)

    registry = createToolRegistry()
    registerBuiltInTools(registry, {
      artifactStore,
      summaryStore,
      transcriptStore,
      planStore,
      longTermMemoryStore,
      sessionStore,
    })
  })

  it('should produce consistent tool sets between fallback and runtime catalog', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const runtimeCatalog = buildRuntimeToolCatalog(registry, { includeMock: true })

    const fallbackToolNames = new Set(fallbackCatalog.map((e) => e.name))
    const runtimeToolNames = new Set(runtimeCatalog.map((e) => e.name))

    expect(runtimeToolNames.size).toBeGreaterThan(0)

    for (const name of runtimeToolNames) {
      expect(fallbackToolNames.has(name)).toBe(true)
    }
  })

  it('should have all required fields populated in fallback catalog', () => {
    const fallbackCatalog = getFallbackToolCatalog()

    expect(fallbackCatalog.length).toBeGreaterThan(0)

    for (const entry of fallbackCatalog) {
      expect(entry.name).toBeDefined()
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.description).toBeDefined()
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.category).toBeDefined()
      expect(entry.sensitivity).toBeDefined()
      expect(entry.executionPlane).toBeDefined()
      expect(entry.availability).toBeDefined()
      expect(entry.isMock).toBeDefined()
      expect(entry.source).toBeDefined()
    }
  })

  it('should have all required fields populated in runtime catalog', () => {
    const runtimeCatalog = buildRuntimeToolCatalog(registry, { includeMock: true })

    expect(runtimeCatalog.length).toBeGreaterThan(0)

    for (const entry of runtimeCatalog) {
      expect(entry.name).toBeDefined()
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.description).toBeDefined()
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.category).toBeDefined()
      expect(entry.sensitivity).toBeDefined()
      expect(entry.executionPlane).toBeDefined()
      expect(entry.availability).toBeDefined()
      expect(entry.isMock).toBeDefined()
      expect(entry.source).toBeDefined()
    }
  })

  it('should mark mock connector tools with isMock: true', () => {
    const fallbackCatalog = getFallbackToolCatalog()

    const mockConnectorToolNames = [
      'email_search',
      'email_send_draft',
      'calendar_list',
      'calendar_create_event',
      'contacts_search',
      'docs_read',
    ]

    for (const toolName of mockConnectorToolNames) {
      const entry = fallbackCatalog.find((e) => e.name === toolName)
      expect(entry).toBeDefined()
      expect(entry!.isMock).toBe(true)
      expect(entry!.source).toBe('mock')
      expect(entry!.executionPlane).toBe('mock_connector')
    }
  })

  it('should mark builtin tools with isMock: false', () => {
    const fallbackCatalog = getFallbackToolCatalog()

    const builtinToolNames = ['artifact_create', 'ask_user', 'status_query', 'file_read', 'web_search']

    for (const toolName of builtinToolNames) {
      const entry = fallbackCatalog.find((e) => e.name === toolName)
      expect(entry).toBeDefined()
      expect(entry!.isMock).toBe(false)
      expect(entry!.source).toBe('builtin')
    }
  })

  it('should match risk policies from catalog with buildDefaultRiskPolicies', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const catalogPolicies = buildRiskPoliciesFromCatalog(fallbackCatalog)
    const defaultPolicies = buildDefaultRiskPolicies()

    expect(catalogPolicies.length).toBe(defaultPolicies.length)

    const catalogPolicyMap = new Map(catalogPolicies.map((p) => [p.toolName, p]))
    const defaultPolicyMap = new Map(defaultPolicies.map((p) => [p.toolName, p]))

    for (const [toolName, catalogPolicy] of catalogPolicyMap) {
      const defaultPolicy = defaultPolicyMap.get(toolName)
      expect(defaultPolicy).toBeDefined()
      expect(catalogPolicy.riskLevel).toBe(defaultPolicy!.riskLevel)
      expect(catalogPolicy.requiresApproval).toBe(defaultPolicy!.requiresApproval)
      expect(catalogPolicy.canAutoGrant).toBe(defaultPolicy!.canAutoGrant)
      expect(catalogPolicy.auditLevel).toBe(defaultPolicy!.auditLevel)
    }
  })

  it('should have valid execution plane for all tools', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const validPlanes = ['standard', 'foreground', 'connector', 'mock_connector', 'catalog_only']

    for (const entry of fallbackCatalog) {
      expect(validPlanes).toContain(entry.executionPlane)
    }
  })

  it('should have valid availability for all tools', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const validAvailability = ['registered', 'foreground_only', 'deferred', 'disabled', 'mock']

    for (const entry of fallbackCatalog) {
      expect(validAvailability).toContain(entry.availability)
    }
  })

  it('should have valid source for all tools', () => {
    const fallbackCatalog = getFallbackToolCatalog()
    const validSources = ['builtin', 'foreground', 'connector', 'mcp', 'mock', 'unknown']

    for (const entry of fallbackCatalog) {
      expect(validSources).toContain(entry.source)
    }
  })
})
