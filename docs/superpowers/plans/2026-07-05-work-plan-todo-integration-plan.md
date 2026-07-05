# 工作计划栏接入后端 Todo 系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天右侧栏「工作计划」一栏只读展示当前会话 `planner` agent 写入的 todos，移除假数据和占位按钮。

**Architecture:** 在现有 `TodoWorkPlanCard` 上做最小改造：新增 `ownerAgentId` prop（默认 `'planner'`），`fetchTodos` 调用 `client.listTodos(sessionId, ownerAgentId)`；删除 `EXAMPLE_TODOS` 假数据回退，空数据走空状态；`ChatContextPanel` 移除「添加任务」「筛选」两个占位按钮。后端 API `GET /api/v1/sessions/:sessionId/todos?ownerAgentId=planner` 已支持，无需改动。

**Tech Stack:** React 18 + TypeScript (strict, noUnusedLocals/Parameters) + Vitest + @testing-library/react + jsdom。路径别名 `@` → `src/`。

**Spec:** `docs/superpowers/specs/2026-07-05-work-plan-todo-integration-design.md`

## Global Constraints

- TypeScript strict 模式：`noUnusedLocals` + `noUnusedParameters`，删除代码后不得留下未使用的 import / 变量 / 参数
- ESM 模块（`"type": "module"`），Target ES2022
- 测试用 vitest + jsdom，`vi.mock('../../api/client')` 模式 mock 整个 client 模块，用 `vi.mocked(client.listTodos).mockResolvedValue(...)` 控制返回值
- 测试文件与被测文件同目录，命名 `*.test.tsx`
- 提交信息格式：`<type>(<scope>): <subject>`，type 用 feat/refactor/test/docs
- 不改动后端、不改动 `web/src/api/client.ts`、不改动 CSS
- 默认 `ownerAgentId` 值为字符串字面量 `'planner'`
- `client.listTodos` 签名：`listTodos(sessionId: string, ownerAgentId?: string): Promise<TodosResponse>`，`TodosResponse = { todos: TodoItem[]; total: number }`
- `TodoItemWithChildren` 由 `buildTodoTree(flatTodos)` 构建而来，含 `children?: TodoItemWithChildren[]`

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `web/src/features/context/TodoWorkPlanCard.tsx` | 只读展示 planner todos 的卡片组件 | 修改 |
| `web/src/features/context/TodoWorkPlanCard.test.tsx` | TodoWorkPlanCard 单测 | 新建 |
| `web/src/features/session/chat/ChatContextPanel.tsx` | 聊天右侧栏容器 | 修改 |
| `web/src/features/session/chat/ChatContextPanel.test.tsx` | 右侧栏单测 | 修改 |

---

### Task 1: 新建 TodoWorkPlanCard 单测并验证默认拉取 planner todos

**Files:**
- Create: `web/src/features/context/TodoWorkPlanCard.test.tsx`
- Modify: `web/src/features/context/TodoWorkPlanCard.tsx`

**Interfaces:**
- Consumes: `client.listTodos(sessionId: string, ownerAgentId?: string)` from `../../api/client`；`buildTodoTree` from `../todos/todo-tree`
- Produces: `TodoWorkPlanCard` 新增 prop `ownerAgentId?: string`（默认 `'planner'`），渲染 `.todo-plan-empty` 空状态分支

- [ ] **Step 1: 写失败测试 — 验证 listTodos 以 'planner' 调用 + 空状态渲染**

Create `web/src/features/context/TodoWorkPlanCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TodoWorkPlanCard from './TodoWorkPlanCard'
import * as client from '../../api/client'

vi.mock('../../api/client')

const TEST_SESSION_ID = 'ses_plan_test'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TodoWorkPlanCard', () => {
  it('fetches todos with ownerAgentId=planner by default', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(client.listTodos).toHaveBeenCalledWith(TEST_SESSION_ID, 'planner')
    })
  })

  it('renders empty state when planner has no todos', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无工作计划')).toBeInTheDocument()
    })
    expect(screen.queryByText('审阅暖纸主题 CSS 草稿')).not.toBeInTheDocument()
  })

  it('renders todo tree when planner has todos', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({
      todos: [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          content: '分析需求文档',
          status: 'in_progress',
          priority: 'high',
          parentTodoId: null,
          position: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
    })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByTestId('todo-plan-item-todo-1')).toBeInTheDocument()
    })
    expect(screen.getByText('分析需求文档')).toBeInTheDocument()
  })

  it('does not call listTodos when sessionId is null', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={null} />)

    expect(client.listTodos).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/context/TodoWorkPlanCard.test.tsx --run`
