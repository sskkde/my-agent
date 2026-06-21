/**
 * Prompt Template Runtime - Hash Stability & Flag Interaction Matrix Tests
 *
 * Verifies that the ModelInputBuilder produces stable segment hashes across
 * flag combinations, and that flag interactions are correct:
 *
 * Flag Matrix:
 * 1. P0=OFF, TEMPLATE=OFF  → No projections injected, segment hashes = baseline
 * 2. P0=ON,  TEMPLATE=OFF  → Default hardcoded projections, segments B/C/D change
 * 3. P0=ON,  TEMPLATE=ON   → Template-loaded projections, segments B/C/D differ from defaults
 * 4. P0=OFF, TEMPLATE=ON   → P0 gates TEMPLATE, behaves same as #1
 *
 * Key invariant: Segment A hash is IDENTICAL across ALL flag combinations.
 *
 * @module tests/unit/prompt/prompt-template-runtime-hash
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'
import { createPromptProjectionResolver } from '../../../src/prompt/prompt-projection-resolver.js'

// ─── Test Templates ──────────────────────────────────────────────────────────

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
        taxonomyLayer: 'platform',
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
        taxonomyLayer: 'platform',
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
        taxonomyLayer: 'provider',
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
        taxonomyLayer: 'provider',
        content: 'DeepSeek provider config for {agentKind}.',
        description: 'Test deepseek provider',
      },
    ],
    [
      'agentProfile:foreground',
      {
        id: 'agentProfile:foreground',
        version: '2026-05-23',
        path: 'agents/foreground.md',
        agentKind: 'foreground',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'foreground',
        content: 'Foreground agent instructions for {agentKind}.',
        description: 'Test foreground agent',
      },
    ],
    [
      'agentProfile:default_main',
      {
        id: 'agentProfile:default_main',
        version: '2026-05-23',
        path: 'agents/kernel.md',
        agentKind: 'kernel',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'default_main',
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
    [
      'persona:default',
      {
        id: 'persona:default',
        version: '2026-05-24',
        path: 'persona/default.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 5,
        content: 'Template-based persona style guidelines content.',
        description: 'Test persona template',
      },
    ],
    [
      'heuristics:tool-usage.common',
      {
        id: 'heuristics:tool-usage.common',
        version: '2026-05-24',
        path: 'heuristics/tool-usage.common.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 6,
        content: 'Template-based tool usage heuristics content.',
        description: 'Test heuristics template',
      },
    ],
    [
      'context:memory-use-rules',
      {
        id: 'context:memory-use-rules',
        version: '2026-05-24',
        path: 'context/memory-use-rules.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 7,
        content: 'Template-based memory use rules content.',
        description: 'Test memory rules template',
      },
    ],
  ])
}

// ─── Builder & Resolver Factories ────────────────────────────────────────────

function makeBuilder(): ModelInputBuilder {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates, '/nonexistent')
  const loader = new TemplateLoader('/nonexistent')
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader })
}

function makeResolver() {
  const templates = makeTestTemplates()
  const registry = new PromptTemplateRegistry(templates)
  const loader = new TemplateLoader()
  return createPromptProjectionResolver(registry, loader)
}

function makeMinimalInput(overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'routing_json',
    agentKind: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  }
}

// ─── Flag State Helpers ──────────────────────────────────────────────────────

interface FlagState {
  p0: boolean
  template: boolean
}

const FLAG_MATRIX: FlagState[] = [
  { p0: false, template: false },
  { p0: true, template: false },
  { p0: true, template: true },
  { p0: false, template: true },
]

function setFlagEnv(state: FlagState): void {
  if (state.p0) {
    process.env.PROMPT_MEMORY_P0_ENABLED = 'true'
  } else {
    delete process.env.PROMPT_MEMORY_P0_ENABLED
  }
  if (state.template) {
    process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED = 'true'
  } else {
    delete process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED
  }
}

function clearFlagEnv(): void {
  delete process.env.PROMPT_MEMORY_P0_ENABLED
  delete process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED
}

function flagLabel(state: FlagState): string {
  return `P0=${state.p0}, TEMPLATE=${state.template}`
}

/**
 * Resolves projections for a flag state and builds input with those projections.
 * This mirrors the production flow: ForegroundAgent.resolveProjections() → buildModelInput().
 */
