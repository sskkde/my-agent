/**
 * Segment D Provenance Header Contract Tests
 *
 * These tests lock the contract that Segment D includes a provenance header
 * recording the origin and freshness of context data. The provenance header
 * appears at the start of Segment D, before any other content.
 *
 * Format:
 * ```
 * ## Provenance
 * sourceType: {sourceType}
 * sourceRef: {sourceRef}
 * freshnessTs: {ISO-8601 timestamp}
 * invocationSource: {invocationSource}
 * ```
 *
 * EXPECTED FAILURE: Currently, provenance fields are not rendered in Segment D.
 * These tests assert the TARGET behavior after migration.
 *
 * @module tests/unit/kernel/model-input/segment-d-provenance
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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

function setFlag(flag: string, value: boolean): void {
  process.env[flag] = value ? 'true' : 'false'
}

function clearFlags(): void {
  delete process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Segment D Provenance Header', () => {
  beforeEach(() => {
    clearFlags()
  })

  afterEach(() => {
    clearFlags()
  })

  describe('Provenance header rendering (flag ON)', () => {
    it('renders provenance header with sourceType', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-123',
          runId: 'run-456',
          currentUserMessage: 'Hello',
          // Provenance data would come from context bundle metadata
          contextBundle: {
            pinnedItems: [
              {
                itemId: 'prov-1',
                content: 'Context item content.',
                semanticType: 'instruction',
              },
            ],
          },
        }),
      )

      // Provenance header should be present
      expect(result.segments.contextBundle).toContain('## Provenance')
    })

    it('provenance header includes sourceType field', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('sourceType:')
    })

    it('provenance header includes sourceRef field', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          runId: 'run-xyz',
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('sourceRef:')
    })

    it('provenance header includes freshnessTs field', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('freshnessTs:')
    })

    it('provenance header includes invocationSource field', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentUserMessage: 'Test',
        }),
      )

      expect(result.segments.contextBundle).toContain('invocationSource:')
    })

    it('provenance header appears at the START of Segment D', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentDate: '2026-06-19T12:00:00Z',
          currentUserMessage: 'Test message',
          contextBundle: {
            orderedItems: [{ itemId: 'item1', content: 'Some context.' }],
          },
        }),
      )

      // Provenance should be first
      const provenanceIdx = result.segments.contextBundle.indexOf('## Provenance')
      const dateIdx = result.segments.contextBundle.indexOf('Current Date:')
      const contextIdx = result.segments.contextBundle.indexOf('--- Context ---')
      const userMsgIdx = result.segments.contextBundle.indexOf('User Message:')

      expect(provenanceIdx).toBe(0)
      if (dateIdx >= 0) expect(provenanceIdx).toBeLessThan(dateIdx)
      if (contextIdx >= 0) expect(provenanceIdx).toBeLessThan(contextIdx)
      expect(provenanceIdx).toBeLessThan(userMsgIdx)
    })

    it('provenance header appears before memoryPolicyProjection', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          memoryPolicyProjection: { useRules: 'Memory rules here.' },
          currentUserMessage: 'Test',
        }),
      )

      const provenanceIdx = result.segments.contextBundle.indexOf('## Provenance')
      const memoryIdx = result.segments.contextBundle.indexOf('Memory Policy:')

      expect(provenanceIdx).toBeGreaterThanOrEqual(0)
      expect(memoryIdx).toBeGreaterThanOrEqual(0)
      expect(provenanceIdx).toBeLessThan(memoryIdx)
    })
  })

  describe('Provenance header NOT rendered (flag OFF)', () => {
    it('provenance header is absent when flag is OFF', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', false)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).not.toContain('## Provenance')
      expect(result.segments.contextBundle).not.toContain('sourceType:')
      expect(result.segments.contextBundle).not.toContain('freshnessTs:')
    })

    it('provenance header is absent when flag env is undefined (default OFF)', async () => {
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-abc',
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).not.toContain('## Provenance')
    })
  })

  describe('Provenance header with all Segment D content', () => {
    it('provenance header + memory policy + summary layers + context items + user message', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          memoryPolicyProjection: { useRules: 'Use memory wisely.' },
          summaryLayers: { session: 'Session summary.' },
          contextBundle: {
            pinnedItems: [{ itemId: 'pin1', content: 'Pinned data.', isPinned: true }],
            orderedItems: [{ itemId: 'item1', content: 'Ordered data.' }],
          },
          currentDate: '2026-06-19T12:00:00Z',
          sessionId: 'session-abc',
          runId: 'run-xyz',
          currentUserMessage: 'User question here.',
        }),
      )

      // All components should be present
      expect(result.segments.contextBundle).toContain('## Provenance')
      expect(result.segments.contextBundle).toContain('Memory Policy:')
      expect(result.segments.contextBundle).toContain('## Session Summary')
      expect(result.segments.contextBundle).toContain('Pinned data.')
      expect(result.segments.contextBundle).toContain('Ordered data.')
      expect(result.segments.contextBundle).toContain('Current Date: 2026-06-19')
      expect(result.segments.contextBundle).toContain('Session ID: session-abc')
      expect(result.segments.contextBundle).toContain('Run ID: run-xyz')
      expect(result.segments.contextBundle).toContain('User Message: User question here.')
    })

    it('correct ordering: provenance < memory policy < summary < dynamic < context < user message', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          memoryPolicyProjection: { useRules: 'Memory rules.' },
          summaryLayers: { session: 'Summary.' },
          contextBundle: {
            orderedItems: [{ itemId: 'item1', content: 'Context data.' }],
          },
          currentDate: '2026-06-19T12:00:00Z',
          currentUserMessage: 'User message.',
        }),
      )

      const text = result.segments.contextBundle
      const provenanceIdx = text.indexOf('## Provenance')
      const memoryIdx = text.indexOf('Memory Policy:')
      const summaryIdx = text.indexOf('## Session Summary')
      const dateIdx = text.indexOf('Current Date:')
      const contextIdx = text.indexOf('--- Context ---')
      const userMsgIdx = text.indexOf('User Message:')

      // Verify ordering
      expect(provenanceIdx).toBeLessThan(memoryIdx)
      expect(memoryIdx).toBeLessThan(summaryIdx)
      expect(summaryIdx).toBeLessThan(dateIdx)
      expect(dateIdx).toBeLessThan(contextIdx)
      expect(contextIdx).toBeLessThan(userMsgIdx)
    })
  })

  describe('Provenance header with subagent invocation', () => {
    it('renders invocationSource as subagent_delegation for subagent context', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          agentType: 'subagent',
          agentProfile: 'research_processor',
          currentUserMessage: 'Subagent objective.',
        }),
      )

      // Should render provenance for subagent invocation
      expect(result.segments.contextBundle).toContain('## Provenance')
      expect(result.segments.contextBundle).toContain('invocationSource:')
    })
  })

  describe('Provenance header Segment isolation', () => {
    it('provenance header does NOT appear in Segment A', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(makeMinimalInput())

      expect(result.segments.staticPrefix).not.toContain('## Provenance')
      expect(result.segments.staticPrefix).not.toContain('sourceType:')
    })

    it('provenance header does NOT appear in Segment B', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(makeMinimalInput({ systemPrompt: 'System.' }))

      expect(result.segments.tenantProject).not.toContain('## Provenance')
      expect(result.segments.tenantProject).not.toContain('sourceType:')
    })

    it('provenance header does NOT appear in Segment C', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(makeMinimalInput({ toolProjection: { toolIds: ['file_read'] } }))

      expect(result.segments.toolPlane).not.toContain('## Provenance')
      expect(result.segments.toolPlane).not.toContain('sourceType:')
    })
  })

  describe('Provenance header hash stability', () => {
    it('Segment D hash is deterministic with provenance', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const input = makeMinimalInput({
        sessionId: 'stable-session',
        runId: 'stable-run',
        currentUserMessage: 'Stable message.',
      })

      const result1 = await builder.build(input)
      const result2 = await builder.build(input)

      expect(result1.segmentHashes.segmentD).toBe(result2.segmentHashes.segmentD)
    })

    it('Segment A hash is unchanged by provenance flag state', async () => {
      const builder = makeBuilder()

      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', false)
      const resultOff = await builder.build(makeMinimalInput())

      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const resultOn = await builder.build(makeMinimalInput())

      expect(resultOff.segmentHashes.segmentA).toBe(resultOn.segmentHashes.segmentA)
    })

    it('Segment B hash is unchanged by provenance flag state', async () => {
      const builder = makeBuilder()

      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', false)
      const resultOff = await builder.build(makeMinimalInput({ systemPrompt: 'Test' }))

      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const resultOn = await builder.build(makeMinimalInput({ systemPrompt: 'Test' }))

      expect(resultOff.segmentHashes.segmentB).toBe(resultOn.segmentHashes.segmentB)
    })
  })

  describe('Provenance header edge cases', () => {
    it('provenance renders even when no contextBundle is provided', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          sessionId: 'session-only',
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Provenance')
    })

    it('provenance renders with empty contextBundle', async () => {
      setFlag('PROMPT_SEGMENT_D_PROVENANCE_ENABLED', true)
      const builder = makeBuilder()

      const result = await builder.build(
        makeMinimalInput({
          contextBundle: {},
          currentUserMessage: 'Hello',
        }),
      )

      expect(result.segments.contextBundle).toContain('## Provenance')
    })
  })
})
