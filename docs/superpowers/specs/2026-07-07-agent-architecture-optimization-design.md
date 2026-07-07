# Agent Architecture Optimization Design

> Date: 2026-07-07
> Status: Draft for review
> Scope: Current agent project architecture optimization, guided by Appendix A: Advanced Prompting Techniques from Agentic Design Patterns

## 背景

用户希望对照 Appendix A: Advanced Prompting Techniques 的思想，规划当前 agent 项目的优化方向，并明确要求以架构优先为侧重点。

参考文档的核心观点不是简单写更长的 prompt，而是将 prompt、上下文、结构化输出、工具调用、推理过程和评估反馈当作系统工程组件治理。当前项目已经具备较完整的基础，包括七层 `ModelInputBuilder`、prompt template registry、tool guardrails、memory projection、summary layers、provider fallback、tool loop 和安全测试。下一阶段的重点应从新增能力转为架构收敛、契约加固和可评估演进。

## 目标

- 统一所有生产 LLM 调用的模型输入构造路径，确保真实 `ModelInputBuilder` 是唯一主干。
- 将结构化输出从 prompt 描述提升为运行时校验契约。
- 将 LLM-facing 工具定义收敛到 `ToolRegistry` 中的真实 schema，减少空 schema 或重复 catalog 路径。
- 将 context engineering 能力从已实现但多 feature flag 的状态推进到可观测、可回滚、可分阶段启用的稳定管线。
- 建立结构化 ReAct trace 和真实 decision trace，提升工具选择、观察结果和最终回答的可解释性。
- 建立 prompt 生命周期治理能力，包括 golden dataset、prompt/template 变更回归和离线优化候选流程。

## 非目标

- 不在第一阶段引入 Tree of Thoughts 或默认 Self-Consistency。
- 不默认保存完整原始 Chain of Thought。
- 不把优化等同于扩写 prompt 或增加大量否定约束。
- 不在结构化输出 validator 缺位时继续扩大 JSON output 依赖面。
- 不在 memory 注入策略和评估集稳定前优先引入复杂向量/RAG 后端。
- 不自动让 LLM 修改生产 prompt；自动 prompt 优化只能产生候选，必须通过评估和人工 review。

## Appendix A 思想映射

| 文档思想 | 对当前项目的架构启示 |
| --- | --- |
| Clarity and Specificity | 用明确的模式、schema、版本和边界替代模糊自然语言规则。 |
| Instructions Over Constraints | 优先定义正向执行策略，只在安全和格式边界使用必要约束。 |
| Context Engineering | 将 system prompt、工具投影、memory、summary、transcript 和 runtime environment 视为动态上下文管线。 |
| Structured Output | LLM 输出必须先解析和校验，再进入业务处理。 |
| Tool Use / Function Calling | 工具选择应由真实 schema、权限边界和最小投影共同控制。 |
| ReAct | 将 Thought/Action/Observation 抽象为可审计 trace，而不是只看最终文本。 |
| Step-back / CoT | 只在复杂规划、高风险操作和多工具冲突场景启用受控推理增强。 |
| APE / DSPy | 用 golden set 和离线候选优化 prompt，而不是在线自动替换。 |

## 当前架构观察

### 已有基础

- `docs/architecture/MODEL_INPUT_ARCHITECTURE.md` 定义了七层、四 segment 的模型输入架构。
- `src/kernel/model-input/model-input-builder.ts` 已实现 Layer 1 到 Layer 7 的 prompt 构造。
- `src/api/context.ts` 创建真实 `ModelInputBuilder`，并注入 `AgentKernel`、`SearchSubagent` 和 long-term memory extraction scheduler。
- `src/foreground/tool-projection-mapper.ts` 已支持从 `ToolRegistry` 转换真实 LLM tool schema。
- `docs/architecture/PROMPT_MEMORY_ENHANCEMENT_ARCHITECTURE.md` 和 `docs/reports/PROMPT_MEMORY_ENHANCEMENT_EXECUTION_REPORT.md` 已覆盖 persona、tool selection policy、memory policy、summary layer 等 P10 能力。
- `src/foreground/tool-projection-mapper.ts`、`src/kernel/agent-kernel.ts`、`src/kernel/tool-result-pairing-guard.ts` 已包含多处 tool guardrail 和 tool-result pairing 防护。

### 主要问题

- `src/foreground/kernel-config-builder.ts` 中仍存在 `createMinimalModelInputBuilder()` stub。如果该路径仍可被生产调用，会绕过七层模型输入主干。
- `src/api/tool-catalog.ts#getToolDefinitions()` fallback 仍返回空参数 schema，可能让 LLM-facing 工具定义退化。
- `src/foreground/foreground-agent.ts` 的 `CreateForegroundAgentOptions` 包含若干未使用的旧依赖，容易造成边界理解混乱。
- 结构化输出更多依赖 prompt 合同和测试约束，缺少统一运行时 schema validator。
- P10 prompt/memory 能力大量由 feature flag 门控，后续需要明确 rollout 生命周期和观测指标。
- `decisionTrace` 当前仍偏占位，completed 分支基本固定为 `answer_directly`，不足以解释工具选择或执行路径。

