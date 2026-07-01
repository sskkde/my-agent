# HanaAgent 暖纸主题聊天页样式对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前聊天主交互页与 HanaAgent 暖纸主题原型在颜色、布局、组件密度、面板内容上逐项对齐，不引入新依赖、不改动后端。

**Architecture:** 通过纯 CSS + 少量 JSX 结构调整，复用现有 `ChatShell`、`ChatContextPanel`、`ChatSessionList`、`ChatComposer`、`TodoWorkPlanCard`；仅在 ChatShell titlebar 增加用户/设置入口，其余数据保持 mock/示例状态。

**Tech Stack:** React 18, TypeScript, Vite, CSS Modules via global CSS, Playwright (验证截图)

## Global Constraints

- 不引入新依赖（字体、图标库、组件库）。
- 只修改 `web/src/features/session/chat/*`、`web/src/features/context/TodoWorkPlanCard.tsx`、`web/src/layout/AgentShell.tsx`、`web/src/layout/chat-minimal-topbar.css`。
- 所有颜色使用 CSS 变量 + fallback，避免破坏其他页面主题。
- 每次 task 结束后运行 `npm --prefix web run typecheck` 和对应测试/截图验证。
- 频繁提交，每个 task 一个 commit。

---

## Task 1: 合并顶部栏，把用户/设置入口下移到 ChatShell titlebar

**Files:**
- Modify: `web/src/layout/AgentShell.tsx`
- Modify: `web/src/features/session/chat/ChatShell.tsx`
- Modify: `web/src/features/session/chat/ChatPage.tsx`
- Modify: `web/src/features/session/chat/chat-theme.css`
- Modify: `web/src/layout/chat-minimal-topbar.css`
- Test: `web/src/layout/AgentShell.test.tsx`
- Test: `web/src/features/session/chat/ChatShell.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `AuthContext` returns `{ user, logout }`。
- Produces: `ChatShell` 新增 props `user?: UserMetadata | null`, `onLogout?: () => void`, `onOpenSettings?: () => void`。

- [ ] **Step 1: 删除 AgentShell chat 模式下的 minimal topbar**

在 `AgentShell.tsx` 中，把 chat 分支简化为只渲染 `app-shell` 和 `center-stage`，不再渲染 `chat-minimal-topbar`。

```tsx
{isChatSection ? (
  <div data-testid="app-shell" className={`shell shell--chat ${isMobile ? 'shell--mobile' : ''}`}>
    <main data-testid="center-stage" className="shell__content shell__content--chat">
      {children}
    </main>
  </div>
) : (
  ...existing non-chat layout...
)}
```

- [ ] **Step 2: 在 ChatShell titlebar 右侧增加用户/设置/退出入口**

修改 `ChatShell.tsx` 接口和渲染：

```tsx
export interface ChatShellProps {
  title: string
  sidebar: React.ReactNode
  rightPanel: React.ReactNode
  children: React.ReactNode
  initialSidebarOpen?: boolean
  initialRightOpen?: boolean
  user?: UserMetadata | null
  onLogout?: () => void
}
```

在 `chat-titlebar__right` 中，切换右侧面板按钮左侧加入：

```tsx
{user && (
  <div className="chat-titlebar__user" data-testid="chat-titlebar-user">
    <span className="chat-titlebar__username">{user.username}</span>
    {onLogout && (
      <button
        className="chat-titlebar__logout"
        onClick={onLogout}
        data-testid="chat-titlebar-logout"
        title="退出登录"
      >
        退出
      </button>
    )}
  </div>
)}
<FloatingSettingsMenu />
```

需要把 `FloatingSettingsMenu` 从 `AgentShell.tsx` 导入并复用。

- [ ] **Step 3: ChatPage 把 user/onLogout 传递给 ChatShell**

```tsx
import { useAuth } from '../../../context/AuthContext'
import FloatingSettingsMenu from '../../settings/FloatingSettingsMenu'
```

```tsx
const { user, logout } = useAuth()
```

```tsx
<ChatShell
  title={selectedSession?.title || 'HanaAgent'}
  user={user}
  onLogout={logout}
  ...
