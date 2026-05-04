import React from 'react';
import type { ProcessingStatusPayload, StreamStatus } from '../../api/types';

interface ProcessingStatusProps {
  streamStatus: StreamStatus;
  processingStatus?: ProcessingStatusPayload | null;
  onRetry?: () => void;
}

export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({
  streamStatus,
  processingStatus,
  onRetry,
}) => {
  const model = processingStatus?.providerId && processingStatus?.model
    ? `${processingStatus.providerId}/${processingStatus.model}`
    : '未知';
  
  const stage = processingStatus?.stageLabel || '空闲';
  
  const context = processingStatus?.contextUsage
    ? processingStatus.contextUsage.maxContextTokens
      ? `${processingStatus.contextUsage.totalTokens}/${processingStatus.contextUsage.maxContextTokens}`
      : `${processingStatus.contextUsage.totalTokens}`
    : '未知';
  
  const tools = processingStatus?.activeTools?.length
    ? processingStatus.activeTools.map(t => t.toolId).join(', ')
    : '无';

  return (
    <div className="processing-status-indicator" data-testid="processing-status-indicator">
      <span className="processing-status-chip">模型：{model}</span>
      <span className="processing-status-chip">阶段：{stage}</span>
      <span className="processing-status-chip">上下文：{context}</span>
      <span className="processing-status-chip">工具：{tools}</span>
      {streamStatus === 'disconnected' && onRetry && (
        <button className="stream-retry-button" onClick={onRetry}>重连</button>
      )}
    </div>
  );
};
