# 聊天页移动端响应式适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为聊天主交互页补齐手机（≤768px）和平板（769px–1024px）的响应式布局：手机默认单栏 + 左右抽屉，平板左侧显示 + 右侧抽屉，桌面保持三栏不变。

**Architecture：** 在 `ChatShell.tsx` 中根据窗口宽度初始化左右侧栏展开状态并监听 resize 重置；在 `chat-theme.css` 中通过媒体查询把侧栏从 `width` 折叠改为 `transform` 抽屉滑入，并统一遮罩层；测试使用 `vitest` + `@testing-library/react` 配合 `window.matchMedia` mock。

**Tech Stack：** React 18 + TypeScript + Vite + vitest + CSS 变量/媒体查询。

## Global Constraints

- 不引入新依赖。
- 只修改 `web/src/features/session/chat/` 目录下的 `ChatShell.tsx`、`chat-theme.css`、`ChatShell.test.tsx`。
- 不改登录页、后端 API、路由或全局布局。
- 所有颜色继续使用现有 CSS 变量和 fallback。
- 桌面端（≥1025px）现有三栏布局和视觉保持完全一致。
- 每次 task 完成后单独 commit，最终跑通 `npm --prefix web run typecheck`、`npm --prefix web test -- --run`、`npm --prefix web run build`。

---

## File Structure

| 文件 | 当前用途 | 本次改动 |
|------|---------|---------|
| `web/src/features/session/chat/ChatShell.tsx` | 三栏布局容器，含标题栏、左右侧栏、中间主内容 | 拆分 mobile/tablet 断点状态，按断点初始化侧栏展开状态，resize 时重置 |
| `web/src/features/session/chat/chat-theme.css` | 聊天页全部样式 | 调整 `.chat-sidebar`、`.chat-right-sidebar` 的折叠逻辑；新增抽屉媒体查询、遮罩、动画 |
| `web/src/features/session/chat/ChatShell.test.tsx` | ChatShell 基础渲染测试 | 新增响应式相关测试（默认状态、按钮开关、遮罩关闭、resize 重置） |

---

## Task 1: 按断点初始化侧栏状态并监听 resize

**Files:**
- Modify: `web/src/features/session/chat/ChatShell.tsx`
- Test: `web/src/features/session/chat/ChatShell.test.tsx`（为后续 Task 4 做准备，但本 task 只需保证现有测试通过）

**Interfaces:**
- Consumes: 无新增依赖。
- Produces: `ChatShell` 内部状态 `isSidebarOpen` / `isRightOpen` 在 mobile/tablet/desktop 下初始值不同；新增 `isTabletOrBelow` 标志。

### Step 1: 替换 `isMobile` 为双断点判定

打开 `web/src/features/session/chat/ChatShell.tsx`，把：

```tsx
const [isMobile, setIsMobile] = useState(false)

useEffect(() => {
  const check = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      setIsMobile(window.matchMedia('(max-width: 1024px)').matches)
    } else {
      setIsMobile(false)
    }
  }
  check()
  window.addEventListener('resize', check)
  return () => window.removeEventListener('resize', check)
}, [])
```

替换为：

```tsx
const [isMobile, setIsMobile] = useState(false)
const [isTabletOrBelow, setIsTabletOrBelow] = useState(false)

useEffect(() => {
  const check = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mobile = window.matchMedia('(max-width: 768px)').matches
      const tabletOrBelow = window.matchMedia('(max-width: 1024px)').matches
      setIsMobile(mobile)
      setIsTabletOrBelow(tabletOrBelow)
    } else {
      setIsMobile(false)
      setIsTabletOrBelow(false)
    }
  }
  check()
  window.addEventListener('resize', check)
  return () => window.removeEventListener('resize', check)
}, [])
```

### Step 2: 按断点初始化展开状态

在 `useEffect` 下方新增一个 `useEffect`，当断点变化时重置侧栏到默认状态：

```tsx
useEffect(() => {
  if (isMobile) {
    setIsSidebarOpen(false)
    setIsRightOpen(false)
  } else if (isTabletOrBelow) {
    setIsSidebarOpen(true)
    setIsRightOpen(false)
  } else {
    setIsSidebarOpen(initialSidebarOpen)
    setIsRightOpen(initialRightOpen)
  }
}, [isMobile, isTabletOrBelow, initialSidebarOpen, initialRightOpen])
```

### Step 3: 用 `isTabletOrBelow` 替代原 `isMobile` 对右侧栏遮罩的判断

把：

