# Phase 3-A 基线报告

> 创建日期：2026-05-11
> 创建人员：Sisyphus
> 基线分支：`feat/phase3-runtime-hardening-beta`
> 基线来源：`master` (26f5b59)

---

## 1. 基线状态

### 1.1 环境信息

| 项目            | 值                                   |
| --------------- | ------------------------------------ |
| 基线 Commit SHA | `26f5b59`                            |
| 基线分支        | `master`                             |
| 新分支          | `feat/phase3-runtime-hardening-beta` |
| Node 版本       | v22.22.2                             |
| npm 版本        | 10.9.7                               |

### 1.2 P0 状态

| 项目     | 状态       |
| -------- | ---------- |
| P0 Phase | **Closed** |
| P1 Phase | **Closed** |
| 当前阶段 | Phase 3    |

> P0 于 2026-05-06 正式关闭。所有 P0-1 至 P0-6 工作项已完成。详见 `docs/architecture/P0_SCOPE.md`。

---

## 2. 基线验证结果

基线验证在 P0 收尾时已完成，以下为验证结果摘要：

### 2.1 构建与静态检查

| 检查项       | 命令                | 结果             |
| ------------ | ------------------- | ---------------- |
| 类型检查     | `npm run typecheck` | ✅ 通过          |
| P0 聚合测试  | `npm run test:p0`   | ✅ 14 用例通过   |
| 全量后端测试 | `npm test`          | ✅ 3587 测试通过 |

### 2.2 数据库验证

| 检查项     | 结果       |
| ---------- | ---------- |
| 数据库迁移 | ✅ 版本 14 |

### 2.3 黄金路径覆盖

P0 验收覆盖 11 条黄金路径（100%）：

1. Direct Chat
2. Read Tool + ResultRef
3. Write Tool + Approval
4. PlannerRun
5. Background Task
6. Workflow Runtime
7. Trigger Wakeup
8. Approval Resume
9. Interrupt / Cancel
10. Status Query
11. Restart / Recovery

---

## 3. Phase 3-A 目标摘要

### 3.1 核心目标

将 P0 基线推进到"运行时可信、安全可审计、测试可覆盖"的 Phase 3-A 状态。

### 3.2 IN SCOPE

| 加固线            | 目标                                           | 优先级 |
| ----------------- | ---------------------------------------------- | ------ |
| Dispatcher 幂等性 | in-flight 检测 + 全终态检测 + WriteActionClass | 高     |
| Recovery 孤儿扫描 | 孤儿运行扫描器 + 统一超时策略 + auto resume    | 高     |
| Tool Risk Policy  | tool-risk-policy.ts 标准化 + 写安全测试        | 高     |
| Architecture 测试 | 5 个 contract tests 补缺                       | 中     |
| E2E 测试          | flow-11-cancel-cascade                         | 中     |
| Planner 验证      | tool-failure replan 专项测试                   | 中     |

### 3.3 OUT OF SCOPE (降级到 Phase 3-B)

| 降级项           | 原因               |
| ---------------- | ------------------ |
| Web UI 产品化    | 核心运行时加固优先 |
| Storage 强化     | 核心运行时加固优先 |
| Retention Policy | 核心运行时加固优先 |
| Connector 扩展   | 核心运行时加固优先 |

---

## 4. 四领域审计摘要

基于深度代码审计，Phase 3-A 计划从"从零构建"校准为"增量加固"：

| 领域                   | 审计结论                                            | 真正缺口                                |
| ---------------------- | --------------------------------------------------- | --------------------------------------- |
| Dispatcher 幂等        | idempotencyKey 存储 + completed 检测已实现          | in-flight 检测、全终态检测、专项测试    |
| Cancel/Recovery        | CancellationCoordinator 级联 + Bootstrap 恢复已实现 | 孤儿扫描器、统一超时策略                |
| Permission/Tool Safety | PermissionEngine 强制调用已实现                     | tool-risk-policy 标准化、riskLevel 字段 |
| Planner Validation     | inline validation + replan 已实现                   | tool failure replan 专项测试            |

---

## 5. 执行策略

```
Wave 1 (基线 + 范围):
├── Task 1: 分支 + 基线报告 [DONE]
└── Task 2: 范围文档更新

Wave 2 (四条加固线并行):
├── Task 3: Dispatcher 幂等性加固
├── Task 4: Recovery 孤儿扫描 + 超时策略
├── Task 5: Permission Tool-Risk-Policy 标准化
├── Task 6: Architecture 测试补缺
└── Task 7: flow-11-cancel-cascade E2E

Wave 3 (集成 + 验收):
├── Task 8: Planner tool-failure replan 测试
├── Task 9: 测试矩阵更新 + 全量回归
└── Task 10: Phase 3-A 验收报告
```

---

## 6. 相关文档链接

- [P0 Scope Declaration](../architecture/P0_SCOPE.md)
- [P0 Execution Report](./P0_EXECUTION_REPORT.md)
- [Architecture Runtime Checklist](../architecture/ARCHITECTURE_RUNTIME_CHECKLIST.md)
- [Architecture Test Matrix](../architecture/ARCHITECTURE_TEST_MATRIX.md)
- [Phase 3-A Implementation Plan](../../.sisyphus/plans/phase3a-implementation.md)

---

**基线状态**：已确立
**Phase 3-A 启动日期**：2026-05-11
