import React from 'react'

export interface ChatWelcomeProps {
  onPromptSelect: (prompt: string) => void
}

const PROMPTS = [
  {
    title: '写一首短诗',
    desc: '关于秋天的意境',
    prompt: '帮我写一首关于秋天的短诗',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    title: '解释技术概念',
    desc: 'CSS Grid 布局原理',
    prompt: '解释一下什么是 CSS Grid 布局',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    title: '旅行规划',
    desc: '三天杭州行程安排',
    prompt: '帮我规划一个三天的杭州旅行计划',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    title: '读书推荐',
    desc: '设计相关书籍',
    prompt: '推荐几本关于设计的书',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
]

const ChatWelcome: React.FC<ChatWelcomeProps> = ({ onPromptSelect }) => {
  return (
    <div className="chat-welcome" data-testid="chat-welcome">
      <div className="chat-welcome__logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h1 className="chat-welcome__title">有什么可以帮你的？</h1>
      <p className="chat-welcome__subtitle">我是 Hana，你的私人 AI 助理。有记忆、有性格，会主动行动。随便聊点什么吧。</p>
      <div className="chat-welcome__prompts" role="list">
        {PROMPTS.map((p) => (
          <button
            key={p.title}
            className="chat-prompt-card"
            onClick={() => onPromptSelect(p.prompt)}
            role="listitem"
          >
            <div className="chat-prompt-card__icon" aria-hidden="true">{p.icon}</div>
            <span className="chat-prompt-card__title">{p.title}</span>
            <span className="chat-prompt-card__desc">{p.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default ChatWelcome