```tsx
{isMobile && isSidebarOpen && (
  <div
    className="chat-sidebar-backdrop"
    onClick={() => setIsSidebarOpen(false)}
    aria-hidden="true"
  />
)}
```

和：

```tsx
{isMobile && isRightOpen && (
  <div
    className="chat-right-backdrop"
    onClick={() => setIsRightOpen(false)}
    aria-hidden="true"
  />
)}
```

都改为使用统一的遮罩类名（为 Task 2 CSS 做准备）：

```tsx
{(isMobile || isTabletOrBelow) && isSidebarOpen && (
  <div
    className="chat-drawer-backdrop"
    onClick={() => setIsSidebarOpen(false)}
    aria-hidden="true"
    data-testid="chat-left-backdrop"
  />
)}
```

```tsx
{isTabletOrBelow && isRightOpen && (
  <div
    className="chat-drawer-backdrop"
    onClick={() => setIsRightOpen(false)}
    aria-hidden="true"
    data-testid="chat-right-backdrop"
  />
)}
```

### Step 4: 运行现有测试

Run:

```bash
npm --prefix web test -- tests/unit/ChatShell.test.tsx --run
```

Expected: 4 tests pass。

### Step 5: Commit

```bash
git add web/src/features/session/chat/ChatShell.tsx
git commit -m "feat(chat): initialize sidebar state by mobile/tablet breakpoint"
```

---

## Task 2: 实现手机端左右抽屉样式

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Verify: Playwright 截图 `/tmp/mobile-chat-task2.png`

**Interfaces:**
- Consumes: `.chat-sidebar`、`.chat-right-sidebar`、`.chat-drawer-backdrop` 类名已在 Task 1 中由 `ChatShell.tsx` 输出。
- Produces: 手机端侧栏默认隐藏，作为抽屉滑入；遮罩全屏显示。

### Step 1: 调整 `.chat-sidebar` 为可抽屉化

在 `web/src/features/session/chat/chat-theme.css` 中，把 `.chat-sidebar` 从：

```css
.chat-sidebar {
  position: relative;
  width: var(--chat-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--chat-bg-elevated, #fbf8f0);
  border-right: 0.5px solid var(--chat-border);
  border-top: 0.5px solid var(--chat-border);
  overflow: hidden;
  transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
}

.chat-sidebar.collapsed {
  width: 0;
  border-right-color: transparent;
}
```

改为：

```css
.chat-sidebar {
  position: relative;
  width: var(--chat-sidebar-width);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--chat-bg-elevated, #fbf8f0);
  border-right: 0.5px solid var(--chat-border);
  border-top: 0.5px solid var(--chat-border);
  overflow: hidden;
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
}

.chat-sidebar.collapsed {
  width: 0;
  border-right-color: transparent;
}
```

### Step 2: 调整 `.chat-right-sidebar` 为可抽屉化

找到 `.chat-right-sidebar` 定义（约 830 行附近），保持其桌面样式，只把 `transition` 扩展为：

```css
.chat-right-sidebar {
  /* 保留原有属性不变 */
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 10;
}
```

### Step 3: 新增统一遮罩样式

在 `.chat-shell` 之后新增：

```css
.chat-drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(42, 38, 34, 0.25);
  z-index: 90;
}
```

并删除或注释掉旧有的 `.chat-sidebar-backdrop` 和 `.chat-right-backdrop` 样式（如果存在）。

### Step 4: 新增手机端抽屉媒体查询

在文件中找到现有 `@media (max-width: 768px)` 块，替换为：

```css
@media (max-width: 768px) {
  .chat-sidebar {
    position: fixed;
    left: 0;
    top: var(--chat-titlebar-h, 48px);
    height: calc(100% - var(--chat-titlebar-h, 48px));
    width: min(80vw, 300px);
    transform: translateX(-100%);
    box-shadow: 4px 0 16px rgba(42, 38, 34, 0.08);
  }

  .chat-sidebar:not(.collapsed) {
    transform: translateX(0);
  }

  .chat-sidebar.collapsed {
    width: min(80vw, 300px);
    border-right-color: var(--chat-border);
  }

  .chat-right-sidebar {
    position: fixed;
    right: 0;
    top: var(--chat-titlebar-h, 48px);
    height: calc(100% - var(--chat-titlebar-h, 48px));
    width: min(80vw, 320px);
    transform: translateX(100%);
    box-shadow: -4px 0 16px rgba(42, 38, 34, 0.08);
  }

  .chat-right-sidebar:not(.collapsed) {
    transform: translateX(0);
  }

  .chat-right-sidebar.collapsed {
    width: min(80vw, 320px);
    border-left-color: var(--chat-border);
  }

  .chat-welcome__prompts {
    grid-template-columns: 1fr;
  }
}
```

