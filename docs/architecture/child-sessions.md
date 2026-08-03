# 子会话（Child Sessions）架构与兼容性说明

> 本文档描述子代理任务（`foreground_launch_subagent` / `search_subagent`）在子会话中的
> 运行模型：**单进程协调**方式、数据模型、可观测性维度，以及对外契约的**兼容性保证**。
> 对应计划 opencode-like-subagent-sessions（Todo 7–17）。

## 1. 概述

每个委派任务运行在租户/用户拥有的内部子会话（`session_kind='subagent'`）中：

- `sessions` 是可观测的会话外壳（子会话默认从普通会话列表隐藏）。
- `subagent_runs` 是执行尝试的事实来源；**每次**新建启动或 `taskId` 恢复都会插入新的一行
  （带 `child_session_id` / `task_id` 关联）。
- 固定身份规则：**`taskId === childSessionId`**。
- 父会话只接收任务生命周期事件与有界的安全结果；子会话的推理/文本/工具事件只出现在子会话时间线。

## 2. 单进程协调（single-process coordination）

平台按**单进程**设计协调子任务，所有协作在同一 API 进程内完成（多实例调度不在本功能范围内）：

### 2.1 组合根（composition root）接线顺序

`src/api/context.ts` 的 `createApiContext` 按以下顺序装配（顺序不可颠倒，否则产生循环依赖）：

1. **搜索相位记录器**：`createSearchPhaseRecorder(subagentTranscriptStore)` — 独立实例。
2. **两阶段搜索执行器**：`createSearchSubagent({ ..., phaseObserver: recorder.observe })` —
   执行器把三个里程碑（phase1 / backend_search / phase2）回调给记录器。
3. **专用搜索运行器**：`createSearchChildSessionRunner({ searchSubagent, recorder })` —
   复用同一个 recorder 实例写子会话时间线。
4. **统一子任务运行时**：`createChildSessionTaskRuntime({ sessionStore, runStore,
   transcriptStore, kernelAdapter, registry, toolRegistry, envelopeRegistry, eventStore,
   lifecycleBroadcaster: timelineBroadcaster, searchRunner })`：
   - `kernelAdapter`（通用内核适配器）处理非搜索 profile；
   - `searchRunner` 处理 `search_processor` profile（`SEARCH_CHILD_PROFILE_ID`）；
   - `eventStore` 持久化父侧生命周期事件（run_started/run_completed/run_failed/run_cancelled）；
   - `lifecycleBroadcaster` 为 `timelineBroadcaster`，父会话 SSE 流实时广播（best-effort，失败不影响处理）。
5. **前台工具接线**：`foregroundToolRuntimeDeps` / `searchSubagentDeps` 注入
   `childSessionTaskRuntime`、`toolResultStore`、`sessionStore`、`subagentRunStore`、
   `backgroundRuntime` 与 `childTaskRemainingTimeoutMs`（默认 `DEFAULT_FOREGROUND_CHILD_WAIT_MS`）。

### 2.2 超时与取消对齐

- 内核按工具分发超时：`PER_TOOL_TIMEOUT_MS` 为 `search_subagent` 与
  `foreground_launch_subagent` 都配置了 `90_000` ms，避免 dispatcher 默认 30s 竞速截断
  有界子任务等待（前台等待预算默认 60s）。
- 取消级联：父会话取消 → `cancelRun` 中止活跃子内核（幂等）；迟到的终态写入不会覆盖已取消运行。
- 前台等待：`waitForChildExecution` 在预算到期或外部 abort 时触发 `cancelRun`（无孤儿运行）。

### 2.3 后台任务

- `background=true` 启动立即返回（`status: 'queued'` + `backgroundRunId`）；
- `backgroundRuntime` 持久化完整任务规格；后台 worker 恢复后从持久化规格重建
  （`launchTask → linkChildTask → executeRun`），终态通知恰好一次（store 层通知类型守卫）。

## 3. 兼容性保证（additive only）

所有变更均为**增量**：不重命名、不删除既有契约。

| 表面 | 保证 |
| ---- | ---- |
| 公开工具 ID | `search_subagent` / `foreground_launch_subagent` 等 ID 与既有 required 字段不变；`taskId` / `background` 仅作为可选字段新增 |
| `subagent_runs` | 表名、列、既有引用不变；无 `child_session_id` / `task_id` 的历史行仍可完整查询（读取按 NULL 处理） |
| 指标名 | 既有指标（`agent_platform_*` 等）不变；新增 `subagent_runs_total` 计数器，标签为增量（`agent_profile` / `parent_session_id` / `task_id` / `child_session_id` / `launch_mode`） |
| OpenAPI | `SessionInfo` / `ConsoleSessionInfo` 既有字段不变；新增 `sessionKind` / `parentSessionId` / `taskId` / `agentProfile` / `launchMode` / `subagentDepth` 与 `/sessions/{sessionId}/children`（列表/resume/cancel）路径 |
| 工具目录 | 两个 catalog（`src/tools/tool-catalog.ts`、`src/api/tool-catalog.ts`）条目 ID 不变；描述文本增量说明子会话行为 |
| 调试/日志投影 | `/debug/replay` 响应新增可选 `childTaskRefs`（既有字段不变）；日志严重度映射沿用既有 `run_failed` / `run_cancelled` 事件类型 |
| 搜索路径 | 未接线子运行时（无 `childSessionTaskRuntime` + stores + sessionId 上下文）时，`search_subagent` 走与历史行为一致的同步路径 |
| 会话 API | 默认会话列表排除子会话；子会话详情/时间线/流沿用既有路由的 403 约定；跨用户/租户访问统一 404，不泄露存在性 |

## 4. 可观测性维度

- **生命周期事件**：父会话可查询 `run_started` / `run_completed` / `run_failed` /
  `run_cancelled` 事件，payload 携带 `{taskId, childSessionId, runId, agentProfile,
  launchMode, status, safeMessage}`，`relatedRefs.subagentRunId` 关联尝试行。
- **指标**：`subagent_runs_total`（见 `docs/observability/metrics.md`）。
- **调试投影**：`/debug/replay/:sessionId` 的 `childTaskRefs` 汇总子任务 ID。
- 子会话时间线事件（含搜索相位 `SearchPhase` 记录）只出现在子会话流上。

## 5. 测试契约

- `tests/unit/api/child-session-contract.test.ts`：组合根接线、历史行可查询、
  生命周期事件父会话关联、目录/OpenAPI/指标契约、内核超时对齐。
- `tests/architecture/`：既有 ID 与响应字段保持不变。
- `tests/unit/tools/tool-catalog-consistency.test.ts`：目录一致性与暴露元数据。
