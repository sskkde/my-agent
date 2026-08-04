import { useRef, useState } from 'react'
import type { ChildTaskLaunchMode, ChildTaskStatus } from '../../../api/types'
import * as api from '../../../api/client'
import Button from '../../../components/ui/Button'
import { showToast } from './ChatToast'

const TERMINAL_STATUSES: ReadonlySet<ChildTaskStatus> = new Set(['completed', 'failed', 'cancelled'])

export interface ChildTaskActionsProps {
  readonly parentSessionId: string
  readonly taskId: string
  readonly childSessionId: string
  readonly status: ChildTaskStatus
  readonly launchMode: ChildTaskLaunchMode
  readonly onCancel?: () => Promise<void>
  readonly onResume?: () => Promise<void>
  readonly onOpen: () => void
  readonly onError?: (message: string) => void
}

export function ChildTaskActions({
  parentSessionId,
  taskId,
  childSessionId,
  status,
  launchMode,
  onCancel,
  onResume,
  onOpen,
  onError,
}: ChildTaskActionsProps): JSX.Element {
  const inFlightRef = useRef<'cancel' | 'resume' | null>(null)
  const [inFlight, setInFlight] = useState<'cancel' | 'resume' | null>(null)
  const terminal = TERMINAL_STATUSES.has(status)
  const canCancel = !terminal && (status === 'queued' || status === 'running')
  const canResume = terminal && (status === 'failed' || status === 'completed')

  const cancelAction = onCancel ?? (() => api.cancelChildSession(parentSessionId, childSessionId).then(() => undefined))
  const resumeAction = onResume ?? (() => api.resumeChildSession(parentSessionId, childSessionId).then(() => undefined))

  const runAction = async (kind: 'cancel' | 'resume', action: () => Promise<void>): Promise<void> => {
    if (inFlightRef.current !== null) return
    inFlightRef.current = kind
    setInFlight(kind)
    try {
      await action()
    } catch {
      const safeMessage = '任务操作失败，请稍后重试'
      onError?.(safeMessage)
      if (!onError) showToast(safeMessage)
    } finally {
      inFlightRef.current = null
      setInFlight(null)
    }
  }

  return (
    <div
      className="child-task-actions"
      data-testid="child-task-actions"
      data-parent-session-id={parentSessionId}
      data-task-id={taskId}
      data-child-session-id={childSessionId}
      data-launch-mode={launchMode}
      data-status={status}
    >
      <Button
        type="button"
        variant="ghost"
        size="small"
        disabled={!canCancel || inFlight !== null}
        loading={inFlight === 'cancel'}
        onClick={() => void runAction('cancel', cancelAction)}
        aria-label="取消任务"
      >
        取消
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="small"
        disabled={!canResume || inFlight !== null}
        loading={inFlight === 'resume'}
        onClick={() => void runAction('resume', resumeAction)}
        aria-label="恢复任务"
      >
        恢复
      </Button>
      <Button type="button" variant="ghost" size="small" onClick={onOpen} aria-label="查看子会话">
        查看
      </Button>
    </div>
  )
}