### Step 5: 验证手机截图

Run:

```bash
cd /tmp/opencode/pw && node mobile-chat-auth-screenshot.js
```

（该脚本已在前期准备中创建，会登录并截图 `/tmp/mobile-chat-before.png`。）

Expected: 375px 下只显示标题栏和中间聊天区，没有左右侧栏露出。

### Step 6: Commit

```bash
git add web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): mobile drawer layout for sidebars"
```

---

## Task 3: 实现平板端左侧常驻 + 右侧抽屉

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`
- Verify: Playwright 截图 `/tmp/tablet-chat-task3.png`

**Interfaces:**
- Consumes: `.chat-sidebar`、`.chat-right-sidebar`、`.chat-drawer-backdrop` 已存在。
- Produces: 769px–1024px 下左侧栏显示，右侧栏作为抽屉。

### Step 1: 调整 `max-width: 1024px` 媒体查询

找到现有 `@media (max-width: 1024px)` 块，替换为：

```css
@media (max-width: 1024px) {
  .chat-right-sidebar {
    position: fixed;
    right: 0;
    top: var(--chat-titlebar-h, 48px);
    height: calc(100% - var(--chat-titlebar-h, 48px));
    width: 300px;
    transform: translateX(100%);
    z-index: 100;
    box-shadow: -4px 0 16px rgba(42, 38, 34, 0.08);
  }

  .chat-right-sidebar:not(.collapsed) {
    transform: translateX(0);
  }

  .chat-right-sidebar.collapsed {
    width: 300px;
    border-left-color: var(--chat-border);
  }

  .chat-sidebar {
    z-index: 100;
  }
}
```

### Step 2: 平板下收窄左侧栏

在 `@media (max-width: 1024px)` 内继续添加：

```css
  :root .chat-page {
    --chat-sidebar-width: 220px;
  }
```

### Step 3: 验证平板截图

Run:

```bash
cd /tmp/opencode/pw && node tablet-chat-retry.js
```

Expected: 768px 下左侧会话列表显示，右侧栏默认隐藏，中间聊天区占主要空间。

### Step 4: Commit

```bash
git add web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): tablet layout with persistent left and drawer right"
```

---

## Task 4: 新增响应式单元测试

**Files:**
- Modify: `web/src/features/session/chat/ChatShell.test.tsx`

**Interfaces:**
- Consumes: `ChatShell` 组件；需要 mock `window.matchMedia`。
- Produces: 新增 4 个测试用例覆盖 mobile/tablet 默认状态、按钮切换、遮罩关闭。

### Step 1: 添加 `matchMedia` mock helper

在测试文件顶部，imports 之后添加：

```ts
function mockMatchMedia(matchesMap: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesMap[query] ?? false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}
```

### Step 2: 新增 mobile 默认隐藏测试

在 describe 块内添加：

```ts
it('hides both sidebars by default on mobile', () => {
  mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
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
  expect(screen.queryByTestId('chat-sidebar')).toHaveClass('collapsed')
  expect(screen.queryByTestId('chat-right-sidebar')).toHaveClass('collapsed')
})
```

### Step 3: 新增 tablet 默认左侧显示右侧隐藏测试

```ts
it('shows left sidebar and hides right sidebar by default on tablet', () => {
  mockMatchMedia({ '(max-width: 768px)': false, '(max-width: 1024px)': true })
  render(
    <ChatShell
      title="Chat"
      sidebar={<div data-testid="sidebar">sidebar</div>}
      rightPanel={<div data-testid="right">right</div>}
    >
      <div data-testid="main">main</div>
    </ChatShell>
  )
  expect(screen.queryByTestId('chat-sidebar')).not.toHaveClass('collapsed')
  expect(screen.queryByTestId('chat-right-sidebar')).toHaveClass('collapsed')
})
```

### Step 4: 新增按钮打开抽屉测试

```ts
it('opens left sidebar when toggle button clicked on mobile', () => {
  mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
  render(
    <ChatShell
      title="Chat"
      sidebar={<div data-testid="sidebar">sidebar</div>}
      rightPanel={<div data-testid="right">right</div>}
    >
      <div data-testid="main">main</div>
    </ChatShell>
  )
  fireEvent.click(screen.getByTestId('chat-sidebar-toggle'))
  expect(screen.queryByTestId('chat-sidebar')).not.toHaveClass('collapsed')
  expect(screen.getByTestId('chat-left-backdrop')).toBeInTheDocument()
})
```

### Step 5: 新增遮罩关闭抽屉测试

```ts
it('closes left sidebar when backdrop clicked', () => {
  mockMatchMedia({ '(max-width: 768px)': true, '(max-width: 1024px)': true })
  render(
    <ChatShell
      title="Chat"
      sidebar={<div data-testid="sidebar">sidebar</div>}
      rightPanel={<div data-testid="right">right</div>}
    >
      <div data-testid="main">main</div>
    </ChatShell>
  )
  fireEvent.click(screen.getByTestId('chat-sidebar-toggle'))
  fireEvent.click(screen.getByTestId('chat-left-backdrop'))
  expect(screen.queryByTestId('chat-sidebar')).toHaveClass('collapsed')
})
```

### Step 6: 运行测试

Run:

```bash
npm --prefix web test -- tests/unit/ChatShell.test.tsx --run
```

Expected: 8 tests pass。

### Step 7: Commit

```bash
git add web/src/features/session/chat/ChatShell.test.tsx
git commit -m "test(chat): add responsive sidebar state tests"
```

---

## Task 5: 减少动画偏好支持

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`

