# DeepSeek Harness 对比差距报告（Gap Report）

> **Status**: ✅ Formal Analysis Document（全部 14 项已修复，见 [FIX_PLAN](./DEEPSEEK_HARNESS_FIX_PLAN.md)）
> **Scope**: 对照 `deepseek-ai/deepseek-harness`（2026-08-13 主分支）的 agent-loop / LLM 层实现，审视本仓库（agent-platform v0.8.0-ga-candidate）模型交互链路。
> **Last Updated**: 2026-08-13（决策修订）
> **Baseline Commit**: 工作区 master（本次分析未引入任何代码变更）
> **已确认决策**: ① 滚动摘要接线启用（P3-1）；② feature-flag 默认值以代码为准 ON（P3-2）；③ 本地 LLM 适配器补 contextWindow 能力（P2-4 前置，Fix-P0-4）。
> **结论摘要**: 14 项可优化项 —— P0 × 3（正确性/成本）+ P0-4 前置任务、P1 × 4（前缀稳定性/超时健壮性）、P2 × 4（成本核算/可观测性）、P3 × 3（清理/一致性）。
> **配套文档**: 修复计划见 [DEEPSEEK_HARNESS_FIX_PLAN.md](./DEEPSEEK_HARNESS_FIX_PLAN.md)

---

## 1. 背景与方法

deepseek-harness（`dsh`）是 DeepSeek AI 官方的开源 agent harness，其核心特征是"一切皆插件"（Cordis）、会话日志为唯一事实源、以及大量针对 DeepSeek API 计费/协议特性的针对性优化。本次分析通读了 harness 的 `packages/core/agent-loop`（6 文件）与 `packages/llm/llm-deepseek`（7 文件）源码，并派 4 个探索 agent 采集了本仓库 `src/kernel/`、`src/llm/`、`src/tools/`、`src/memory/` 的对应实现，逐项比对。

harness 的 DeepSeek 针对性优化可归纳为五类：

1. **KV cache 利用**：disjoint token 记账（`prompt_tokens` 剥离缓存命中）；compaction 摘要调用逐字节重放热前缀（指令放尾部 user 消息）；会话前缀按实例冻结；"KV Cache effect"为全仓库强制文档契约。
2. **thinking/reasoning**：适配器拥有 effort 档位（off/high/max）；`reasoning_content` 仅工具轮次回传（API 强制）、无工具轮次丢弃省 token；session-title 调用强制 `thinking: disabled`。
3. **上下文窗口**：压缩阈值按适配器 `contextWindow`（默认 1M）缩放，而非固定值。
4. **重试**：QUOTA/余额不足分类为终止不重试；429 尊重 `Retry-After`；5xx/超时指数退避重试；`x-request-id` 随失败持久化。
5. **传输层**：流式 idle watchdog；归因请求头（`x-deepseek-harness-*`）；空内容/null/空工具输出的网关怪癖防御。

---

## 2. 已达标部分（无需改动）

以下能力本地实现已具备或更优，**不列入修复计划**：

| 维度 | 本地现状 | 结论 |
|---|---|---|
| 前缀分层 | 7 层/4 段架构：Segment A/B/C 静态、D 全动态；时变内容（`currentDate` 等）正确收敛在 Segment D（`src/kernel/model-input/model-input-types.ts`） | 优于 harness 的会话前缀冻结，不动 |
| 结果排序 | 工具结果模型序提交：`agent-kernel.ts:1306-1347` 按模型发出顺序写转录，`ToolResultPairingGuard` 按 toolCallId 配对 | 等价于 harness 的 committed，达标 |
| 取消日志完整性 | `flushPairingGuard` 合成 `MISSING_TOOL_RESULT` + orchestrator 合成 `CANCELLED`，转录恒有配对结果 | 达标 |
| reasoning 隔离 | 全链路独立 `reasoning` channel，绝不与 content 合并（反模式 #17），`openai-chat-transformer.ts:202-243`、`stream-aggregator.ts:38-44` | 达标 |
| 会话标题 | 无 LLM 调用（`sessions.ts:139-150` 确定性时间戳） | 天然零成本 |
| 工具参数解析 | 双层：kernel 层 JSON 语法（`agent-kernel.ts:1019-1063`，失败合成 `INVALID_TOOL_ARGUMENTS`）+ executor 层 schema 校验（`tool-executor.ts:151-163`） | 达标 |
| 写工具串行化 | `tool-orchestrator.ts:88-112` 写类串行 + `SIBLING_WRITE_FAILED` 跳过 | 部分等价 harness 独占屏障 |

