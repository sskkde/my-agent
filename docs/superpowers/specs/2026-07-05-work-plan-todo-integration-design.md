# 工作计划栏接入后端 Todo 系统设计

- 日期：2026-07-05
- 状态：已批准，待实现
- 方案：方案 A（在现有 `TodoWorkPlanCard` 上做最小改造）

## 1. 目标

将前端聊天右侧栏「工作计划」一栏接入后端 todo 系统，只读展示当前会话中 `planner` agent 写入的 todo 列表。呈现风格参考 [opencode](https://github.com/anomalyco/opencode.git) 的简洁列表（状态标记 + 优先级 + 内容 + 层级缩进）。

## 2. 范围

### 包含

- 工作计划栏拉取并展示当前会话 `ownerAgentId='planner'` 的 todos
- 移除示例假数据，空数据时显示空状态
- 移除右侧栏顶部「添加任务」「筛选」占位按钮

### 不包含

- 不提供创建 / 编辑 / 删除 / 状态切换 / 子任务添加等任何写交互
- 不改动后端 API（`GET /api/v1/sessions/:sessionId/todos?ownerAgentId=planner` 已支持）
- 不改动 `client.listTodos(sessionId, ownerAgentId)`（已支持 ownerAgentId 参数）
- 不改动 `ContextDeskPanel`（workspace 视图）调用点
- 不改动 `TodosTab` / `TodoTree` / `TodoItem`（完整 CRUD 视图保持独立）

## 3. 数据流

```
ChatContextPanel (sessionId)
   └─ TodoWorkPlanCard (sessionId, ownerAgentId='planner')  // 新增 prop，默认 'planner'
        └─ client.listTodos(sessionId, 'planner')
             → GET /api/v1/sessions/:sessionId/todos?ownerAgentId=planner
             → buildTodoTree(response.todos)
             → 只读渲染：状态图标 + 优先级色块 + 内容 + 层级缩进（max 3 层）
```

## 4. 后端契约（已存在，无改动）

- 路由：`src/api/routes/todos.ts`
- 端点：`GET /api/v1/sessions/:sessionId/todos?ownerAgentId=planner`
- 行为：`todoStore.findBySessionAndOwner(sessionId, 'planner')`，按 `position` 升序返回
- 鉴权：`ResourceType.todos` + `Action.read`，会话访问校验（owner 或 admin）
- 响应：`{ todos: TodoItem[], total: number }`，`TodoItem` 含 `todoId / sessionId / content / status / priority / parentTodoId / position / ownerAgentId / createdAt / updatedAt`

## 5. 改动文件（3 个）

### 5.1 `web/src/features/context/TodoWorkPlanCard.tsx`

**新增**：
- Props 增加 `ownerAgentId?: string`，默认值 `'planner'`
- `fetchTodos` 调用 `client.listTodos(sessionId, ownerAgentId)`
- 空状态渲染分支：`todos.length === 0 && !loading && !error` → 渲染 `.todo-plan-empty`（图标 + 主标题「暂无工作计划」+ 副提示「planner 暂未生成任务」）

**删除**：
- `EXAMPLE_TODOS` 常量
- `ExampleTodoItem` 接口
- `getTimeGroup` / `groupByTime` 函数
- `renderExampleItem` 方法
- 空数据时回退到 `EXAMPLE_TODOS` 的整个 IIFE 分支

**保留**：
- loading / error / 重试按钮
- stats 统计栏（总计 / 进行中 / 待处理 / 已完成）
- 树形渲染（`renderTodoItem`，max 3 层，层级缩进 16px）
- 进度条
- stale response guard（`sessionIdRef`）

### 5.2 `web/src/features/session/chat/ChatContextPanel.tsx`

**删除**：
- 工作计划 panel header 内的 `.chat-rs-panel__actions`（筛选按钮 + svg）
- 工作计划 panel body 内的 `.chat-rs-add-btn`（添加任务按钮 + svg + span）
- 若 `showToast` 在工作计划区已无引用且书桌区仍使用 → 保留 import；若全文件不再使用 → 移除 import

**保留**：
- 工作计划标题 + 日历 svg
- `<TodoWorkPlanCard sessionId={sessionId} />`（使用默认 `ownerAgentId='planner'`）
- 书桌 panel 完整结构

### 5.3 `web/src/features/session/chat/ChatContextPanel.test.tsx`

- 移除对「添加任务」按钮和「筛选」按钮的断言（若有）
- 保留「工作计划」标题断言
- 保留对 `TodoWorkPlanCard` 渲染的断言

## 6. 不改动

- 后端：`src/api/routes/todos.ts`、`src/todo/store.ts`、`src/tools/builtins/todo-write-tool.ts`
- 前端 API client：`web/src/api/client.ts`（`listTodos` 已支持 ownerAgentId）
- 类型：`web/src/api/types.ts`（`TodoItemWithChildren` 已存在）
- 工具：`web/src/features/todos/todo-tree.ts`（`buildTodoTree` 已存在）
- CSS：`web/src/styles.css` 的 `.todo-plan-*` 全套（含 `.todo-plan-empty`、`.todo-plan-loading`、`.todo-plan-error`、`.todo-plan-stats`、`.todo-plan-progress`）、`web/src/features/session/chat/chat-theme.css`（右侧栏布局相关类）
- 其他视图：`ContextDeskPanel`、`TodosTab`、`TodoTree`、`TodoItem`

## 7. 边界与错误处理

| 场景 | 行为 |
|------|------|
| 无 sessionId | `todos=[]` → 空状态 |
| sessionId 切换中 | 保留 stale response guard，仅更新最新 sessionId 的响应 |
| planner 无 todo | 空状态：「暂无工作计划 / planner 暂未生成任务」 |
| 加载中 | `.todo-plan-loading`（spinner + 加载中...） |
| 加载失败 | `.todo-plan-error`（⚠️ 加载失败 + 重试按钮） |
| 网络错误 / 403 | 走 error 分支，点击重试重新拉取 |

## 8. 视觉对齐 opencode

已有的 CSS 已与 opencode 简洁列表风格一致，无需新增样式：

- `.todo-plan-item__status`：`○` pending / `◐` in_progress / `●` completed / `✕` cancelled
- `.todo-plan-item__priority`：高=红 / 中=黄 / 低=灰 色块
- `.todo-plan-item__content--completed`：删除线
- 层级缩进：`paddingLeft: ${depth * 16}px`
- stats 栏 + 进度条提供整体进度感知

## 9. 测试策略

### 9.1 `TodoWorkPlanCard` 单测

- mock `client.listTodos`：验证调用参数为 `(sessionId, 'planner')`
- 空数据：渲染 `.todo-plan-empty`，不渲染 `EXAMPLE_TODOS`
- 有数据：渲染树 + stats + 进度条
- loading / error 分支

### 9.2 `ChatContextPanel` 单测

- 断言存在「工作计划」标题
- 断言存在 `TodoWorkPlanCard`
- 断言不存在「添加任务」按钮（queryByRole button name '添加任务' 返回 null）
- 断言不存在「筛选」按钮

### 9.3 验证命令

```bash
npm --prefix web test
npm run typecheck
```

## 10. 风险与回滚

- **风险**：极低。仅前端 3 文件改动，无后端 / DB / API 变更。
- **回滚**：`git revert` 单个 commit 即可恢复 EXAMPLE_TODOS 和占位按钮。

## 11. 验收标准

1. 工作计划栏显示当前会话 planner 写入的真实 todos
2. planner 无 todo 时显示空状态，不再显示示例假数据
3. 右侧栏顶部无「添加任务」「筛选」按钮
4. 切换会话时正确刷新对应 planner 的 todos
5. 加载 / 错误 / 重试交互正常
6. `npm --prefix web test` 通过
7. `npm run typecheck` 通过