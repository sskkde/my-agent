# Release Notes: v0.7.0-rc.1

**发布日期**: 2026-05-19  
**版本类型**: Release Candidate  
**上一版本**: v0.6.0

---

## 概述

v0.7.0-rc.1 是 Agent Platform 的首个 Release Candidate 版本，将 Phase 6 代码库硬化为可发布、可部署、可回滚、可审计的生产就绪状态。

本版本聚焦于：

- 安全加固（安全头、认证测试、SSRF 防护）
- RBAC 全路由覆盖
- Docker 生产化
- 性能基线建立
- API 契约冻结
- 完整发布文档

---

## 新功能

### 安全加固

#### 安全响应头中间件

所有 API 响应现在包含标准安全头：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

这通过 `@fastify/helmet` 中间件实现，有效防止 XSS、点击劫持等常见攻击。

#### API Key 认证完整测试

新增完整的 API Key 认证测试套件，覆盖：

- API Key 创建（返回 `ak_` 前缀 key）
- API Key 使用（Bearer Token 认证）
- 角色映射（admin/user/service 权限）
- API Key 撤销
- 无效/过期 Key 处理

#### SSRF 防护测试

新增 SSRF（服务器端请求伪造）防护测试，覆盖：

- RFC1918 私有地址阻止
- 环回地址阻止
- 链路本地地址阻止
- 云元数据地址阻止
- DNS rebinding 攻击防护
- URL 解析绕过防护

---

### RBAC 全路由覆盖

所有 25 个路由文件现已添加 `requirePermission` 权限检查，实现完整的资源级别访问控制。

新增 `route-policy.ts` 定义路由权限映射：

- `ResourceType`: session, approval, run, workflow, trigger, connector, api-key, provider, agent-config, memory, observability, tool-result, user, setting
- `Action`: read, write, delete, execute
- `getRequiredPermission()`: 根据路由自动查找所需权限

---

### Cursor 分页

Sessions 端点新增 cursor 分页支持，提供更高效的分页方式：

```bash
# 使用 cursor 分页
GET /api/v1/sessions?limit=10

# 响应包含 nextCursor
{
  "items": [...],
  "nextCursor": "eyJpZCI6MTB9",
  "hasMore": true,
  "total": 100
}

# 使用 cursor 获取下一页
GET /api/v1/sessions?cursor=eyJpZCI6MTB9&limit=10
```

向后兼容：不提供 cursor 时仍使用 offset 分页。

---

### Docker 生产化

#### API Dockerfile

- `NODE_ENV=production` 生产模式
- 优化的镜像层缓存
- 健康检查配置
- LABEL 元数据

#### Web Dockerfile

多阶段构建 + nginx 静态服务：

- Stage 1: 构建前端资源
- Stage 2: nginx:alpine 静态文件服务
- SPA 路由支持
- API 代理配置
- Gzip 压缩
- 安全头

---

### 性能 Smoke 测试

建立 CI 环境性能基线：

| 端点                    | P95 阈值 |
| ----------------------- | -------- |
| `GET /api/v1/health`    | < 200ms  |
| `GET /api/v1/sessions`  | < 1000ms |
| `POST /api/v1/sessions` | < 500ms  |
| `GET /api/v1/tools`     | < 200ms  |

---

### ESLint + Prettier

新增代码质量工具链：

- `npm run lint` — 代码检查
- `npm run format` — 代码格式化
- `npm run format:check` — 格式检查

---

## Bug 修复

### 重定向状态码修复

旧版 API 路径重定向从 301（永久重定向）改为 307（临时重定向）。

**影响**: POST 请求体在重定向后正确保留。

**之前**:

```
POST /api/sessions → 301 → GET /api/v1/sessions (请求体丢失)
```

**之后**:

```
POST /api/sessions → 307 → POST /api/v1/sessions (请求体保留)
```

---

### 版本号统一

修复三处版本号不一致问题：

| 位置                | 之前   | 之后       |
| ------------------- | ------ | ---------- |
| package.json        | 0.1.0  | 0.7.0-rc.1 |
| server.ts (Swagger) | v0.5.0 | 0.7.0-rc.1 |
| openapi.yaml        | 0.6.0  | 0.7.0-rc.1 |

