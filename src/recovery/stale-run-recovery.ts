import { KERNEL_RUN_STATES, RUNTIME_ACTION_STATES, type KernelRunState } from '../shared/states.js'
import type { RuntimeActionStore } from '../storage/runtime-action-store.js'
import type { KernelRunStore } from '../storage/kernel-run-store.js'

export interface StaleRunRecoveryResult {
  scannedAt: string
  staleActionsMarked: number
  staleKernelRunsMarked: number
  staleActions: Array<{ actionId: string; previousStatus: string; newStatus: string; reason: string }>
  staleKernelRuns: Array<{ runId: string; previousStatus: string; newStatus: string; reason: string }>
}

export interface StaleRunRecoveryConfig {
  runtimeActionStore: Pick<RuntimeActionStore, 'listStaleByStatus' | 'updateStatus'>
  kernelRunStore: Pick<KernelRunStore, 'listStaleInStates' | 'markFailedWithResult'>
  /**
   * Threshold in milliseconds. Runtime actions in `dispatching` (or other
   * in-flight states) whose `updated_at` is older than `now - thresholdMs`
   * are marked `timeout` (or `failed` for non-dispatching in-flight states).
   */
  runtimeActionThresholdMs: number
  /**
   * Threshold in milliseconds. Kernel runs in any non-terminal state whose
   * `updated_at` is older than `now - thresholdMs` are marked `failed`.
   */
  kernelRunThresholdMs: number
  /**
   * Runtime action states that should be swept by the recovery helper.
   * Defaults to `dispatching` only — `waiting_for_approval` is intentionally
   * excluded because it represents a user-gated approval flow, not a hang.
   */
  runtimeActionSweepStates?: ReadonlyArray<(typeof RUNTIME_ACTION_STATES)[keyof typeof RUNTIME_ACTION_STATES]>
  /**
   * Kernel run states that are considered non-terminal and eligible for
   * stale-sweep. Defaults to all `KERNEL_RUN_STATES` except the terminal
   * ones (`completed`, `failed`, `cancelled`, `interrupted`,
   * `partial_success`, `max_iterations_reached`).
   */
  kernelRunSweepStates?: ReadonlyArray<KernelRunState>
  now?: () => Date
}

const DEFAULT_RUNTIME_ACTION_SWEEP_STATES: ReadonlyArray<
  (typeof RUNTIME_ACTION_STATES)[keyof typeof RUNTIME_ACTION_STATES]
> = [RUNTIME_ACTION_STATES.DISPATCHING]

const DEFAULT_KERNEL_RUN_SWEEP_STATES: ReadonlyArray<KernelRunState> = [
  KERNEL_RUN_STATES.INITIALIZING,
  KERNEL_RUN_STATES.BUILDING_CONTEXT,
  KERNEL_RUN_STATES.BUILDING_MODEL_INPUT,
  KERNEL_RUN_STATES.SAMPLING_MODEL,
  KERNEL_RUN_STATES.PARSING_MODEL_OUTPUT,
  KERNEL_RUN_STATES.DISPATCHING_TOOLS,
  KERNEL_RUN_STATES.LAUNCHING_SUBAGENT,
  KERNEL_RUN_STATES.CHECKING_COMPACT,
  KERNEL_RUN_STATES.COMPACTING,
]

export function createStaleRunRecovery(config: StaleRunRecoveryConfig) {
  const runtimeActionSweepStates = config.runtimeActionSweepStates ?? DEFAULT_RUNTIME_ACTION_SWEEP_STATES
  const kernelRunSweepStates = config.kernelRunSweepStates ?? DEFAULT_KERNEL_RUN_SWEEP_STATES

  function recover(now: Date = config.now?.() ?? new Date()): StaleRunRecoveryResult {
    const scannedAt = now.toISOString()
    const staleActions: StaleRunRecoveryResult['staleActions'] = []
    const staleKernelRuns: StaleRunRecoveryResult['staleKernelRuns'] = []

    const actionThresholdIso = new Date(now.getTime() - config.runtimeActionThresholdMs).toISOString()
    for (const state of runtimeActionSweepStates) {
      const stale = config.runtimeActionStore.listStaleByStatus(state, actionThresholdIso)
      for (const action of stale) {
        const newStatus =
          action.status === RUNTIME_ACTION_STATES.DISPATCHING
            ? RUNTIME_ACTION_STATES.TIMEOUT
            : RUNTIME_ACTION_STATES.FAILED
        const reason = `Stale action in '${action.status}' exceeded recovery threshold (${config.runtimeActionThresholdMs}ms)`
        config.runtimeActionStore.updateStatus(action.actionId, newStatus, reason)
        staleActions.push({
          actionId: action.actionId,
          previousStatus: action.status,
          newStatus,
          reason,
        })
      }
    }

    const kernelThresholdIso = new Date(now.getTime() - config.kernelRunThresholdMs).toISOString()
    const staleRuns = config.kernelRunStore.listStaleInStates([...kernelRunSweepStates], kernelThresholdIso)
    for (const run of staleRuns) {
      const reason = `Stale kernel run in '${run.status}' exceeded recovery threshold (${config.kernelRunThresholdMs}ms)`
      const finalResult = {
        recovered: true,
        recoveredAt: scannedAt,
        previousStatus: run.status,
        reason,
      }
      config.kernelRunStore.markFailedWithResult(run.runId, finalResult)
      staleKernelRuns.push({
        runId: run.runId,
        previousStatus: run.status,
        newStatus: KERNEL_RUN_STATES.FAILED,
        reason,
      })
    }

    return {
      scannedAt,
      staleActionsMarked: staleActions.length,
      staleKernelRunsMarked: staleKernelRuns.length,
      staleActions,
      staleKernelRuns,
    }
  }

  return { recover }
}
