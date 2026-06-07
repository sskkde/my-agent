import React from 'react'
import type { ProcessingStatusPayload, StreamStatus, ProcessingStage } from '../../api/types'

interface ProcessingStatusProps {
  streamStatus: StreamStatus
  processingStatus?: ProcessingStatusPayload | null
  onRetry?: () => void
}

const isActiveStage = (stage: ProcessingStage): boolean => {
  return stage !== 'idle' && stage !== 'completed'
}

export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({ streamStatus, processingStatus, onRetry }) => {
  const hasActiveProcessing = processingStatus && isActiveStage(processingStatus.stage)

  const model =
    hasActiveProcessing && processingStatus.providerId && processingStatus.model
      ? `${processingStatus.providerId}/${processingStatus.model}`
      : null

  const stage = hasActiveProcessing && processingStatus.stageLabel ? processingStatus.stageLabel : null

  const context =
    hasActiveProcessing && processingStatus.contextUsage
      ? processingStatus.contextUsage.maxContextTokens
        ? `${processingStatus.contextUsage.totalTokens}/${processingStatus.contextUsage.maxContextTokens}`
        : `${processingStatus.contextUsage.totalTokens}`
      : null

  const tools =
    hasActiveProcessing && processingStatus.activeTools?.length
      ? processingStatus.activeTools.map((t) => t.toolId).join(', ')
      : null

  const error = hasActiveProcessing && processingStatus.error ? processingStatus.error : null

  return (
    <div className="processing-status-indicator" data-testid="processing-status-indicator">
      {model && <span className="processing-status-chip">模型：{model}</span>}
      {stage && <span className="processing-status-chip">阶段：{stage}</span>}
      {context && <span className="processing-status-chip">上下文：{context}</span>}
      {tools && <span className="processing-status-chip">工具：{tools}</span>}
      {error && <span className="processing-status-chip">错误：{error}</span>}
      {!model && !stage && !context && !tools && !error && (
        <span className="processing-status-chip processing-status-chip--idle">就绪</span>
      )}
      {streamStatus === 'disconnected' && onRetry && (
        <button className="stream-retry-button" onClick={onRetry}>
          重连
        </button>
      )}
    </div>
  )
}
