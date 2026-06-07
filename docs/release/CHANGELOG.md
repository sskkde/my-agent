# 变更日志

本文档记录 Agent Platform 各版本的变更历史。

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [0.7.0-rc.1] - 2026-05-19

### 安全加固

#### 新增

- **ESLint + Prettier 配置** — 添加代码质量和格式化工具链，确保代码风格一致性
- **安全响应头中间件** — 使用 `@fastify/helmet` 添加安全头：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- **API Key 认证测试套件** — 完整覆盖 API Key 生命周期测试：
  - API Key 创建、使用、撤销
  - 角色映射（admin/user/service）
  - 无效/过期 Key 处理
- **SSRF 防护测试套件** — 覆盖私有地址、环回地址、链路本地地址、云元数据地址等场景
- **安全发布门禁测试** — 综合安全测试，确保发布前所有安全检查通过

#### 修复

- **重定向状态码修复** — 将旧版 API 路径重定向从 301（永久）改为 307（临时），保留 POST 请求体

#### 文档

- **已知安全限制文档** — 记录 5 项已知安全限制及建议修复方案

---

### 功能增强

#### 新增

- **RBAC 全路由覆盖** — 为所有 25 个路由文件添加 `requirePermission` 权限检查
- **Cursor 分页支持** — Sessions 端点支持 cursor 分页，向后兼容 offset 分页：
  - 新增 `CursorPaginatedResponse<T>` 类型
  - 新增 `CursorPaginationParams` 类型
  - 新增 cursor 编码/解码工具函数
- **Docker 生产化**：
  - API Dockerfile 优化（NODE_ENV=production）
  - Web 多阶段构建 + nginx 静态文件服务
  - Docker smoke test 脚本
- **性能 Smoke 测试** — CI 环境基线延迟测试：
  - `GET /api/v1/health` p95 < 200ms
  - `GET /api/v1/sessions` p95 < 1000ms
  - `POST /api/v1/sessions` p95 < 500ms
  - `GET /api/v1/tools` p95 < 200ms
- **备份恢复验证脚本** — 自动验证备份完整性和恢复流程

#### 改进

- **版本号统一** — 将 package.json、server.ts、openapi.yaml 三处版本号统一为 `0.7.0-rc.1`
- **API 契约锁定测试** — 确保 API 契约不被意外破坏

---

### 文档

#### 新增

- **Metrics 文档** — Prometheus 指标说明和使用指南
- **Alerting Runbook** — 告警配置和处理手册
- **Audit Retention 策略文档** — 审计日志保留策略和合规要求
- **性能基线文档** — CI 环境基线和阈值说明
- **恢复操作文档** — 数据库恢复步骤和故障排除
- **发布文档套件** — CHANGELOG、Release Notes、Rollback Runbook、Production Readiness Checklist

---

### 基础设施

#### 新增

- **P7 验证脚本** — `npm run test:p7` 执行 8 项检查
- **CI Workflow 更新** — GitHub Actions 新增 lint、security、performance 测试任务

#### 改进

- **Schema 完整性验证** — 更新迁移版本验证至 v50

---

### 前端优化

#### 改进

- **错误消息统一** — 统一错误消息格式，提供用户友好提示
- **加载状态优化** — 添加 skeleton/loading 指示器，防止重复提交

---

## [0.6.0] - 2026-05-13

### 安全与访问控制

#### 新增

- **RBAC 权限系统** — 3 层角色体系（admin/user/service）
- **API Key 管理** — 创建、管理、撤销 API Key
- **API Key 认证中间件** — 支持 Bearer Token 认证
- **SHA-256 哈希存储** — API Key 安全存储

### API 版本控制

#### 新增

- **API v1 前缀** — 所有端点使用 `/api/v1/` 前缀
- **旧版路径重定向** — `/api/` 自动重定向到 `/api/v1/`

### 连接器

#### 新增

- **GitHub 连接器** — 支持 API Key 和 OAuth 认证
- **Google Calendar 连接器** — OAuth2 认证
- **Google Contacts 连接器** — OAuth2 认证
- **Google Docs / Notion 连接器** — 文档操作支持
- **Web Search 连接器** — 多后端搜索支持
- **Mock 连接器模式** — 开发测试支持
- **私有 IP 阻止** — SSRF 防护

### 内存与预算

#### 新增

- **内存缓存层** — LRU/LFU 淘汰策略
- **预算管理器** — 周期性预算跟踪
- **资源限制强制执行**

### 可观测性

#### 新增

- **Prometheus 指标导出**
- **OpenTelemetry 分布式追踪**
- **告警系统** — 阈值/速率/缺失条件
- **Webhook 通知**

### 前端

#### 新增

- **触发器创建对话框** — 支持 schedule + webhook 类型
- **DLQ 管理标签页**
- **API 客户端 v1 前缀**

### 文档

#### 新增

- **管理员指南** — RBAC、API Keys、连接器、告警配置
- **用户指南** — 触发器创建、DLQ、内存预算
- **演示脚本** — P6 功能演示流程

---

## [0.5.0] - 2026-04-28

### 核心功能

#### 新增

- **工作流引擎** — 多步骤任务编排
- **触发器系统** — 定时触发、Webhook 触发、连接器事件触发
- **连接器管理** — 连接器列表、详情、实例配置
- **可观测性控制台** — 运行列表、时间线、回放预览
- **死信队列（DLQ）** — 失败事件捕获、重试、审计

---

## [0.4.0] - 2026-04-15

### 会话管理

#### 新增

- **会话创建和管理**
- **会话历史记录**
- **实时消息流（SSE）**

### 审批流程

#### 新增

- **工具调用审批**
- **审批请求和响应机制**
- **审批历史记录**

---

## [0.3.0] - 2026-04-01

### 基础架构

#### 新增

- **LLM 多提供商支持** — OpenRouter、Ollama
- **Web 搜索集成** — SearXNG、Tavily、Playwright
- **数据库迁移系统**
- **基础 API 端点**

---

## [0.2.0] - 2026-03-15

### 初始功能

#### 新增

- **Fastify 服务器框架**
- **SQLite 数据库集成**
- **基础存储层**
- **开发环境配置**

---

## [0.1.0] - 2026-03-01

### 项目初始化

#### 新增

- **项目脚手架**
- **TypeScript 配置**
- **基础目录结构**