---

## 3. 问题清单

### 🔴 P0 —— 正确性与成本（3 项）

#### P0-1 长时记忆抽取使用错误模型

- **现象**：`api/context.ts:1053-1060` 创建 `createLongTermMemoryScheduler` 时未传 model；`src/memory/long-term-memory-extractor-service.ts:39` 落到 `DEFAULT_MODEL = 'gpt-4o-mini'`。每轮对话后异步抽取长期记忆，实际用的是 gpt-4o-mini 而非会话使用的模型。
- **证据**：`long-term-memory-extractor-service.ts:181-198` 的 LLM 请求只有 `{ model: deps.model ?? DEFAULT_MODEL, messages, responseFormat }`。
- **影响**：成本错配；记忆提取质量与主模型（可能为 DeepSeek v4）不一致，产生上下文割裂。
- **harness 参照**：辅助调用通过 `llm.prepareCall` 绑定精确 provider/model 路由，会话模型继承。

#### P0-2 LLM 错误分类缺失 + 重试机制半成品

- **现象**：
  - `src/llm/transform/provider-errors.ts:31-60` 仅三档分类：429→`RATE_LIMIT_ERROR`、≥500→`PROVIDER_ERROR`、≥400（含 401）→`REQUEST_ERROR`。**401 无单独分类、无余额不足/QUOTA 检测**（全仓 grep `insufficient|quota|balance` 无 LLM 路径命中）。
  - 429 的 `retryAfterMs: 60000` **硬编码**（:36），不读响应 `Retry-After` 头。
  - `LLMAdapterConfig.retryPolicy`（`adapter.ts:30`）与 `ProviderConfig.retries: 2`（`routing/provider-resolver.ts:379`）均为**死配置**；`createLLMAdapter.complete()` 只做多 provider failover，同一 provider 无次数重试、无退避。
  - `src/recovery/retry-executor.ts:149-184` 的指数退避引擎存在但**未接入 LLM 调用路径**。
  - 错误映射实现重复三份：`provider-errors.ts`（生产引用）、`openai-adapter.ts:47-91`、`openrouter-adapter.ts:49-93`（后两者非生产路径）。
- **影响**：DeepSeek 余额不足（402/quota）被标 `retryable_later`，反复重试/换 provider 白烧钱；限流时死等 60s 而非尊重服务器 Retry-After；瞬时 5xx 无自动重试。
- **harness 参照**：QUOTA 终止不重试；`providerRetryAfterMs` 解析 Retry-After；`SERVER/RATE_LIMIT/TIMEOUT/TRANSPORT/EMPTY_RESPONSE` 指数退避重试 2 次。

#### P0-3 reasoning_content 不回传历史（DeepSeek thinking 模式多轮隐患）

- **现象**：`src/llm/types.ts:17-23` 的 `LLMMessage` 无 reasoning 字段；`agent-kernel.ts:227-232` `commitTranscript('llm_response')` 只记 content/toolCalls/finishReason。reasoning 全链路只解析/广播/展示，**从不回传下一轮请求**。
- **证据**：`openai-chat-transformer.ts:202-205, 234-243, 336-339` 解析正确；`transcript-redaction-mapper.ts:118-137` 仅投影 `role:'thinking'` 展示。
- **影响**：DeepSeek API 在 thinking 模式下**要求工具调用轮次的 `reasoning_content` 回传**；本地不回传会导致多步工具循环报错或推理链断裂。
- **harness 参照**：`serializeAssistant` —— 工具轮次回传 `reasoning_content`（API 强制），无工具轮次丢弃（省 token）。

---

### 🟠 P1 —— 前缀稳定性与超时健壮性（4 项）

#### P1-1 foreground 主路径工具未做确定性排序

- **现象**：`src/tools/tool-schema-canonicalizer.ts:64-74` 的 `stableToolSort` 已实现，subagent/search 路径使用；但 **foreground 主路径** `src/foreground/tool-projection-mapper.ts:145` 直接 `filter` 保留注册表插入序，`model-input-builder.ts:605-614` `extractToolsForRequest` 出口也不再重排。
- **影响**：function_calling 下 Segment C 文本为空，工具仅存在于 `LLMRequest.tools`；工具序变化即破坏 DeepSeek 前缀缓存。
- **harness 参照**：工具 schema 规范化 + 稳定排序是缓存前缀的一部分。

#### P1-2 90s per-tool 超时在批量路径失效