async function buildWithFlagState(
  builder: ModelInputBuilder,
  resolver: ReturnType<typeof makeResolver>,
  flagState: FlagState,
  inputOverrides: Partial<ModelInputBuildInput> = {},
): Promise<import('../../../src/kernel/model-input/model-input-types.js').BuiltModelInput> {
  setFlagEnv(flagState)
  const projections = await resolver.resolve({})
  return builder.build(makeMinimalInput({ ...projections, ...inputOverrides }))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Prompt Template Runtime - Hash Stability & Flag Interaction Matrix', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    clearFlagEnv()
    process.env = originalEnv
  })

  describe('Segment A hash is identical across ALL flag combinations', () => {
    it('segmentAHash does not change across the full P0×TEMPLATE matrix', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()
      const hashes: string[] = []

      for (const flagState of FLAG_MATRIX) {
        const result = await buildWithFlagState(builder, resolver, flagState)
        hashes.push(result.segmentHashes.segmentA)
      }

      expect(hashes[0]).toBe(hashes[1])
      expect(hashes[1]).toBe(hashes[2])
      expect(hashes[2]).toBe(hashes[3])
    })

    it('segmentAHash remains stable when projections are manually injected', async () => {
      const builder = makeBuilder()

      clearFlagEnv()
      const resultBaseline = await builder.build(makeMinimalInput())

      const resultWithProjections = await builder.build(
        makeMinimalInput({
          personaProjection: {
            personaId: 'default-assistant',
            styleGuidelines: 'test-style',
            constraints: ['constraint-1'],
          },
          toolSelectionPolicy: {
            heuristics: 'test-heuristics',
          },
          memoryPolicyProjection: {
            useRules: 'test-rules',
          },
        }),
      )

      expect(resultBaseline.segmentHashes.segmentA).toBe(resultWithProjections.segmentHashes.segmentA)
    })
  })

  describe('Flag OFF baseline — segments B/C/D unchanged from pre-P0 state', () => {
    it('P0=OFF → segmentB hash identical to build without any projection fields', async () => {
      const builder = makeBuilder()
      clearFlagEnv()

      const resultNoProjection = await builder.build(makeMinimalInput())
      const resultExplicitNoProjection = await builder.build(
        makeMinimalInput({
          personaProjection: undefined,
        }),
      )

      expect(resultNoProjection.segmentHashes.segmentB).toBe(resultExplicitNoProjection.segmentHashes.segmentB)
    })

    it('P0=OFF → segmentC hash identical to build without toolSelectionPolicy', async () => {
      const builder = makeBuilder()
      clearFlagEnv()

      const resultNoPolicy = await builder.build(makeMinimalInput())
      const resultExplicitNoPolicy = await builder.build(
        makeMinimalInput({
          toolSelectionPolicy: undefined,
        }),
      )

      expect(resultNoPolicy.segmentHashes.segmentC).toBe(resultExplicitNoPolicy.segmentHashes.segmentC)
    })

    it('P0=OFF → segmentD hash identical to build without memoryPolicyProjection', async () => {
      const builder = makeBuilder()
      clearFlagEnv()

      const resultNoMemory = await builder.build(makeMinimalInput())
      const resultExplicitNoMemory = await builder.build(
        makeMinimalInput({
          memoryPolicyProjection: undefined,
        }),
      )

      expect(resultNoMemory.segmentHashes.segmentD).toBe(resultExplicitNoMemory.segmentHashes.segmentD)
    })
  })

  describe('Flag interaction matrix — P0×TEMPLATE produces expected hash differences', () => {
    it('P0=OFF + TEMPLATE=OFF ≡ P0=OFF + TEMPLATE=ON (P0 gates TEMPLATE)', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()

      const result1 = await buildWithFlagState(builder, resolver, { p0: false, template: false })
      const result2 = await buildWithFlagState(builder, resolver, { p0: false, template: true })

      expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA)
      expect(result1.segmentHashes.segmentB).toBe(result2.segmentHashes.segmentB)
      expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC)
      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('P0=ON + TEMPLATE=OFF → segments B/C/D differ from P0=OFF baseline', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()

      const baseline = await buildWithFlagState(builder, resolver, { p0: false, template: false })
      const withDefaults = await buildWithFlagState(builder, resolver, { p0: true, template: false })

      expect(baseline.segmentHashes.segmentA).toBe(withDefaults.segmentHashes.segmentA)

      expect(baseline.segmentHashes.segmentB).not.toBe(withDefaults.segmentHashes.segmentB)
      expect(baseline.segmentHashes.segmentC).not.toBe(withDefaults.segmentHashes.segmentC)
      expect(baseline.segmentHashes.segmentD).not.toBe(withDefaults.segmentHashes.segmentD)
    })

    it('P0=ON + TEMPLATE=ON → segments B/C/D differ from P0=ON + TEMPLATE=OFF', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()

      const withDefaults = await buildWithFlagState(builder, resolver, { p0: true, template: false })
      const withTemplates = await buildWithFlagState(builder, resolver, { p0: true, template: true })

      expect(withDefaults.segmentHashes.segmentA).toBe(withTemplates.segmentHashes.segmentA)

      expect(withDefaults.segmentHashes.segmentB).not.toBe(withTemplates.segmentHashes.segmentB)
      expect(withDefaults.segmentHashes.segmentC).not.toBe(withTemplates.segmentHashes.segmentC)
      expect(withDefaults.segmentHashes.segmentD).not.toBe(withTemplates.segmentHashes.segmentD)
    })

    it('all 4 matrix cells produce distinct B/C/D hashes (except P0=OFF pairs)', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()
      const results: Map<string, { segmentA: string; segmentB: string; segmentC: string; segmentD: string }> = new Map()

      for (const flagState of FLAG_MATRIX) {
        const result = await buildWithFlagState(builder, resolver, flagState)
        results.set(flagLabel(flagState), {
          segmentA: result.segmentHashes.segmentA,
          segmentB: result.segmentHashes.segmentB,
          segmentC: result.segmentHashes.segmentC,
          segmentD: result.segmentHashes.segmentD,
        })
      }

      const offOff = results.get('P0=false, TEMPLATE=false')!
      const onOff = results.get('P0=true, TEMPLATE=false')!
      const onOn = results.get('P0=true, TEMPLATE=true')!
      const offOn = results.get('P0=false, TEMPLATE=true')!

      expect(offOff.segmentB).toBe(offOn.segmentB)
      expect(offOff.segmentC).toBe(offOn.segmentC)
      expect(offOff.segmentD).toBe(offOn.segmentD)

      expect(onOff.segmentB).not.toBe(onOn.segmentB)
      expect(onOff.segmentC).not.toBe(onOn.segmentC)
      expect(onOff.segmentD).not.toBe(onOn.segmentD)

      expect(offOff.segmentB).not.toBe(onOff.segmentB)
      expect(offOff.segmentC).not.toBe(onOff.segmentC)
      expect(offOff.segmentD).not.toBe(onOff.segmentD)
    })
  })

  describe('Projection resolver produces correct hash-affecting output', () => {
    it('resolver with P0=ON + TEMPLATE=OFF injects default projections that change segment B/C/D', async () => {
      const resolver = makeResolver()

      setFlagEnv({ p0: true, template: false })
      const projections = await resolver.resolve({})

      expect(projections.personaProjection).toBeDefined()
      expect(projections.toolSelectionPolicy).toBeDefined()
      expect(projections.memoryPolicyProjection).toBeDefined()

      expect(projections.personaProjection!.personaId).toBe('default-assistant')
      expect(projections.personaProjection!.styleGuidelines).toBe('沉稳、清晰、尊重边界')
      expect(projections.toolSelectionPolicy!.heuristics).toBe('直接回答优先，读优先于写，低风险优先')
      expect(projections.memoryPolicyProjection!.useRules).toBe('记忆为私有背景上下文，默认不主动声明"我记得"')

      const builder = makeBuilder()
      clearFlagEnv()
      const baseline = await builder.build(makeMinimalInput())
      const withDefaults = await builder.build(
        makeMinimalInput({
          personaProjection: projections.personaProjection,
          toolSelectionPolicy: projections.toolSelectionPolicy,
          memoryPolicyProjection: projections.memoryPolicyProjection,
        }),
      )

      expect(baseline.segmentHashes.segmentA).toBe(withDefaults.segmentHashes.segmentA)
      expect(baseline.segmentHashes.segmentB).not.toBe(withDefaults.segmentHashes.segmentB)
      expect(baseline.segmentHashes.segmentC).not.toBe(withDefaults.segmentHashes.segmentC)
      expect(baseline.segmentHashes.segmentD).not.toBe(withDefaults.segmentHashes.segmentD)
    })

    it('resolver with P0=OFF returns empty result (no hash changes)', async () => {
      const resolver = makeResolver()

      setFlagEnv({ p0: false, template: false })
      const projections = await resolver.resolve({})

      expect(projections.personaProjection).toBeUndefined()
      expect(projections.toolSelectionPolicy).toBeUndefined()
      expect(projections.memoryPolicyProjection).toBeUndefined()
    })

    it('resolver with P0=OFF + TEMPLATE=ON returns empty (P0 gates TEMPLATE)', async () => {
      const resolver = makeResolver()

      setFlagEnv({ p0: false, template: true })
      const projections = await resolver.resolve({})

      expect(projections.personaProjection).toBeUndefined()
      expect(projections.toolSelectionPolicy).toBeUndefined()
      expect(projections.memoryPolicyProjection).toBeUndefined()
    })

    it('resolver with P0=ON + TEMPLATE=ON produces projections with extended constraints', async () => {
      const resolver = makeResolver()

      setFlagEnv({ p0: true, template: true })
      const projections = await resolver.resolve({})

      expect(projections.personaProjection).toBeDefined()
      expect(projections.toolSelectionPolicy).toBeDefined()
      expect(projections.memoryPolicyProjection).toBeDefined()

      expect(projections.personaProjection!.constraints.length).toBe(5)
      expect(projections.memoryPolicyProjection!.invisibilityRules).toBeDefined()
      expect(projections.memoryPolicyProjection!.invisibilityRules!.length).toBe(3)
    })
  })

  describe('Hash determinism across flag combinations', () => {
    it('identical flag state always produces identical segment hashes', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()

      for (const flagState of FLAG_MATRIX) {
        const result1 = await buildWithFlagState(builder, resolver, flagState)
        const result2 = await buildWithFlagState(builder, resolver, flagState)

        expect(result1.segmentHashes.segmentA).toBe(result2.segmentHashes.segmentA)
        expect(result1.segmentHashes.segmentB).toBe(result2.segmentHashes.segmentB)
        expect(result1.segmentHashes.segmentC).toBe(result2.segmentHashes.segmentC)
        expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
      }
    })

    it('segment hashes are valid 64-character hex strings across all flag states', async () => {
      const builder = makeBuilder()
      const resolver = makeResolver()
      const hashRegex = /^[a-f0-9]{64}$/

      for (const flagState of FLAG_MATRIX) {
        const result = await buildWithFlagState(builder, resolver, flagState)

        expect(result.segmentHashes.segmentA).toMatch(hashRegex)
        expect(result.segmentHashes.segmentB).toMatch(hashRegex)
        expect(result.segmentHashes.segmentC).toMatch(hashRegex)
        expect(result.segmentHashes.segmentD).toMatch(hashRegex)
      }
    })
  })
})
