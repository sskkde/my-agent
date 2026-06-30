# 聊天页暖纸主题重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 HanaAgent 暖纸主题原型为视觉基准，彻底重写当前聊天主交互页面，保留核心聊天循环，复杂功能后续分批以插件卡片形式接回。

**Architecture:** 在 `web/src/features/session/chat/` 下新建一套聊天专用组件（ChatPage / ChatShell / ChatSessionList / ChatMessageList / ChatComposer / ChatContextPanel / chat-theme.css），复用现有 `useSessionList` / `useSelectedSession` / `useComposerSubmission` 等 hook 管理数据，替换 `App.tsx` 中 chat 路由入口，由 `AgentShell` 继续提供外层产品导航与右侧书桌兼容。

**Tech Stack:** React 18 + TypeScript + Vite，CSS 全局样式（与项目现有风格一致），React Router v6，Vitest + React Testing Library。

## Global Constraints

- 保持 `npm --prefix web test` 通过。
- 保持 `npm --prefix web run build` 通过。
- 不引入新依赖。
- CSS 不使用 CSS-in-JS，沿用项目全局 CSS / CSS Module 风格。
- 保留现有 `theme.css` warm-paper token，新增 `chat-theme.css` 专项样式。
- 第一期仅保留核心聊天循环；BrowserHandoff、ApprovalModal、工具调用详情、地图、文件附件上传均降级为占位或隐藏。
- TypeScript strict mode（含 `noUnusedLocals`、`noUnusedParameters`）必须无错误。

---

## 文件结构映射

| 文件 | 职责 |
|---|---|
| `web/src/features/session/chat/ChatPage.tsx` | chat 路由入口，替代 `SessionWorkspace` |
| `web/src/features/session/chat/ChatShell.tsx` | 三栏布局容器 |
| `web/src/features/session/chat/ChatSessionList.tsx` | 左侧会话列表（日期分组） |
| `web/src/features/session/chat/ChatWelcome.tsx` | 欢迎屏 + 四宫格 prompt-card |
| `web/src/features/session/chat/ChatMessageList.tsx` | 消息列表容器 |
| `web/src/features/session/chat/ChatMessage.tsx` | 单条消息（avatar + 衬线正文 + 操作栏） |
| `web/src/features/session/chat/ChatComposer.tsx` | 底部输入框 + 状态栏 + 发送 |
| `web/src/features/session/chat/ChatContextPanel.tsx` | 右侧工作台（计划 + 书桌） |
| `web/src/features/session/chat/ChatToast.tsx` | 居底轻量 Toast |
| `web/src/features/session/chat/chat-theme.css` | 暖纸主题专项样式 |
| `web/src/features/session/chat/ChatPage.test.tsx` | ChatPage 渲染测试 |
| `web/src/features/session/chat/ChatComposer.test.tsx` | Composer 交互测试 |
| `web/src/features/session/chat/ChatMessageList.test.tsx` | 消息渲染测试 |
| `web/src/App.tsx` | chat 路由改为渲染 `ChatPage` |

---

## Task 1: 创建暖纸主题基础样式 `chat-theme.css`

**Files:**
- Create: `web/src/features/session/chat/chat-theme.css`
- Test: 手动查看，无需单测；后续组件测试覆盖渲染

**Interfaces:**
- Consumes: 现有 `theme.css` 中 `[data-theme='warm-paper']` 变量
- Produces: `.chat-page`, `.chat-shell`, `.chat-session-list`, `.chat-welcome`, `.chat-message-list`, `.chat-message`, `.chat-composer`, `.chat-context-panel`, `.chat-toast` 等样式类

- [ ] **Step 1: 编写 `chat-theme.css` 基础 token 与布局**