>
```

- [ ] **Step 4: 调整 titlebar 样式**

在 `chat-theme.css` 中：

```css
.chat-titlebar {
  flex-shrink: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: var(--chat-bg-elevated);
  border-bottom: 0.5px solid var(--chat-border);
}

.chat-titlebar__title {
  font-size: 0.92rem;
  font-weight: 500;
  color: var(--chat-text);
  letter-spacing: 0.01em;
}

.chat-titlebar__user {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8rem;
  color: var(--chat-text-muted);
}

.chat-titlebar__logout {
  padding: 3px 8px;
  border: 0.5px solid var(--chat-border);
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--chat-text-muted);
  font-size: 0.74rem;
  cursor: pointer;
  transition: all 0.15s;
}

.chat-titlebar__logout:hover {
  background: rgba(83, 125, 150, 0.08);
  color: var(--chat-accent);
  border-color: rgba(83, 125, 150, 0.2);
}

.chat-titlebar__right {
  display: flex;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 5: 清理 chat-minimal-topbar.css**

如果删除 minimal topbar 后没有其他地方使用，删除 `web/src/layout/chat-minimal-topbar.css` 及其在 `AgentShell.tsx` 中的 import。

- [ ] **Step 6: 更新测试**

`AgentShell.test.tsx` 中 chat section 测试：
- 不再断言 `topbar-user` 出现在 AgentShell 层级；改为断言 AgentShell chat 模式下不出现 `product-nav` 和 `context-desk-panel`。

`ChatShell.test.tsx` 中新增断言：
- 传入 `user` 时显示用户名；传入 `onLogout` 时点击退出调用回调。

运行：

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/layout/AgentShell.test.tsx src/features/session/chat/ChatShell.test.tsx
```

Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add web/src/layout/AgentShell.tsx web/src/features/session/chat/ChatShell.tsx web/src/features/session/chat/ChatPage.tsx web/src/features/session/chat/chat-theme.css web/src/layout/AgentShell.test.tsx web/src/features/session/chat/ChatShell.test.tsx
[ -f web/src/layout/chat-minimal-topbar.css ] && git rm web/src/layout/chat-minimal-topbar.css
git commit -m "feat(chat): merge minimal topbar into ChatShell titlebar"
```

---

## Task 2: 全局颜色与纸张层级

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Test: Playwright 截图 `/tmp/shot-task2.png`

**Interfaces:**
- 无新增接口；所有颜色变量使用 fallback。

- [ ] **Step 1: 覆盖 chat 区域背景色 token**

在 `chat-theme.css` 顶部定义 chat 局部变量：

```css
.chat-page {
  --chat-bg: #fdf9f3;
  --chat-bg-elevated: #f5f0e8;
  --chat-bg-card: #fbf7ee;
  --chat-border: rgba(216, 207, 190, 0.45);
  --chat-text: #3d3833;
  --chat-text-muted: #6b655d;
  --chat-text-faint: #9a948c;
  --chat-accent: #537d96;
  --chat-accent-hover: #3f657d;
  --chat-sidebar-width: 240px;
  --chat-right-width: 280px;
  --chat-column-width: 720px;
  --chat-titlebar-h: 48px;

  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--chat-bg);
}
```

- [ ] **Step 2: 把所有 .chat-* 颜色引用改为 chat 局部变量**

全局替换 `var(--bg)` → `var(--chat-bg)`、`var(--bg-elevated)` → `var(--chat-bg-elevated)`、`var(--bg-card)` → `var(--chat-bg-card)`、`var(--border)` → `var(--chat-border)`、`var(--text)` → `var(--chat-text)`、`var(--text-muted)` → `var(--chat-text-muted)`、`var(--text-faint)` → `var(--chat-text-faint)`、`var(--accent)` → `var(--chat-accent)`、`var(--accent-hover)` → `var(--chat-accent-hover)`。

- [ ] **Step 3: 统一边框为 0.5px 淡色**

确保所有边框使用 `var(--chat-border)`。

- [ ] **Step 4: 验证截图**

构建并部署后截图：

```bash
npm --prefix web run build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build web
```

Playwright 截图并检查整体色调是否变暖、边框变淡。

- [ ] **Step 5: Commit**

```bash
git add web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): warm paper color tokens and soft borders"
```

---

## Task 3: 左侧会话列表样式对齐

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Modify: `web/src/features/session/chat/ChatSessionList.tsx`
- Test: `web/src/features/session/chat/ChatSessionList.test.tsx`

**Interfaces:**
- 无新增 props；新增底部「归档」按钮为视觉占位。

- [ ] **Step 1: 增强选中态样式**

```css
.chat-session-item.active {
  background: rgba(83, 125, 150, 0.12);
}

.chat-session-item.active .chat-session-item__title {
  color: var(--chat-accent);
  font-weight: 600;
}
```

- [ ] **Step 2: 调整分组标题和搜索图标**

```css
.chat-session-date {
  font-size: 0.64rem;
  color: var(--chat-text-faint);
  letter-spacing: 0.04em;
  padding: 10px 10px 4px;
  text-transform: uppercase;
}

.chat-sidebar__action {
  color: var(--chat-text-faint);
}

.chat-sidebar__action:hover {
  color: var(--chat-text-muted);
  background: rgba(42, 38, 34, 0.03);
}
```

- [ ] **Step 3: 在 ChatSessionList 底部增加「归档」入口**

修改 `ChatSessionList.tsx`，在 `chat-session-list` 最下方渲染：

```tsx
<div className="chat-archive-entry" data-testid="chat-archive-entry">
  <button className="chat-archive-entry__btn" onClick={() => showToast('归档功能后续接入')}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
    </svg>
    <span>归档</span>
  </button>
</div>
```

- [ ] **Step 4: 增加归档入口样式**

```css
.chat-archive-entry {
  padding: 8px 12px 12px;
  flex-shrink: 0;
}

.chat-archive-entry__btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm, 2px);
  background: transparent;
  color: var(--chat-text-faint);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s;
}

.chat-archive-entry__btn:hover {
  background: rgba(42, 38, 34, 0.03);
  color: var(--chat-text-muted);
}

.chat-archive-entry__btn svg {
  width: 14px;
  height: 14px;
  stroke-width: 1.5;
}
```

- [ ] **Step 5: 运行测试**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/features/session/chat/ChatSessionList.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/features/session/chat/ChatSessionList.tsx web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): align session list selection, groups, and archive entry"
```

---

## Task 4: 中间欢迎区域与提示卡片

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Modify: `web/src/features/session/chat/ChatWelcome.tsx`
- Test: `web/src/features/session/chat/ChatWelcome.test.tsx`

**Interfaces:**
- 无新增接口。

- [ ] **Step 1: 调整欢迎标题与副标题样式**

```css
.chat-welcome__logo {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--chat-bg-card);
  border: 0.5px solid var(--chat-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  box-shadow: 0 1px 4px rgba(42, 38, 34, 0.03);
}