Expected: FAIL — `listTodos` 被调用时未传入 `'planner'`（当前 `fetchTodos` 调用 `client.listTodos(currentSessionId)` 无第二参数）；空状态断言失败（当前回退到 `EXAMPLE_TODOS`）。

- [ ] **Step 3: 修改 TodoWorkPlanCard — 新增 ownerAgentId prop + 删除假数据 + 空状态分支**

Edit `web/src/features/context/TodoWorkPlanCard.tsx`:

1. 在 `TodoWorkPlanCardProps` 接口新增 `ownerAgentId`：

```tsx
export interface TodoWorkPlanCardProps {
  sessionId?: string | null
  ownerAgentId?: string
  className?: string
  testId?: string
}
```

2. 组件解构新增 `ownerAgentId = 'planner'`：

```tsx
const TodoWorkPlanCard: React.FC<TodoWorkPlanCardProps> = ({
  sessionId,
  ownerAgentId = 'planner',
  className = '',
  testId = 'todo-work-plan-card',
}) => {
```

3. `fetchTodos` 改为传入 `ownerAgentId`（注意 `useCallback` 依赖数组新增 `ownerAgentId`）：

```tsx
  const fetchTodos = useCallback(async () => {
    if (!sessionId) {
      setTodos([])
      return
    }

    const currentSessionId = sessionId
    setLoading(true)
    setError(null)

    try {
      const response = await client.listTodos(currentSessionId, ownerAgentId)
      if (currentSessionId === sessionIdRef.current) {
        setTodos(buildTodoTree(response.todos))
      }
    } catch (err) {
      if (currentSessionId === sessionIdRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to load todos'))
      }
    } finally {
      if (currentSessionId === sessionIdRef.current) {
        setLoading(false)
      }
    }
  }, [sessionId, ownerAgentId])
```

4. 删除以下死代码（约第 13-50 行 + 第 139-162 行）：
   - `interface ExampleTodoItem` 块
   - `EXAMPLE_TODOS` 常量
   - `getTimeGroup` 函数
   - `groupByTime` 函数
   - `renderExampleItem` 方法

5. 替换 `todos.length === 0 ? (... EXAMPLE_TODOS 分支 ...)` 为空状态分支。当前 JSX 结构为：

```tsx
      ) : todos.length === 0 ? (
        <div className="todo-plan-list" data-testid="todo-plan-list">
          {(() => {
            const groups = groupByTime(EXAMPLE_TODOS)
            return groups.map(group => (
              <div key={group.title} className="todo-plan-group">
                <div className="todo-plan-group__title">{group.title}</div>
                {group.items.map(item => renderExampleItem(item))}
              </div>
            ))
          })()}
        </div>
      ) : (
```

改为：