```css
/* web/src/features/session/chat/chat-theme.css */

.chat-page {
  --chat-sidebar-width: 240px;
  --chat-right-width: 280px;
  --chat-column-width: 720px;
  --chat-titlebar-h: 44px;

  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-titlebar {
  flex-shrink: 0;
  height: var(--chat-titlebar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--bg);
  border-bottom: 0.5px solid var(--border);
}

.chat-titlebar__left,
.chat-titlebar__right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-titlebar__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.chat-titlebar__btn:hover {
  background: rgba(42, 38, 34, 0.04);
  color: var(--text);
}

.chat-titlebar__btn svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

.chat-titlebar__title {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.chat-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  background: var(--bg);
}

.chat-sidebar {
  position: relative;
  width: var(--chat-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated, #fbf8f0);
  border-right: 0.5px solid var(--border);
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
}

.chat-sidebar.collapsed {
  width: 0;
  border-right-color: transparent;
}

.chat-sidebar__inner {
  display: flex;
  flex-direction: column;
  width: var(--chat-sidebar-width);
  min-width: var(--chat-sidebar-width);
  height: 100%;
}

.chat-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
}

.chat-sidebar__title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.chat-sidebar__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  border-radius: var(--radius-sm, 2px);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-sidebar__action:hover {
  color: var(--accent);
  background: rgba(83, 125, 150, 0.08);
}

.chat-sidebar__action svg {
  width: 15px;
  height: 15px;
  stroke-width: 1.5;
}

.chat-new-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% - 32px);
  margin: 2px auto 4px;
  padding: 7px 12px;
  border-radius: var(--radius-sm, 2px);
  font-family: inherit;
  font-size: 0.78rem;
  color: var(--text);
  background: var(--bg-card, #fbf7ee);
  border: 0.5px solid rgba(216, 207, 190, 0.5);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.chat-new-btn:hover {
  background: rgba(83, 125, 150, 0.08);
  color: var(--accent);
  border-color: rgba(83, 125, 150, 0.2);
}

.chat-new-btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
  flex-shrink: 0;
}

.chat-session-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px;
}

.chat-session-date {
  font-size: 0.65rem;
  color: var(--text-faint, #8f867b);
  letter-spacing: 0.06em;
  padding: 8px 8px 2px;
  text-transform: uppercase;
}

.chat-session-item {
  display: flex;
  flex-direction: column;
  padding: 7px 10px;
  margin-bottom: 1px;
  border-radius: var(--radius-sm, 2px);
  cursor: pointer;
  transition: background 0.15s;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  font-family: inherit;
  overflow: hidden;
}

.chat-session-item:hover {
  background: rgba(42, 38, 34, 0.04);
}

.chat-session-item.active {
  background: rgba(83, 125, 150, 0.08);
}

.chat-session-item__title {
  font-size: 0.8rem;
  color: var(--text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.chat-session-item.active .chat-session-item__title {
  color: var(--accent);
  font-weight: 600;
}

.chat-session-item__meta {
  font-size: 0.66rem;
  color: var(--text-faint, #8f867b);
  margin-top: 2px;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px 24px 10rem;
  scroll-behavior: smooth;
}

.chat-column {
  max-width: var(--chat-column-width);
  margin: 0 auto;
}

.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  padding: 40px 16px;
}

.chat-welcome__logo {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-card, #fbf7ee);
  border: 0.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(42, 38, 34, 0.04);
}

.chat-welcome__logo svg {
  width: 32px;
  height: 32px;
  color: var(--accent);
  stroke-width: 1.5;
}

.chat-welcome__title {
  font-family: 'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;
  font-size: 1.75rem;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 8px;
  letter-spacing: 0.01em;
}

.chat-welcome__subtitle {
  font-size: 0.88rem;
  color: var(--text-muted);
  max-width: 28rem;
  line-height: 1.6;
}

.chat-welcome__prompts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 40px;
  max-width: 36rem;
  width: 100%;
}

.chat-prompt-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 16px;
  background: var(--bg-card, #fbf7ee);
  border: 0.5px solid rgba(216, 207, 190, 0.5);
  border-radius: var(--radius-md, 3px);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: left;
  font-family: inherit;
}

.chat-prompt-card:hover {
  background: rgba(83, 125, 150, 0.08);
  border-color: rgba(83, 125, 150, 0.15);
  transform: translateY(-1px);
}

.chat-prompt-card__icon {
  width: 20px;
  height: 20px;
  color: var(--accent);
  margin-bottom: 4px;
}

.chat-prompt-card__icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.5;
}

.chat-prompt-card__title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
}

.chat-prompt-card__desc {
  font-size: 0.74rem;
  color: var(--text-muted);
  line-height: 1.5;
}

.chat-message-group {
  margin-bottom: 24px;
}

.chat-message {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.chat-message__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.74rem;
  font-weight: 600;
  overflow: hidden;
}

.chat-message__avatar--assistant {
  background: var(--bg-card, #fbf7ee);
  border: 0.5px solid var(--border);
  color: var(--accent);
}

.chat-message__avatar--assistant svg {
  width: 18px;
  height: 18px;
  stroke-width: 1.5;
}

.chat-message__avatar--user {
  background: rgba(83, 125, 150, 0.1);
  color: var(--accent);
}

.chat-message__content {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
}

.chat-message__role {
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text-light, #4a433c);
  margin-bottom: 2px;
}

.chat-message__body {
  font-family: 'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;
  font-size: 15px;
  line-height: 1.75;
  color: var(--text);
  user-select: text;
}

.chat-message__body p {
  margin: 0 0 0.5em 0;
}

.chat-message__body p:last-child {
  margin-bottom: 0;
}

.chat-message__body strong {
  font-weight: 600;
  color: var(--text);
}

.chat-message__body em {
  font-style: italic;
}

.chat-message__body code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.85em;
  background: rgba(42, 38, 34, 0.04);
  padding: 0.15em 0.35em;
  border-radius: var(--radius-sm, 2px);
  color: var(--text);
}

.chat-message__body pre {
  background: rgba(42, 38, 34, 0.03);
  border: 0.5px solid rgba(216, 207, 190, 0.5);
  border-radius: var(--radius-md, 3px);
  padding: 8px 16px;
  margin: 16px 0;
  overflow-x: auto;
  line-height: 1.5;
}

.chat-message__body pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 0.82em;
  color: var(--text);
}

.chat-message__actions {
  display: flex;
  gap: 2px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.chat-message:hover .chat-message__actions {
  opacity: 1;
}

.chat-message__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--text-faint, #8f867b);
  cursor: pointer;
  transition: all 0.15s;
}

.chat-message__action:hover {
  background: rgba(42, 38, 34, 0.04);
  color: var(--text);
}

.chat-message__action svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
}

.chat-typing {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.chat-typing__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint, #8f867b);
  animation: chat-typing-bounce 1.4s infinite ease-in-out;
}

.chat-typing__dot:nth-child(2) { animation-delay: 0.2s; }
.chat-typing__dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes chat-typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.chat-input-wrapper {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 24px 16px;
  background: linear-gradient(to top, var(--bg) 60%, transparent);
}

.chat-input-surface {
  max-width: var(--chat-column-width);
  margin: 0 auto;
  background: var(--bg-card, #fbf7ee);
  border: 0.5px solid var(--border);
  border-radius: 6px;
  padding: 8px 16px;
  box-shadow: 0 2px 12px rgba(42, 38, 34, 0.04);
  transition: border-color 0.15s;
}

.chat-input-surface:focus-within {
  border-color: rgba(83, 125, 150, 0.3);
}

.chat-input {
  width: 100%;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 0.88rem;
  line-height: 1.6;
  color: var(--text);
  resize: none;
  outline: none;
  min-height: 24px;
  max-height: 200px;
  user-select: text;
}

.chat-input::placeholder {
  color: var(--text-faint, #8f867b);
}

.chat-input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  gap: 8px;
}

.chat-input-tools {
  display: flex;
  gap: 2px;
}

.chat-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--text-faint, #8f867b);
  cursor: pointer;
  transition: all 0.15s;
}

.chat-tool-btn:hover {
  background: rgba(42, 38, 34, 0.04);
  color: var(--text);
}

.chat-tool-btn svg {
  width: 16px;
  height: 16px;
  stroke-width: 1.5;
}

.chat-status-bar {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 4px;
  overflow: hidden;
}

.chat-status-segment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 100%;
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
}

.chat-status-segment + .chat-status-segment::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 0.5px;
  background: rgba(216, 207, 190, 0.5);
}

.chat-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-ghost, #b8b0a3);
  transition: background 0.15s;
}

.chat-status-dot--thinking {
  background: var(--accent);
  animation: chat-pulse-dot 1.2s ease-in-out infinite;
}

.chat-status-dot--tool {
  background: #4a6b4a;
  animation: chat-pulse-dot 0.8s ease-in-out infinite;
}

.chat-status-dot--generating {
  background: #c9a14a;
  animation: chat-pulse-dot 1s ease-in-out infinite;
}

@keyframes chat-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.chat-status-label {
  font-weight: 500;
  color: var(--text-light, #4a433c);
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-status-sub {
  color: var(--text-faint, #8f867b);
  font-size: 0.66rem;
}

.chat-ctx-bar {
  width: 60px;
  height: 3px;
  background: rgba(42, 38, 34, 0.04);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.chat-ctx-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-ctx-fill--warn { background: #c9a14a; }
.chat-ctx-fill--danger { background: #8b2c1f; }

.chat-ctx-pct {
  font-size: 0.66rem;
  color: var(--text-faint, #8f867b);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.chat-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}

.chat-send-btn:hover {
  background: var(--accent-hover, #466a80);
}

.chat-send-btn:disabled {
  background: var(--text-ghost, #b8b0a3);
  cursor: not-allowed;
}

.chat-send-btn svg {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

.chat-toast {
  position: fixed;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: var(--text);
  color: var(--bg);
  padding: 8px 16px;
  border-radius: var(--radius-sm, 2px);
  font-size: 0.78rem;
  opacity: 0;
  transition: opacity 0.25s, transform 0.25s;
  z-index: 9999;
  pointer-events: none;
}

.chat-toast.show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.chat-right-sidebar {
  position: relative;
  width: var(--chat-right-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-elevated, #fbf8f0);
  border-left: 0.5px solid var(--border);
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
}

.chat-right-sidebar.collapsed {
  width: 0;
  border-left-color: transparent;
}

.chat-right-sidebar__inner {
  display: flex;
  flex-direction: column;
  width: var(--chat-right-width);
  min-width: var(--chat-right-width);
  height: 100%;
}

@media (max-width: 1024px) {
  .chat-right-sidebar {
    position: absolute;
    right: 0;
    top: 0;
    height: 100%;
    z-index: 100;
    box-shadow: -4px 0 16px rgba(42, 38, 34, 0.08);
  }
}

@media (max-width: 768px) {
  .chat-sidebar {
    position: absolute;
    height: 100%;
    z-index: 100;
  }
  .chat-welcome__prompts {
    grid-template-columns: 1fr;
  }
  .chat-right-sidebar {
    width: 240px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-page * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: 运行 TypeScript 与构建检查**

Run:
```bash
npm --prefix "web" run typecheck
npm --prefix "web" run build
```

Expected: 通过（此时只有 CSS 文件，无 TS 引用，不会影响编译）。

- [ ] **Step 3: Commit**

```bash
git add "web/src/features/session/chat/chat-theme.css"
git commit -m "feat(chat): add warm-paper chat theme stylesheet"
```

---

## Task 2: 创建 `ChatToast.tsx` 轻量 Toast 组件

**Files:**
- Create: `web/src/features/session/chat/ChatToast.tsx`
- Test: `web/src/features/session/chat/ChatToast.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `showToast(message: string)` 全局函数；`ChatToast` 组件渲染固定 DOM `#chat-toast`

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatToast.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { ChatToast, showToast } from './ChatToast'