---

## 已知限制

以下限制在 v0.7.0-rc.1 中被接受为已知问题，将在后续版本中解决：

### 高优先级

1. **excludedPaths 覆盖几乎所有路由**

   当 `API_AUTH_TOKEN` 未设置时，API 完全开放。大多数业务端点绕过会话认证检查。

   **建议**: 生产部署前配置 `API_AUTH_TOKEN` 并使用 API Key 认证。

2. **CORS origin:true 允许所有来源**

   任何网站都可以向 API 发起跨域请求。

   **建议**: 生产环境配置 `ALLOWED_ORIGINS` 环境变量。

3. **会话认证不保护大多数端点**

   安全模型依赖于 API Key 认证，会话认证形同虚设。

   **建议**: 使用 API Key 认证保护生产环境。

### 中优先级

4. **速率限制豁免本地请求**

   Docker 环境中内部服务可能绕过速率限制。

   **建议**: 生产环境禁用 localhost 豁免。

5. **Cookie 未设置 Secure 标志**

   Cookie 可通过非 HTTPS 连接传输。

   **建议**: 生产环境强制 HTTPS。

详细说明见 [已知安全限制](../security/known-limitations.md)。

---

## 升级指南

### 从 v0.6.0 升级

#### 1. 备份数据

```bash
npm run db:backup
```

#### 2. 拉取更新

```bash
git fetch origin
git checkout v0.7.0-rc.1
```

#### 3. 安装依赖

```bash
npm install
npm --prefix web install
```

#### 4. 运行迁移

```bash
npm run db:migrate
```

#### 5. 验证

```bash
npm run test:p7
```

#### 6. 重启服务

```bash
# Docker
docker compose down
docker compose build
docker compose up -d

# 或直接运行
npm run start:api
```

---

### API 客户端更新

#### 重定向处理

如果客户端使用旧版 `/api/` 路径，需更新处理 307 重定向：

```javascript
// 之前：期望 301
if (response.status === 301) { ... }

// 之后：期望 307
if (response.status === 307) { ... }
```

建议直接使用 `/api/v1/` 前缀避免重定向。

#### Cursor 分页

Sessions 端点新增 cursor 分页支持：

```javascript
// 使用 cursor 分页
const response = await fetch('/api/v1/sessions?limit=10')
const data = await response.json()

if (data.nextCursor) {
  // 获取下一页
  const nextResponse = await fetch(`/api/v1/sessions?cursor=${data.nextCursor}&limit=10`)
}
```

---

### Docker 部署更新

#### docker-compose.yml 更新

新版 Docker 配置使用生产模式：

```yaml
services:
  api:
    environment:
      - NODE_ENV=production # 之前是 development
```

#### Web 服务变更

Web 服务现在使用 nginx 静态服务，不再运行 Vite dev server：

```yaml
services:
  web:
    build:
      context: ./web
      dockerfile: Dockerfile # 多阶段构建
    # nginx 配置在 web/nginx.conf
```

---

## 验证清单

升级后请验证：

- [ ] API 健康检查正常：`curl http://localhost:3003/api/v1/health`
- [ ] 安全头存在：`curl -I http://localhost:3003/api/v1/health | grep X-Frame-Options`
- [ ] 旧版路径重定向为 307：`curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3003/api/sessions`
- [ ] 版本号正确：`curl http://localhost:3003/api/v1/docs | grep "0.7.0-rc.1"`
- [ ] P7 测试通过：`npm run test:p7`

---

## 贡献者

感谢所有参与 Phase 7 开发的贡献者。

---

## 下一步

v0.7.0-rc.1 是 Release Candidate 版本，后续计划：

1. **v0.7.0** — 正式发布（根据 RC 反馈修复）
2. **v0.8.0** — Cursor 分页扩展到更多端点
3. **v0.9.0** — PostgreSQL 支持
4. **v1.0.0** — 生产就绪正式版

---

## 反馈

如有问题或建议，请通过以下方式反馈：

- GitHub Issues
- 内部反馈渠道
