import type { ChildSessionInfo, ConsoleTimelineEvent } from '../../../api/types'

export type ChildStatus = ChildSessionInfo['status'] | 'completed' | 'failed' | 'cancelled'

export const statusLabels: Record<ChildStatus, string> = {
  active: '运行中',
  archived: '已归档',
  closed: '已结束',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const isTerminalTimelineEvent = (event: ConsoleTimelineEvent): boolean =>
  event.eventType === 'run_completed' || event.eventType === 'run_failed' || event.eventType === 'run_cancelled'

export const getTerminalStatus = (events: readonly ConsoleTimelineEvent[]): ChildStatus | undefined => {
  const latest = [...events]
    .filter(isTerminalTimelineEvent)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]
  if (!latest) return undefined
  if (latest.eventType === 'run_completed') return 'completed'
  if (latest.eventType === 'run_failed') return 'failed'
  return 'cancelled'
}

export const isAccessError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { status?: number; code?: string }
  return (
    candidate.status === 403 ||
    candidate.status === 404 ||
    candidate.code === 'FORBIDDEN' ||
    candidate.code === 'NOT_FOUND'
  )
}
