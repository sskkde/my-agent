# DeepSeek Harness 差距修复计划（Fix Plan）

> **Status**: ✅ Executed（全部完成，2026-08-13）
> **配套**: 问题清单见 [DEEPSEEK_HARNESS_GAP_REPORT.md](./DEEPSEEK_HARNESS_GAP_REPORT.md)
> **Last Updated**: 2026-08-13（执行完成）
> **执行结果**: 14 项全部落地——P0×3（+P0-4 前置）、P1×4、P2×4、P3×3。验证：`typecheck` ✅、`lint` 0 error ✅、`format:check` ✅、全部定向与全目录测试 ✅（106 文件 / 1953 用例）。
> **已确认决策**:
> 1. **P3-1 滚动摘要**：接线启用（不删除）。✅ 已实施
> 2. **P3-2 feature-flag**：以代码为准（默认 ON），改文档不改代码。✅ 已实施
> 3. **P2-4 contextWindow**：本地 LLM 适配器增加 contextWindow 能力（新增 Fix-P0-4 前置任务）。✅ 经 `ModelInfo.limits.contextTokens` 落地
> **执行原则**: ① 每项独立可合并（small focused changes）；② 禁止 `as any`/`@ts-ignore`；③ 每项完成跑 `npm run typecheck` + 相关测试套件；④ P0 各项之间无依赖，可并行开工。

---

## 阶段划分

| 阶段 | 内容 | 预估总量 | 触发条件 |
|---|---|---|---|
| **Phase 0** | P0-1 / P0-2 / P0-3 / P0-4 | ~3 人日 | 立即 |
| **Phase 1** | P1-1 ~ P1-4 | ~2 人日 | Phase 0 完成 |
| **Phase 2** | P2-1 ~ P2-4 | ~3 人日 | Phase 1 完成 |
| **Phase 3** | P3-1 ~ P3-3 | ~1.5 人日 | Phase 2 完成后按需 |

每阶段结束的验证门槛：`npm run typecheck` ✅ + `npm run test:unit` ✅ + `npm run test:model-input` ✅（涉及模型输入的项）+ `npm run test:integration` ✅（涉及存储的项）。

---

## Phase 0（P0，立即）

### Fix-P0-1 长时记忆抽取继承会话模型

- **目标**: 抽取调用的 provider/model 与会话实际路由一致，删除 `gpt-4o-mini` 硬编码回退。
- **现状**: `api/context.ts:1053-1060` 创建 scheduler 不传 model；`extractor-service.ts:39` `DEFAULT_MODEL = 'gpt-4o-mini'`。
- **实施方案**:
  1. 在 `processor-orchestration.ts` 的 `scheduleAfterTurn` 调用点（:487-493），把当前会话已解析的 `providerId`/`modelId`（turn 上下文中已有，`resolveProviderAndModel` 的产物）传入 scheduler 的 schedule 参数。
  2. `long-term-memory-scheduler.ts` 的 schedule 接口增加可选 `{ providerId, modelId }`，透传至 `extractor-service.ts:181-198` 的 LLM 请求构造。
  3. `extractor-service.ts` 改为：显式传入时用之；未传入时**抛错或跳过**（删除静默 `gpt-4o-mini` 回退）——与 AGENTS.md "Provider precedence: session → agent config → user defaults → env" 的继承语义一致。
  4. 确认抽取请求补 `maxTokens`（当前无任何输出上限，见 Fix-P2 补充）。
- **涉及文件**: `src/api/context.ts`、`src/processing/processor-orchestration.ts`、`src/memory/long-term-memory-scheduler.ts`、`src/memory/long-term-memory-extractor-service.ts`。
- **验证**: ① `npm run typecheck`；② `npm run test:unit -- tests/unit/memory`（若存在抽取相关用例，需同步更新期望模型）；③ 手工跑一轮对话，观察抽取请求的 model 字段与会话一致。
- **风险**: 低。异步路径（queueMicrotask）不影响消息处理主路径。注意：会话若用 DeepSeek 而抽取 prompt 依赖 OpenAI 特有 response_format，需确认 DeepSeek 支持 `json_object`（harness 的 structured_json 映射可参考，实施时验证）。
- **估时**: 0.5 人日。

### Fix-P0-2 LLM 错误分类补全 + 重试接通