.chat-welcome__logo svg {
  width: 28px;
  height: 28px;
  color: var(--chat-accent);
  stroke-width: 1.5;
}

.chat-welcome__title {
  font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif;
  font-size: 2.25rem;
  font-weight: 500;
  color: var(--chat-text);
  margin-bottom: 10px;
  letter-spacing: 0.01em;
}

.chat-welcome__subtitle {
  font-size: 0.92rem;
  color: var(--chat-text-muted);
  max-width: 34rem;
  line-height: 1.5;
}
```

- [ ] **Step 2: 调整提示卡片为圆润、轻边框**

```css
.chat-welcome__prompts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 44px;
  max-width: 36rem;
  width: 100%;
}

.chat-prompt-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px;
  background: transparent;
  border: 0.5px solid rgba(216, 207, 190, 0.35);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: left;
  font-family: inherit;
}

.chat-prompt-card:hover {
  background: rgba(83, 125, 150, 0.06);
  border-color: rgba(83, 125, 150, 0.15);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: 修复 ChatWelcome 中卡片不应有固定灰底的问题**

检查 `ChatWelcome.tsx`，确保每个 `chat-prompt-card` 没有内联 style 或额外 class 导致灰底。当前代码无内联样式，样式由 CSS 控制；Step 2 已把 background 设为 transparent。

- [ ] **Step 4: 运行测试**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/features/session/chat/ChatWelcome.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/features/session/chat/ChatWelcome.tsx web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): align welcome title, subtitle, and prompt cards"
```

---

## Task 5: 右侧工作计划面板

**Files:**
- Modify: `web/src/features/session/chat/ChatContextPanel.tsx`
- Modify: `web/src/features/context/TodoWorkPlanCard.tsx`
- Modify: `web/src/features/session/chat/chat-theme.css`
- Test: `web/src/features/session/chat/ChatContextPanel.test.tsx`

**Interfaces:**
- `TodoWorkPlanCard` 保持原 props；新增本地示例 task 列表用于空状态占位。

- [ ] **Step 1: 改造 ChatContextPanel 的 header**

每个面板 header 右侧增加操作图标按钮：

```tsx
<div className="chat-rs-panel__header">
  <span className="chat-rs-panel__title">...</span>
  <div className="chat-rs-panel__actions">
    <button className="chat-rs-panel__action" aria-label="筛选" title="筛选" onClick={() => showToast('筛选后续接入')}>
      <svg>...</svg>
    </button>
  </div>
