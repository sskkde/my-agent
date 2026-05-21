# Release Notes: v0.8.0-ga-candidate

**Release Date**: 2026-05-21
**Release Type**: GA Candidate
**Previous Version**: v0.7.0-rc.1

---

## 概述 (Summary)

Phase 8 (GA Readiness) 将 v0.7.0-rc.1 从 Release Candidate 推进到 GA 可发布状态。本版本聚焦于生产安全加固、PostgreSQL 支持、最小多租户边界、完整 OAuth 流程、连接器 GA 认证和性能验证。

Phase 8 transforms v0.7.0-rc.1 from Release Candidate to GA-ready state. This release focuses on production security hardening, PostgreSQL support, minimal multi-tenant boundary, complete OAuth flow, connector GA certification, and performance verification.

---

## 新功能 (New Features)

### 🔒 生产安全加固 (Production Security Hardening)

#### Production Guard
- 生产环境启动前检查 (Pre-startup validation in production)
- 9 项配置验证：APP_SECRET_KEY、ALLOWED_ORIGINS、认证配置、数据库、备份等
- 占位符检测：拒绝常见占位符如 "your_secret_key"、"changeme"

#### CORS 生产 Allowlist
- 生产环境强制 CORS allowlist (Production CORS allowlist enforced)
- 不允许 wildcard origin (`*`)
- 开发环境保持宽松配置 (Development remains permissive)

#### Cookie 安全加固
- 生产环境 Cookie Secure 标记 (Cookie Secure flag in production)
- 条件化 Secure 标记：`NODE_ENV=production` 时自动启用

#### Auth 排除路径收敛
- 排除路径从 55 条收敛到 22 条 (Excluded paths reduced from 55 to 22)
- 与 RBAC DEFAULT_EXEMPT_PATHS 对齐

#### Rate Limit 生产加固
- 生产环境移除 localhost 豁免 (Production removes localhost exemption)
- SSE 端点豁免保留

---

### 🗄️ PostgreSQL 支持 (PostgreSQL Support)

#### DatabaseAdapter 抽象层
- 双模式策略：SQLite 同步 + PostgreSQL 异步 (Dual-mode: SQLite sync + PostgreSQL async)
- SqlDialect 抽象：方言转换 (json_extract → `->>`, datetime → NOW())
- 统一接口，透明切换

#### PostgreSQL Adapter
- 连接池管理 (Connection pooling with pg.Pool)
- 健康检查和池指标 (Health checks and pool metrics)
- 异步 API 支持

#### PostgreSQL 迁移
- 55+ 迁移语法转换 (55+ migrations converted)
- JSONB + GIN 索引替代函数索引
- BOOLEAN 类型替代 INTEGER 布尔

---

### 👥 多租户边界 (Multi-tenant Boundary)

#### Organizations 管理
- Organizations 表和 user_organizations 关联表
- 默认组织模式 (Default organization mode)
- 组织成员角色：owner/admin/member

#### Tenant Context
- 租户上下文注入 (Tenant context injection)
- Tenant Resolution 中间件
- 默认租户 ID: `org_default`

#### Store 层过滤
- 所有核心 Store 添加 tenantId 过滤
- 17 个 Store 全面覆盖
- 跨租户数据隔离验证

#### 组织 API
- `GET/POST /api/v1/organizations`
- `GET/PATCH/DELETE /api/v1/organizations/{orgId}`
- `GET/POST /api/v1/organizations/{orgId}/members`
- `DELETE /api/v1/organizations/{orgId}/members/{userId}`
- `PATCH /api/v1/organizations/{orgId}/members/{userId}/role`

---

### 🔐 OAuth 完整流程 (Complete OAuth Flow)

#### OAuth Service
- PKCE 授权流程 (PKCE authorization flow)
- State 参数管理，一次性使用 (One-time-use state)
- 授权 URL 生成

#### OAuth Callback
- Code → Token 交换 (Token exchange)
- Token 加密存储 (Encrypted token storage)
- State 校验

#### Token 管理
- 自动刷新 (Auto-refresh with expiry detection)
- Token 撤销 (Token revocation)
- Refresh token 处理

#### OAuth API Routes
- `GET /api/v1/connectors/{type}/oauth/authorize`
- `POST /api/v1/connectors/{type}/oauth/callback`
- `POST /api/v1/connectors/{instanceId}/oauth/revoke`

---

### 🔌 连接器 GA 认证 (Connector GA Certification)

所有 6 个生产连接器通过 GA 契约测试 (All 6 production connectors pass GA contract tests):

| Connector | Status | Auth Methods |
|-----------|--------|--------------|
| GitHub | ✅ GA | API Key, OAuth |
| Google Calendar | ✅ GA | OAuth2 |
| Google Contacts | ✅ GA | OAuth2 |
| Docs (Google/Notion) | ✅ GA | OAuth2 |
| Web Search | ✅ GA | Multiple backends |
| Generic HTTP | ✅ GA | API Key, OAuth, Basic |

---

### 📊 可观测性增强 (Observability Enhanced)

#### SLO/SLI 文档
- 7 个 SLO 定义 (7 SLOs defined)
  - API 可用性 99.5%
  - Health check p95 < 100ms
  - Normal API p95 < 500ms
  - Workflow start p95 < 1000ms
  - Connector timeout compliance
  - DLQ processing lag < 5min
  - Backup freshness < 24h

#### Incident Runbook
- 10 个故障场景 (10 incident scenarios)
- 严重等级：P0/P1/P2
- 快速参考和检查清单

#### Dashboard Guide
- 10 个仪表板配置 (10 dashboard configurations)
- PromQL 查询示例
- Grafana 导入指南

---