- **目标**: 401 单独分类；余额不足/QUOTA 终止不重试；429 尊重 `Retry-After`；同 provider 指数退避重试（消费现有 `retries` 配置）。
- **现状**: `provider-errors.ts:31-60` 三档分类 + 硬编码 60s；`adapter.ts` 的 retryPolicy/`provider-resolver.ts:379` retries 死配置；`recovery/retry-executor.ts` 退避引擎未接入。
- **实施方案**:
  1. **分类表**（`provider-errors.ts`）：新增 `401/403 → connector_auth_error`（recoverable: false）；响应体/`insufficient`/`quota`/`balance` 关键词或状态码 402 → 新错误码 `QUOTA_ERROR`（recoverable: **false**，不再换 provider 重试）。同时清理 `openai-adapter.ts`/`openrouter-adapter.ts` 里的重复实现，统一 import（消除三份拷贝）。
  2. **Retry-After**：在 `providers.ts` 的 `complete()` 响应处理处读取 `Retry-After` 头（秒数或 HTTP 日期），覆盖硬编码 60s，写入 `error.technical.retryAfterMs`。
  3. **重试接通**：在 `src/llm/adapter.ts` 的 `complete()`/`stream()` 内，对单 provider 失败使用 `recovery/retry-executor.ts` 的指数退避（`initialDelay * 2^n + jitter`），次数取 `ProviderConfig.retries`（resolver 已解析，`provider-resolver.ts:379`）；仅当 `recoverability === 'retryable_later'` 且未超次数才重试，之后才进入多 provider failover。
  4. **重试计数归因**：重试/换 provider 事件追加到 observability（现有 trace/audit 结构）。
- **涉及文件**: `src/llm/transform/provider-errors.ts`、`src/llm/providers.ts`、`src/llm/adapter.ts`、`src/llm/openai-adapter.ts`（删重复实现）、`src/llm/openrouter-adapter.ts`（同上）、`src/recovery/retry-executor.ts`（按需导出复用）、`src/shared/errors.ts`（错误码注册）。
- **验证**: ① `npm run typecheck`；② `npm run test:unit -- tests/unit/llm`（若存在）；③ mock provider 下注入 429/500/402 响应验证分类与重试次数（`src/llm/mock-provider-*` 已有观测设施）；④ `npm run test:integration`。
- **风险**: 中。重试接入可能改变现有超时预算（重试时间计入 turn 总 timeout，需确认重试与 `callLLMWithTimeout` 的交互）；QUOTA 终止语义会改变现有 failover 行为（此前 402 会换 provider）。
- **估时**: 1 人日。

### Fix-P0-3 reasoning_content 工具轮次回传

- **目标**: DeepSeek thinking 模式下，工具调用轮次的 reasoning 随历史回传；无工具轮次不回传（省 token）。
- **现状**: `llm/types.ts:17-23` `LLMMessage` 无 reasoning 字段；`agent-kernel.ts:227-232` 不记 reasoning；解析侧已就绪（`openai-chat-transformer.ts:336-339`）。
- **实施方案**:
  1. `LLMMessage` 增加可选 `reasoningContent?: string`。
  2. `agent-kernel.ts` 的 `commitTranscript('llm_response')` 与 `buildTranscriptMessages` 补 reasoning 传递；kernel 历史消息构造时携带上一轮 `completedResult.reasoningContent`（该字段已在 `agent-kernel.ts:457-458` 捕获）。
  3. 序列化侧（`providers.ts` 的 `buildRequestBody` 或 openai-chat-transformer 的消息转换）：**仅当该 assistant 消息带 toolCalls 时**输出 `reasoning_content`，否则省略。空字符串 reasoning 不输出。
  4. 确认流式与非流式路径均生效；`TRUNCATED_TOOL_CALL`/截断轮次的 reasoning 不回收。
- **涉及文件**: `src/llm/types.ts`、`src/llm/transform/openai-chat-transformer.ts`、`src/llm/providers.ts`、`src/kernel/agent-kernel.ts`、`src/kernel/types.ts`（transcript 类型）。
- **验证**: ① `npm run typecheck`；② `npm run test:unit -- tests/unit/kernel tests/unit/llm`；③ `npm run test:model-input`（reasoning 不合并 content 的红线测试，反模式 #17 已有测试守护，需确认不回退）；④ 若 e2e 环境有 DeepSeek key，跑 `npm run test:e2e` 的多步工具场景。
- **风险**: 中。触碰 transcript 与消息构造链路，需保证 replay/projection 不受影响（reasoning 进入消息但不进 `content` 文本）；需保持"reasoning 绝不并入 content"红线。
- **估时**: 1 人日。

