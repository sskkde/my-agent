import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createContextMetricsStore, type ContextMetrics } from '../../../src/storage/context-metrics-store.js'

describe('ContextMetricsStore', () => {
  const connection = createConnectionManager(':memory:')
  const store = createContextMetricsStore(connection)

  beforeAll(() => {
    connection.open()
  })

  beforeEach(() => {
    connection.exec('DROP TABLE IF EXISTS context_metrics')
    store.applyMigrations({
      init: () => {},
      getCurrentVersion: () => 0,
      apply: (migrations) => {
        for (const m of migrations) {
          for (const stmt of m.up.split(';').filter((s) => s.trim())) connection.exec(stmt)
        }
      },
    })
  })

  afterAll(() => {
    connection.close()
  })

  it('records a context metric entry', () => {
    const metric: Omit<ContextMetrics, 'id'> = {
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      segmentDTokenEstimate: 1024,
      segmentDTokenActual: 800,
      memoryInjectedCount: 5,
      memoryTokenEstimate: 256,
      summaryHitCount: 2,
      summaryTokenEstimate: 128,
      transcriptTokenEstimate: 512,
      pinnedItemCount: 3,
      orderedItemCount: 7,
      droppedContextReasons: null,
      flagPhase: 'canary',
      flagName: 'PROMPT_MEMORY_P0_PHASE',
    }
    const id = store.record(metric)
    expect(id).toBeTruthy()
  })

  it('getMetricsByRunId returns the recorded metric', () => {
    const metric: Omit<ContextMetrics, 'id'> = {
      runId: 'run-2',
      agentId: 'agent-1',
      sessionId: null,
      timestamp: new Date().toISOString(),
      segmentDTokenEstimate: 2048,
      segmentDTokenActual: 1800,
      memoryInjectedCount: 0,
      memoryTokenEstimate: 0,
      summaryHitCount: 0,
      summaryTokenEstimate: 0,
      transcriptTokenEstimate: 0,
      pinnedItemCount: 0,
      orderedItemCount: 0,
      droppedContextReasons: null,
      flagPhase: null,
      flagName: null,
    }
    const id = store.record(metric)
    const result = store.getMetricsByRunId('run-2')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(id)
    expect(result!.runId).toBe('run-2')
  })

  it('getMetricsByRunId returns null for unknown run', () => {
    expect(store.getMetricsByRunId('nonexistent')).toBeNull()
  })

  it('getRecentMetrics returns metrics ordered by timestamp desc', () => {
    const base: Omit<ContextMetrics, 'id'> = {
      runId: 'run-3',
      agentId: 'agent-2',
      sessionId: null,
      timestamp: new Date().toISOString(),
      segmentDTokenEstimate: 512,
      segmentDTokenActual: 500,
      memoryInjectedCount: 0,
      memoryTokenEstimate: 0,
      summaryHitCount: 0,
      summaryTokenEstimate: 0,
      transcriptTokenEstimate: 0,
      pinnedItemCount: 0,
      orderedItemCount: 0,
      droppedContextReasons: null,
      flagPhase: null,
      flagName: null,
    }
    store.record({ ...base, runId: 'run-3a', timestamp: '2026-07-08T10:00:00Z' })
    store.record({ ...base, runId: 'run-3b', timestamp: '2026-07-08T11:00:00Z' })
    const recent = store.getRecentMetrics('agent-2', 5)
    expect(recent).toHaveLength(2)
    expect(recent[0].runId).toBe('run-3b')
  })

  it('getRecentMetrics respects limit', () => {
    const base: Omit<ContextMetrics, 'id'> = {
      runId: 'run-4',
      agentId: 'agent-3',
      sessionId: null,
      timestamp: new Date().toISOString(),
      segmentDTokenEstimate: 256,
      segmentDTokenActual: 200,
      memoryInjectedCount: 0,
      memoryTokenEstimate: 0,
      summaryHitCount: 0,
      summaryTokenEstimate: 0,
      transcriptTokenEstimate: 0,
      pinnedItemCount: 0,
      orderedItemCount: 0,
      droppedContextReasons: null,
      flagPhase: null,
      flagName: null,
    }
    store.record({ ...base, runId: 'run-4a' })
    store.record({ ...base, runId: 'run-4b' })
    expect(store.getRecentMetrics('agent-3', 1)).toHaveLength(1)
  })

  it('stores droppedContextReasons as JSON string and reads it back', () => {
    const reasons = JSON.stringify([{ section: 'transcript', reason: 'exceeded budget', itemCount: 3 }])
    store.record({
      runId: 'run-5',
      agentId: 'agent-1',
      sessionId: null,
      timestamp: new Date().toISOString(),
      segmentDTokenEstimate: 1000,
      segmentDTokenActual: 800,
      memoryInjectedCount: 0,
      memoryTokenEstimate: 0,
      summaryHitCount: 0,
      summaryTokenEstimate: 0,
      transcriptTokenEstimate: 0,
      pinnedItemCount: 0,
      orderedItemCount: 0,
      droppedContextReasons: reasons,
      flagPhase: null,
      flagName: null,
    })
    const result = store.getMetricsByRunId('run-5')
    expect(result!.droppedContextReasons).toBe(reasons)
  })
})
