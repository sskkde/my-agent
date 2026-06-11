import React, { useState } from 'react'
import './Timeline.css'
import type { ConsoleTimelineEvent, ConsoleTimelineEventType } from '../../api/types'
import { ToolCallCard } from '../ToolCallCard'
import { ApprovalCard } from '../ApprovalCard'
import { BackgroundTaskCard } from '../BackgroundTaskCard'
import { MessageContent, type MessageRole, type MessageMode } from '../message/MessageContent'
import { formatMessageContent } from './formatMessageContent'

export interface TimelineEventCardProps {
  event: ConsoleTimelineEvent
}

const eventTypeLabels: Record<ConsoleTimelineEventType, string> = {
  user_message: 'User',
  assistant_message: 'Assistant',
  thinking_summary: 'Thinking',
  tool_call: 'Tool Call',
  tool_result: 'Tool Result',
  approval_request: 'Approval Request',
  approval_decision: 'Approval Decision',
  artifact_created: 'Artifact',
  run_started: 'Run Started',
  run_progress: 'Run Progress',
  run_completed: 'Run Complete',
  run_failed: 'Run Failed',
  run_cancelled: 'Run Cancelled',
  system_status: 'Status',
  error: 'Error',
  processing_status: 'Processing',
  token_stream: 'Token Stream',
}

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const getRoleForEventType = (eventType: ConsoleTimelineEventType): MessageRole => {
  switch (eventType) {
    case 'assistant_message':
      return 'assistant'
    case 'user_message':
      return 'user'
    case 'thinking_summary':
      return 'assistant'
    case 'error':
      return 'error'
    default:
      return 'system'
  }
}

