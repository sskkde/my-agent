import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import { computeCacheKey } from '../../../src/kernel/model-input/model-input-cache-key.js'

const TENANT_A = 'org_tenant_alpha'
const TENANT_B = 'org_tenant_beta'

function makeTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    [
      'platform:base',
      {
        id: 'platform:base',
        version: '2026-05-23',
        path: 'platform/base.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Platform Base for {agentKind} agent with {providerFamily} provider.',
        description: 'Test platform base',
      },
    ],
    [
      'platform:safety',
      {
        id: 'platform:safety',
        version: '2026-05-23',
        path: 'platform/safety.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 1,
        content: 'Safety rules for {agentKind}.',
        description: 'Test safety',
      },
    ],
    [
      'provider:openai',
      {
        id: 'provider:openai',
        version: '2026-05-23',
        path: 'provider/openai.md',
        agentKind: '*',
        providerFamily: 'openai',
        layer: 2,
        content: 'OpenAI provider config for {agentKind}.',
        description: 'Test openai provider',
      },
    ],
    [
      'provider:deepseek',
      {
        id: 'provider:deepseek',
        version: '2026-05-23',
        path: 'provider/deepseek.md',
        agentKind: '*',
        providerFamily: 'deepseek',
        layer: 2,
        content: 'DeepSeek provider config for {agentKind}.',
        description: 'Test deepseek provider',
      },
    ],
    [
      'agents:foreground',
      {
        id: 'agents:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        content: 'Foreground agent instructions for {agentKind}.',
        description: 'Test foreground agent',
      },
    ],
    [
      'agents:kernel',
      {
        id: 'agents:kernel',
        version: '2026-05-23',
        path: 'agents/kernel.md',
        agentKind: 'kernel',
        providerFamily: '*',
        layer: 3,
        content: 'Kernel agent instructions for {agentKind}.',
        description: 'Test kernel agent',
      },
    ],
    [
      'output:foreground.schema',
      {
        id: 'output:foreground.schema',
        version: '2026-05-23',
        path: 'output/foreground.schema.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 4,
        content: 'Output schema for {agentKind} with {providerFamily}.',
        description: 'Test foreground schema',
      },
    ],
    [
      'output:planner.schema',
      {
        id: 'output:planner.schema',
        version: '2026-05-23',
        path: 'output/planner.schema.md',
        agentKind: 'planner',
        providerFamily: '*',
        layer: 4,
        content: 'Planner output schema for {agentKind}.',
        description: 'Test planner schema',
      },
    ],
  ])
}

function makeBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

function makeTenantInput(tenantId: string, overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'routing_json',
    agentKind: 'foreground',
    providerFamily: 'openai',
    systemPrompt: `Instructions for ${tenantId}: Follow ${tenantId} policies strictly.`,
    routingPrompt: `Routing rules for ${tenantId}: prioritize ${tenantId} workflows.`,
    currentUserMessage: `Request from user in ${tenantId}`,
    ...overrides,
  }
}