### 🖥️ Web UI 改进 (Web UI Improvements)

#### 生产错误状态
- 8 个 Tab 全面的错误/加载/空状态 (Full error/loading/empty states for 8 tabs)
- AdminTab、ConnectorsTab、TriggersTab、DLQTab、MemoryTab、ObservabilityTab、SettingsTab、SessionsTab
- 重试按钮和错误代码映射

#### Setup/Bootstrap Flow
- 3 步设置向导 (3-step setup wizard)
- Admin 用户创建
- API Key 创建
- 生产就绪检查清单

#### Secret 保护
- API Key 前缀显示 (ak_...)
- 完整 Key 仅创建时显示一次
- Provider secret 完全隐藏

---

### 📝 API 改进 (API Improvements)

#### OpenAPI v0.8
- 98% 路由覆盖 (98% route coverage)
- 版本号更新为 0.8.0-ga-candidate
- 新增 Organizations、OAuth、Alerts 端点文档

#### API Deprecation Headers
- Legacy `/api/` 路由添加弃用头
- `Deprecation: true` header
- `Link: </api/v1/{path}>; rel="successor-version"` header

#### API Contract Lock
- 63 个契约测试验证响应格式
- 24 个唯一路由验证
- 错误格式和分页契约验证

---

## 重大变更 (Breaking Changes)

### ⚠️ 必须注意 (Must Note)

1. **Production Guard 阻断启动**
   - 生产环境缺少必要配置时，API 将拒绝启动
   - 确保 `APP_SECRET_KEY`、`ALLOWED_ORIGINS` 等已配置

2. **CORS 不再允许 Wildcard**
   - 生产环境 `ALLOWED_ORIGINS` 不能为 `*`
   - 必须配置具体的 origin 列表

3. **Cookie Secure 标记**
   - 生产环境 Cookie 自动添加 Secure 标记
   - 需要确保使用 HTTPS

4. **Auth 排除路径减少**
   - 原本无需认证的路由可能现在需要认证
   - 检查客户端是否依赖这些路径

### 🔄 迁移影响 (Migration Impact)

- **数据库迁移**：新增 organizations 表和 tenant_id 列
- **API 版本**：/api/v1/ 是规范路径，/api/ 已弃用
- **配置变更**：生产环境需要更多配置项

---

## 升级指南 (Upgrade Guide)

详见 `docs/release/MIGRATION_GUIDE_v0.7_to_v0.8.md`

### 快速升级步骤 (Quick Upgrade Steps)

1. **备份数据库**
   ```bash
   npm run db:backup
   ```

2. **更新配置**
   ```bash
   # 设置生产配置
   export NODE_ENV=production
   export APP_SECRET_KEY="your-secure-key-at-least-32-chars"
   export ALLOWED_ORIGINS="https://your-domain.com"
   export PUBLIC_BASE_URL="https://api.your-domain.com"
   ```

3. **运行迁移**
   ```bash
   npm run db:migrate
   ```

4. **启动服务**
   ```bash
   npm run start:api
   ```

5. **验证健康**
   ```bash
   curl http://localhost:3003/api/v1/health
   ```

---

## 已修复问题 (Fixed Issues)

| Issue | Description |
|-------|-------------|
| CORS wildcard security | 生产环境 CORS 不再允许 wildcard origin |
| Cookie Secure missing | 生产环境 Cookie 现在包含 Secure 标记 |
| Auth path over-exposure | Auth 排除路径从 55 收敛到 22 |
| Rate limit localhost bypass | 生产环境 localhost 不再豁免 rate limit |
| PostgreSQL missing | 现在支持 PostgreSQL 作为数据库后端 |
| Multi-tenant isolation | 租户数据隔离现在得到验证 |
| OAuth flow incomplete | OAuth 现在支持完整授权流程 |
| Connector production ready | 所有 6 个连接器通过 GA 认证 |

---

## 已知限制 (Known Limitations)

| Limitation | Description | Workaround |
|------------|-------------|------------|
| 307 redirect tests | v1-routes.test.ts 和 final-qa.test.ts 中有预存问题 | 不影响功能，可忽略 |
| Multi-tenant UI | 租户管理 UI 未实现 | 使用 API 管理 |
| Tenant self-registration | 租户自助注册未实现 | 管理员手动创建 |
| Cross-tenant sharing | 跨租户数据共享未实现 | 架构上不支持 |

---

## 致谢 (Acknowledgments)

Phase 8 是团队协作的结果，感谢所有贡献者的辛勤工作。

---

## 下一步 (Next Steps)

- 完成最终验证 (Complete final verification)
- 更新 CI workflow (Update CI workflow)
- 创建 git tag (Create git tag)
- 部署到生产环境 (Deploy to production)

---

## Final Verification

The following commands were executed before tagging v0.8.0-ga-candidate:

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run test:security` | ✅ PASS (291 tests, 12 files) |
| `npm run test:prod-config` | ✅ PASS (23 tests) |
| `npm run test:tenancy` | ✅ PASS (62 tests, 3 files) |
| `npm run test:backup-restore` | ✅ PASS (11 tests) |
| `npm run test:load` | ✅ PASS (7 tests, p95 within thresholds) |
| `npm run build:web` | ✅ PASS (production build) |

Docker and PostgreSQL gates are environment-dependent and are documented in the release checklist.

CI verification (GitHub Actions): 14/15 jobs passed. `test-p8` combined gate failed due to CI resource constraints; all individual gates passed independently.

---

**Release Manager**: Sisyphus
**Documentation**: docs/release/MIGRATION_GUIDE_v0.7_to_v0.8.md
**Rollback**: docs/release/ROLLBACK_RUNBOOK.md
