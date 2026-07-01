# 移动端响应式适配设计文档

## 背景

当前聊天主交互页在桌面端（≥1025px）已完成暖纸主题对齐，但在移动端（手机/平板）存在明显布局问题：三栏（左侧会话列表、中间聊天区、右侧工作计划/书桌）同时挤在屏幕上，中间内容被严重压缩，顶部标题栏也受影响。本 spec 目标是为聊天页补齐手机和平板的响应式适配。

## 目标

- 手机（≤768px）：默认只显示中间聊天区，左右侧栏作为抽屉收起，通过标题栏按钮触发。
- 平板（769px–1024px）：左侧会话列表保持显示，右侧上下文面板默认隐藏，通过按钮展开为抽屉。
- 桌面（≥1025px）：保持现有三栏布局不变。
- 不引入新依赖，仅使用 React + CSS。

## 非目标

- 不改动登录页样式（当前已可用）。
- 不改动后端 API 或数据流。
- 不新增复杂的拖拽调整宽度功能。
- 不改写全局路由/导航结构。

## 当前问题

- `ChatShell.tsx` 虽已存在 `isMobile` 状态和遮罩逻辑，但初始状态未按断点区分。
- `chat-theme.css` 中 `.chat-sidebar.collapsed` 仅把宽度设为 0，内部子元素仍有 `min-width`，在移动端会撑开并导致布局错乱。
- 媒体查询（`max-width: 768px`）把侧栏设为 `position: absolute`，但未配合 `transform` 做真正的隐藏/滑出。

## 设计方案

### 断点定义

| 断点名 | 范围 | 布局 |
|--------|------|------|
| desktop | ≥1025px | 三栏常态 |
| tablet | 769px–1024px | 左栏显示 + 右栏抽屉 |
| mobile | ≤768px | 单栏 + 左右抽屉 |

### 组件改动

#### `ChatShell.tsx`

- 把单一 `isMobile` 状态拆为两个布尔标志：
  - `isMobile`：≤768px
  - `isTabletOrBelow`：≤1024px
- 初始展开状态根据断点自动设置：
  - desktop：`isSidebarOpen = true`，`isRightOpen = true`
  - tablet：`isSidebarOpen = true`，`isRightOpen = false`
  - mobile：`isSidebarOpen = false`，`isRightOpen = false`
- 保留现有状态切换按钮和遮罩点击关闭逻辑。
- 在 `useEffect` 中监听 `resize`，断点变化时自动重置到默认状态（避免旋转屏幕后边栏状态不一致）。

#### `chat-theme.css`

- 新增/调整媒体查询：
  - `max-width: 1024px`：右侧栏变为可抽屉化（`position: absolute`，默认隐藏时 `transform: translateX(100%)`）。
  - `max-width: 768px`：左侧栏也变为抽屉（默认隐藏时 `transform: translateX(-100%)`）。
- 抽屉宽度：
  - 手机左侧：80vw，最大 300px
  - 手机右侧：80vw，最大 320px
  - 平板右侧：300px
- 遮罩统一使用 `.chat-drawer-backdrop`：
  - `position: fixed` 全屏
  - `background: rgba(42, 38, 34, 0.25)`
  - `z-index: 90`
- 抽屉本身 `z-index: 100`，带 `box-shadow`。
- 抽屉动画使用 `transform` + `transition`。

### 交互细节

- 点击标题栏左侧汉堡按钮：切换左侧抽屉。
- 点击标题栏右侧面板按钮：切换右侧抽屉。
- 点击遮罩：关闭当前打开的抽屉。
- 按 `Esc`：关闭当前打开的抽屉（可选增强）。
- 抽屉打开时，背景内容禁止滚动（在 `.chat-page` 或 `body` 上设置 `overflow: hidden`）。

### 可访问性

- 抽屉容器加 `role="dialog"`、`aria-modal="true"`。
- 遮罩加 `aria-hidden="true"`。
- 支持 `prefers-reduced-motion`：关闭抽屉位移动画。

### 测试策略

- 更新 `ChatShell.test.tsx`：
  - 桌面默认三栏显示。
  - 手机默认仅中间区域显示，左右抽屉隐藏。
  - 点击按钮打开/关闭抽屉。
  - 点击遮罩关闭抽屉。
- 视觉回归：
  - Playwright 截图 375px、768px、1440px 的 `/chat` 页。

## 影响范围

- `web/src/features/session/chat/ChatShell.tsx`
- `web/src/features/session/chat/chat-theme.css`
- `web/src/features/session/chat/ChatShell.test.tsx`

## 验收标准

- [ ] 375px 宽度下，chat 页只显示标题栏 + 中间聊天区，无左右侧栏内容露出。
- [ ] 768px 宽度下，chat 页显示左侧会话列表 + 中间聊天区，右侧栏默认隐藏。
- [ ] 点击标题栏按钮可正常打开/关闭对应抽屉。
- [ ] 点击遮罩可关闭抽屉。
- [ ] 1440px 宽度下，现有三栏布局保持不变。
- [ ] `npm --prefix web run typecheck` 通过。
- [ ] `npm --prefix web test -- --run` 通过。
- [ ] `npm --prefix web run build` 通过。
