/**
 * T5/T6/T7 Template Consumption Contract Tests
 *
 * These tests lock the contract that taxonomy templates T5 (agentProfile),
 * T6 (toolProjection), and T7 (runtimeContext) are consumed by the builder
 * behind feature flags. When flags are OFF, these templates must NOT appear
 * in the built segments. When flags are ON, they MUST appear.
 *
 * EXPECTED FAILURE: Currently, T5/T6/T7 templates are registered but the
 * builder does not consume them (StaticPrefixBuilder filters to layer <= 4).
 * These tests assert the TARGET behavior after migration.
 *
 * @module tests/unit/kernel/model-input/t5-t7-template-consumption
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../../src/kernel/model-input/model-input-types.js'

// ─── Test Templates ──────────────────────────────────────────────────────────

function makeTestTemplates(): Map<string, PromptTemplateRecord> {
  return new Map([
    // T1 - Platform
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
        content: 'Platform base rules.',
        description: 'Test platform base',
      },
    ],
    // T2 - Provider
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
        content: 'OpenAI provider config.',
        description: 'Test openai provider',
      },
    ],
    // T3 - AgentType
    [
      'agentType:main',
      {
        id: 'agentType:main',
        version: '2026-05-23',
        path: 'agentType/main.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 3,
        taxonomyLayer: 'agentType',
        agentType: 'main',
        content: 'Main agent behavior rules.',
        description: 'Test main agent type',
      },
    ],
    // T5 - agentProfile (SHOULD be consumed in Segment B when flag ON)
    [
      'agentProfile:foreground',
      {
        id: 'agentProfile:foreground',
        version: '2026-05-23',
        path: 'agentProfile/foreground.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 5,
        taxonomyLayer: 'agentProfile',
        agentProfile: 'foreground',
        content: 'Foreground agent profile instructions. Respond to user queries.',
        description: 'Test foreground profile',
      },
    ],
    // T6 - toolProjection (SHOULD be consumed in Segment C when flag ON)
    [
      'toolProjection:default',
      {
        id: 'toolProjection:default',
        version: '2026-05-23',
        path: 'toolProjection/default.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 6,
        taxonomyLayer: 'toolProjection',
        content: 'Tool usage heuristics: prefer read-only tools first.',
        description: 'Test tool projection',
      },
    ],
    // T7 - runtimeContext (SHOULD be consumed in Segment D when flag ON)
    [
      'runtimeContext:default',
      {
        id: 'runtimeContext:default',
        version: '2026-05-23',
        path: 'runtimeContext/default.md',
        agentKind: '*',
        providerFamily: '*',
        layer: 7,
        taxonomyLayer: 'runtimeContext',
        content: 'Runtime context rules: always include current date and session info.',
        description: 'Test runtime context',
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

function makeMinimalInput(overrides: Partial<ModelInputBuildInput> = {}): ModelInputBuildInput {
  return {
    mode: 'routing_json',
    agentType: 'main',
    agentProfile: 'foreground',
    providerFamily: 'openai',
    ...overrides,
  }
}

// ─── Feature flag env helpers ────────────────────────────────────────────────

function setFlag(flag: string, value: boolean): void {
  process.env[flag] = value ? 'true' : 'false'
}

function clearFlags(): void {
  delete process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED
  delete process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED
  delete process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED
  delete process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED
  delete process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED
  delete process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED
  delete process.env.PROMPT_RICH_PERSONA_ENABLED
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('T5/T6/T7 Template Consumption', () => {
  beforeEach(() => {
    clearFlags()
  })

  afterEach(() => {
    clearFlags()
  })

  describe('Feature OFF: T5 templates NOT in Segment B', () => {
    it('T5 agentProfile content is absent from Segment B when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is false', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', false)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          systemPrompt: 'You are a helpful assistant.',
        }),
      )

      // T5 content should NOT appear in Segment B when flag is OFF
      expect(result.segments.tenantProject).not.toContain('Foreground agent profile instructions')
      expect(result.segments.tenantProject).not.toContain('Respond to user queries')
      // But systemPrompt should still be there
      expect(result.segments.tenantProject).toContain('You are a helpful assistant.')
    })

    it('T5 agentProfile content is absent from Segment B when flag env is undefined (default OFF)', async () => {
      // No flag set at all - should default to OFF
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          systemPrompt: 'System prompt text.',
        }),
      )

      expect(result.segments.tenantProject).not.toContain('Foreground agent profile instructions')
      expect(result.segments.tenantProject).toContain('System prompt text.')
    })

    it('T5 content is absent from Segment A regardless of flag', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(makeMinimalInput())

      // T5 content should NEVER be in Segment A (that's T1-T4 only)
      expect(result.segments.staticPrefix).not.toContain('Foreground agent profile instructions')
    })
  })

  describe('Feature ON: T5 templates present in Segment B', () => {
    it('T5 agentProfile content appears in Segment B when PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED is true', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          systemPrompt: 'You are a helpful assistant.',
        }),
      )

      // T5 content SHOULD appear in Segment B when flag is ON
      expect(result.segments.tenantProject).toContain('Foreground agent profile instructions')
      expect(result.segments.tenantProject).toContain('You are a helpful assistant.')
    })

    it('T5 content appears after systemPrompt (B1) in Segment B', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          systemPrompt: 'B1 system prompt.',
        }),
      )

      const b1Index = result.segments.tenantProject.indexOf('B1 system prompt.')
      const t5Index = result.segments.tenantProject.indexOf('Foreground agent profile instructions')

      expect(b1Index).toBeGreaterThanOrEqual(0)
      expect(t5Index).toBeGreaterThanOrEqual(0)
      expect(b1Index).toBeLessThan(t5Index)
    })

    it('T5 content appears before personaProjection (B3) in Segment B', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          systemPrompt: 'System instructions.',
          personaProjection: {
            personaId: 'test',
            styleGuidelines: 'Be concise.',
            constraints: [],
          },
        }),
      )

      const t5Index = result.segments.tenantProject.indexOf('Foreground agent profile instructions')
      const b3Index = result.segments.tenantProject.indexOf('风格指南')

      expect(t5Index).toBeGreaterThanOrEqual(0)
      expect(b3Index).toBeGreaterThanOrEqual(0)
      expect(t5Index).toBeLessThan(b3Index)
    })
  })

  describe('Feature OFF: T6 templates NOT in Segment C', () => {
    it('T6 toolProjection content is absent from Segment C when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is false', async () => {
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', false)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'] },
        }),
      )

      expect(result.segments.toolPlane).not.toContain('Tool usage heuristics')
      expect(result.segments.toolPlane).not.toContain('prefer read-only tools first')
      // Tool IDs should still be present
      expect(result.segments.toolPlane).toContain('file_read')
    })

    it('T6 content absent when flag env is undefined (default OFF)', async () => {
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['web_search'] },
        }),
      )

      expect(result.segments.toolPlane).not.toContain('Tool usage heuristics')
      expect(result.segments.toolPlane).toContain('web_search')
    })
  })

  describe('Feature ON: T6 templates present in Segment C', () => {
    it('T6 toolProjection content appears in Segment C when PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED is true', async () => {
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'] },
        }),
      )

      expect(result.segments.toolPlane).toContain('Tool usage heuristics')
      expect(result.segments.toolPlane).toContain('file_read')
    })

    it('T6 content is absent from Segment A', async () => {
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(makeMinimalInput())

      expect(result.segments.staticPrefix).not.toContain('Tool usage heuristics')
    })

    it('T6 content is absent from Segment B', async () => {
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(makeMinimalInput())

      expect(result.segments.tenantProject).not.toContain('Tool usage heuristics')
    })
  })

  describe('Feature OFF: T7 templates NOT in Segment D', () => {
    it('T7 runtimeContext content is absent from Segment D when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is false', async () => {
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', false)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).not.toContain('Runtime context rules')
      expect(result.segments.contextBundle).not.toContain('always include current date')
      expect(result.segments.contextBundle).toContain('Hello')
    })

    it('T7 content absent when flag env is undefined (default OFF)', async () => {
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          currentUserMessage: 'Test message',
        }),
      )

      expect(result.segments.contextBundle).not.toContain('Runtime context rules')
    })
  })

  describe('Feature ON: T7 templates present in Segment D', () => {
    it('T7 runtimeContext content appears in Segment D when PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED is true', async () => {
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).toContain('Runtime context rules')
      expect(result.segments.contextBundle).toContain('Hello')
    })

    it('T7 content appears at the start of Segment D', async () => {
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          currentUserMessage: 'User question',
        }),
      )

      const t7Index = result.segments.contextBundle.indexOf('Runtime context rules')
      const userMsgIndex = result.segments.contextBundle.indexOf('User question')

      expect(t7Index).toBeGreaterThanOrEqual(0)
      expect(userMsgIndex).toBeGreaterThanOrEqual(0)
      expect(t7Index).toBeLessThan(userMsgIndex)
    })
  })

  describe('Missing template fallback', () => {
    it('does not crash when T5 template is missing for the agentProfile', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const builder = makeBuilder()
      // Use an agentProfile that has no T5 template
      const result = await builder.build(
        makeMinimalInput({
          agentProfile: 'nonexistent_profile',
          systemPrompt: 'Fallback system prompt.',
        }),
      )

      // Should not crash, Segment B should still have the system prompt
      expect(result.segments.tenantProject).toContain('Fallback system prompt.')
      expect(result.segments.tenantProject).not.toContain('undefined')
    })

    it('does not crash when T6 template is missing', async () => {
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      // Build with empty templates (no T6)
      const emptyRegistry = new PromptTemplateRegistry(new Map(), '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      const builder = new ModelInputBuilder({ templateRegistry: emptyRegistry, templateLoader: loader })

      const result = await builder.build(
        makeMinimalInput({
          toolProjection: { toolIds: ['file_read'] },
        }),
      )

      // Should not crash
      expect(result.segments.toolPlane).toContain('file_read')
      expect(result.segments.toolPlane).not.toContain('undefined')
    })

    it('does not crash when T7 template is missing', async () => {
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)
      const emptyRegistry = new PromptTemplateRegistry(new Map(), '/nonexistent')
      const loader = new TemplateLoader('/nonexistent')
      const builder = new ModelInputBuilder({ templateRegistry: emptyRegistry, templateLoader: loader })

      const result = await builder.build(
        makeMinimalInput({
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).toContain('Hello')
      expect(result.segments.contextBundle).not.toContain('undefined')
    })
  })

  describe('Per-mode T5/T6/T7 consumption matrix', () => {
    it('routing_json mode: T5 in B, T6 text in C, T7 in D', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)

      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          mode: 'routing_json',
          toolProjection: { toolIds: ['file_read'] },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.tenantProject).toContain('Foreground agent profile instructions')
      expect(result.segments.toolPlane).toContain('Tool usage heuristics')
      expect(result.segments.contextBundle).toContain('Runtime context rules')
    })

    it('function_calling mode: T5 in B, T6 policy in C, T7 in D', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)

      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          mode: 'function_calling',
          agentType: 'subagent',
          agentProfile: 'foreground',
          toolProjection: {
            toolIds: ['file_read'],
            tools: [
              {
                type: 'function' as const,
                function: {
                  name: 'file_read',
                  description: 'Read a file',
                  parameters: { type: 'object', properties: {} },
                },
              },
            ],
          },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.tenantProject).toContain('Foreground agent profile instructions')
      expect(result.segments.toolPlane).toContain('Tool usage heuristics')
      expect(result.segments.contextBundle).toContain('Runtime context rules')
    })

    it('structured_json mode: T5 in B, T6 minimal in C, T7 in D', async () => {
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)

      const builder = makeBuilder()
      const result = await builder.build(
        makeMinimalInput({
          mode: 'structured_json',
          toolProjection: { toolIds: ['memory_retrieve'] },
          currentUserMessage: 'Extract',
        }),
      )

      expect(result.segments.tenantProject).toContain('Foreground agent profile instructions')
      expect(result.segments.toolPlane).toContain('Tool usage heuristics')
      expect(result.segments.contextBundle).toContain('Runtime context rules')
    })
  })

  describe('Segment hash stability', () => {
    it('Segment A hash is unchanged by T5/T6/T7 flag state', async () => {
      const builder = makeBuilder()

      // Build with all flags OFF
      clearFlags()
      const resultOff = await builder.build(makeMinimalInput())

      // Build with all flags ON
      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED', true)
      setFlag('PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED', true)
      const resultOn = await builder.build(makeMinimalInput())

      // Segment A (static prefix) must be identical regardless of flag state
      expect(resultOff.segmentHashes.segmentA).toBe(resultOn.segmentHashes.segmentA)
    })

    it('Segment B hash changes when T5 flag toggles', async () => {
      const builder = makeBuilder()

      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', false)
      const resultOff = await builder.build(makeMinimalInput({ systemPrompt: 'Test' }))

      setFlag('PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED', true)
      const resultOn = await builder.build(makeMinimalInput({ systemPrompt: 'Test' }))

      expect(resultOff.segmentHashes.segmentB).not.toBe(resultOn.segmentHashes.segmentB)
    })
  })
})
