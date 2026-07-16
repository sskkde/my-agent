import type { ConsoleTimelineEvent } from '../../../api/types'
export type ToolStatus = 'running' | 'completed' | 'failed'

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getMetaString = (event: ConsoleTimelineEvent, key: string): string | undefined => {
  const value = event.metadata?.[key]
  return isNonEmptyString(value) ? value.trim() : undefined
}

export const normalizeToolStatus = (event: ConsoleTimelineEvent): ToolStatus => {
  if (event.metadata?.failed === true) return 'failed'
  const raw = event.metadata?.status
  if (raw === 'running' || raw === 'completed' || raw === 'failed') return raw
  if (typeof event.content === 'string') {
    const trimmed = event.content.trim()
    if (/^[^:]+:\s*completed$/i.test(trimmed)) return 'completed'
    if (/^[^:]+:\s*failed$/i.test(trimmed)) return 'failed'
  }
  return event.eventType === 'tool_call' ? 'running' : 'completed'
}

export const extractParameters = (event?: ConsoleTimelineEvent): Record<string, unknown> => {
  if (!event) return {}
  const value = event.metadata?.parameters
  return isRecord(value) ? value : {}
}

export const extractResultText = (
  result?: ConsoleTimelineEvent,
  call?: ConsoleTimelineEvent,
): string | undefined => {
  if (result) {
    const metaResult = result.metadata?.result
    if (typeof metaResult === 'string') return metaResult
    if (typeof result.content === 'string') return result.content
  }
  if (call) {
    const metaResult = call.metadata?.result
    if (typeof metaResult === 'string') return metaResult
  }
  return undefined
}

export const extractDurationMs = (
  result?: ConsoleTimelineEvent,
  call?: ConsoleTimelineEvent,
): number | undefined => {
  const fromResult = result?.metadata?.durationMs
  if (typeof fromResult === 'number') return fromResult
  const fromCall = call?.metadata?.durationMs
  if (typeof fromCall === 'number') return fromCall
  return undefined
}

export const extractToolName = (
  call?: ConsoleTimelineEvent,
  result?: ConsoleTimelineEvent,
): string => {
  if (call) {
    const name = getMetaString(call, 'toolName')
    if (name) return name
  }
  if (result) {
    const name = getMetaString(result, 'toolName')
    if (name) return name
  }
  return 'Unknown tool'
}