### Fix-P0-4 LLM 适配器暴露 contextWindow 能力（P2-4 前置）

- **目标**: 本地 LLM 适配器（provider/model 解析结果）暴露模型上下文窗口大小，供压缩阈值缩放使用。**已决策：必须补此能力。**
- **现状**: 本地 `LLMResolvedModelInfo`/adapter 未暴露 contextWindow（harness 侧 `DeepSeekCatalogModel.contextWindow` + `defaultContextWindow` 为参照）。
- **实施方案**:
  1. 在 LLM 适配器接口与 `resolveModelInfo`/`resolveModel` 返回类型增加可选 `contextWindow?: number`（harness 语义：模型精确容量优先，缺省回落 adapter 级默认）。
  2. DeepSeek provider 目录配置（`src/llm/catalog/domestic-providers.ts` 附近）为已知模型补容量（按实际部署配置，默认可取 128K，1M 模型显式标 1M）。
  3. 其余 provider（OpenAI/OpenRouter 等）按各自已知窗口配置，未知则留空（消费侧回退现有 8000 资源限额）。
- **涉及文件**: `src/llm/types.ts`、`src/llm/adapter.ts`（接口）、`src/llm/catalog/`（各 provider 目录）、`src/llm/routing/provider-resolver.ts`（解析透传）。
- **验证**: ① `npm run typecheck`；② `npm run test:unit -- tests/unit/llm`；③ 单元断言 DeepSeek 模型解析结果携带 contextWindow。
- **风险**: 低。纯增量字段，不改变现有路由行为。
- **估时**: 0.5 人日。

---

## Phase 1（P1，前缀稳定性与超时）

### Fix-P1-1 foreground 工具确定性排序

- **目标**: foreground 主路径工具按 `stableToolSort` 排序，保证 `LLMRequest.tools` 字节序稳定。
- **改法**: 在 `model-input-builder.ts:605-614` `extractToolsForRequest` 出口（或 `tool-projection-mapper.ts:145` 投影构建处）统一调用 `stableToolSort`。选出口处改的理由：所有消费方（foreground/kernel/子路径）一次性收敛。
- **涉及文件**: `src/kernel/model-input/model-input-builder.ts`、`src/tools/tool-schema-canonicalizer.ts`（复用）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/kernel` + `npm run test:model-input`（前缀哈希相关快照若存在需刷新）。
- **风险**: 低。排序确定性增强，理论上可改变现有缓存前缀——发布前用 P2-2 的前缀指纹观测确认命中率变化。
- **估时**: 0.25 人日。

### Fix-P1-2 恢复 90s per-tool 超时语义

- **改法**: `agent-kernel.ts:1216-1219` `dispatchExternalBatch` 的 `executionPolicy` 补 `timeoutMs`；实现方式二选一：① 批量内逐工具映射 `PER_TOOL_TIMEOUT_MS`（需 kernel-dispatcher-adapter 支持 per-toolUse timeoutMs，`toolUse.timeoutMs` 字段已存在于 dispatch contract）；② 简化：取批量内 max(PER_TOOL_TIMEOUT_MS[name]) 作为整批超时。
- **涉及文件**: `src/kernel/agent-kernel.ts`、`src/kernel/kernel-dispatcher-adapter.ts`、`src/tools/runtime/tool-dispatch-contract.ts`（若走 per-tool）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/kernel`；mock 下用慢工具验证超时生效时点。
- **风险**: 低。
- **估时**: 0.5 人日。

### Fix-P1-3 流式 idle watchdog