describe('Tenant Leakage Security Tests', () => {
  describe('cross-tenant instruction isolation', () => {
    it('Tenant A instructions do not appear in Tenant B build', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(makeTenantInput(TENANT_A))
      const resultB = await builder.build(makeTenantInput(TENANT_B))

      expect(resultA.segments.tenantProject).toContain(TENANT_A)
      expect(resultA.segments.tenantProject).not.toContain(TENANT_B)

      expect(resultB.segments.tenantProject).toContain(TENANT_B)
      expect(resultB.segments.tenantProject).not.toContain(TENANT_A)
    })

    it('Tenant A context does not appear in Tenant B contextBundle', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(
        makeTenantInput(TENANT_A, {
          contextBundle: {
            pinnedItems: [{ itemId: 'p1', content: `Tenant Alpha secret policy: ${TENANT_A} data` }],
          },
          currentUserMessage: `Tenant Alpha user request with ${TENANT_A} specifics`,
        }),
      )

      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          contextBundle: {
            pinnedItems: [{ itemId: 'p1', content: `Tenant Beta public policy: ${TENANT_B} data` }],
          },
          currentUserMessage: `Tenant Beta user request with ${TENANT_B} specifics`,
        }),
      )

      expect(resultA.segments.contextBundle).toContain(TENANT_A)
      expect(resultA.segments.contextBundle).not.toContain(TENANT_B)

      expect(resultB.segments.contextBundle).toContain(TENANT_B)
      expect(resultB.segments.contextBundle).not.toContain(TENANT_A)
    })

    it('different systemPrompt produces different segmentB hash', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(makeTenantInput(TENANT_A))
      const resultB = await builder.build(makeTenantInput(TENANT_B))

      expect(resultA.segmentHashes.segmentB).not.toBe(resultB.segmentHashes.segmentB)
    })
  })

  describe('cross-tenant tool projection isolation', () => {
    it('Tenant A tools do not appear in Tenant B tool plane', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(
        makeTenantInput(TENANT_A, {
          toolProjection: {
            toolIds: ['file_read', 'web_search'],
            toolSummaries: `${TENANT_A} tools: read files, search web`,
          },
        }),
      )

      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          toolProjection: {
            toolIds: ['memory_retrieve', 'status_query'],
            toolSummaries: `${TENANT_B} tools: retrieve memory, query status`,
          },
        }),
      )

      expect(resultA.segments.toolPlane).toContain('file_read')
      expect(resultA.segments.toolPlane).toContain('web_search')
      expect(resultA.segments.toolPlane).not.toContain('memory_retrieve')
      expect(resultA.segments.toolPlane).not.toContain(TENANT_B)

      expect(resultB.segments.toolPlane).toContain('memory_retrieve')
      expect(resultB.segments.toolPlane).toContain('status_query')
      expect(resultB.segments.toolPlane).not.toContain('file_read')
      expect(resultB.segments.toolPlane).not.toContain(TENANT_A)
    })

    it('different tool projection produces different segmentC hash', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(
        makeTenantInput(TENANT_A, {
          toolProjection: { toolIds: ['file_read'] },
        }),
      )
      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          toolProjection: { toolIds: ['memory_retrieve'] },
        }),
      )

      expect(resultA.segmentHashes.segmentC).not.toBe(resultB.segmentHashes.segmentC)
    })
  })

  describe('cross-tenant memory does not enter prompt', () => {
    it('pinned items from Tenant A do not leak into Tenant B build', async () => {
      const builder = makeBuilder()

      const tenantAMemory = 'Alpha confidential: internal roadmap details'
      const tenantBMemory = 'Beta confidential: financial projections Q3'

      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          contextBundle: {
            pinnedItems: [{ itemId: 'b-pin', content: tenantBMemory }],
          },
        }),
      )

      expect(resultB.segments.contextBundle).toContain(tenantBMemory)
      expect(resultB.segments.contextBundle).not.toContain(tenantAMemory)
    })

    it('ordered context items from Tenant A do not appear in Tenant B', async () => {
      const builder = makeBuilder()

      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          contextBundle: {
            orderedItems: [
              { itemId: 'b-1', content: 'Beta context: project Beta details' },
              { itemId: 'b-2', content: 'Beta context: team Beta structure' },
            ],
          },
        }),
      )

      expect(resultB.segments.contextBundle).toContain('Beta context')
      expect(resultB.segments.contextBundle).not.toContain('Alpha context')
    })

    it('transcript from Tenant A does not appear in Tenant B build', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(
        makeTenantInput(TENANT_A, {
          transcript: [
            { role: 'user', content: 'Show me Alpha internal data' },
            { role: 'assistant', content: 'Here is Alpha confidential information' },
          ],
        }),
      )

      const resultB = await builder.build(
        makeTenantInput(TENANT_B, {
          transcript: [
            { role: 'user', content: 'Show me Beta public data' },
            { role: 'assistant', content: 'Here is Beta shared information' },
          ],
        }),
      )

      expect(resultA.segments.contextBundle).toContain('Alpha confidential')
      expect(resultA.segments.contextBundle).not.toContain('Beta shared')

      expect(resultB.segments.contextBundle).toContain('Beta shared')
      expect(resultB.segments.contextBundle).not.toContain('Alpha confidential')
    })
  })

  describe('cache key isolation', () => {
    it('different tenants produce different cache keys when instructions differ', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(makeTenantInput(TENANT_A))
      const resultB = await builder.build(makeTenantInput(TENANT_B))

      const cacheKeyA = computeCacheKey(
        resultA.segmentHashes.segmentA,
        resultA.segmentHashes.segmentB,
        resultA.segmentHashes.segmentC,
      )
      const cacheKeyB = computeCacheKey(
        resultB.segmentHashes.segmentA,
        resultB.segmentHashes.segmentB,
        resultB.segmentHashes.segmentC,
      )

      expect(cacheKeyA).not.toBe(cacheKeyB)
    })
  })

  describe('Segment A is tenant-independent', () => {
    it('same agentKind + providerFamily → same Segment A regardless of tenant', async () => {
      const builder = makeBuilder()

      const resultA = await builder.build(makeTenantInput(TENANT_A))
      const resultB = await builder.build(makeTenantInput(TENANT_B))

      expect(resultA.segmentHashes.segmentA).toBe(resultB.segmentHashes.segmentA)
    })
  })
})
