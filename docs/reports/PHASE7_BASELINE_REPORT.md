# Phase 7 基线报告

> 创建日期：2026-05-20
> 创建人员：Sisyphus
> 基线分支：`feat/phase7-release-candidate`
> 基线来源：Phase 6 完成状态

---

## 1. 基线状态

### 1.1 环境信息

| 项目 | 值 |
|------|-----|
| 基线 Commit | 0850efd9cd95fc06f2ef473bb43336f19dc9e0f2 |
| P6 基线 Tag | v0.6.0-phase6 |
| P6 基线 Commit | ebce492 |
| 新分支 | `feat/phase7-release-candidate` |
| Node 版本 | 20 |
| 数据库 | SQLite WAL |
| CI 环境 | Ubuntu latest |

### 1.2 阶段状态

| 项目 | 状态 |
|------|------|
| P0 Phase | **Closed** |
| P1 Phase | **Closed** |
| Phase 3-A | **Closed** |
| Phase 3-B | **Closed** |
| Phase 4 | **Closed** |
| Phase 5 | **Closed** |
| Phase 6 | **Closed** |
| 当前阶段 | Phase 7 |

> Phase 6 于 2026-05-19 完成。详见 `docs/reports/PHASE6_COMPLETION_REPORT.md`。
> P7 入口 Commit 为 PR #9 的 squash merge。

---

## 2. 代码指标

### 2.1 文件统计

| 类别 | 数量 |
|------|------|
| 后端源文件 | ~180+ |
| 前端源文件 | ~120+ |
| 测试文件 | ~320+ |
| 迁移文件 | 50+ |
| 文档文件 | 40+ |

### 2.2 代码行数

| 类别 | 行数 |
|------|------|
| 后端 TypeScript | ~20,000+ |
| 前端 TypeScript/TSX | ~12,000+ |
| 测试代码 | ~35,000+ |

### 2.3 测试统计

| 指标 | 值 |
|------|-----|
| 后端单元测试 | 1736 tests, 72 files |
| 集成测试 | 2590 tests, 146 files |
| E2E 测试 | 309 tests, 18 files |
| 通过率 | 100% |

---

## 3. 架构摘要

### 3.1 核心组件

**后端模块** (src/):
- `api/` — Fastify API 服务器，路由，中间件
- `foreground/` — LLM 路由和消息处理
- `planner/` — 任务规划和编排
- `dispatcher/` — 任务派发
- `kernel/` — Agent 执行引擎
- `tools/` — 工具集成
- `permissions/` — 权限和审批（RBAC）
- `memory/` — 长期记忆和预算管理
- `workflows/` — 工作流引擎
- `triggers/` — 事件触发器
- `connectors/` — 外部连接器
- `observability/` — 可观测性
- `dead-letter/` — 死信队列
- `storage/` — SQLite 存储

**前端模块** (web/src/):
- `features/` — 功能 Tab 组件
- `components/` — 可复用 UI 组件
- `api/` — API 客户端（/api/v1/ 前缀）
- `hooks/` — React Hooks

### 3.2 API 端点统计

| 类别 | 端点数 |
|------|--------|
| Sessions | 8 |
| Workflows | 10 |
| Triggers | 8 |
| Approvals | 4 |
| Memory | 5 |
| Observability | 6 |
| Connectors | 4 |
| Providers | 6 |
| Agents | 5 |
| Auth | 3 |
| API Keys | 4 |
| Status | 4 |
| Tools | 2 |
| Logs | 2 |
| 其他 | 10+ |
| **总计** | **~80+** |

### 3.3 数据库架构

SQLite 数据库，WAL 模式，50+ 迁移版本，主要表包括：
- sessions, messages
- workflows, workflow_runs
- triggers, trigger_events
- approvals, approval_requests
- memories, memory_tombstones
- connectors, connector_instances
- dead_letter_queue
- providers, agent_configs
- api_keys, roles, permissions
- budgets, alerts

---

## 4. Phase 6 已完成功能

| 功能 | 状态 | 描述 |
|------|------|------|
| RBAC 权限控制 | ✅ | 3 层角色体系，资源级别权限 |
| API Key 管理 | ✅ | 创建、角色绑定、SHA-256 存储 |
| API 版本控制 | ✅ | /api/v1/ 前缀，旧版重定向 |
| GitHub 连接器 | ✅ | API Key / OAuth 认证 |
| Google 连接器 | ✅ | Calendar, Contacts, Docs |
| Web Search 连接器 | ✅ | 多后端支持 |
| 内存预算管理 | ✅ | 令牌、请求、存储预算 |
| Prometheus 指标 | ✅ | 指标导出 |
| OpenTelemetry 追踪 | ✅ | 分布式追踪 |
| 告警系统 | ✅ | 规则、状态、Webhook |

---

## 5. Phase 7 目标摘要

### 5.1 核心目标

Phase 7 聚焦于安全加固、生产就绪和发布候选准备工作，确保平台具备生产环境部署能力。

### 5.2 IN SCOPE

| 工作项 | 目标 | 优先级 |
|--------|------|--------|
| Security Hardening | 安全头、SSRF 保护、API Key 认证测试 | 高 |
| RBAC Full Coverage | 全路由权限覆盖（25 路由文件） | 高 |
| Docker Productionization | 生产级 Dockerfile、Compose | 高 |
| Performance Baseline | API 延迟基准测试 | 高 |
| API Contract Freeze | 响应封装、错误格式、分页、限流 | 高 |
| Release Documentation | 发布说明、回滚手册、检查清单 | 高 |
| Observability Docs | 指标、告警、审计文档 | 中 |
| CI Stabilization | CI 稳定性和修复 | 中 |

### 5.3 OUT OF SCOPE

| 降级项 | 原因 |
|--------|------|
| 新功能开发 | P7 为发布准备阶段 |
| PostgreSQL 迁移 | 后续阶段 |
| 多租户隔离 | 架构预留，未实现 |

---

## 6. 已知限制

### 6.1 架构限制

| 限制 | 影响 | 备注 |
|------|------|------|
| SQLite 单实例 | 无法水平扩展 | 可考虑 PostgreSQL 迁移 |
| 内存缓存无持久化 | 重启丢失 | 适合开发和小规模部署 |
| 无多租户隔离 | 单一用户空间 | 架构预留，未实现 |

### 6.2 功能限制

| 限制 | 影响 | 备注 |
|------|------|------|
| Mock 连接器 | 无真实外部集成 | 需实现实际连接器 |
| 本地文件访问 | 安全考虑 | 仅限可信环境 |
| 无 Web UI 国际化 | 仅英文/中文混合 | 后续可扩展 |

### 6.3 已知风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| ESLint 迁移规则放宽 | 代码风格可能不一致 | P7 建立 ESLint 基线 |
| 集成测试 CI 串行执行 | CI 时间较长 | 已配置 serial workers |
| Docker 构建条件执行 | CI 不验证 Docker | 手动部署验证 |

---

## 7. 相关文档链接

- [Phase 6 Baseline Report](./PHASE6_COMPLETION_REPORT.md)
- [Phase 6 Execution Report](./PHASE6_COMPLETION_REPORT.md)
- [Architecture Test Matrix](../architecture/ARCHITECTURE_TEST_MATRIX.md)
- [P0 Scope Declaration](../architecture/P0_SCOPE.md)
- [Phase 6 Scope](../architecture/PHASE6_SCOPE.md)

---

**基线状态**：已确立
**Phase 7 启动日期**：2026-05-20