- **改法**: 在 `providers.ts` `readStreamLines`（:193-230）加每 chunk 空闲超时：每次收到数据重置 timer，空闲超阈值（默认 300s，可配 `streamIdleTimeoutMs`）则 abort 并抛 `TIMEOUT` 错误码（与 `provider-errors` 分类对齐）。复用 `shared/timeout`（若有）或最小实现。
- **涉及文件**: `src/llm/providers.ts`、`src/llm/types.ts`（配置字段）、`src/llm/provider-runtime.ts`（配置透传）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/llm`；mock provider 注入"发一半停住"的流验证超时。
- **风险**: 低。
- **估时**: 0.5 人日。

### Fix-P1-4 并行度接入 dispatch contract

- **改法**: `runtime-adapters.ts:126` 读 `payload.executionPolicy?.maxConcurrency`，传为 orchestrator 的 `maxParallelReads`（先校验 ≥1 整数）；`allowParallelReadOnly` 语义与现状（读并行/写串行）保持一致。
- **涉及文件**: `src/dispatcher/runtime-adapters.ts`、`src/tools/runtime/tool-orchestrator.ts`（构造参数）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/tools`（orchestrator 用例）。
- **风险**: 低。
- **估时**: 0.5 人日。

---

## Phase 2（P2，成本核算与可观测性）

### Fix-P2-1 cacheRead 计费剥离

- **改法**: `agent-kernel.ts:220-224` `aggregatedUsage` 增加 `promptCacheHitTokens`/`promptCacheMissTokens` 累加；`KernelRunResult.tokenUsage` 增加 cacheRead 字段；预算/用量存储层（`budget-store.ts`）增加 `cache_read_tokens` 列（走 `all-stores-migrations.ts` 新版本）并按 `ModelPricing.cacheReadPerMTok` 折扣计价展示。
- **涉及文件**: `src/kernel/agent-kernel.ts`、`src/kernel/types.ts`、`src/memory/budget-store.ts`（如存在）、`src/storage/all-stores-migrations.ts`（v77+）、`src/llm/types.ts`（TokenUsage 已有字段，复用）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/kernel tests/unit/storage` + `npm run test:integration`（迁移）; 迁移需加 backward-compat 测试。
- **风险**: 中（涉及存储迁移）。
- **估时**: 1 人日。

### Fix-P2-2 前缀指纹持久化 + 漂移告警

- **改法**: ① 把 `model-input-cache-key.ts` 的 `computeCacheKey` 接回 `model-input-builder.ts` 的 build 出口；② 新增 `model-input-prefix-store`（或复用现有 storage 表）持久化 `(tenant_id, agent_profile, provider_family, output_contract) → prefix_hash + first_seen + last_seen`；③ build 时对比，哈希变化记 `prefix_drift` 事件进 observability（低噪音告警，不计入消息处理失败）。
- **涉及文件**: `src/kernel/model-input/model-input-cache-key.ts`、`model-input-builder.ts`、`src/storage/all-stores-migrations.ts`、`src/observability/`（事件）。
- **验证**: `npm run typecheck` + `npm run test:model-input` + `npm run test:integration`。
- **风险**: 中（存储 + 主路径开销，需保证 drift 检测 best-effort、绝不破坏消息处理——反模式 #11）。
- **估时**: 1 人日。

### Fix-P2-3 纯 reasoning 轮次合法化

- **改法**: `stream-aggregator.ts` 的 `isEmpty` 判定改为"无 content 且无 toolCalls **且无 reasoningContent**"；kernel 对"空 content 但有 reasoning"的完成态产出合法空 assistant 消息（content: ''），不再 `success: false`。序列化时空 content 消息按 harness 规则（`content: ''` 非 null）。
- **涉及文件**: `src/llm/stream-aggregator.ts`、`src/kernel/agent-kernel.ts`、`src/llm/providers.ts`（空消息序列化）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/kernel tests/unit/llm` + `npm run test:model-input`。
- **风险**: 低。
- **估时**: 0.5 人日。

### Fix-P2-4 压缩阈值感知模型上下文窗口

