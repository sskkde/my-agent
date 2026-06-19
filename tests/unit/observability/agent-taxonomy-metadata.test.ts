import { describe, it, expect, beforeEach } from 'vitest'
import { createTracingCollector, createTracingHooks } from '../../../src/observability/tracing.js'
import { createModelInputSnapshotStore } from '../../../src/kernel/model-input/model-input-snapshot-store.js'
import { createModelInputRedactor } from '../../../src/kernel/model-input/model-input-redactor.js'
import type { TraceStore, MetricStore, RuntimeSpan } from '../../../src/observability/types.js'
import type { BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'

function makeFakeTraceStore(): TraceStore {
  const traces = new Map<string, unknown>()
  const spans = new Map<string, RuntimeSpan>()
  return {
    createTrace: (ctx: unknown) => { traces.set((ctx as { traceId: string }).traceId, ctx) },
    getTrace: () => null,
    updateTraceStatus: () => {},
    findTracesByCorrelation: () => [],
    findTracesByUser: () => [],
    findTracesBySession: () => [],
    findTraces: () => [],
    createSpan: (span: RuntimeSpan) => { spans.set(span.spanId, span) },
    getSpan: (spanId: string) => spans.get(spanId) ?? null,
    updateSpan: () => {},
    endSpan: () => {},
    findSpansByTrace: () => [],
    findSpansByModule: () => [],
    findSpansByParent: () => [],
    findSpans: () => [],
  }
}

function makeFakeMetricStore(): MetricStore {
  return {
    recordMetric: () => {},
    recordMetrics: () => {},
    getMetric: () => null,
    queryMetrics: () => [],
    aggregateMetrics: () => [],
    getLatestMetric: () => null,
  }
}

function makeBuiltInput(overrides: Partial<BuiltModelInput> = {}): BuiltModelInput {
  return {
    messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
    segments: {
      staticPrefix: 'Segment A',
      tenantProject: 'Segment B',
      toolPlane: 'Segment C',
      contextBundle: 'Segment D',
    },
    segmentHashes: {
      segmentA: 'hash-a',
      segmentB: 'hash-b',
      segmentC: 'hash-c',
      segmentD: 'hash-d',
    },
    metadata: {
      mode: 'routing_json',
      agentKind: 'foreground',
      agentType: 'main',
      agentProfile: 'foreground',
      providerFamily: 'deepseek',
      messageCount: 1,
    },
    ...overrides,
  }
}

describe('Agent taxonomy metadata in observability', () => {
  describe('TracingCollector onSubagentRun', () => {
    let traceStore: TraceStore
    let collector: ReturnType<typeof createTracingCollector>
    let hooks: ReturnType<typeof createTracingHooks>
    let capturedSpans: RuntimeSpan[]

    beforeEach(() => {
      capturedSpans = []
      traceStore = {
        ...makeFakeTraceStore(),
        createSpan: (span: RuntimeSpan) => { capturedSpans.push(span) },
      }
      collector = createTracingCollector({
        traceStore,
        metricStore: makeFakeMetricStore(),
        enabled: true,
        sampleRate: 1.0,
      })
      hooks = createTracingHooks(collector)
    })

    it('includes agentType in subagent span metadata', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined)
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span).toBeDefined()
      expect(span!.metadata?.agentType).toBe('subagent')
    })

    it('includes agentProfile in subagent span metadata when provided', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined, { agentProfile: 'search' })
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata?.agentProfile).toBe('search')
    })

    it('includes launchSource in subagent span metadata when provided', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined, { launchSource: 'planner_execution' })
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata?.launchSource).toBe('planner_execution')
    })

    it('includes outputContract in subagent span metadata when provided', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined, { outputContract: 'output:planner.schema' })
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata?.outputContract).toBe('output:planner.schema')
    })

    it('includes permissionPolicyRef in subagent span metadata when provided', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined, { permissionPolicyRef: 'policy:subagent-default' })
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata?.permissionPolicyRef).toBe('policy:subagent-default')
    })

    it('omits undefined taxonomy fields from span metadata', () => {
      hooks.onSubagentRun('trace-1', 'subagent', undefined, { agentProfile: 'search' })
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata).not.toHaveProperty('launchSource')
      expect(span!.metadata).not.toHaveProperty('outputContract')
      expect(span!.metadata).not.toHaveProperty('permissionPolicyRef')
    })

    it('works without taxonomy parameter (backward compat)', () => {
      hooks.onSubagentRun('trace-1', 'subagent')
      const span = capturedSpans.find((s) => s.spanType === 'subagent_run')
      expect(span!.metadata?.agentType).toBe('subagent')
      expect(span!.metadata).not.toHaveProperty('agentProfile')
    })
  })

  describe('ModelInputSnapshot taxonomy fields', () => {
    let store: ReturnType<typeof createModelInputSnapshotStore>

    beforeEach(() => {
      store = createModelInputSnapshotStore(createModelInputRedactor())
    })

    it('records outputContract on snapshot', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        outputContract: 'output:planner.schema',
      })
      expect(snapshot.outputContract).toBe('output:planner.schema')
    })

    it('records launchSource on snapshot', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput(),
        launchSource: 'gateway_intent',
      })
      expect(snapshot.launchSource).toBe('gateway_intent')
    })

    it('redacts sensitive content while preserving taxonomy metadata', () => {
      const snapshot = store.record({
        agentKind: 'foreground',
        agentType: 'main',
        agentProfile: 'foreground',
        mode: 'routing_json',
        builtInput: makeBuiltInput({
          messages: [{ role: 'user', content: 'API Key: sk-12345-secret' }],
        }),
        outputContract: 'output:test.schema',
        launchSource: 'gateway_intent',
      })

      const inputJson = JSON.stringify(snapshot.input)
      expect(inputJson).not.toContain('sk-12345-secret')
      expect(snapshot.outputContract).toBe('output:test.schema')
      expect(snapshot.launchSource).toBe('gateway_intent')
      expect(snapshot.agentType).toBe('main')
      expect(snapshot.agentProfile).toBe('foreground')
    })
  })

  describe('EventRecord taxonomy fields', () => {
    it('EventRecord interface accepts taxonomy fields', () => {
      const event = {
        eventId: 'evt-1',
        eventType: 'BackgroundRunEnqueued',
        sourceModule: 'subagent' as const,
        payload: {
          agentType: 'background',
          agentProfile: 'document_processor',
          launchSource: 'background_subagent',
          outputContract: 'output:doc.schema',
          permissionPolicyRef: 'policy:bg-default',
        },
        sensitivity: 'low' as const,
        retentionClass: 'standard' as const,
        createdAt: new Date().toISOString(),
        agentType: 'background',
        agentProfile: 'document_processor',
        launchSource: 'background_subagent',
        outputContract: 'output:doc.schema',
        permissionPolicyRef: 'policy:bg-default',
      }

      expect(event.agentType).toBe('background')
      expect(event.agentProfile).toBe('document_processor')
      expect(event.launchSource).toBe('background_subagent')
      expect(event.outputContract).toBe('output:doc.schema')
      expect(event.permissionPolicyRef).toBe('policy:bg-default')
    })
  })
})