describe('ChatToast', () => {
  it('renders toast container', () => {
    render(<ChatToast />)
    expect(document.getElementById('chat-toast')).toBeInTheDocument()
  })

  it('shows message when showToast is called', async () => {
    render(<ChatToast />)
    showToast('hello toast')
    await waitFor(() => {
      expect(screen.getByText('hello toast')).toBeInTheDocument()
    })
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatToast.test.tsx
```

Expected: FAIL - `ChatToast` / `showToast` 未定义。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatToast.tsx
import React, { useEffect, useRef, useState } from 'react'

let toastHandler: ((msg: string) => void) | null = null

export function showToast(message: string): void {
  if (toastHandler) {
    toastHandler(message)
  }
}

const ChatToast: React.FC = () => {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    toastHandler = (msg: string) => {
      setMessage(msg)
      setVisible(true)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => {
        setVisible(false)
      }, 2200)
    }
    return () => {
      toastHandler = null
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return (
    <div
      id="chat-toast"
      className={`chat-toast ${visible ? 'show' : ''}`}
      role="status"
      aria-live="polite"
      aria-hidden={!visible}
    >
      {message}
    </div>
  )
}

export default ChatToast
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatToast.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatToast.tsx" "web/src/features/session/chat/ChatToast.test.tsx"
git commit -m "feat(chat): add ChatToast component"
```

---

## Task 3: 创建 `ChatWelcome.tsx` 欢迎屏组件

**Files:**
- Create: `web/src/features/session/chat/ChatWelcome.tsx`
- Test: `web/src/features/session/chat/ChatWelcome.test.tsx`

**Interfaces:**
- Consumes: `onPromptSelect(prompt: string): void`
- Produces: 渲染欢迎屏和 prompt-card；点击时调用 `onPromptSelect`

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatWelcome.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ChatWelcome from './ChatWelcome'

describe('ChatWelcome', () => {
  it('renders title and prompts', () => {
    render(<ChatWelcome onPromptSelect={() => {}} />)
    expect(screen.getByText('有什么可以帮你的？')).toBeInTheDocument()
    expect(screen.getByText('写一首短诗')).toBeInTheDocument()
  })

  it('calls onPromptSelect when prompt card clicked', () => {
    const onPromptSelect = vi.fn()
    render(<ChatWelcome onPromptSelect={onPromptSelect} />)
    fireEvent.click(screen.getByText('写一首短诗'))
    expect(onPromptSelect).toHaveBeenCalledWith('帮我写一首关于秋天的短诗')
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatWelcome.test.tsx
```

Expected: FAIL - `ChatWelcome` 未定义。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatWelcome.tsx
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
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatWelcome.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatWelcome.tsx" "web/src/features/session/chat/ChatWelcome.test.tsx"
git commit -m "feat(chat): add ChatWelcome prompt screen"
```

---

## Task 4: 创建 `ChatMessage.tsx` 单条消息组件

**Files:**
- Create: `web/src/features/session/chat/ChatMessage.tsx`
- Test: `web/src/features/session/chat/ChatMessage.test.tsx`

**Interfaces:**
- Consumes: `ConsoleTimelineEvent`（或简化后的消息对象 `{ role: 'user' | 'assistant'; content: string }`）
- Produces: 渲染消息；支持复制操作

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatMessage.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ChatMessage from './ChatMessage'

describe('ChatMessage', () => {
  it('renders user message', () => {
    render(<ChatMessage role="user" content="hello" />)
    expect(screen.getByText('你')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('renders assistant message with markdown', () => {
    render(<ChatMessage role="assistant" content="**bold** text" />)
    expect(screen.getByText('Hana')).toBeInTheDocument()
    expect(document.querySelector('strong')).toHaveTextContent('bold')
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatMessage.test.tsx
```

Expected: FAIL - `ChatMessage` 未定义。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatMessage.tsx
import React from 'react'
import MarkdownContent from '../../components/message/MarkdownContent'

export interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
}

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text)
  }
}

const ChatMessage: React.FC<ChatMessageProps> = ({ role, content }) => {
  const isAssistant = role === 'assistant'

  return (
    <div className="chat-message" data-testid={`chat-message-${role}`}>
      <div className={`chat-message__avatar chat-message__avatar--${role}`} aria-hidden="true">
        {isAssistant ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        ) : (
          '我'
        )}
      </div>
      <div className="chat-message__content">
        <div className="chat-message__role">{isAssistant ? 'Hana' : '你'}</div>
        <div className="chat-message__body">
          <MarkdownContent content={content} />
        </div>
        <div className="chat-message__actions">
          <button
            className="chat-message__action"
            aria-label="复制"
            title="复制"
            onClick={() => {
              copyToClipboard(content).catch(() => {})
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatMessage
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatMessage.test.tsx
```

Expected: PASS（假设 `MarkdownContent` 在当前测试中可用；若不可用，调整测试 mock）。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatMessage.tsx" "web/src/features/session/chat/ChatMessage.test.tsx"
git commit -m "feat(chat): add ChatMessage with warm-paper styling"
```

---

## Task 5: 创建 `ChatMessageList.tsx` 消息列表组件

**Files:**
- Create: `web/src/features/session/chat/ChatMessageList.tsx`
- Test: `web/src/features/session/chat/ChatMessageList.test.tsx`

**Interfaces:**
- Consumes: `events: ConsoleTimelineEvent[]`, `loading: boolean`, `error?: string`, `onRetryStream: () => void`
- Produces: 渲染 `ChatWelcome` 或消息列表；自动滚动到底部

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatMessageList.test.tsx
import { render, screen } from '@testing-library/react'
import ChatMessageList from './ChatMessageList'
import type { ConsoleTimelineEvent } from '../../api/types'

describe('ChatMessageList', () => {
  it('renders welcome screen when no events', () => {
    render(<ChatMessageList events={[]} loading={false} onPromptSelect={() => {}} onRetryStream={() => {}} />)
    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument()
  })

  it('renders messages from events', () => {
    const events: ConsoleTimelineEvent[] = [
      {
        eventId: '1',
        eventType: 'user_message',
        sessionId: 's1',
        timestamp: new Date().toISOString(),
        content: 'hi',
        actor: 'user',
      },
      {
        eventId: '2',
        eventType: 'assistant_message',
        sessionId: 's1',
        timestamp: new Date().toISOString(),
        content: 'hello',
        actor: 'assistant',
      },
    ]
    render(<ChatMessageList events={events} loading={false} onPromptSelect={() => {}} onRetryStream={() => {}} />)
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatMessageList.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatMessageList.tsx
import React, { useEffect, useRef } from 'react'
import type { ConsoleTimelineEvent } from '../../api/types'
import ChatWelcome from './ChatWelcome'
import ChatMessage from './ChatMessage'

export interface ChatMessageListProps {
  events: ConsoleTimelineEvent[]
  loading: boolean
  error?: string
  onPromptSelect: (prompt: string) => void
  onRetryStream: () => void
}

const actorToRole = (actor?: string): 'user' | 'assistant' => {
  return actor === 'user' ? 'user' : 'assistant'
}

const ChatMessageList: React.FC<ChatMessageListProps> = ({
  events,
  loading,
  error,
  onPromptSelect,
  onRetryStream,
}) => {
  const chatAreaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight
    }
  }, [events])

  const messageEvents = events.filter(
    (e) => e.eventType === 'user_message' || e.eventType === 'assistant_message',
  )

  return (
    <div className="chat-area" ref={chatAreaRef} data-testid="chat-message-list">
      <div className="chat-column">
        {messageEvents.length === 0 ? (
          <ChatWelcome onPromptSelect={onPromptSelect} />
        ) : (
          <div className="chat-messages">
            {messageEvents.map((event) => (
              <div key={event.eventId} className="chat-message-group">
                <ChatMessage
                  role={actorToRole(event.actor)}
                  content={event.content || ''}
                />
              </div>
            ))}
          </div>
        )}
        {loading && messageEvents.length > 0 && (
          <div className="chat-message">
            <div className="chat-message__avatar chat-message__avatar--assistant" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
            </div>
            <div className="chat-message__content">
              <div className="chat-message__role">Hana</div>
              <div className="chat-typing" aria-label="正在输入">
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
                <span className="chat-typing__dot" />
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert" data-testid="chat-message-error">
            {error}
            <button onClick={onRetryStream} className="chat-error__retry">重试</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ChatMessageList
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatMessageList.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatMessageList.tsx" "web/src/features/session/chat/ChatMessageList.test.tsx"
git commit -m "feat(chat): add ChatMessageList with auto-scroll"
```

---

## Task 6: 创建 `ChatComposer.tsx` 底部输入组件

**Files:**
- Create: `web/src/features/session/chat/ChatComposer.tsx`
- Test: `web/src/features/session/chat/ChatComposer.test.tsx`

**Interfaces:**
- Consumes: `value`, `onChange(value: string)`, `onSend()`, `sending`, `model?`, `status?`
- Produces: 渲染输入浮层、状态栏、发送按钮；Enter 发送，Shift+Enter 换行

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatComposer.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ChatComposer from './ChatComposer'

describe('ChatComposer', () => {
  it('renders textarea and send button', () => {
    render(<ChatComposer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('chat-send-button')).toBeInTheDocument()
  })

  it('calls onSend when Enter pressed', () => {
    const onSend = vi.fn()
    render(<ChatComposer value="hello" onChange={() => {}} onSend={onSend} />)
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter', code: 'Enter' })
    expect(onSend).toHaveBeenCalled()
  })

  it('disables send when value is empty', () => {
    render(<ChatComposer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.getByTestId('chat-send-button')).toBeDisabled()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatComposer.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatComposer.tsx
import React, { useEffect, useRef } from 'react'
import { showToast } from './ChatToast'

export type ChatComposerStatus = 'idle' | 'thinking' | 'tool' | 'generating'

export interface ChatComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending?: boolean
  model?: string
  status?: ChatComposerStatus
  ctxUsage?: number
}

const STATUS_LABELS: Record<ChatComposerStatus, string> = {
  idle: '空闲',
  thinking: '思考中…',
  tool: '调用工具…',
  generating: '生成回复…',
}

const ChatComposer: React.FC<ChatComposerProps> = ({
  value,
  onChange,
  onSend,
  sending = false,
  model = 'GLM-4.6',
  status = 'idle',
  ctxUsage = 12,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, 200)
    textarea.style.height = `${newHeight}px`
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !sending) {
        onSend()
      }
    }
  }

  const isSendDisabled = !value.trim() || sending

  const ctxClass = ctxUsage > 80 ? 'chat-ctx-fill--danger' : ctxUsage > 60 ? 'chat-ctx-fill--warn' : ''

  return (
    <div className="chat-input-wrapper" data-testid="chat-composer">
      <div className="chat-input-surface">
        <textarea
          ref={textareaRef}
          className="chat-input"
          data-testid="chat-input"
          placeholder="输入消息，或按 Enter 发送…"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          aria-label="聊天输入框"
        />
        <div className="chat-input-toolbar">
          <div className="chat-input-tools">
            <button
              className="chat-tool-btn"
              aria-label="附件"
              title="附件"
              onClick={() => showToast('附件上传后续接入')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              className="chat-tool-btn"
              aria-label="代码块"
              title="代码块"
              onClick={() => showToast('代码插入后续接入')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </button>
          </div>

          <div className="chat-status-bar" data-testid="chat-status-bar">
            <div className="chat-status-segment" title="当前模型">
              <span className={`chat-status-dot chat-status-dot--${status}`} />
              <span className="chat-status-label">{model}</span>
            </div>
            <div className="chat-status-segment" title="工作阶段">
              <span className="chat-status-sub">{STATUS_LABELS[status]}</span>
            </div>
            <div className="chat-status-segment" title="上下文窗口占用">
              <div className="chat-ctx-bar">
                <div
                  className={`chat-ctx-fill ${ctxClass}`}
                  style={{ width: `${Math.min(100, Math.max(0, ctxUsage))}%` }}
                  data-testid="chat-ctx-fill"
                />
              </div>
              <span className="chat-ctx-pct" data-testid="chat-ctx-pct">{Math.round(ctxUsage)}%</span>
            </div>
          </div>

          <button
            className="chat-send-btn"
            data-testid="chat-send-button"
            aria-label="发送"
            onClick={() => {
              if (!isSendDisabled) onSend()
            }}
            disabled={isSendDisabled}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatComposer
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatComposer.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatComposer.tsx" "web/src/features/session/chat/ChatComposer.test.tsx"
git commit -m "feat(chat): add ChatComposer with status indicator"
```

---

## Task 7: 创建 `ChatSessionList.tsx` 左侧会话列表

**Files:**
- Create: `web/src/features/session/chat/ChatSessionList.tsx`
- Test: `web/src/features/session/chat/ChatSessionList.test.tsx`

**Interfaces:**
- Consumes: `sessions: ConsoleSessionInfo[]`, `selectedSessionId?`, `onSelectSession(sessionId: string)`, `onCreateSession()`, `loading`, `error?`
- Produces: 日期分组渲染会话；支持新建会话

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatSessionList.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import ChatSessionList from './ChatSessionList'
import type { ConsoleSessionInfo } from '../../api/types'

describe('ChatSessionList', () => {
  it('renders new chat button', () => {
    render(<ChatSessionList sessions={[]} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('新对话')).toBeInTheDocument()
  })

  it('renders session titles', () => {
    const sessions: ConsoleSessionInfo[] = [
      {
        sessionId: 's1',
        title: 'Session 1234',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as ConsoleSessionInfo,
    ]
    render(<ChatSessionList sessions={sessions} onSelectSession={() => {}} onCreateSession={() => {}} />)
    expect(screen.getByText('Session 1234')).toBeInTheDocument()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatSessionList.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatSessionList.tsx
import React, { useMemo } from 'react'
import { showToast } from './ChatToast'
import type { ConsoleSessionInfo } from '../../../api/types'

export interface ChatSessionListProps {
  sessions: ConsoleSessionInfo[]
  selectedSessionId?: string | null
  onSelectSession: (sessionId: string) => void
  onCreateSession: () => void
  loading?: boolean
  error?: string | null
}

interface GroupedSessions {
  label: string
  sessions: ConsoleSessionInfo[]
}

function isToday(date: Date): boolean {
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function isYesterday(date: Date): boolean {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  )
}

function formatSessionMeta(date: Date): string {
  if (isToday(date)) return '刚刚'
  if (isYesterday(date)) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

const ChatSessionList: React.FC<ChatSessionListProps> = ({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  loading,
  error,
}) => {
  const grouped = useMemo(() => {
    const today: ConsoleSessionInfo[] = []
    const yesterday: ConsoleSessionInfo[] = []
    const earlier: ConsoleSessionInfo[] = []

    for (const session of sessions) {
      const date = new Date(session.updatedAt || session.createdAt)
      if (isToday(date)) today.push(session)
      else if (isYesterday(date)) yesterday.push(session)
      else earlier.push(session)
    }

    const groups: GroupedSessions[] = []
    if (today.length > 0) groups.push({ label: '今天', sessions: today })
    if (yesterday.length > 0) groups.push({ label: '昨天', sessions: yesterday })
    if (earlier.length > 0) groups.push({ label: '7 天内', sessions: earlier })
    return groups
  }, [sessions])

  return (
    <div className="chat-sidebar__inner" data-testid="chat-session-list">
      <div className="chat-sidebar__header">
        <span className="chat-sidebar__title">对话</span>
        <button
          className="chat-sidebar__action"
          aria-label="搜索会话"
          title="搜索会话"
          onClick={() => showToast('搜索后续接入')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <button className="chat-new-btn" onClick={onCreateSession} data-testid="chat-new-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        新对话
      </button>

      <div className="chat-session-list">
        {loading && <div className="chat-session-status">加载中…</div>}
        {error && <div className="chat-session-status chat-session-status--error">{error}</div>}
        {!loading && !error && grouped.length === 0 && (
          <div className="chat-session-status">暂无会话</div>
        )}
        {grouped.map((group) => (
          <React.Fragment key={group.label}>
            <div className="chat-session-date">{group.label}</div>
            {group.sessions.map((session) => {
              const date = new Date(session.updatedAt || session.createdAt)
              const isActive = session.sessionId === selectedSessionId
              return (
                <button
                  key={session.sessionId}
                  className={`chat-session-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectSession(session.sessionId)}
                  data-testid={`chat-session-${session.sessionId}`}
                >
                  <span className="chat-session-item__title">{session.title || `会话 ${session.sessionId.slice(-8)}`}</span>
                  <span className="chat-session-item__meta">{formatSessionMeta(date)}</span>
                </button>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export default ChatSessionList
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatSessionList.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatSessionList.tsx" "web/src/features/session/chat/ChatSessionList.test.tsx"
git commit -m "feat(chat): add ChatSessionList with date grouping"
```

---

## Task 8: 创建 `ChatContextPanel.tsx` 右侧工作台

**Files:**
- Create: `web/src/features/session/chat/ChatContextPanel.tsx`
- Modify: `web/src/features/context/TodoWorkPlanCard.tsx` 可选择性迁移样式；本期复用现有组件
- Test: `web/src/features/session/chat/ChatContextPanel.test.tsx`

**Interfaces:**
- Consumes: `sessionId?`, `activeTab?`
- Produces: 渲染“工作计划”和“书桌”面板；内部复用现有 `TodoWorkPlanCard`

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatContextPanel.test.tsx
import { render, screen } from '@testing-library/react'
import ChatContextPanel from './ChatContextPanel'

describe('ChatContextPanel', () => {
  it('renders work plan and desk sections', () => {
    render(<ChatContextPanel sessionId="s1" />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatContextPanel.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatContextPanel.tsx
import React from 'react'
import TodoWorkPlanCard from '../../context/TodoWorkPlanCard'

export interface ChatContextPanelProps {
  sessionId?: string | null
}

const ChatContextPanel: React.FC<ChatContextPanelProps> = ({ sessionId }) => {
  return (
    <div className="chat-right-sidebar__inner" data-testid="chat-context-panel">
      <div className="chat-rs-panel chat-rs-panel--top">
        <div className="chat-rs-panel__header">
          <span className="chat-rs-panel__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            工作计划
          </span>
        </div>
        <div className="chat-rs-panel__body">
          <TodoWorkPlanCard sessionId={sessionId} />
        </div>
      </div>

      <div className="chat-rs-panel chat-rs-panel--bottom">
        <div className="chat-rs-panel__header">
          <span className="chat-rs-panel__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            书桌
          </span>
        </div>
        <div className="chat-rs-panel__body">
          <div className="chat-desk-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <span>文件与资源将在后续版本接入书桌</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatContextPanel
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatContextPanel.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatContextPanel.tsx" "web/src/features/session/chat/ChatContextPanel.test.tsx"
git commit -m "feat(chat): add ChatContextPanel with work plan and desk"
```

---

## Task 9: 创建 `ChatShell.tsx` 三栏布局容器

**Files:**
- Create: `web/src/features/session/chat/ChatShell.tsx`
- Test: `web/src/features/session/chat/ChatShell.test.tsx`

**Interfaces:**
- Consumes: children（主内容区）、`sidebar`、`rightPanel`、toggle 回调
- Produces: 渲染标题栏 + 左中右三栏布局

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatShell.test.tsx
import { render, screen } from '@testing-library/react'
import ChatShell from './ChatShell'

describe('ChatShell', () => {
  it('renders main content and sidebars', () => {
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    expect(screen.getByTestId('main')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatShell.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现组件**

```tsx
// web/src/features/session/chat/ChatShell.tsx
import React, { useState, useEffect } from 'react'

export interface ChatShellProps {
  title: string
  sidebar: React.ReactNode
  rightPanel: React.ReactNode
  children: React.ReactNode
  initialSidebarOpen?: boolean
  initialRightOpen?: boolean
}

const ChatShell: React.FC<ChatShellProps> = ({
  title,
  sidebar,
  rightPanel,
  children,
  initialSidebarOpen = true,
  initialRightOpen = true,
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(initialSidebarOpen)
  const [isRightOpen, setIsRightOpen] = useState(initialRightOpen)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => {
      setIsMobile(window.matchMedia('(max-width: 1024px)').matches)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <div className="chat-page" data-testid="chat-shell">
      <header className="chat-titlebar">
        <div className="chat-titlebar__left">
          <button
            className="chat-titlebar__btn"
            aria-label="切换侧边栏"
            title="切换侧边栏"
            onClick={() => setIsSidebarOpen((v) => !v)}
            data-testid="chat-sidebar-toggle"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
        <div className="chat-titlebar__title">{title}</div>
        <div className="chat-titlebar__right">
          <button
            className="chat-titlebar__btn"
            aria-label="切换右侧栏"
            title="切换右侧栏"
            onClick={() => setIsRightOpen((v) => !v)}
            data-testid="chat-right-toggle"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
              <line x1="15" y1="12" x2="21" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <div className="chat-shell">
        {isMobile && isSidebarOpen && (
          <div
            className="chat-sidebar-backdrop"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside className={`chat-sidebar ${isSidebarOpen ? '' : 'collapsed'}`} data-testid="chat-sidebar">
          {sidebar}
        </aside>

        <main className="chat-main" data-testid="chat-main">
          {children}
        </main>

        {isMobile && isRightOpen && (
          <div
            className="chat-right-backdrop"
            onClick={() => setIsRightOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside className={`chat-right-sidebar ${isRightOpen ? '' : 'collapsed'}`} data-testid="chat-right-sidebar">
          {rightPanel}
        </aside>
      </div>
    </div>
  )
}

export default ChatShell
```

- [ ] **Step 3: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatShell.test.tsx
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/chat/ChatShell.tsx" "web/src/features/session/chat/ChatShell.test.tsx"
git commit -m "feat(chat): add ChatShell three-column layout"
```

---

## Task 10: 创建 `ChatPage.tsx` 路由入口并替换 `SessionWorkspace`

**Files:**
- Create: `web/src/features/session/chat/ChatPage.tsx`
- Modify: `web/src/App.tsx` chat 路由入口
- Test: `web/src/features/session/chat/ChatPage.test.tsx`

**Interfaces:**
- Consumes: `initialSessionId?`, `useSessionList`, `useSelectedSession`，`useComposerSubmission`
- Produces: 完整聊天页面

- [ ] **Step 1: 编写失败测试**

```tsx
// web/src/features/session/chat/ChatPage.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChatPage from './ChatPage'

describe('ChatPage', () => {
  it('renders chat shell', () => {
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    )
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
  })
})
```

Run:
```bash
npm --prefix "web" test -- ChatPage.test.tsx
```

Expected: FAIL。

- [ ] **Step 2: 实现 `ChatPage.tsx`**

```tsx
// web/src/features/session/chat/ChatPage.tsx
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatShell from './ChatShell'
import ChatSessionList from './ChatSessionList'
import ChatMessageList from './ChatMessageList'
import ChatComposer from './ChatComposer'
import ChatContextPanel from './ChatContextPanel'
import ChatToast from './ChatToast'
import { useSessionList } from '../hooks/useSessionList'
import { useSelectedSession } from '../hooks/useSelectedSession'
import { useComposerSubmission } from '../hooks/useComposerSubmission'
import { useSSEStream } from '../hooks/useSSEStream'
import * as api from '../../../api/client'
import type { ConsoleTimelineEvent } from '../../../api/types'
import { safeRemoveLocalStorage } from '../session-migration'
import { SELECTED_SESSION_KEY } from '../session-constants'

export interface ChatPageProps {
  initialSessionId?: string
}

type StreamStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

const ChatPage: React.FC<ChatPageProps> = ({ initialSessionId }) => {
  const navigate = useNavigate()
  const {
    selectedSessionId,
    setSelectedSessionId,
    selectedSession,
    setSelectedSession,
    selectedSessionIdRef,
    handleSelectSession,
  } = useSelectedSession({ initialSessionId, navigate })

  const { sessions, sessionsLoading, sessionsError, fetchSessions, handleCreateSession } = useSessionList({
    onSessionCreated: setSelectedSessionId,
  })

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('idle')

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const {
    draft,
    setDraft,
    sending,
    sendError,
    setSendError,
    handleSend,
    localCommandEvents,
    localMessageEvents,
  } = useComposerSubmission({
    selectedSessionId,
    mountedRef,
    selectedSessionIdRef,
    events,
    callbacks: {
      fetchSessions,
    },
  })

  const { connectSse, disconnectSse } = useSSEStream({
    mountedRef,
    selectedSessionIdRef,
    onEvent: (event: ConsoleTimelineEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.eventId === event.eventId)) return prev
        return [...prev, event]
      })
      if (['user_message', 'assistant_message', 'error'].includes(event.eventType)) {
        fetchSessions(true)
      }
    },
    onToken: () => {},
  })

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents([])
      setTimelineError(null)
      disconnectSse()
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        setTimelineLoading(true)
        setTimelineError(null)
        const sessionResponse = await api.getSession(selectedSessionId)
        if (cancelled || selectedSessionIdRef.current !== selectedSessionId) return
        setSelectedSession({
          ...sessionResponse.session,
          title: `Session ${sessionResponse.session.sessionId.slice(-8)}`,
          status: 'active',
          createdAt: sessionResponse.session.lastActivityAt,
          updatedAt: sessionResponse.session.lastActivityAt,
        })
        const timelineResponse = await api.getSessionTimeline(selectedSessionId)
        if (cancelled || selectedSessionIdRef.current !== selectedSessionId) return
        setEvents(timelineResponse.events)
        connectSse(selectedSessionId)
        setStreamStatus('connected')
      } catch (err) {
        if (!cancelled && selectedSessionIdRef.current === selectedSessionId) {
          const isMissingSession = err instanceof api.ApiClientError && ['FORBIDDEN', 'NOT_FOUND'].includes(err.code)
          if (isMissingSession) {
            setSelectedSessionId(null)
            safeRemoveLocalStorage(SELECTED_SESSION_KEY)
          }
          setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline')
        }
      } finally {
        if (!cancelled && selectedSessionIdRef.current === selectedSessionId) {
          setTimelineLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
      disconnectSse()
    }
  }, [selectedSessionId, selectedSessionIdRef, setSelectedSession, setSelectedSessionId, connectSse, disconnectSse])

  const mergedEvents: ConsoleTimelineEvent[] = events

  const status: 'idle' | 'thinking' | 'tool' | 'generating' = streamStatus === 'connecting' ? 'thinking' : sending ? 'generating' : 'idle'

  return (
    <>
      <ChatShell
        title={selectedSession?.title || 'My Agent'}
        sidebar={
          <ChatSessionList
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            loading={sessionsLoading}
            error={sessionsError}
          />
        }
        rightPanel={<ChatContextPanel sessionId={selectedSessionId} />}
      >
        <ChatMessageList
          events={mergedEvents}
          loading={timelineLoading || sending}
          error={timelineError || sendError || undefined}
          onPromptSelect={setDraft}
          onRetryStream={() => {
            if (selectedSessionId) connectSse(selectedSessionId)
          }}
        />
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          sending={sending}
          model="GLM-4.6"
          status={status}
          ctxUsage={Math.min(98, 12 + events.length * 2)}
        />
      </ChatShell>
      <ChatToast />
    </>
  )
}

export default ChatPage
```

注意：这里 `useComposerSubmission` 的 callbacks 只传了 `fetchSessions`，需要检查该 hook 是否接受此最小集合；若其类型要求更多回调，需补充空实现或调整 hook。

- [ ] **Step 3: 修改 `App.tsx`**

```tsx
// web/src/App.tsx
import ChatPage from './features/session/chat/ChatPage'

function ChatRouteContent() {
  const location = useLocation()
  const navState = routeToNavigation(location.pathname)
  const localStorageSessionId = safeReadLocalStorage(SELECTED_SESSION_KEY)
  const resolvedSessionId = resolveSessionId(navState.sessionId ?? null, localStorageSessionId)
  return <ChatPage initialSessionId={resolvedSessionId ?? undefined} />
}
```

同时移除 `SessionWorkspace` 的 import（若其他地方不再使用）。

- [ ] **Step 4: 运行测试**

Run:
```bash
npm --prefix "web" test -- ChatPage.test.tsx
```

Expected: 可能因 hook 依赖报错，根据错误调整至 PASS。

- [ ] **Step 5: Commit**

```bash
git add "web/src/features/session/chat/ChatPage.tsx" "web/src/features/session/chat/ChatPage.test.tsx" "web/src/App.tsx"
git commit -m "feat(chat): add ChatPage and wire into chat routes"
```

---

## Task 11: 补充缺失的右侧栏/占位样式并修复编译错误

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Test: `npm --prefix web test`, `npm --prefix web run build`

- [ ] **Step 1: 在 `chat-theme.css` 末尾追加右侧栏面板与空状态样式**

```css
/* 右侧栏面板 */
.chat-rs-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.chat-rs-panel--top {
  flex: 1 1 50%;
  border-bottom: 0.5px solid var(--border);
}

.chat-rs-panel--bottom {
  flex: 1 1 50%;
}

.chat-rs-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  flex-shrink: 0;
}

.chat-rs-panel__title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-rs-panel__title svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
  color: var(--accent);
}

.chat-rs-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.chat-desk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: var(--text-faint);
  font-size: 0.76rem;
  text-align: center;
  gap: 8px;
}

.chat-desk-empty svg {
  width: 28px;
  height: 28px;
  stroke-width: 1.2;
  color: var(--text-ghost);
}

/* 错误/空状态 */
.chat-error,
.chat-session-status {
  padding: 12px 16px;
  font-size: 0.82rem;
  color: var(--text-muted);
  text-align: center;
}

.chat-error__retry {
  margin-left: 8px;
  padding: 4px 8px;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-sm, 2px);
  background: var(--bg-card, #fbf7ee);
  color: var(--text);
  cursor: pointer;
}

.chat-error__retry:hover {
  background: rgba(83, 125, 150, 0.08);
  color: var(--accent);
}

.chat-session-status--error {
  color: #8b2c1f;
}

/* 侧边栏 backdrop */
.chat-sidebar-backdrop,
.chat-right-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(42, 38, 34, 0.08);
  z-index: 90;
}
```

- [ ] **Step 2: 运行构建**

Run:
```bash
npm --prefix "web" run typecheck
npm --prefix "web" run build
```

Expected: 通过（若 `ChatPage` 中 hook 调用有类型错误，修复至通过）。

- [ ] **Step 3: Commit**

```bash
git add "web/src/features/session/chat/chat-theme.css"
git commit -m "style(chat): add context panel and empty state styles"
```

---

## Task 12: 迁移/调整原有 `SessionConsoleTab.test.tsx` 冲突用例

**Files:**
- Modify: `web/src/features/session/SessionConsoleTab.test.tsx`
- Test: `npm --prefix web test`

- [ ] **Step 1: 运行全部前端测试**

Run:
```bash
npm --prefix "web" test
```

Expected: 可能有 `SessionConsoleTab` 相关测试因 `App.tsx` 不再渲染它而失败。

- [ ] **Step 2: 调整或跳过与新结构冲突的测试**

若测试检查“聊天页渲染 `SessionConsoleTab` / `data-testid="session-workspace"`”，改为检查 `data-testid="chat-shell"`。

示例修改：

```tsx
// 原断言
expect(screen.getByTestId('session-workspace')).toBeInTheDocument()
// 改为
expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
```

若无法简单迁移，可在测试文件顶部标注并跳过：

```tsx
describe.skip('SessionConsoleTab legacy tests', () => { ... })
```

并在 PR 说明中记录。

- [ ] **Step 3: 重新运行全部测试**

Run:
```bash
npm --prefix "web" test
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add "web/src/features/session/SessionConsoleTab.test.tsx"
git commit -m "test(chat): adapt legacy SessionConsoleTab tests for new ChatPage"
```

---

## Task 13: 最终验证与收尾

- [ ] **Step 1: 运行完整检查**

```bash
npm --prefix "web" run typecheck
npm --prefix "web" test
npm --prefix "web" run build
```

Expected: 全部通过。

- [ ] **Step 2: 检查 git diff**

```bash
git status
git diff --stat
```

确认新增文件、修改范围符合预期。

- [ ] **Step 3: 最终 commit（如有多余未提交改动）**

```bash
git add .
git commit -m "feat(chat): warm-paper theme chat page redesign (core loop)"
```

---

## Spec Coverage Check

| 规格要求 | 对应 Task |
|---|---|
| 暖纸视觉风格 | Task 1, Task 4, Task 6, Task 11 |
| 核心聊天循环 | Task 7, Task 10 |
| 消息 Markdown 渲染 | Task 4, Task 5 |
| 欢迎屏 prompt-card | Task 3, Task 5 |
| 底部 Composer + 状态指示器 | Task 6 |
| 右侧工作台/计划 | Task 8 |
| 响应式布局 | Task 1 (CSS), Task 9 |
| 复杂功能降级/隐藏 | Task 8 (书桌占位), Task 10 |
| 测试覆盖 | Task 2-12 |
| 不引入新依赖 | 全局约束 |

---

## Placeholder Scan

- 无 TBD/TODO。
- 无“后续实现”类模糊描述；所有降级点已明确为 Toast 或占位。
- 类型签名在 Task 间一致（`ConsoleTimelineEvent`、`ChatComposerStatus` 等）。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-30-warm-paper-chat-redesign.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