## 推荐路线

推荐采用“架构收敛优先”路线。

该路线先统一主干和契约，再引入推理增强和自动优化。它短期看起来不像直接提升智能能力，但能确保后续 CoT、Step-back、ReAct trace、APE/DSPy 都建立在稳定、可测试、可回滚的系统边界上。

### 备选路线对比

| 路线 | 内容 | 优点 | 风险 |
| --- | --- | --- | --- |
| 架构收敛优先 | 统一 ModelInputBuilder 主干、schema validator、tool schema、context rollout | 低风险、高杠杆、便于长期演进 | 短期质量提升不如推理增强直观 |
| 推理能力优先 | 优先加入 Step-back、CoT 摘要、多路径探索、ReAct trace | 对复杂任务质量提升明显 | token 成本和调试复杂度上升，基础契约不稳会放大问题 |
| 评估平台优先 | 先建 golden dataset、prompt 版本评估、离线 prompt optimizer | 长期治理最稳 | 如果主路径仍分叉，评估覆盖会不完整 |

## 设计方案

### 1. 统一模型输入主干

`ModelInputBuilder` 应成为所有生产 LLM 请求的唯一模型输入构造入口。

具体方向：

- 审计 `src/foreground/kernel-config-builder.ts` 是否仍被生产链路调用。
- 如果仍使用该路径，将 `createMinimalModelInputBuilder()` 替换为真实 `ModelInputBuilder` 依赖注入。
- 如果该路径已废弃，移除或显式标记为测试/迁移路径，并增加保护避免生产误用。
- 清理 `CreateForegroundAgentOptions` 中未使用字段，或为其补齐实际用途，避免维护者误解 ForegroundAgent 直接构造 prompt。
- 建立 LLM call path 清单，覆盖 foreground、kernel、search subagent、memory extractor、subagent context manager。

目标状态：

- 所有生产请求都能追踪到真实 `ModelInputBuilder.build()`。
- 所有 LLM 请求都能记录 mode、segment hash、agentType、agentProfile、providerFamily 和 outputContract。
- legacy prompt 构造路径不可静默进入生产。

### 2. 强化结构化输出契约

结构化输出不应只写在 prompt 中，还应在运行时成为 parse boundary。

具体方向：

- 为 `outputContract:*` 定义运行时 validator，建议优先使用项目内轻量 schema 校验实现，后续再评估是否引入 Ajv 等依赖。
- 所有 structured JSON 输出遵循 parse -> validate -> domain mapping 的边界。
- 解析失败、schema 失败、未知枚举、缺少字段、额外高风险字段都映射为统一错误类型。
- 保留 malformed JSON repair retry，但 repair 后仍必须通过 validator。
- 记录 schema failure rate、repair success rate、unknown enum rate 和 fallback rate。

目标状态：

- prompt 中的 output contract 与运行时校验保持同步。
- LLM 输出不能以半结构化对象绕过业务边界。
- 失败原因可观测、可统计、可回归测试。

### 3. 收敛工具 schema 单一事实源

工具 schema 应以 `ToolRegistry` 为单一事实源，fallback catalog 只能作为只读展示或降级说明，不应成为主生产 schema 来源。

具体方向：

- 审计 `src/api/tool-catalog.ts#getToolDefinitions()` 的实际调用面。
- 对生产 LLM tool definition 优先使用 `ToolRegistry.listTools()` 与 `toLLMToolDefinition()`。
- 对缺失 schema 的工具在测试或启动期失败，避免运行时静默暴露 `{ type: 'object', properties: {} }`。
- 将工具投影规则文档化为 envelope ∩ safe/default ∩ workdir/session policy ∩ registry known tools。
- 保留 `search_subagent` 优先于 `web_search` 的偏好，但将其纳入 tool selection policy 或投影规则文档。

目标状态：

- LLM 看到的每个 callable tool 都有真实参数 schema。
- tool guardrail 的边界由代码和测试双重保证。
- hallucinated tool、unprojected tool、unknown tool 都有统一拒绝和指标。

### 4. 稳定上下文工程管线

当前项目已经有 context bundle、summary layers、memory policy、persona projection 和 tool selection policy。下一步重点是分阶段启用和治理，而不是继续扩大上下文内容。

具体方向：

- 为 Segment D 建立上下文优先级：当前用户消息、pinned constraints、active workdir/runtime、recent transcript、summary、long-term memory。
- 为每类上下文配置 token budget 和裁剪策略。
- 为 memory 注入增加 provenance：source type、source ref、freshness、relevance reason。
- P10 相关 feature flag 从 shadow 开始，逐步进入 canary，再进入默认启用。
- 记录 context token usage、memory injected count、summary hit rate、dropped context reason。

目标状态：

- 上下文注入可解释、可裁剪、可回滚。
- 长会话不会因为无界上下文膨胀破坏 token budget。
- memory 不只是被检索出来，还能解释为什么进入本次模型输入。

### 5. 建立结构化 ReAct trace

ReAct 的价值在于让工具行动过程可解释。项目应保存结构化决策摘要，而不是保存完整隐私敏感或高 token 的原始推理链。