```tsx
      ) : todos.length === 0 ? (
        <div className="todo-plan-empty" data-testid="todo-plan-empty">
          <div className="todo-plan-empty__icon">📋</div>
          <div className="todo-plan-empty__text">
            <span className="todo-plan-empty__title">暂无工作计划</span>
            <span className="todo-plan-empty__hint">planner 暂未生成任务</span>
          </div>
        </div>
      ) : (
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/context/TodoWorkPlanCard.test.tsx --run`
Expected: PASS — 4 个测试全部通过。

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS — 无 `noUnusedLocals`/`noUnusedParameters` 错误（确认 `getTimeGroup`/`groupByTime`/`renderExampleItem`/`ExampleTodoItem`/`EXAMPLE_TODOS` 全部删除且无残留引用）。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/context/TodoWorkPlanCard.tsx web/src/features/context/TodoWorkPlanCard.test.tsx
git commit -m "refactor(context): TodoWorkPlanCard fetches planner todos with empty state"
```

---

### Task 2: 更新 ChatContextPanel 移除占位按钮

**Files:**
- Modify: `web/src/features/session/chat/ChatContextPanel.tsx`
- Test: `web/src/features/session/chat/ChatContextPanel.test.tsx`

**Interfaces:**
- Consumes: `TodoWorkPlanCard`（Task 1 产出，默认 `ownerAgentId='planner'`，无需显式传）
- Produces: `ChatContextPanel` 工作计划区无占位按钮，渲染 `TodoWorkPlanCard`

- [ ] **Step 1: 更新失败测试 — 移除占位按钮断言，新增不存在断言**

Edit `web/src/features/session/chat/ChatContextPanel.test.tsx`，整体替换为：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../../api/client'
import ChatContextPanel from './ChatContextPanel'

vi.mock('../../api/client')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
})

describe('ChatContextPanel', () => {
  it('renders work plan and desk sections', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
  })

  it('does not render add-task or filter placeholder buttons in work plan', () => {
    render(<ChatContextPanel />)
    expect(screen.queryByText('添加任务')).not.toBeInTheDocument()
    expect(screen.queryAllByTitle('筛选').filter(el =>
      el.closest('.chat-rs-panel--top')
    )).toHaveLength(0)
  })

  it('renders TodoWorkPlanCard', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTestId('todo-work-plan-card')).toBeInTheDocument()
  })

  it('renders 6 example desk items', () => {
    render(<ChatContextPanel />)
    const items = screen.getAllByTestId('chat-desk-item')
    expect(items).toHaveLength(6)
    expect(screen.getByText('暖纸主题设计规范.md')).toBeInTheDocument()
  })

  it('renders put-to-desk button', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('放到书桌')).toBeInTheDocument()
  })
})
```

