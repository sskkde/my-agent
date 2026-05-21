# 已知限制 (GA v0.8.0)

本文档记录 v0.8.0 GA 版本中已知的架构和功能限制。这些限制在当前版本中被接受，部分已在后续版本路线图中规划解决。

---

## 目录

1. [数据库限制](#数据库限制)
2. [多租户限制](#多租户限制)
3. [OAuth 与连接器限制](#oauth-与连接器限制)
4. [身份验证限制](#身份验证限制)
5. [部署限制](#部署限制)
6. [功能限制](#功能限制)

---

## 数据库限制

### PostgreSQL 适配器需要 test:p8 配置

**状态**: 已接受

**描述**

PostgreSQL 适配器已完成实现并通过集成测试，但需要使用特定的测试配置 (`test:p8`) 运行。这包括：
- 设置 `DATABASE_URL` 环境变量
- 确保 PostgreSQL 实例可访问
- 运行 `npm run test:postgres` 而非标准测试套件

**影响**

- 生产环境使用 PostgreSQL 需要额外配置步骤
- CI/CD 流程需要独立的 PostgreSQL 测试阶段
- 默认测试套件 (`npm test`) 不验证 PostgreSQL 功能

**解决方案**

生产环境部署时：
1. 设置 `DATABASE_URL=postgresql://user:pass@host:5432/dbname`
2. 运行迁移：`npm run db:migrate`
3. 验证连接：`npm run db:health`

---

### PostgreSQL 无自动 Schema 迁移

**状态**: 已接受

**描述**

SQLite 到 PostgreSQL 的 Schema 迁移需要手动执行。虽然迁移脚本已提供（`src/storage/adapters/postgres/migrations/`），但不存在自动迁移机制。

**影响**

- 版本升级时需要手动检查 Schema 变更
- 需要维护两套迁移脚本（SQLite SQL 文件 + PostgreSQL TypeScript）
- 迁移失败可能需要手动回滚

**解决方案**

升级流程：
```bash
# 1. 备份数据库
pg_dump agent_platform > backup.sql

# 2. 检查迁移版本
SELECT * FROM pg_migrations ORDER BY version;

# 3. 执行新迁移
npm run db:migrate

# 4. 验证
npm run db:health
```

---

## 多租户限制

### 多租户仅支持 org_default 租户

**状态**: 已接受 (Phase 8 GA)

**描述**

当前多租户架构仅支持单一默认租户 `org_default`。虽然数据库 Schema 已包含 `tenant_id` 列，但租户隔离中间件始终返回默认租户。

**影响**

- 所有用户共享同一租户空间
- 无法实现真正的数据隔离
- 组织级别的访问控制不可用

**代码示例**

```typescript
// 当前实现 - 始终返回默认租户
export function resolveTenant(userId: string): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID, // 'org_default'
    resolvedFrom: 'default',
  };
}
```

**路线图**

Phase 9 计划：
- 多租户 API 端点 (`POST /api/v1/organizations`)
- 租户隔离中间件激活
- 跨租户管理界面

---

### 无租户自助服务

**状态**: 已接受

**描述**

用户无法自行创建或管理组织/租户。所有组织操作需要管理员权限。

**影响**

- 无法实现 SaaS 多租户场景
- 新用户只能加入默认组织
- 组织管理依赖管理员操作

**解决方案**

当前版本如需创建新组织：
```bash
# 通过管理员 API 创建
curl -X POST http://localhost:3003/api/v1/organizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "New Org", "slug": "new-org"}'
```

---

## OAuth 与连接器限制

### OAuth 需要手动注册连接器

**状态**: 已接受

**描述**

OAuth 连接器（Google Calendar、Google Contacts、Google Docs 等）需要在授权服务器端手动注册回调 URL。平台不提供自动注册机制。

**要求**

每个 OAuth 连接器需要：
1. 在 Provider（如 Google Cloud Console）注册应用
2. 配置回调 URL：`{PUBLIC_BASE_URL}/api/v1/connectors/{type}/oauth/callback`
3. 获取 Client ID 和 Client Secret
4. 在平台中配置 Provider 凭证

**示例配置**

```bash
# Google OAuth 配置
POST /api/v1/providers
{
  "providerType": "google-calendar",
  "displayName": "Google Calendar",
  "oauthConfig": {
    "clientId": "xxx.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-xxx",
    "scopes": ["https://www.googleapis.com/auth/calendar"]
  }
}
```

**影响**

- 部署时需要额外配置步骤
- 无法实现"一键连接"体验
- 每个 OAuth Provider 需要独立的注册流程

---

## 身份验证限制

### 无 SSO/SAML 支持

**状态**: 已接受

**描述**

平台不支持 SAML 2.0 或其他企业 SSO 协议。身份验证仅支持：
- Cookie 会话（用户名/密码）
- API Key（服务账户）
- Bearer Token（OIDC 客户端凭证）

**影响**

- 无法与企业 IdP（Okta、Azure AD、Google Workspace）集成
- 用户必须使用平台本地账户
- 无法实现单点登录

**替代方案**

1. **反向代理认证**：在 Nginx/负载均衡器层实现 SSO
   ```nginx
   # 使用 auth_request 委托给 IdP
   location /api/ {
       auth_request /auth;
       auth_request_set $user $upstream_http_x_user;
       proxy_set_header X-User $user;
   }
   ```

2. **OIDC 中间件**：扩展认证中间件支持 OIDC 流程

---

### 无 BYOIDP（自带身份提供商）

**状态**: 已接受

**描述**

平台无法配置外部身份提供商作为用户目录源。所有用户账户必须存在于本地 `users` 表中。

**影响**

- 用户管理完全本地化
- 无法同步外部目录用户
- 无自动用户配置/取消配置

---

## 部署限制

### 无 Kubernetes Helm Chart

**状态**: 已接受

**描述**

平台未提供官方 Kubernetes Helm Chart 或 Operator。部署到 Kubernetes 需要手动创建 Manifest 或使用 Docker Compose 兼容方案。

**影响**

- 无法使用标准 Kubernetes 部署流程
- 需要 Helm Chart 维护成本
- 缺少 Kubernetes 原生健康检查集成

**替代方案**

Docker Compose 转 Kubernetes：
```bash
# 使用 kompose 转换
kompose convert -f docker-compose.yml

# 或使用 Docker Compose 在 Kubernetes 中运行
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: agent-platform
spec:
  containers:
  - name: api
    image: agent-platform:latest
    ports:
    - containerPort: 3003
    env:
    - name: NODE_ENV
      value: "production"
    # ... 其他配置
EOF
```

---

## 功能限制

### SQLite 水平扩展限制

**状态**: 架构限制

**描述**

默认 SQLite 数据库不支持水平扩展。高可用部署需要切换到 PostgreSQL。

**影响**

- 单实例架构
- 无数据库复制
- 故障转移需要手动干预

**解决方案**

生产环境推荐 PostgreSQL：
```bash
# 设置 PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/agent_platform

# 运行迁移
npm run db:migrate:postgres
```

---

### 连接器网络访问控制

**状态**: 已接受

**描述**

通用 HTTP 连接器的网络访问默认禁用（`GENERIC_HTTP_CONNECTOR_NETWORK=disabled`）。启用需要显式配置。

**安全影响**

防止 SSRF 攻击：
- 阻止访问内部服务
- 防止云元数据端点访问
- 限制网络暴露

**启用方式**

```bash
# 仅在可信环境中启用
GENERIC_HTTP_CONNECTOR_NETWORK=enabled
```

---

## 限制总结表

| 限制 | 严重性 | 状态 | 计划版本 |
|------|--------|------|----------|
| PostgreSQL 需要特殊配置 | 中 | 已接受 | 持续改进 |
| PostgreSQL 无自动迁移 | 中 | 已接受 | 持续改进 |
| 仅支持 org_default 租户 | 高 | 已接受 | Phase 9 |
| 无租户自助服务 | 中 | 已接受 | Phase 9+ |
| OAuth 需要手动注册 | 低 | 已接受 | - |
| 无 SSO/SAML | 高 | 已接受 | Phase 10+ |
| 无 BYOIDP | 中 | 已接受 | Phase 10+ |
| 无 Helm Chart | 中 | 已接受 | Phase 9 |
| SQLite 水平扩展 | 架构 | 已接受 | 使用 PG |

---

## 相关文档

- [生产安全模型](./production-security-model.md)
- [部署指南](../deployment/production.md)
- [环境变量参考](../deployment/env-reference.md)
- [PostgreSQL 部署](../deployment/postgres.md)