export const TimelineEventCard: React.FC<TimelineEventCardProps> = ({ event }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const isAssistantPlaceholder = event.metadata?.assistantPlaceholder === true
  const isStreamingDraft = event.metadata?.streamingDraft === true
  const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined

  const approvalRequestId =
    typeof event.metadata?.approvalRequestId === 'string' ? event.metadata.approvalRequestId : undefined
  const approvalStatus =
    typeof event.metadata?.approvalStatus === 'string'
      ? (event.metadata.approvalStatus as 'pending' | 'approved' | 'rejected')
      : undefined
  const actionType = typeof event.metadata?.actionType === 'string' ? event.metadata.actionType : undefined
  const resource = typeof event.metadata?.resource === 'string' ? event.metadata.resource : undefined
  const justification = typeof event.metadata?.justification === 'string' ? event.metadata.justification : undefined
  const riskLevel = typeof event.metadata?.riskLevel === 'string' ? event.metadata.riskLevel : undefined

  const toolName = typeof event.metadata?.toolName === 'string' ? event.metadata.toolName : undefined
  const parameters =
    typeof event.metadata?.parameters === 'object' && event.metadata.parameters !== null
      ? (event.metadata.parameters as Record<string, unknown>)
      : undefined
  const toolResult = typeof event.metadata?.result === 'string' ? event.metadata.result : undefined
  const toolStatus =
    typeof event.metadata?.status === 'string'
      ? (event.metadata.status as 'running' | 'completed' | 'failed')
      : undefined
  const durationMs = typeof event.metadata?.durationMs === 'number' ? event.metadata.durationMs : undefined

  const taskId = typeof event.metadata?.taskId === 'string' ? event.metadata.taskId : undefined
  const taskLabel = typeof event.metadata?.label === 'string' ? event.metadata.label : undefined
  const progress = typeof event.metadata?.progress === 'number' ? event.metadata.progress : undefined
  const taskMessage = typeof event.metadata?.message === 'string' ? event.metadata.message : undefined

  const label = isStreamingDraft ? 'Assistant (streaming)' : eventTypeLabels[event.eventType]
  const timestamp = formatTimestamp(event.timestamp)
  const messageMode: MessageMode = isStreamingDraft ? 'streaming' : 'static'
  const messageRole = getRoleForEventType(event.eventType)

  const getEventClassName = (): string => {
    const baseClass = 'timeline-event-card'
    if (isAssistantPlaceholder) {
      return `${baseClass} timeline-event-card--assistant-placeholder`
    }
    if (isStreamingDraft) {
      return `${baseClass} timeline-event-card--streaming-draft`
    }
    const typeClass = `timeline-event-card--${event.eventType}`
    return `${baseClass} ${typeClass}`
  }

  const renderContent = (): React.ReactNode => {
    if (isAssistantPlaceholder) {
      return (
        <div className="assistant-placeholder-animation">
          <span className="placeholder-dot"></span>
          <span className="placeholder-dot"></span>
          <span className="placeholder-dot"></span>
        </div>
      )
    }

    if (isStreamingDraft) {
      return (
        <div className="timeline-event-content">
          <MessageContent
            text={event.content}
            role={messageRole}
            mode={messageMode}
          />
        </div>
      )
    }

    switch (event.eventType) {
      case 'thinking_summary':
        return (
          <div className="timeline-thinking">
            <button
              className="timeline-thinking-toggle"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
            >
              <span className="timeline-thinking-icon">{isExpanded ? '▼' : '▶'}</span>
              <span>{isExpanded ? '思考中...' : 'Thinking...'}</span>
            </button>
            {isExpanded && event.content && (
              <div className="timeline-thinking-content">
                <MessageContent
                  text={event.content}
                  role={messageRole}
                  mode={messageMode}
                />
              </div>
            )}
          </div>
        )

      case 'tool_call':
      case 'tool_result':
        if (toolName && parameters) {
          return (
            <ToolCallCard
              toolName={toolName}
              parameters={parameters}
              result={toolResult}
              status={toolStatus ?? 'completed'}
              durationMs={durationMs}
            />
          )
        }
        return (
          <div className="timeline-code-block">
            <pre className="timeline-code-content">
              <code>{formatMessageContent(event.content) || '(No content)'}</code>
            </pre>
          </div>
        )

      case 'approval_request':
        if (approvalRequestId && actionType) {
          return (
            <ApprovalCard
              approvalId={approvalRequestId}
              actionType={actionType}
              resource={resource}
              justification={justification}
              riskLevel={riskLevel}
              status={approvalStatus ?? 'pending'}
              onApprove={() => {}}
              onReject={() => {}}
            />
          )
        }
        return event.content ? (
          <div className="timeline-event-content">
            <MessageContent
              text={event.content}
              role={messageRole}
              mode={messageMode}
            />
          </div>
        ) : null

      case 'run_started':
      case 'run_progress':
      case 'run_completed':
      case 'run_failed':
      case 'run_cancelled':
        if (taskId && taskLabel) {
          const runStatusMap: Record<string, 'running' | 'completed' | 'failed' | 'cancelled'> = {
            run_started: 'running',
            run_progress: 'running',
            run_completed: 'completed',
            run_failed: 'failed',
            run_cancelled: 'cancelled',
          }
          return (
            <BackgroundTaskCard
              taskId={taskId}
              label={taskLabel}
              status={runStatusMap[event.eventType]}
              progress={progress}
              message={taskMessage}
            />
          )
        }
        return event.content ? (
          <div className="timeline-event-content">
            <MessageContent
              text={event.content}
              role={messageRole}
              mode={messageMode}
            />
          </div>
        ) : null

      default:
        return event.content ? (
          <div className="timeline-event-content">
            <MessageContent
              text={event.content}
              role={messageRole}
              mode={messageMode}
            />
          </div>
        ) : null
    }
  }

  return (
    <div
      className={getEventClassName()}
      data-testid={
        isAssistantPlaceholder
          ? 'assistant-placeholder'
          : isStreamingDraft
            ? 'streaming-assistant-draft'
            : `timeline-event-${event.eventId}`
      }
      data-event-type={event.eventType}
      data-is-command={event.actor === 'command' ? 'true' : undefined}
      data-attempt-id={attemptId}
    >
      <div className="timeline-event-header">
        <span className="timeline-event-label">{label}</span>
        <span className="timeline-event-timestamp">{timestamp}</span>
        {event.actor && <span className="timeline-event-actor">@{event.actor}</span>}
      </div>
      <div className="timeline-event-body">{renderContent()}</div>
    </div>
  )
}