注意：旧测试第 10 行 `expect(screen.getAllByTitle('筛选').length).toBeGreaterThanOrEqual(1)` 依赖书桌区筛选按钮仍存在，新测试中我们仅断言**工作计划区**（`.chat-rs-panel--top`）内无筛选按钮；书桌区筛选按钮本次需求未要求移除，保留。

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/session/chat/ChatContextPanel.test.tsx --run`
Expected: FAIL — `queryByText('添加任务')` 仍能找到（当前 `ChatContextPanel` 第 98-104 行渲染了添加任务按钮）；且旧测试 `renders example task list when no sessionId` 已被删除但新测试中 `renders TodoWorkPlanCard` 可能因 mock 未返回而时序问题（依赖 Task 1 的空状态分支）。

- [ ] **Step 3: 修改 ChatContextPanel — 移除工作计划区的占位按钮**

Edit `web/src/features/session/chat/ChatContextPanel.tsx`:

1. 删除工作计划 panel header 内的 actions 块（当前第 89-95 行）：

删除前：
```tsx
          <div className="chat-rs-panel__actions">
            <button className="chat-rs-panel__action" aria-label="筛选" title="筛选" onClick={() => showToast('筛选后续接入')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
            </button>
          </div>
```

删除后：工作计划 header 只剩 `<span className="chat-rs-panel__title">...工作计划</span>`，无 actions。

2. 删除工作计划 panel body 内的添加任务按钮（当前第 98-104 行）：

删除前：
```tsx
          <button className="chat-rs-add-btn" onClick={() => showToast('添加任务后续接入')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>添加任务</span>
          </button>
```

删除后：`<div className="chat-rs-panel__body">` 直接跟 `<TodoWorkPlanCard sessionId={sessionId} />`。

3. 检查 `showToast` 是否仍被使用：书桌区第 119-123 行仍有 `onClick={() => showToast('放到书桌后续接入')}` 和筛选按钮 → **保留 `showToast` import**。

4. `<TodoWorkPlanCard sessionId={sessionId} />` 不传 `ownerAgentId`（用默认 `'planner'`）。

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/session/chat/ChatContextPanel.test.tsx --run`
Expected: PASS — 5 个测试全部通过。

- [ ] **Step 5: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS — 无错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/session/chat/ChatContextPanel.tsx web/src/features/session/chat/ChatContextPanel.test.tsx
git commit -m "refactor(chat): remove placeholder buttons from work plan panel"
```

---

### Task 3: 全量验证与回归

**Files:**
- 无新改动，仅运行验证命令

- [ ] **Step 1: 运行前端全量测试**

Run: `npm --prefix web test -- --run`
Expected: PASS — 所有测试通过，包括 `TodosTab.test.tsx`（未改动，应仍通过）、`ContextDeskPanel.test.tsx`（注意：该测试第 92-102 行可能依赖 `TodoWorkPlanCard` 的旧行为）。

若 `ContextDeskPanel.test.tsx` 失败：
- 检查失败原因。该测试若依赖 EXAMPLE_TODOS 文案（如"审阅暖纸主题 CSS 草稿"），需在该测试中改为 mock `client.listTodos` 返回空或自定义数据，并断言空状态或自定义内容。
- `ContextDeskPanel` 调用 `<TodoWorkPlanCard sessionId={scopedSessionId} />` 未传 `ownerAgentId`，会默认 `'planner'`。该测试需补 `vi.mock('../../api/client')` + `vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })`，并移除对 EXAMPLE_TODOS 文案的断言。
- 此修复属于本次改动范围的连带影响（spec 第 24 行"不改动 ContextDeskPanel 调用点"指组件调用，但其测试若因默认 ownerAgentId 变化而失败需顺带修复）。

- [ ] **Step 2: 运行 typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: 运行后端测试（确认无回归）**

Run: `npm test -- --run`
Expected: PASS — 后端未改动，应全部通过。

- [ ] **Step 4: 检查 git 状态干净**

Run: `git status`
Expected: `nothing to commit, working tree clean`（若 Task 3 Step 1 修复了 ContextDeskPanel.test.tsx，则需额外提交）

- [ ] **Step 5（条件）: 若 Step 1 修复了 ContextDeskPanel.test.tsx，提交**

```bash
git add web/src/features/context/ContextDeskPanel.test.tsx
git commit -m "test(context): adapt ContextDeskPanel test to planner-scoped TodoWorkPlanCard"
```

- [ ] **Step 6: 最终确认**

Run: `git log --oneline -5`
Expected: 看到本次改动的 2-3 个 commit（Task 1、Task 2，可选 Task 3 Step 5）。

---

## Self-Review

**Spec coverage:**
- §2 包含「拉取并展示 planner todos」→ Task 1 Step 3 ✓
- §2 包含「移除示例假数据，空数据时显示空状态」→ Task 1 Step 3 (删除 EXAMPLE_TODOS + 空状态分支) ✓
- §2 包含「移除右侧栏顶部占位按钮」→ Task 2 Step 3 ✓
- §5.1 ownerAgentId prop + fetchTodos + 空状态 + 删除死代码 → Task 1 ✓
- §5.2 删除两个按钮 + showToast 处理 → Task 2 Step 3 (保留 import 因书桌区仍用) ✓
- §5.3 测试更新 → Task 2 Step 1 ✓
- §7 边界（无 sessionId / 空数据 / loading / error）→ Task 1 测试覆盖无 sessionId + 空；loading/error 已有逻辑保留，Task 1 Step 3 保留分支 ✓
- §9 测试策略 → Task 1 (TodoWorkPlanCard 单测) + Task 2 (ChatContextPanel 单测) + Task 3 (全量) ✓
- §11 验收标准 1-5 → Task 1+2 实现；6-7 → Task 3 验证 ✓

**Placeholder scan:** 无 TBD/TODO/「适当处理」等占位符。所有代码块均为完整可执行代码。✓

**Type consistency:**
- `ownerAgentId?: string` 默认 `'planner'` — Task 1 Props 定义与 Task 2 不传该 prop（用默认值）一致 ✓
- `client.listTodos(sessionId, ownerAgentId)` 签名 — Task 1 调用与测试 mock 一致 ✓
- `.todo-plan-empty` / `.todo-plan-empty__icon` / `.todo-plan-empty__text` / `.todo-plan-empty__title` / `.todo-plan-empty__hint` — Task 1 渲染与 `styles.css` 已定义的类名一致 ✓
- `data-testid="todo-plan-empty"` / `todo-work-plan-card` / `todo-plan-item-todo-1` — 测试与渲染一致 ✓

无问题，计划完成。