- **现象**：`agent-kernel.ts:67-70` 定义 `PER_TOOL_TIMEOUT_MS`（search_subagent/foreground_launch_subagent=90s），但仅挂在 `dispatchTool`（:1104，主循环已不调用）；主循环走的 `dispatchExternalBatch` 的 `executionPolicy` **不写 timeoutMs**（:1216-1219），退化到 dispatcher 默认 30s。`search_subagent` 靠内部 `DEFAULT_SEARCH_CHILD_WAIT_MS=60s`（`search-subagent-tool.ts:52`）才未被切断。
- **影响**：设计意图（90s）与实际行为（30s）不符，长耗时子代理搜索会被提前掐断。

#### P1-3 流式无 idle watchdog

- **现象**：`src/llm/providers.ts:193-230` `readStreamLines` 循环 `await reader.read()` 无 chunk 间空闲超时；kernel 侧 `agent-kernel.ts:941-963` 只有总超时（`Promise.race`）。
- **影响**：provider 连接不断但长时间不发数据时，挂满总 timeout 才断开，浪费资源与用户等待。
- **harness 参照**：`idleWatchdog`（默认 5min，每次 chunk pulse 重置），超时抛 `TIMEOUT`。

#### P1-4 并行度不可配（maxConcurrency 死配置）

- **现象**：`agent-kernel.ts:1216-1219` 写 `executionPolicy: { maxConcurrency: 5 }`，但 `src/dispatcher/runtime-adapters.ts:126` 创建 orchestrator 时不读它，固定用默认 `maxParallelReads ?? 5`（`tool-orchestrator.ts:38`）。
- **影响**：想调并行度只能改 orchestrator 默认值，dispatch contract 形同虚设。
- **harness 参照**：`maxParallelToolCalls` 走 settings 段 + read-through getter，提交变更即刻影响下一组。

---

### 🟡 P2 —— 成本核算与可观测性（4 项）

#### P2-1 缓存命中未剥离做成本记账

