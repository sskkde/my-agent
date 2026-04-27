# Lifecycle / Storage / Failure 文档补充说明

本次新增 4 份架构收口文档：

1. `planner_run_lifecycle_spec_v1.md`
   - 定义 Planner Agent Template 与 PlannerRun 的生命周期
   - 明确 PlannerRun 创建、复用、合并、取消、归档规则
   - 明确 PlannerRun 不直接执行工具，而是输出 RuntimeAction

2. `global_runtime_lifecycle_state_machine_v1.md`
   - 定义 ForegroundConversationRun、PlannerRun、ExecutionPlan、RuntimeAction、KernelRun、ToolExecution、SubagentRun、BackgroundSubagentRun、WorkflowRun、ApprovalRequest、WaitCondition 等状态机
   - 统一 active / waiting / terminal 状态语义
   - 明确审批、外部等待、取消、后台任务的跨对象状态映射

3. `storage_model_indexing_strategy_v1.md`
   - 定义 Event Store、Transcript Store、Summary Store、Long-term Memory Store、Plan Store、Runtime Stores、Artifact Store、Approval Store、Connector State Store、Trace / Audit / Metrics Store
   - 明确索引、持久化、上下文可见性和保留策略
   - 明确 ActiveWorkProjection 的投影来源

4. `failure_recovery_interrupt_cancellation_policy_v1.md`
   - 定义错误分类、可恢复性、取消、暂停、恢复、重试、审批拒绝、WaitCondition 超时、Connector 授权失效、重复事件幂等、Workflow 失败策略
   - 明确前台打断优先、工具必须终态、外部副作用不自动重放等原则

这些文档补齐后，架构定义阶段的横向一致性已经基本完整。
