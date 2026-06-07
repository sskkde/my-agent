import type { RunType } from './timeout-policy.js'
import { getTimeout } from './timeout-policy.js'
import type { EventStore } from './types.js'

export interface OrphanRun {
  runId: string
  runType: string
  status: string
  startedAt: string
  timeoutMs: number
  action: 'recover' | 'mark_failed' | 'skip'
  reason: string
}

export interface OrphanScanResult {
  scannedAt: string
  orphanedCount: number
  recoveredCount: number
  failedCount: number
  orphans: OrphanRun[]
}

export interface OrphanScannerStore {
  listActive: () => Array<{
    runId: string
    runType: RunType
    status: string
    startedAt: string
    actionCategory?: string
  }>
  updateStatus?: (runId: string, status: string) => void
}

export interface OrphanScannerConfig {
  stores: Record<string, OrphanScannerStore>
  eventStore?: EventStore
  now?: () => Date
}

export interface OrphanScanner {
  scanOrphanedRuns(now?: Date): OrphanScanResult
  isRecoverable(runType: string, status: string, actionCategory?: string): boolean
}

const RECOVERABLE_RUN_TYPES = new Set<string>(['PlannerRun', 'KernelRun', 'BackgroundRun', 'WorkflowRun'])

const NON_RECOVERABLE_ACTION_CATEGORIES = new Set<string>(['write', 'delete', 'send', 'execute', 'mutate'])

export function createOrphanScanner(config: OrphanScannerConfig): OrphanScanner {
  return new OrphanScannerImpl(config)
}

class OrphanScannerImpl implements OrphanScanner {
  private config: OrphanScannerConfig

  constructor(config: OrphanScannerConfig) {
    this.config = config
  }

  scanOrphanedRuns(now?: Date): OrphanScanResult {
    const currentTime = now ?? this.config.now?.() ?? new Date()
    const scannedAt = currentTime.toISOString()
    const orphans: OrphanRun[] = []

    for (const [storeKey, store] of Object.entries(this.config.stores)) {
      const activeRuns = store.listActive()
      for (const run of activeRuns) {
        if (!this.isOverdueByType(run.runType, run.startedAt, currentTime)) {
          continue
        }

        const orphan = this.classifyOrphan(run, storeKey)
        orphans.push(orphan)
      }
    }

    const recoveredCount = orphans.filter((o) => o.action === 'recover').length
    const failedCount = orphans.filter((o) => o.action === 'mark_failed').length

    this.writeAuditEvents(orphans)

    return {
      scannedAt,
      orphanedCount: orphans.length,
      recoveredCount,
      failedCount,
      orphans,
    }
  }

  isRecoverable(runType: string, _status: string, actionCategory?: string): boolean {
    if (RECOVERABLE_RUN_TYPES.has(runType)) {
      return true
    }

    if (runType === 'RuntimeAction' && actionCategory) {
      return !NON_RECOVERABLE_ACTION_CATEGORIES.has(actionCategory.toLowerCase())
    }

    if (runType === 'RuntimeAction') {
      return false
    }

    return false
  }

  private isOverdueByType(runType: RunType, startedAt: string, now: Date): boolean {
    const timeout = getTimeout(runType)
    const start = new Date(startedAt)
    return now.getTime() - start.getTime() > timeout
  }

  private classifyOrphan(
    run: {
      runId: string
      runType: RunType
      status: string
      startedAt: string
      actionCategory?: string
    },
    _storeKey: string,
  ): OrphanRun {
    const timeoutMs = getTimeout(run.runType)
    const recoverable = this.isRecoverable(run.runType, run.status, run.actionCategory)

    if (recoverable) {
      return {
        runId: run.runId,
        runType: run.runType,
        status: run.status,
        startedAt: run.startedAt,
        timeoutMs,
        action: 'recover',
        reason: `Orphaned ${run.runType} can be recovered`,
      }
    }

    return {
      runId: run.runId,
      runType: run.runType,
      status: run.status,
      startedAt: run.startedAt,
      timeoutMs,
      action: 'mark_failed',
      reason: `${run.runType} is not recoverable${run.actionCategory ? ` (category: ${run.actionCategory})` : ''}`,
    }
  }

  private writeAuditEvents(orphans: OrphanRun[]): void {
    if (!this.config.eventStore) {
      return
    }
    for (const orphan of orphans) {
      this.config.eventStore.append({
        eventId: `orphan-${orphan.runId}-${Date.now()}`,
        eventType: 'orphan_run_detected',
        sourceModule: 'recovery',
        correlationId: orphan.runId,
        payload: {
          runId: orphan.runId,
          runType: orphan.runType,
          status: orphan.status,
          action: orphan.action,
          reason: orphan.reason,
          scannedAt: new Date().toISOString(),
        },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: new Date().toISOString(),
      })
    }
  }
}
