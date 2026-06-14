import React from 'react'
import agentAvatarUrl from '../../assets/default-agent-avatar.svg?url'

export interface TimelineWelcomeStateProps {
  onPromptSelect?: (prompt: string) => void
}

const QUICK_PROMPTS = [
  '帮我规划今天的工作流',
  '分析一下最近的数据',
  '写一份周报',
  '帮我整理待办事项',
]

export const TimelineWelcomeState: React.FC<TimelineWelcomeStateProps> = ({ onPromptSelect }) => {
  const handlePromptClick = (prompt: string) => {
    onPromptSelect?.(prompt)
  }

  return (
    <div className="timeline-welcome" data-testid="timeline-welcome">
      <div className="timeline-welcome__avatar-container">
        <img className="timeline-welcome__avatar" src={agentAvatarUrl} alt="" />
      </div>

      <h2 className="timeline-welcome__title">今天想让智能体帮你做什么？</h2>
      <p className="timeline-welcome__subtitle">
        开始一段对话，让智能体协助你完成日常工作
      </p>

      <div className="timeline-welcome__prompts" aria-label="快捷 prompt">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            className="timeline-welcome__prompt"
            type="button"
            onClick={() => handlePromptClick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