具体方向：

- 扩展 foreground/kernel 的 trace 数据结构，包含 route、intent、candidate tools、selected tools、rejected tools、tool observations、final answer source。
- 将 `ForegroundTurnResult.decisionTrace` 从固定 `answer_directly` 演进为真实执行摘要。
- 对高风险工具记录 risk reason、approval status 和 denial reason。
- 对 search/memory/file read 等 read/search 工具记录 evidence summary，而不是倾倒完整工具结果。
- 在 trace 中保留受控 reasoning summary，不保存完整 CoT。

目标状态：

- 开发者能解释一次回复为什么调用或拒绝某个工具。
- 用户可见文本保持简洁，调试链路拥有足够证据。
- trace 可用于后续 golden set 和 prompt 回归。

### 6. 建立 prompt 生命周期治理

prompt 优化应从经验调整变为可评估的工程流程。

具体方向：

- 建立 golden dataset，覆盖直接回答、工具选择、权限拒绝、schema repair、memory retrieval、search evidence、provider fallback。
- 每个 golden case 包含输入、期望工具、禁止工具、期望输出形态、必要上下文和安全边界。
- 对 prompt/template/feature flag 变更运行离线回归，输出 segment hash 变化、token 变化、工具选择变化、schema 失败率变化。
- APE/DSPy 风格优化只生成候选 prompt，不直接写入生产模板。
- 生产 prompt 变更必须通过 golden set、人工 review 和可回滚版本标记。

目标状态：

- prompt 不再依赖主观感觉迭代。
- 关键能力有回归样例保护。
- 模板变更的行为影响可比较、可审计。

## 阶段路线图

### Phase 0: 架构盘点与路径收敛

目标：确认 LLM 调用路径，消除或隔离绕过真实 `ModelInputBuilder` 的风险。

交付物：

- LLM call path inventory。
- `src/foreground/kernel-config-builder.ts` stub 路径处置方案。
- 未使用 ForegroundAgent option 字段清单。
- 最小回归测试覆盖生产 LLM 请求路径。

### Phase 1: 契约加固

目标：让结构化输出和工具 schema 成为运行时契约。

交付物：

- output contract runtime validator。
- 统一 structured output error 类型。
- tool schema 来源收敛到 `ToolRegistry`。
- 空 schema fallback 调用面清理或保护。

### Phase 2: Context Engineering Rollout

目标：让 P10 prompt/memory 能力进入可观测、可回滚的分阶段启用。

交付物：

- Segment D token budget policy。
- memory provenance 和注入理由。
- feature flag rollout checklist。
- context/memory 相关指标。

### Phase 3: ReAct Trace 与决策解释

目标：让工具选择、观察结果和最终回答来源可解释。

交付物：

- structured decision trace。
- tool selection/rejection reason。
- observation summary。
- foreground completed branch 的真实 `decisionTrace`。

### Phase 4: Prompt 评估与离线优化

目标：建立长期 prompt 治理能力。

交付物：

- golden dataset。
- prompt/template regression runner。
- segment/token/tool/schema diff report。
- 离线 prompt candidate workflow。

## 测试策略

- Unit tests 覆盖 validator、tool schema conversion、trace mapping、context budget policy。
- Integration tests 覆盖完整 foreground -> kernel -> LLM mock -> tool loop -> transcript persistence 链路。
- Security tests 覆盖 prompt injection、tool escalation、tenant leakage、secret redaction、workdir boundary。
- Golden tests 覆盖工具选择、禁止工具、schema 修复、memory 注入、search evidence、provider fallback。
- Snapshot tests 覆盖 segment hash 和关键 prompt segment 稳定性。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 移除 legacy/stub 路径导致测试或特殊注入场景失败 | 中 | 先做调用面 inventory，再分阶段替换，保留显式测试 helper。 |
| validator 过严导致可恢复输出失败 | 中 | 引入 repair retry、错误分类、canary 指标和 golden set。 |
| context/memory rollout 改变模型行为 | 高 | 继续使用 shadow/canary，记录 diff 和回滚开关。 |
| trace 记录泄露敏感信息或 CoT | 高 | 只保存 decision summary 和 evidence summary，沿用 redaction。 |
| prompt 评估成本上升 | 中 | golden set 分层，PR 阶段跑核心集，夜间跑扩展集。 |

## 验收标准

- 生产 LLM 请求均经过真实 `ModelInputBuilder.build()`。
- 不存在生产路径静默使用 minimal/stub model input builder。
- structured JSON 输出均有运行时 validator。
- LLM-facing callable tools 均有真实参数 schema。
- context 注入有优先级、预算、来源和裁剪原因。
- foreground/kernel 返回的 decision trace 能解释工具选择和最终回答来源。
- prompt/template/feature flag 变更能通过 golden set 或核心回归捕获行为差异。

## 下一步

建议先进入 Phase 0，完成 LLM call path inventory 和 `kernel-config-builder` stub 路径处置。Phase 0 完成后再拆分 Phase 1 的实现计划，避免在主路径尚未收敛前引入更多 prompt 或 reasoning 复杂度。
