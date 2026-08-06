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

## 6. 受控多轮搜索（bounded multi-round search）

> 本节描述 `search_subagent` 在生产装配下的有界多轮搜索行为。实现已完成并通过测试
> （见 `.omo/evidence/task-1..11-search-subagent-multi-round.log`），以下为源码事实，不是设计草案。

搜索子代理仍然是**专用的两阶段子会话**（`search_processor` profile，`SearchChildRunner`）。
它**不走**通用内核 LOOP，也**不通过** `kernelAdapter.execute()` 执行。多轮只在该专用路径内部
发生；对外两阶段契约（phase1 -> backend -> phase2）保持不变。

### 6.1 轮次与相位序列

生产策略 `MULTI_ROUND_SEARCH_POLICY`（`src/search/search-round-budget.ts`）允许最多
**3 轮**、**2 次 replan**；每一轮**只执行一条查询**；**phase2 只运行一次**，对合并并裁剪后的
证据做最终综合。

| 参数 | 值 | 说明 |
| ---- | ---- | ---- |
| `maxRounds` | 3 | 顺序轮次上限 |
| `maxReplans` | 2 | replan 上限（循环界 `min(maxRounds, maxReplans + 1)`） |
| `phase2ReserveMs` | 14000 | phase2 预留预算 |
| `handoffReserveMs` | 1000 | 交接预留 |

典型两轮序列（观察者视角）：

```
phase1(q1) -> backend_search -> evaluation(continue) -> replan
-> phase1(q2) -> backend_search -> evaluation(stop) -> phase2(merged evidence)
```

phase2 通过 `prepareSynthesisResults(mergedResults, plan)` 复用既有
`cleanSnippets -> rankSearchResults -> selectSearchResults` 管道，遵守 `MAX_RESULTS=10`
与每域名多样性上限。

### 6.2 默认单轮与生产装配

- **默认单轮**：直接/默认 `createSearchSubagent()` 使用 `ONE_ROUND_SEARCH_POLICY`
  （`maxRounds=1, maxReplans=0, phase2ReserveMs=0, handoffReserveMs=1000`），保持与历史
  **字节一致**的行为（单次 backend、两次 LLM、既有 metadata 形状）。
- **生产装配**：只有组合根 `src/api/context.ts` 的生产 `createSearchSubagent({...})` 通过
  `roundPolicy: MULTI_ROUND_SEARCH_POLICY` 启用多轮；该实例同时被 `SearchChildRunner` 与
  `searchSubagentDeps` 复用。
- **无新增配置面**：不引入环境变量、API 字段、config-store 字段或数据库迁移。策略是
  `search-round-budget.ts` 中的硬编码常量导入。

### 6.3 确定性去重

| 维度 | 规则 |
| ---- | ---- |
| 查询去重 | Unicode NFKC 归一化 + 精确比较 + Jaccard(0.8) 相似度；Latin 词元 + CJK 二元组；空词元回退到精确比较（永不产生 NaN） |
| 重复查询处理 | 第 2 轮及之后命中重复 -> `stopReason='duplicate_query'`，**不消耗 backend 调用** |
| URL 合并键 | scheme/host 小写、去掉 `www.`、剥离默认端口、丢弃 fragment、移除跟踪参数（`utm_*` / `gclid` / `fbclid`）、剩余参数排序后重新编码；保留 path 大小写与业务参数 |
| 合并语义 | 首结果优先（first-result-wins）；既有 `deduplicateResults()` 单轮行为**不变** |

### 6.4 纯确定性轮次评估

`search-round-evaluator.ts` 是**纯函数**，不调用 LLM，不重定义公开的
`determineEvidenceSufficiency()`。决策矩阵按优先级（高到低）：

1. `backend_failure` / `duplicate_query` / `budget_boundary` / `max_rounds` -> **stop**
2. `no_results` / `no_facts` / `low_diversity` -> **replan**
3. `freshness_unverifiable` -> 最多 **一次** replan
4. `sufficient_evidence` -> **stop**

源多样性下限（按 intent）：

| intent | 最小独立源数 |
| ---- | ---- |
| weather / local | 1 |
| news / technical / product / general | 2 |

`missingCriticalContext` **只是 prompt 提示**（渲染在 Segment D 动态上下文），
**绝不**单独触发新一轮。

### 6.5 超时是管道级放弃，不是传输取消

> 关键：deadline 是**管道级放弃（pipeline-level abandonment）**，**不是** provider 传输取消。

- LLM / provider 请求**不带 AbortSignal**；当 deadline 触发，管道停止等待在途 promise，
  但 provider 调用**本身不会被取消**。
- 迟到的完成/拒绝都会被**观察并吞掉**：既不调度后续管道工作，也不产生 unhandled rejection。
- 迟到但被放弃的调用仍计入 `llmCallCount`（provider 工作确实发起过）。
- 外部 abort 仍然权威：abort -> cancelled，即使被放弃的 provider promise 随后 settle。

### 6.6 部分成功 vs SEARCH_TIMEOUT

| 场景 | 结果 |
| ---- | ---- |
| 预算到达 + **有**证据 | 部分成功：`budgetExhausted=true` +（可能降级的）答案 |
| 预算到达 + **零**证据 | 类型化可恢复失败 `SEARCH_TIMEOUT`（已加入 `SearchSubagentFailureResult.errorCode`） |
| 外部 abort | `SEARCH_TIMEOUT` / cancelled（即使被放弃的 provider promise 随后 settle） |
| backend `success:false` | **终端**：不盲目重试；保留既有 `SEARCH_BACKEND_ERROR` 映射；不运行 phase2 |

### 6.7 元数据与时间线

- **内部** `SearchSubagentExecutionMetadata`：`executedQueries`（**仅内部**，不外泄）、
  `roundCount`、`replanCount`、`searchCallCount`、`llmCallCount`、`stopReason`、
  `budgetExhausted`。
- **公开** `SearchSubagentMetadata`：可选拷贝上述字段**除 `executedQueries` 外**；拷贝受
  门控（默认单轮不发射任何新可选字段）。
- **`SearchPhaseObservation`**：新增 `evaluation` / `replan` 相位，以及
  `round` / `stopReason` / `replanReason` / `roundCount` / `searchCallCount` / `llmCallCount`
  可选字段。
- **记录器**：持久化 best-effort，**永不**因记录失败而中断运行（try/catch 包裹
  `transcriptStore.append`）。
- **子会话 `toolCalls` / `iterationsUsed`**：现在反映真实的 `executedQueries` / `llmCallCount`，
  缺省时回退到 `{query}` / 2。

### 6.8 兼容性与范围边界

- 所有变更为**增量**：不重命名、不删除既有契约。
- 默认单轮路径保持字节一致；只有生产组合根启用多轮。
- `SearchSubagentToolResult` 主体形状不变；不新增 `finalAnswer` / `userVisibleResponse` 字段。
- 公开 `EvidenceSufficiency` 规则与 `scoreSourceQuality()` 阈值**不变**。
- 共享 `deduplicateResults()` 单轮行为**不变**。
- 不引入向量模型、新依赖、并行查询或递归子代理。