- **现象**：`openai-chat-transformer.ts:315-329` **已正确解析** DeepSeek 扁平 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`，但 `agent-kernel.ts:220-224` 聚合 usage 只累加 prompt/completion/total；预算层 `budget-store.ts` 只有 `tokens_used` 累计。价格模型 `ModelPricing.cacheReadPerMTok`（`llm/types.ts:262-263`）已存在，usage 层未接上。
- **影响**：账单/预算显示含缓存的 prompt_tokens，缓存省钱效果不可见、无法按 cacheRead 折扣计价。
- **harness 参照**：`mapUsage` 去折叠 —— `inputTokens = prompt_tokens - cacheRead`，`cacheReadTokens` 独立桶。

#### P2-2 `computeCacheKey` 死代码 + 无前缀漂移检测

- **现象**：`src/kernel/model-input/model-input-cache-key.ts:17-20` 定义了 A+B+C 哈希，但全 src 无引用；`model-input-snapshot-store.ts` 仅内存 Map 记录，无 DB 持久化；无跨回合前缀变更检测/告警。
- **影响**：前缀被意外破坏（模板变更、工具序变化）时无感知，缓存命中率下降无声无息。
- **harness 参照**：`request/header` 三态持久化 + invariant 强制"模型可见必可从日志重建"。

#### P2-3 纯 reasoning 轮次被当失败

- **现象**：`stream-aggregator.ts:99-101` `isEmpty` = 无 content 且无 toolCalls；纯 CoT 轮次（模型完全在 reasoning 通道回答）走 `agent-kernel.ts:966-968` 返回 `{ success: false }`。
- **影响**：DeepSeek v4-flash 等模型偶发纯 reasoning 回答（如打招呼）被记成失败回合。
- **harness 参照**：reasoning-only 轮次产出合法空消息（`content:""` + 不回传 reasoning），不 brick 会话。

#### P2-4 压缩 tokenBudget 硬编码 8000，不感知模型上下文窗口（**已决策：补 adapter 能力**）

- **现象**：`src/runtime/resource-limits.ts:72` `maxContextTokens: 8000` 固定默认；压缩触发阈值（`agent-kernel.ts:1460-1476`，利用率 >0.8）据此计算，不感知实际模型的 contextWindow。
- **影响**：DeepSeek 1M 上下文场景下 8000 token 即触发压缩，浪费长上下文能力、增加压缩成本。
- **处理（2026-08-13 决策）**：本地 LLM 适配器增加 contextWindow 能力（新增前置任务 Fix-P0-4），压缩阈值改为 `min(资源限额, contextWindow × ratio)`。
- **harness 参照**：压缩阈值按 `adapter.contextWindow × ratio` 缩放（默认 1M × 0.8）。

---

### 🟢 P3 —— 清理与一致性（3 项）

#### P3-1 休眠代码（**已决策：接线启用**）

- `src/memory/summary-prompt-builder.ts`、`src/memory/rolling-summary-policy.ts` 无生产调用者（仅测试引用），与 AGENTS.md 描述的滚动摘要能力不符。**处理（2026-08-13 决策）**：接线启用——在回合后异步调度接入 `createRollingSummaryPolicy` 判定，触发时经 `buildSessionSummaryPrompt` 生成摘要并写回 summaryManager（详见修复计划 Fix-P3-1）。

#### P3-2 默认值四处不一致 + 文档冲突（**已决策：以代码为准**）

- AGENTS.md 写"max 6 iterations, 120s"；实际 `foreground-agent.ts:57-58` = 20/360s、`kernel-config-builder.ts:200` = 5/60s、`api/context.ts:1033` = 10/30s，**四套默认值**需收敛为单一事实源。
- `feature-flags.ts:53-79` 默认 ON，与 `docs/architecture/MODEL_INPUT_ARCHITECTURE.md:518-522` 声称的 OFF 冲突；翻转该 flag 会改变 Segment B/C 内容、破坏前缀。**处理（2026-08-13 决策）**：以代码为准（默认 ON），改文档并补警示。

#### P3-3 LLM 出站请求无归因头

- `x-request-id` 仅存在于入站 API 中间件（`src/api/middleware/request-id.ts:30-34`）；LLM 出站请求头只有 Content-Type + Authorization（`providers.ts:254-258, 334-338`）。provider 故障无法关联本地请求。
- **harness 参照**：`x-deepseek-harness-user-id / session-id / compact` 归因头。

---

## 4. 汇总表

| # | 问题 | 优先级 | 核心证据位置 | harness 参照 |
|---|---|---|---|---|
| P0-1 | 抽取模型错误 | 🔴P0 | `api/context.ts:1053` | `prepareCall` 精确路由 |
| P0-2 | 错误分类/重试半成品 | 🔴P0 | `provider-errors.ts:31` | QUOTA 终止/Retry-After/退避 |
| P0-3 | reasoning 不回传 | 🔴P0 | `llm/types.ts:17` | `serializeAssistant` |
| P1-1 | foreground 工具排序缺失 | 🟠P1 | `tool-projection-mapper.ts:145` | `stableToolSort` |
| P1-2 | 90s 超时批量失效 | 🟠P1 | `agent-kernel.ts:1216` | per-tool timeout |
| P1-3 | 流式无 idle watchdog | 🟠P1 | `providers.ts:193` | `idleWatchdog` |
| P1-4 | 并行度不可配 | 🟠P1 | `runtime-adapters.ts:126` | `maxParallelToolCalls` |
| P2-1 | cacheRead 计费剥离 | 🟡P2 | `agent-kernel.ts:220` | `mapUsage` 去折叠 |
| P2-2 | 前缀指纹未持久化 | 🟡P2 | `model-input-cache-key.ts` | request/header + invariant |
| P2-3 | 纯 reasoning 当失败 | 🟡P2 | `stream-aggregator.ts:99` | reasoning-only 轮次 |
| P2-4 | 压缩阈值不感知窗口 | 🟡P2 | `resource-limits.ts:72` | `adapter.contextWindow` |
| P3-1 | 休眠代码 | 🟢P3 | `summary-prompt-builder.ts` | — |
| P3-2 | 默认值/文档不一致 | 🟢P3 | 多处 | — |
| P3-3 | 出站归因头 | 🟢P3 | `providers.ts:254` | `x-deepseek-*` 头 |

---

## 5. 附：harness 侧参考文件索引

| harness 文件 | 对应本地缺口 |
|---|---|
| `packages/llm/llm-deepseek/src/translate.ts`（mapUsage 去折叠） | P2-1 |
| `packages/llm/llm-deepseek/src/serialize.ts`（reasoning 回传规则 / thinking 解析） | P0-3 |
| `packages/llm/llm-deepseek/src/adapter.ts`（错误码分类 / Retry-After / idle watchdog / 归因头） | P0-2, P1-3, P3-3 |
| `packages/core/agent-loop/src/tool-calls.ts`（有界并行池 / 模型序提交 / 中止合成结果） | P1-2, P1-4 |
| `packages/core/agent-loop/src/invariant.ts`（请求可重建不变式） | P2-2 |
| `packages/compaction/compaction-basic/src/config.ts`（阈值按 contextWindow 缩放） | P2-4 |