**Interfaces:**
- Consumes: 现有 `@media (prefers-reduced-motion: reduce)` 块。
- Produces: 抽屉动画在减少动画偏好下被禁用。

### Step 1: 扩展 reduced-motion 媒体查询

找到现有：

```css
@media (prefers-reduced-motion: reduce) {
  .chat-page * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

保持原样即可（已覆盖所有过渡）。如果本块已存在，本 task 可跳过，但需在 commit 中说明无改动。

若不存在则添加：

```css
@media (prefers-reduced-motion: reduce) {
  .chat-page * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Step 2: Commit（如果无改动则跳过）

```bash
git add web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): respect reduced motion for drawer animations"
```

---

## Task 6: 全量回归验证

**Files:**
- 无代码改动
- 输出：截图 `/tmp/mobile-chat-final.png`、 `/tmp/tablet-chat-final.png`、 `/tmp/desktop-chat-final.png`

### Step 1: TypeScript 检查

Run:

```bash
npm --prefix web run typecheck
```

Expected: 无错误。

### Step 2: 单元测试

Run:

```bash
npm --prefix web test -- --run
```

Expected: 全部通过，0 failed。

### Step 3: 构建

Run:

```bash
npm --prefix web run build
```

Expected: 构建成功。

### Step 4: Playwright 视觉回归

Run：

```bash
cd /tmp/opencode/pw && node mobile-chat-auth-screenshot.js && node tablet-chat-retry.js && node desktop-chat-screenshot.js
```

Expected:
- `/tmp/mobile-chat-before.png`：375px，仅标题栏 + 中间聊天区。
- `/tmp/tablet-chat-before.png`：768px，左侧列表 + 中间聊天区，右侧隐藏。
- `/tmp/desktop-chat-before.png`：1440px，三栏均显示。

### Step 5: Docker 重新部署验证

Run:

```bash
cd "/home/ubuntu/workspace/my agent" && docker compose -f docker-compose.prod.yml up -d --build
```

Expected: 容器 `myagent-web-1` 状态 `healthy`。

### Step 6: Commit（如果测试脚本有更新）

如有新增测试脚本或截图记录，提交；否则无需单独 commit。

---

## Self-Review

### Spec Coverage

- 手机默认单栏：Task 1（状态初始化）+ Task 2（CSS 抽屉）。
- 平板左侧显示 + 右侧抽屉：Task 1（状态初始化）+ Task 3（CSS 布局）。
- 桌面保持不变：Task 2 / Task 3 媒体查询只在 ≤1024px 生效，桌面逻辑不变。
- 遮罩关闭：Task 1 + Task 4 测试。
- 可访问性/减少动画：Task 5。
- 全量验证：Task 6。

### Placeholder Scan

- 无 TBD/TODO。
- 所有代码步骤都给出完整代码片段。
- 所有命令都给出预期输出。

### Type Consistency

- `ChatShell` props 未改变。
- 新增 state 变量 `isTabletOrBelow` 与现有 `isMobile` 类型一致（`boolean`）。
- `data-testid` 名称在测试和组件中一致：`chat-left-backdrop`、`chat-right-backdrop`。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-02-mobile-responsive-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