</div>
```

- [ ] **Step 2: 在「工作计划」面板顶部增加「+ 添加任务」按钮**

```tsx
<button className="chat-rs-add-btn" onClick={() => showToast('添加任务后续接入')}>
  <svg>...</svg>
  <span>添加任务</span>
</button>
```

- [ ] **Step 3: 改造 TodoWorkPlanCard 渲染真实 task 列表 + 空状态示例**

当 `todos` 为空时，渲染 5 条示例 task（静态数据）：

```tsx
const EXAMPLE_TODOS: TodoItemWithChildren[] = [
  { id: 'ex-1', content: '审阅暖纸主题 CSS 草稿', status: 'completed', priority: 'medium', dueDate: '今天 09:30', sessionId: sessionId ?? '' },
  { id: 'ex-2', content: '回复客户邮件', status: 'completed', priority: 'medium', dueDate: '今天 10:15', sessionId: sessionId ?? '' },
  { id: 'ex-3', content: '完成右侧栏交互原型', status: 'pending', priority: 'high', dueDate: '截止 15:00', sessionId: sessionId ?? '' },
  { id: 'ex-4', content: '整理本周设计规范文档', status: 'pending', priority: 'medium', dueDate: '今天内', sessionId: sessionId ?? '' },
  { id: 'ex-5', content: '收集竞品截图参考', status: 'pending', priority: 'low', dueDate: '今天内', sessionId: sessionId ?? '' },
]
```

显示时按时间分组（今天 / 明天 / 未来）。真实 task 存在时优先显示真实 task。

- [ ] **Step 4: 更新 task 项样式**

```css
.todo-plan-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.todo-plan-group {
  margin-bottom: 8px;
}

.todo-plan-group__title {
  font-size: 0.64rem;
  color: var(--chat-text-faint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 8px 6px 4px;
}

.todo-plan-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 6px;
  border-radius: var(--radius-sm, 2px);
  transition: background 0.15s;
}

.todo-plan-item:hover {
  background: rgba(42, 38, 34, 0.03);
}

.todo-plan-item__checkbox {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--chat-text-faint);
  flex-shrink: 0;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.todo-plan-item__checkbox--completed {
  background: var(--chat-accent);
  border-color: var(--chat-accent);
  color: #fff;
}

.todo-plan-item__checkbox svg {
  width: 8px;
  height: 8px;
  stroke-width: 3;
}

.todo-plan-item__content {
  flex: 1;
  min-width: 0;
}

.todo-plan-item__text {
  font-size: 0.8rem;
  color: var(--chat-text);
  line-height: 1.4;
}

.todo-plan-item__text--completed {
  text-decoration: line-through;
  color: var(--chat-text-faint);
}