- **改法**: 依赖 Fix-P0-4 的 contextWindow 能力。① provider/model 解析结果注入 kernel 运行配置；② `checkCompactTrigger`（`agent-kernel.ts:1460-1476`）与 `context-manager.ts:349-378` 的 tokenBudget 改为 `min(资源限额, adapter.contextWindow × ratio)`；contextWindow 未知时回退现有 8000。
- **涉及文件**: `src/runtime/resource-limits.ts`、`src/kernel/agent-kernel.ts`、`src/context/context-manager.ts`（contextWindow 能力见 Fix-P0-4）。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/kernel tests/unit/context`。
- **风险**: 中。依赖 P0-2 后 adapter 能力模型是否稳定；压缩阈值变化会影响既有会话的压缩时机。
- **估时**: 1 人日。

---

## Phase 3（P3，清理与一致性，按需）

### Fix-P3-1 滚动摘要接线启用（已决策）

- **方案**（已决策：启用，不删除）:
  1. 在 `processor-orchestration.ts` 回合后异步调度处（:485-493，与 `long-term-memory-scheduler` 的 `scheduleAfterTurn` 并列）接入 `createRollingSummaryPolicy`（`src/memory/rolling-summary-policy.ts`，触发条件已实现：maxTurns=10 / topicShift 0.7 / token_pressure / minTurnsBetween=5）。
  2. 触发时用 `buildSessionSummaryPrompt`（`src/memory/summary-prompt-builder.ts`）构造 LLM 请求，**补 maxTokens/temperature 约束**（对齐 harness 辅助调用成本控制；当前 builder 产物无任何输出上限）。
  3. 摘要结果写回 summaryManager（与 compaction 摘要同一存储），下一轮经 Segment D summaryBlocks 注入（`compact-summary-rendering.ts` 同路径）。
  4. 保持异步 fire-and-forget + best-effort（反模式 #11：不得阻塞消息处理主路径）；失败吞错记 observability。
  5. 补齐生产接线测试（现有 `tests/unit/memory`、`tests/integration/memory` 仅覆盖纯函数）。
- **涉及文件**: `src/processing/processor-orchestration.ts`、`src/memory/rolling-summary-policy.ts`、`src/memory/summary-prompt-builder.ts`、`src/api/context.ts`（scheduler 接线）、`src/memory/summary-manager.ts`。
- **验证**: `npm run typecheck` + `npm run test:memory-*` + `npm run test:integration`。
- **风险**: 中。异步调度新增一条 LLM 消耗路径，需确认模型路由与限流策略；抽取模型继承（Fix-P0-1）的产物需同样应用到摘要调用。
- **估时**: 1.5 人日。

### Fix-P3-2 默认值收敛与文档对齐（以代码为准）

- **方案**（已决策：feature-flag 默认值以代码为准 ON）:
  1. 确定前台回合唯一事实源（建议 `kernel-guard-constants.ts`），删除 `foreground-agent.ts:57-58`、`kernel-config-builder.ts:200`、`api/context.ts:1033` 三处本地默认，统一引用常量。
  2. AGENTS.md 的 "6/120s" 更新为收敛后的实际值。
  3. 修正 `docs/architecture/MODEL_INPUT_ARCHITECTURE.md:518-522`：feature-flag 默认值描述改为 **ON**（与 `feature-flags.ts:53-79` 一致），并补充"翻转即破坏前缀"的警示。
- **验证**: `npm run typecheck` + `npm run doc-sync`。
- **估时**: 0.5 人日。

### Fix-P3-3 LLM 出站归因头

- **方案**: `providers.ts` 出站请求头增加 `x-request-id`（复用 `api/middleware/request-id.ts` 的生成逻辑或 crypto.randomUUID），并随 `LlmError.technical` 持久化 provider 返回的 `x-request-id`/`x-deepseek-request-id` 响应头；kernel run/observability 侧带上 requestId 便于对账。
- **验证**: `npm run typecheck` + `npm run test:unit -- tests/unit/llm`。
- **估时**: 0.5 人日。

---

## 依赖关系

```
P0-1 ──┐
P0-2 ──┼─→ Phase1 ──→ Phase2（P2-4 依赖 P0-4 的 contextWindow 能力；P2-2 受益于 P1-1 排序稳定）
P0-3 ──┘
P0-4 ──→ P2-4
```

- P1-1 先行会让 P2-2 的前缀指纹基线更干净（排序稳定后哈希才有可比性）。
- P0-4（adapter contextWindow 能力）是 P2-4 的硬前置。
- P3-1（滚动摘要接线）建议在 P0-1 完成后实施：摘要调用的模型继承与抽取同源（避免再引入一次 gpt-4o-mini 式回退）。

## 验证总门（每阶段完成后）

```bash
npm run typecheck && npm run lint && npm run test:unit
npm run test:model-input          # 涉及模型输入/前缀的项
npm run test:integration          # 涉及存储/迁移的项（--maxWorkers=1）
npm run test:web                  # 涉及 web 类型的项
```

禁止事项沿用仓库红线：不 `as any`、不 `@ts-ignore`、不留 TODO、迁移必须向后兼容、观测类改动 best-effort 不得破坏消息处理（反模式 #11）。
