import React, { useState } from 'react'
import LoadingSpinner from './LoadingSpinner'
import { CodeBlock } from './message/CodeBlock'

export interface ToolCallCardProps {
  toolName: string
  parameters: Record<string, unknown>
  result?: string
  status: 'running' | 'completed' | 'failed'
  durationMs?: number
  agentProfile?: string
  agentType?: string
  onExpand?: () => void
}

const statusLabels: Record<ToolCallCardProps['status'], string> = {
  running: '运行中',
  completed: '已完成',
  failed: '失败',
}

const toolNameLabels: Record<string, string> = {
  web_search: '网页搜索',
  web_fetch: '网页抓取',
  read_file: '读取文件',
  write_file: '写入文件',
  exec_command: '执行命令',
  search_subagent: '搜索子代理',
  session_history: '会话历史',
  transcript_search: '转录搜索',
  memory_retrieve: '记忆检索',
  status_query: '状态查询',
}

const getToolDisplayName = (toolName: string): string => {
  return toolNameLabels[toolName] || toolName
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  parameters,
  result,
  status,
  durationMs,
  agentProfile,
  agentType,
  onExpand,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const handleToggle = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    if (newState && onExpand) {
      onExpand()
    }
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatJson = (obj: Record<string, unknown>): string => {
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return '[无法序列化]'
    }
  }

  return (
    <div className="tool-call-card" data-testid="tool-call-card" data-status={status}>
      <div
        className="tool-call-card__header"
        onClick={handleToggle}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleToggle()
          }
        }}
      >
        <span className="tool-call-card__expand-icon" aria-hidden="true">
          {isExpanded ? '▼' : '▶'}
        </span>
        <span className="tool-call-card__tool-name">{getToolDisplayName(toolName)}</span>
        <span className="tool-call-card__tool-name-original">{toolName}</span>
        {agentProfile && (
          <span className="tool-call-card__agent-profile">{agentProfile}</span>
        )}
        {agentType && agentType !== agentProfile && (
          <span className="tool-call-card__agent-type">{agentType}</span>
        )}
        <span className={`status-badge status-badge--${status}`}>
          {status === 'running' && <LoadingSpinner size="small" inline label="" />}
          {statusLabels[status]}
        </span>
        {durationMs !== undefined && status !== 'running' && (
          <span className="tool-call-card__duration">{formatDuration(durationMs)}</span>
        )}
      </div>

      {isExpanded && (
        <div className="tool-call-card__body">
          <div className="tool-call-card__section">
            <div className="tool-call-card__section-label">参数</div>
            <div className="tool-call-card__json">
              <CodeBlock code={formatJson(parameters)} language="json" />
            </div>
          </div>

          {result !== undefined && (
            <div className="tool-call-card__section">
              <div className="tool-call-card__section-label">结果</div>
              <div className="tool-call-card__json tool-call-card__json--result">
                <CodeBlock code={result} language="bash" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ToolCallCard
