import React, { useState } from 'react';
import type { ConsoleTimelineEvent, ConsoleTimelineEventType } from '../../api/types';
import { useApprovalActions } from '../../features/approvals/ApprovalActionHandler';

export interface TimelineEventCardProps {
  event: ConsoleTimelineEvent;
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
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const sanitizeContent = (content: string | undefined): string => {
  if (!content) return '';
  // Remove any HTML tags to prevent XSS
  return content.replace(/<[^>]*>/g, '');
};

export const TimelineEventCard: React.FC<TimelineEventCardProps> = ({ event }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [actionTaken, setActionTaken] = useState<'approved' | 'rejected' | null>(null);
  const { approve, reject, isSubmitting, error } = useApprovalActions();

  const isAssistantPlaceholder = event.metadata?.assistantPlaceholder === true;
  const isStreamingDraft = event.metadata?.streamingDraft === true;
  const attemptId = typeof event.metadata?.attemptId === 'string' ? event.metadata.attemptId : undefined;

  const approvalRequestId = typeof event.metadata?.approvalRequestId === 'string'
    ? event.metadata.approvalRequestId
    : undefined;
  const approvalStatus = typeof event.metadata?.approvalStatus === 'string'
    ? event.metadata.approvalStatus as 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'
    : undefined;
  const currentUserId = typeof event.metadata?.currentUserId === 'string'
    ? event.metadata.currentUserId
    : undefined;
  const approvalUserId = typeof event.metadata?.userId === 'string'
    ? event.metadata.userId
    : undefined;

  const label = isStreamingDraft ? 'Assistant (streaming)' : eventTypeLabels[event.eventType];
  const timestamp = formatTimestamp(event.timestamp);
  const sanitizedContent = sanitizeContent(event.content);

  const getEventClassName = (): string => {
    const baseClass = 'timeline-event-card';
    if (isAssistantPlaceholder) {
      return `${baseClass} timeline-event-card--assistant-placeholder`;
    }
    if (isStreamingDraft) {
      return `${baseClass} timeline-event-card--streaming-draft`;
    }
    const typeClass = `timeline-event-card--${event.eventType}`;
    return `${baseClass} ${typeClass}`;
  };

  const renderContent = (): React.ReactNode => {
    if (isAssistantPlaceholder) {
      return (
        <div className="assistant-placeholder-animation">
          <span className="placeholder-dot"></span>
          <span className="placeholder-dot"></span>
          <span className="placeholder-dot"></span>
        </div>
      );
    }

    if (isStreamingDraft) {
      return sanitizedContent ? (
        <div className="timeline-event-content">{sanitizedContent}</div>
      ) : null;
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
            {isExpanded && sanitizedContent && (
              <div className="timeline-thinking-content">{sanitizedContent}</div>
            )}
          </div>
        );

      case 'tool_call':
      case 'tool_result':
        return (
          <div className="timeline-code-block">
            <pre className="timeline-code-content">
              <code>{sanitizedContent || '(No content)'}</code>
            </pre>
          </div>
        );

      case 'approval_request':
        if (!approvalRequestId) {
          return sanitizedContent ? (
            <div className="timeline-event-content">{sanitizedContent}</div>
          ) : null;
        }

        const effectiveStatus = actionTaken ?? approvalStatus;
        const isOwnApproval = !currentUserId || !approvalUserId || currentUserId === approvalUserId;
        const isPending = effectiveStatus === 'pending';

        const handleApprove = async () => {
          if (!approvalRequestId) return;
          try {
            await approve(approvalRequestId);
            setActionTaken('approved');
          } catch {
            // noop - error displayed via hook
          }
        };

        const handleReject = async () => {
          if (!approvalRequestId) return;
          try {
            await reject(approvalRequestId);
            setActionTaken('rejected');
          } catch {
            // noop - error displayed via hook
          }
        };

        return (
          <div className="timeline-approval-request">
            {sanitizedContent && (
              <div className="timeline-event-content">{sanitizedContent}</div>
            )}
            {isPending && isOwnApproval && (
              <div className="timeline-approval-actions">
                <button
                  data-testid={`approval-approve-${approvalRequestId}`}
                  onClick={handleApprove}
                  disabled={isSubmitting}
                  className="timeline-approval-btn timeline-approval-btn--approve"
                >
                  {isSubmitting ? '处理中...' : '批准'}
                </button>
                <button
                  data-testid={`approval-reject-${approvalRequestId}`}
                  onClick={handleReject}
                  disabled={isSubmitting}
                  className="timeline-approval-btn timeline-approval-btn--reject"
                >
                  {isSubmitting ? '处理中...' : '拒绝'}
                </button>
              </div>
            )}
            {effectiveStatus === 'approved' && (
              <div className="timeline-approval-status timeline-approval-status--approved">
                已批准
              </div>
            )}
            {effectiveStatus === 'rejected' && (
              <div className="timeline-approval-status timeline-approval-status--rejected">
                已拒绝
              </div>
            )}
            {error && (
              <div className="timeline-approval-error">{error}</div>
            )}
          </div>
        );

      default:
        return sanitizedContent ? (
          <div className="timeline-event-content">{sanitizedContent}</div>
        ) : null;
    }
  };

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
        {event.actor && (
          <span className="timeline-event-actor">@{event.actor}</span>
        )}
      </div>
      <div className="timeline-event-body">{renderContent()}</div>
    </div>
  );
};
