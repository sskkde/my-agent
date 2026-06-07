/**
 * Model Input Snapshot Store - Records snapshots of LLM calls for observability.
 * @module kernel/model-input/model-input-snapshot-store
 */

import { randomUUID } from 'crypto'
import type { BuiltModelInput } from './model-input-types.js'
import type { TokenUsage } from '../../llm/types.js'
import type { ModelInputRedactor } from './model-input-redactor.js'

export interface ModelInputSnapshot {
  snapshotId: string
  timestamp: string
  agentKind: string
  mode: string
  segmentHashes: {
    segmentA: string
    segmentB: string
    segmentC: string
    segmentD: string
  }
  input?: Record<string, unknown>
  response?: Record<string, unknown>
  tokenUsage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    promptCacheHitTokens?: number
    promptCacheMissTokens?: number
    cacheHitRate?: number
  }
  provider?: string
  model?: string
}

export interface ModelInputSnapshotStore {
  record(params: {
    agentKind: string
    mode: string
    builtInput: BuiltModelInput
    response?: Record<string, unknown>
    tokenUsage?: TokenUsage
    provider?: string
    model?: string
  }): ModelInputSnapshot

  get(snapshotId: string): ModelInputSnapshot | undefined
  getByAgent(agentKind: string): ModelInputSnapshot[]
  getByTimeRange(from: string, to: string): ModelInputSnapshot[]
  count(): number
  clear(): void
}

class ModelInputSnapshotStoreImpl implements ModelInputSnapshotStore {
  private readonly snapshots: Map<string, ModelInputSnapshot> = new Map()
  private readonly redactor: ModelInputRedactor

  constructor(redactor: ModelInputRedactor) {
    this.redactor = redactor
  }

  record(params: {
    agentKind: string
    mode: string
    builtInput: BuiltModelInput
    response?: Record<string, unknown>
    tokenUsage?: TokenUsage
    provider?: string
    model?: string
  }): ModelInputSnapshot {
    const snapshotId = randomUUID()
    const timestamp = new Date().toISOString()

    const snapshot: ModelInputSnapshot = {
      snapshotId,
      timestamp,
      agentKind: params.agentKind,
      mode: params.mode,
      segmentHashes: params.builtInput.segmentHashes,
      input: this.redactor.redact({
        messages: params.builtInput.messages,
        segments: params.builtInput.segments,
        metadata: params.builtInput.metadata,
      }) as Record<string, unknown>,
      response: params.response ? (this.redactor.redact(params.response) as Record<string, unknown>) : undefined,
      tokenUsage: params.tokenUsage
        ? {
            promptTokens: params.tokenUsage.promptTokens,
            completionTokens: params.tokenUsage.completionTokens,
            totalTokens: params.tokenUsage.totalTokens,
            promptCacheHitTokens: params.tokenUsage.promptCacheHitTokens,
            promptCacheMissTokens: params.tokenUsage.promptCacheMissTokens,
            cacheHitRate: params.tokenUsage.cacheHitRate,
          }
        : undefined,
      provider: params.provider,
      model: params.model,
    }

    this.snapshots.set(snapshotId, snapshot)
    return snapshot
  }

  get(snapshotId: string): ModelInputSnapshot | undefined {
    return this.snapshots.get(snapshotId)
  }

  getByAgent(agentKind: string): ModelInputSnapshot[] {
    return Array.from(this.snapshots.values()).filter((s) => s.agentKind === agentKind)
  }

  getByTimeRange(from: string, to: string): ModelInputSnapshot[] {
    const fromDate = new Date(from)
    const toDate = new Date(to)
    return Array.from(this.snapshots.values()).filter((s) => {
      const snapshotDate = new Date(s.timestamp)
      return snapshotDate >= fromDate && snapshotDate <= toDate
    })
  }

  count(): number {
    return this.snapshots.size
  }

  clear(): void {
    this.snapshots.clear()
  }
}

export function createModelInputSnapshotStore(redactor: ModelInputRedactor): ModelInputSnapshotStore {
  return new ModelInputSnapshotStoreImpl(redactor)
}
