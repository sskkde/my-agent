import React, { useState } from 'react'
import { MessageContent } from '../../../components/message/MessageContent'

export interface ReasoningBlockProps {
  content: string
}

const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="chat-reasoning-block" data-testid="chat-reasoning-block">
      <button
        className="chat-reasoning-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        type="button"
      >
        <span className="chat-reasoning-icon">{isExpanded ? '▼' : '▶'}</span>
        <span>推理摘要</span>
      </button>
      {isExpanded && content && (
        <div className="chat-reasoning-content">
          <MessageContent text={content} role="assistant" mode="static" />
        </div>
      )}
    </div>
  )
}

export default ReasoningBlock
