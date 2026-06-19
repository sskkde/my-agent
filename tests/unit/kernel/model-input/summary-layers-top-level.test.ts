/**
 * Top-Level summaryLayers Contract Tests
 *
 * These tests lock the contract that `summaryLayers` is a top-level strategy
 * projection on `ModelInputBuildInput`. The builder reads from
 * `input.summaryLayers` first, falling back to `input.contextBundle?.summaryLayers`
 * for backward compatibility.
 *
 * @module tests/unit/kernel/model-input/summary-layers-top-level
 */

import { describe, it, expect } from 'vitest'
import { PromptTemplateRegistry, type PromptTemplateRecord } from '../../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../../src/prompt/template-loader.js'
import { ModelInputBuilder } from '../../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../../src/kernel/model-input/model-input-types.js'

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
        content: 'Platform base.',
        description: 'Test platform base',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Top-Level summaryLayers Strategy Projection', () => {
  describe('summaryLayers as top-level field on ModelInputBuildInput', () => {
    it('accepts summaryLayers at top level of ModelInputBuildInput (type contract)', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Current session summary.',
          daily: 'Daily summary content.',
        },
        currentUserMessage: 'Hello',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Current session summary.')
      expect(result.segments.contextBundle).toContain('## Daily Summary')
      expect(result.segments.contextBundle).toContain('Daily summary content.')
    })

    it('top-level summaryLayers appears in Segment D', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Session summary for top-level test.',
        },
        currentUserMessage: 'Test',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Session summary for top-level test.')
    })

    it('top-level summaryLayers does NOT appear in Segment A', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Should not be in A.',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.staticPrefix).not.toContain('## Session Summary')
      expect(result.segments.staticPrefix).not.toContain('Should not be in A.')
    })

    it('top-level summaryLayers does NOT appear in Segment B', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Should not be in B.',
        },
      }

      const result = await builder.build(input)

      expect(result.segments.tenantProject).not.toContain('## Session Summary')
      expect(result.segments.tenantProject).not.toContain('Should not be in B.')
    })

    it('top-level summaryLayers does NOT appear in Segment C', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'Should not be in C.',
        },
        toolProjection: { toolIds: ['file_read'] },
      }

      const result = await builder.build(input)

      expect(result.segments.toolPlane).not.toContain('## Session Summary')
      expect(result.segments.toolPlane).not.toContain('Should not be in C.')
    })
  })

  describe('Backward compatibility: nested contextBundle.summaryLayers', () => {
    it('reads from contextBundle.summaryLayers when top-level is absent', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        contextBundle: {
          summaryLayers: {
            session: 'Nested session summary.',
          },
        },
        currentUserMessage: 'Test',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Nested session summary.')
    })

    it('prefers top-level over nested', async () => {
      const builder = makeBuilder()

      const input: ModelInputBuildInput = {
        mode: 'routing_json',
        agentType: 'main',
        agentProfile: 'foreground',
        providerFamily: 'openai',
        summaryLayers: {
          session: 'TOP-LEVEL session summary.',
        },
        contextBundle: {
          summaryLayers: {
            session: 'NESTED session summary.',
          },
        },
        currentUserMessage: 'Test',
      }

      const result = await builder.build(input)

      expect(result.segments.contextBundle).toContain('TOP-LEVEL session summary.')
      expect(result.segments.contextBundle).not.toContain('NESTED session summary.')
    })
  })

  describe('summaryLayers renders all layer types', () => {
    it('renders session summary from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { session: 'Session content.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Session content.')
    })

    it('renders daily summary from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { daily: 'Daily content.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Daily Summary')
      expect(result.segments.contextBundle).toContain('Daily content.')
    })

    it('renders weekly summary from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { weekly: 'Weekly content.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Weekly Summary')
      expect(result.segments.contextBundle).toContain('Weekly content.')
    })

    it('renders long-term profile from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { longTerm: 'Long-term content.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Long-Term Profile')
      expect(result.segments.contextBundle).toContain('Long-term content.')
    })

    it('renders atomic facts from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { atomicFacts: 'Atomic facts content.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Atomic Facts')
      expect(result.segments.contextBundle).toContain('Atomic facts content.')
    })

    it('renders multiple layers together from top-level', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: {
            session: 'Session data.',
            daily: 'Daily data.',
            weekly: 'Weekly data.',
            longTerm: 'Long-term data.',
            atomicFacts: 'Facts data.',
          },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('## Daily Summary')
      expect(result.segments.contextBundle).toContain('## Weekly Summary')
      expect(result.segments.contextBundle).toContain('## Long-Term Profile')
      expect(result.segments.contextBundle).toContain('## Atomic Facts')
    })
  })

  describe('summaryLayers ordering in Segment D', () => {
    it('summaryLayers appears before context items in Segment D', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: { session: 'Summary content.' },
          contextBundle: {
            orderedItems: [{ itemId: 'item1', content: 'Context item.' }],
          },
          currentUserMessage: 'Test',
        }),
      )

      const summaryIdx = result.segments.contextBundle.indexOf('## Session Summary')
      const contextIdx = result.segments.contextBundle.indexOf('--- Context ---')

      expect(summaryIdx).toBeGreaterThanOrEqual(0)
      expect(contextIdx).toBeGreaterThanOrEqual(0)
      expect(summaryIdx).toBeLessThan(contextIdx)
    })

    it('summaryLayers appears after memoryPolicyProjection in Segment D', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          memoryPolicyProjection: { useRules: 'Memory rules.' },
          summaryLayers: { session: 'Summary content.' },
          currentUserMessage: 'Test',
        }),
      )

      const memoryIdx = result.segments.contextBundle.indexOf('Memory Policy:')
      const summaryIdx = result.segments.contextBundle.indexOf('## Session Summary')

      expect(memoryIdx).toBeGreaterThanOrEqual(0)
      expect(summaryIdx).toBeGreaterThanOrEqual(0)
      expect(memoryIdx).toBeLessThan(summaryIdx)
    })
  })

  describe('summaryLayers hash stability', () => {
    it('Segment D hash is deterministic for same top-level summaryLayers', async () => {
      const builder = makeBuilder()

      const input = makeMinimalInput({
        summaryLayers: { session: 'Stable content.' },
        currentUserMessage: 'Test',
      })

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('Segment D hash changes when top-level summaryLayers content changes', async () => {
      const builder = makeBuilder()

      const result1 = await builder.build(
        makeMinimalInput({
          summaryLayers: { session: 'Version 1.' },
          currentUserMessage: 'Test',
        }),
      )
      const result2 = await builder.build(
        makeMinimalInput({
          summaryLayers: { session: 'Version 2.' },
          currentUserMessage: 'Test',
        }),
      )

      expect(result1.segmentHashes.segmentD).not.toBe(result2.segmentHashes.segmentD)
    })
  })

  describe('null/undefined summaryLayers handling', () => {
    it('null summaryLayers fields are skipped', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: {
            session: 'Has session.',
            daily: null,
            weekly: null,
          },
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Has session.')
      expect(result.segments.contextBundle).not.toContain('## Daily Summary')
      expect(result.segments.contextBundle).not.toContain('## Weekly Summary')
    })

    it('undefined summaryLayers produces no summary content', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          summaryLayers: undefined,
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).not.toContain('## Session Summary')
      expect(result.segments.contextBundle).not.toContain('## Daily Summary')
    })
  })
})