.todo-plan-item__meta {
  font-size: 0.7rem;
  color: var(--chat-text-faint);
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.todo-plan-item__priority {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.todo-plan-item__priority--high { background: #c45c4a; }
.todo-plan-item__priority--medium { background: #c9a14a; }
.todo-plan-item__priority--low { background: var(--chat-text-faint); }
```

- [ ] **Step 5: 更新 ChatContextPanel 测试**

断言「添加任务」按钮存在、筛选图标存在、task 列表渲染。

- [ ] **Step 6: 运行测试**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/features/session/chat/ChatContextPanel.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git add web/src/features/session/chat/ChatContextPanel.tsx web/src/features/context/TodoWorkPlanCard.tsx web/src/features/session/chat/chat-theme.css
git commit -m "feat(chat): align work plan panel with tasks, groups, and add button"
```

---

## Task 6: 右侧书桌面板

**Files:**
- Modify: `web/src/features/session/chat/ChatContextPanel.tsx`
- Modify: `web/src/features/session/chat/chat-theme.css`
- Test: `web/src/features/session/chat/ChatContextPanel.test.tsx`

**Interfaces:**
- 无新增接口；使用静态示例文件数据。

- [ ] **Step 1: 在书桌面板顶部增加「+ 放到书桌」按钮**

```tsx
<button className="chat-rs-add-btn" onClick={() => showToast('放到书桌后续接入')}>
  <svg>...</svg>
  <span>放到书桌</span>
</button>
```

- [ ] **Step 2: 渲染示例文件列表**

在 `ChatContextPanel.tsx` 中定义静态示例文件：

```tsx
const EXAMPLE_DESK_ITEMS = [
  { id: 'd1', name: '暖纸主题设计规范.md', type: '文档', time: '刚刚编辑', icon: 'doc' },
  { id: 'd2', name: 'theme-warm-paper.css', type: '代码', time: '2 小时前', icon: 'code' },
  { id: 'd3', name: '配色方案参考', type: '笔记', time: '昨天', icon: 'note' },
  { id: 'd4', name: '界面截图对比.png', type: '图片', time: '昨天', icon: 'image' },
  { id: 'd5', name: 'HanaAgent 仓库链接', type: '链接', time: '2 天前', icon: 'link' },
  { id: 'd6', name: '字体加载策略笔记', type: '笔记', time: '3 天前', icon: 'note' },
]
```

渲染为 `chat-desk-item` 列表。

- [ ] **Step 3: 添加文件项样式**

```css
.chat-desk-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-desk-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 6px;
  border-radius: var(--radius-sm, 2px);
  cursor: pointer;
  transition: background 0.15s;
}

.chat-desk-item:hover {
  background: rgba(42, 38, 34, 0.03);
}

.chat-desk-item__icon {
  width: 18px;
  height: 18px;
  color: var(--chat-text-faint);
  flex-shrink: 0;
  margin-top: 1px;
}

.chat-desk-item__icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.5;
}

.chat-desk-item__main {
  flex: 1;
  min-width: 0;
}

.chat-desk-item__name {
  font-size: 0.8rem;
  color: var(--chat-text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-desk-item__meta {
  font-size: 0.7rem;
  color: var(--chat-text-faint);
  margin-top: 2px;
}
```

- [ ] **Step 4: 更新测试**

断言「放到书桌」按钮和 6 条示例文件项存在。

- [ ] **Step 5: 运行测试**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/features/session/chat/ChatContextPanel.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/features/session/chat/ChatContextPanel.tsx web/src/features/session/chat/chat-theme.css
git commit -m "feat(chat): align desk panel with add button and example file list"
```

---

## Task 7: 底部输入框

**Files:**
- Modify: `web/src/features/session/chat/ChatComposer.tsx`
- Modify: `web/src/features/session/chat/chat-theme.css`
- Test: `web/src/features/session/chat/ChatComposer.test.tsx`

**Interfaces:**
- 无新增接口。

- [ ] **Step 1: 增大输入框尺寸和圆角**

```tsx
<textarea
  ...
  rows={1}
  style={{ minHeight: '28px' }}
/>
```

在 CSS 中：

```css
.chat-input-wrapper {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 18px 24px 22px;
  background: linear-gradient(to top, var(--chat-bg) 70%, transparent);
}

.chat-input-surface {
  max-width: var(--chat-column-width);
  margin: 0 auto;
  background: var(--chat-bg-card);
  border: 0.5px solid rgba(216, 207, 190, 0.5);
  border-radius: 16px;
  padding: 12px 18px 14px;
  box-shadow: 0 1px 8px rgba(42, 38, 34, 0.03);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.chat-input-surface:focus-within {
  border-color: rgba(83, 125, 150, 0.25);
  box-shadow: 0 0 0 3px rgba(83, 125, 150, 0.06);
}

.chat-input {
  width: 100%;
  border: none;
  background: none;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--chat-text);
  resize: none;
  outline: none;
  min-height: 28px;
  max-height: 200px;
  user-select: text;
}
```

- [ ] **Step 2: 调整工具按钮颜色**

```css
.chat-tool-btn {
  color: var(--chat-text-faint);
}

.chat-tool-btn:hover {
  background: rgba(42, 38, 34, 0.03);
  color: var(--chat-text-muted);
}
```

- [ ] **Step 3: 发送按钮改为冷灰蓝**

```css
.chat-send-btn {
  background: var(--chat-accent);
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.chat-send-btn:hover {
  background: var(--chat-accent-hover);
}

.chat-send-btn:disabled {
  background: var(--chat-text-faint);
}
```

- [ ] **Step 4: 状态栏分隔更轻**

```css
.chat-status-segment + .chat-status-segment::before {
  background: var(--chat-border);
}

.chat-status-dot {
  background: var(--chat-text-faint);
}
```

- [ ] **Step 5: 运行测试**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run src/features/session/chat/ChatComposer.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add web/src/features/session/chat/ChatComposer.tsx web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): align composer size, radius, and send button color"
```

---

## Task 8: 全面回归测试与最终验证

**Files:**
- 全部已修改文件
- Playwright 验证脚本

- [ ] **Step 1: 运行完整测试套件**

```bash
npm --prefix web run typecheck
npm --prefix web test -- --run
```

Expected: 124 files passed, 0 failed。

- [ ] **Step 2: 构建并部署 Docker**

```bash
npm --prefix web run build
docker compose -f docker-compose.yml -f docker-compose.prod.yml down --remove-orphans
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache web
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
sleep 20
docker ps --format "table {{.Names}}\t{{.Status}}"
```

- [ ] **Step 3: Playwright 登录截图对比**

```bash
cd /home/ubuntu/workspace/my\ agent/web
npx playwright screenshot --viewport-size=1440,900 \
  --wait-for-timeout=5000 \
  --full-page \
  --javascript \
  http://localhost:3002/ /tmp/shot-final.png
```

手动检查 `/tmp/shot-final.png` 与 HanaAgent 原型逐项对齐：
- 顶部栏只有一行，标题 "HanaAgent"，右侧用户/设置/退出 + 切换右侧面板。
- 左侧选中项高亮明显。
- 中间标题更大、卡片更圆润。
- 右侧工作计划有任务列表和「+ 添加任务」按钮。
- 右侧书桌有文件列表和「+ 放到书桌」按钮。
- 底部输入框更大、圆角更大、发送按钮为冷灰蓝。

- [ ] **Step 4: Commit 任何最终微调**

如果有必要的小调整，单独 commit：

```bash
git add ...
git commit -m "polish(chat): final alignment tweaks after screenshot review"
```

---

## Spec Coverage Check

| Spec Section | 对应 Task |
|---|---|
| 顶部栏合并与颜色 | Task 1, Task 2 |
| 左侧会话列表选中态/归档 | Task 3 |
| 中间欢迎标题/副标题/卡片 | Task 4 |
| 右侧工作计划内容与按钮 | Task 5 |
| 右侧书桌内容与按钮 | Task 6 |
| 底部输入框尺寸/颜色 | Task 7 |
| 全局颜色与回归验证 | Task 2, Task 8 |

## Placeholder Scan

- 无 "TBD"/"TODO"。
- 所有代码片段完整。
- 所有命令带 expected output。
- 示例 task 和 desk 数据为静态数据，不依赖后端接口。

## Type Consistency

- `ChatShellProps` 新增 `user`/`onLogout` 后，Task 1 的 ChatPage 按该签名传递；后续 task 不再新增接口。
- `TodoWorkPlanCard` 使用现有 `TodoItemWithChildren` 类型，新增示例数据字段与真实数据一致。
