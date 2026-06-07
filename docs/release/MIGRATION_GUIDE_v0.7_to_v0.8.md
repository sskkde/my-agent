# Migration Guide: v0.7.0-rc.1 → v0.8.0-ga-candidate

**Target Version**: v0.8.0-ga-candidate
**Source Version**: v0.7.0-rc.1
**Difficulty**: Medium
**Estimated Time**: 1-2 hours

---

## 目录 (Table of Contents)

1. [迁移前准备 (Pre-migration Preparation)](#1-迁移前准备-pre-migration-preparation)
2. [安全配置迁移 (Security Configuration)](#2-安全配置迁移-security-configuration)
3. [数据库迁移 (Database Migration)](#3-数据库迁移-database-migration)
4. [多租户迁移 (Multi-tenant Migration)](#4-多租户迁移-multi-tenant-migration)
5. [OAuth 配置迁移 (OAuth Configuration)](#5-oauth-配置迁移-oauth-configuration)
6. [连接器迁移 (Connector Migration)](#6-连接器迁移-connector-migration)
7. [部署迁移 (Deployment Migration)](#7-部署迁移-deployment-migration)
8. [迁移后验证 (Post-migration Verification)](#8-迁移后验证-post-migration-verification)
9. [回滚方案 (Rollback Plan)](#9-回滚方案-rollback-plan)

---

## 1. 迁移前准备 (Pre-migration Preparation)

### 1.1 系统要求 (System Requirements)

| Requirement | v0.7.0-rc.1 | v0.8.0-ga-candidate            |
| ----------- | ----------- | ------------------------------ |
| Node.js     | 20+         | 20+ (unchanged)                |
| SQLite      | 3.x         | 3.x (unchanged)                |
| PostgreSQL  | -           | 14+ (optional)                 |
| Docker      | Optional    | Optional                       |
| Memory      | 512MB       | 512MB (1GB recommended for PG) |

### 1.2 备份数据库 (Backup Database)

```bash
# 创建备份
npm run db:backup

# 验证备份文件存在
ls -la data/backups/

# 建议保留多个备份
cp data/backups/app-$(date +%Y%m%d).db data/backups/app-pre-p8-migration.db
```

### 1.3 检查当前版本 (Verify Current Version)

```bash
# 检查当前版本
cat package.json | grep version

# 检查数据库迁移版本
sqlite3 data/app.db "SELECT * FROM schema_version ORDER BY version DESC LIMIT 1;"
```

### 1.4 更新代码 (Update Code)

```bash
# 获取最新代码
git fetch origin
git checkout v0.8.0-ga-candidate

# 安装依赖
npm install
npm --prefix web install
```

---

## 2. 安全配置迁移 (Security Configuration)

### 2.1 Production Guard 配置

v0.8.0 引入 Production Guard，生产环境必须配置以下环境变量：

#### 必需配置 (Required Configuration)

```bash
# .env.production 或环境变量

# 必需：加密密钥，至少 32 字符
APP_SECRET_KEY=your-secure-secret-key-at-least-32-characters-long

# 必需：允许的 CORS origins，逗号分隔，不允许 *
ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com

# 必需：公开访问的基础 URL
PUBLIC_BASE_URL=https://api.yourdomain.com

# 必需：备份目录
BACKUP_DIR=/var/backups/agent

# 必需：至少启用一种认证方式
# 选项 1: Bootstrap Token
API_AUTH_TOKEN=your-bootstrap-token

# 选项 2: 或确保有 API Key 已创建（首次启动时通过 bootstrap）
```

#### 条件配置 (Conditional Configuration)

```bash
# 生产环境必须设置
NODE_ENV=production

# 如果使用反向代理
TRUST_PROXY=true

# 数据库配置（二选一）
DATABASE_PATH=./data/app.db          # SQLite
DATABASE_URL=postgresql://user:pass@host:5432/db  # PostgreSQL

# 日志级别（生产环境不允许 debug）
LOG_LEVEL=info
```

#### 配置验证 (Configuration Validation)

```bash
# 运行生产配置检查
npm run test:prod-config

# 或手动检查
tsx scripts/check-production-config.ts
```

### 2.2 CORS 配置迁移

**变更前 (Before)**:

```
# 开发环境使用宽松 CORS
CORS_ORIGIN=*
```

**变更后 (After)**:

```bash
# 生产环境必须配置具体 origins
ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com

# 开发环境保持宽松（自动检测 NODE_ENV）
# NODE_ENV=development 时自动允许所有 origin
```

#### 迁移步骤 (Migration Steps)

1. 列出所有允许的前端域名
2. 配置 `ALLOWED_ORIGINS` 环境变量
3. 重启服务
4. 验证 CORS 配置：

```bash
# 测试允许的 origin
curl -I -X OPTIONS \
  -H "Origin: https://app.yourdomain.com" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:3003/api/v1/health

# 应返回: Access-Control-Allow-Origin: https://app.yourdomain.com

# 测试不允许的 origin
curl -I -X OPTIONS \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: GET" \
  http://localhost:3003/api/v1/health

# 应不返回 Access-Control-Allow-Origin 头
```

### 2.3 Cookie 安全配置

**变更**: 生产环境自动添加 Secure 标记

**迁移步骤**:

1. 确保生产环境使用 HTTPS
2. Cookie Secure 标记由系统自动添加，无需手动配置
3. 验证：

```bash
# 生产环境登录后检查 Cookie
curl -v -X POST \
  -d '{"username":"admin","password":"yourpassword"}' \
  https://api.yourdomain.com/api/v1/auth/login

# Set-Cookie 头应包含 Secure 标记
```

### 2.4 Auth 排除路径变更

**变更**: 排除路径从 55 条减少到 22 条

**可能影响的路由**:

- 原本无需认证的路由可能现在需要认证

**迁移步骤**:

1. 检查客户端是否依赖以下路径的无认证访问：

   ```
   /api/v1/health          # 仍然公开
   /api/v1/health/ready    # 仍然公开
   /api/v1/docs            # 仍然公开
   /api/v1/auth/login      # 仍然公开
   /api/v1/auth/logout     # 仍然公开
   /api/v1/setup/*         # 仍然公开
   /api/v1/webhooks/*      # 仍然公开
   ```

2. 如果客户端需要访问其他路由，确保：
   - 使用有效的 session cookie
   - 或使用有效的 API Key

3. 验证所有业务路由需要认证：

```bash
# 测试未认证访问
curl http://localhost:3003/api/v1/sessions
# 应返回 401

curl http://localhost:3003/api/v1/providers
# 应返回 401
```

---

## 3. 数据库迁移 (Database Migration)

### 3.1 SQLite 迁移（无变更）

SQLite 用户无需额外迁移，运行数据库迁移即可：

```bash
# 运行迁移
npm run db:migrate

# 验证迁移
sqlite3 data/app.db "SELECT * FROM schema_version ORDER BY version DESC LIMIT 5;"
# 应显示版本 18（或更高）
```

### 3.2 PostgreSQL 迁移（可选）

如果要从 SQLite 迁移到 PostgreSQL：

#### Step 1: 准备 PostgreSQL

```bash
# 创建数据库
createdb agent_production

# 或使用 psql
psql -U postgres -c "CREATE DATABASE agent_production;"
```

#### Step 2: 配置环境变量

```bash
# 设置 PostgreSQL 连接
export DATABASE_URL="postgresql://user:password@localhost:5432/agent_production"

# 可选：连接池配置
export PG_POOL_MIN=2
export PG_POOL_MAX=10
```

#### Step 3: 运行迁移

```bash
# PostgreSQL 模式运行迁移
DATABASE_URL="postgresql://..." npm run db:migrate

# 验证迁移
psql $DATABASE_URL -c "SELECT * FROM schema_version ORDER BY version DESC LIMIT 5;"
```

#### Step 4: 数据迁移（手动）

```bash
# SQLite 数据导出
sqlite3 data/app.db ".dump" > sqlite_dump.sql

# 需要手动转换语法：
# - INTEGER → BOOLEAN (for true/false fields)
# - datetime('now') → NOW()
# - json_extract() → ->> operator
# - AUTOINCREMENT → SERIAL/IDENTITY

# 或使用迁移脚本（如有）
npm run migrate:sqlite-to-pg -- --source data/app.db --target $DATABASE_URL
```

#### Step 5: 验证 PostgreSQL 模式

```bash
# 运行 PostgreSQL 测试
npm run test:postgres

# 验证健康检查
curl http://localhost:3003/api/v1/health | jq '.data.modules.database'
```

### 3.3 新增表结构

v0.8.0 新增以下表：

```sql
-- Organizations 表
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-Organization 关联表
CREATE TABLE user_organizations (
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, organization_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 所有表新增 tenant_id 列
ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
ALTER TABLE workflows ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
-- ... 其他表
```

---

## 4. 多租户迁移 (Multi-tenant Migration)

### 4.1 默认租户模式

v0.8.0 采用默认租户模式，无需额外配置：

```sql
-- 默认组织自动创建
INSERT INTO organizations (id, name, slug)
VALUES ('org_default', 'Default Organization', 'default');

-- 所有现有数据归入默认组织
UPDATE sessions SET tenant_id = 'org_default';
UPDATE workflows SET tenant_id = 'org_default';
-- ... 其他表
```

### 4.2 组织管理 API

新增组织管理 API：

```bash
# 创建组织（需要 admin 角色）
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Org","slug":"my-org"}' \
  http://localhost:3003/api/v1/organizations

# 列出组织
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3003/api/v1/organizations

# 添加成员
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-123","role":"member"}' \
  http://localhost:3003/api/v1/organizations/org_default/members
```

### 4.3 租户隔离验证

```bash
# 运行租户隔离测试
npm run test:tenancy

# 应显示 32 tests passed
```

---

## 5. OAuth 配置迁移 (OAuth Configuration)

### 5.1 OAuth Provider 配置

v0.8.0 支持完整 OAuth 流程，需要配置 OAuth provider：

#### Google OAuth 示例

```bash
# Google OAuth 配置
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v1/connectors/calendar/oauth/callback
```

#### GitHub OAuth 示例

```bash
# GitHub OAuth 配置
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://api.yourdomain.com/api/v1/connectors/github/oauth/callback
```

### 5.2 OAuth 流程使用

```bash
# 1. 获取授权 URL
curl http://localhost:3003/api/v1/connectors/calendar/oauth/authorize
# 返回: {"authorizeUrl": "https://accounts.google.com/..."}

# 2. 用户访问授权 URL，同意授权

# 3. OAuth provider 回调到系统
# GET /api/v1/connectors/calendar/oauth/callback?code=...&state=...

# 4. 系统自动交换 token 并存储

# 5. 手动刷新 token
curl -X POST \
  http://localhost:3003/api/v1/connectors/instance-123/oauth/revoke

# 6. 撤销 token
curl -X POST \
  http://localhost:3003/api/v1/connectors/instance-123/oauth/revoke
```

### 5.3 OAuth 迁移检查清单

- [ ] 配置 OAuth provider credentials
- [ ] 设置 redirect URI
- [ ] 测试授权流程
- [ ] 验证 token 刷新
- [ ] 验证 token 撤销

---

## 6. 连接器迁移 (Connector Migration)

### 6.1 连接器 GA 认证

所有 6 个连接器现在通过 GA 认证：

| Connector       | Auth Method             | Configuration                              |
| --------------- | ----------------------- | ------------------------------------------ |
| GitHub          | API Key / OAuth         | `GITHUB_TOKEN` or OAuth                    |
| Google Calendar | OAuth2                  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Google Contacts | OAuth2                  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Docs            | OAuth2                  | Provider-specific credentials              |
| Web Search      | Multiple                | `TAVILY_API_KEY`, `SEARXNG_BASE_URL`, etc. |
| Generic HTTP    | API Key / Basic / OAuth | Instance-specific configuration            |

### 6.2 连接器配置迁移

```bash
# GitHub 连接器
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "github",
    "config": {
      "authType": "api_key",
      "apiKey": "ghp_your_token"
    }
  }' \
  http://localhost:3003/api/v1/connectors/instances

# Web Search 连接器
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "web-search",
    "config": {
      "backend": "tavily",
      "apiKey": "tvly_your_key"
    }
  }' \
  http://localhost:3003/api/v1/connectors/instances
```

### 6.3 连接器健康检查

```bash
# 测试连接器
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3003/api/v1/connectors/instances/instance-123/test

# 应返回: {"ok": true, "message": "Connection successful"}
```

---

## 7. 部署迁移 (Deployment Migration)

### 7.1 Docker 部署

#### docker-compose.yml (开发)

保持原有配置不变。

#### docker-compose.prod.yml (生产)

```yaml
# docker-compose.prod.yml
services:
  api:
    environment:
      - NODE_ENV=production
      - APP_SECRET_KEY=${APP_SECRET_KEY}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
      - PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
      - BACKUP_DIR=/backups
    volumes:
      - agent_data:/app/data
      - agent_backups:/backups
    restart: always
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3003/api/v1/health']
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    environment:
      - VITE_API_URL=${PUBLIC_BASE_URL}
    restart: always

volumes:
  agent_data:
  agent_backups:
```

#### 启动生产环境

```bash
# 使用生产配置启动
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 查看日志
docker compose logs -f api
```

### 7.2 环境变量模板

创建 `.env.production`:

```bash
# .env.production

# === 必需配置 ===
NODE_ENV=production
APP_SECRET_KEY=your-secure-secret-key-at-least-32-characters-long
ALLOWED_ORIGINS=https://app.yourdomain.com,https://admin.yourdomain.com
PUBLIC_BASE_URL=https://api.yourdomain.com
BACKUP_DIR=/var/backups/agent

# === 认证配置 ===
API_AUTH_TOKEN=your-bootstrap-token

# === 数据库配置 (二选一) ===
DATABASE_PATH=./data/app.db
# DATABASE_URL=postgresql://user:pass@host:5432/db

# === 安全配置 ===
TRUST_PROXY=true
COOKIE_SECURE=true

# === 日志配置 ===
LOG_LEVEL=info

# === OAuth 配置 ===
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# === Web Search 配置 ===
WEB_SEARCH_BACKEND=auto
TAVILY_API_KEY=your-tavily-key
```

### 7.3 部署验证脚本

```bash
# 运行部署验证
tsx scripts/check-deployment-smoke.ts

# 应显示所有检查通过
```

---

## 8. 迁移后验证 (Post-migration Verification)

### 8.1 健康检查

```bash
# 基础健康检查
curl http://localhost:3003/api/v1/health

# 就绪检查
curl http://localhost:3003/api/v1/health/ready

# 数据库健康
curl http://localhost:3003/api/v1/health | jq '.data.modules.database'
```

### 8.2 功能验证

```bash
# 认证测试
curl -X POST \
  -d '{"username":"admin","password":"yourpassword"}' \
  http://localhost:3003/api/v1/auth/login

# API 测试
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3003/api/v1/sessions

# 组织测试
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3003/api/v1/organizations
```

### 8.3 性能验证

```bash
# 运行负载测试
npm run test:load

# 验证 p95 延迟在阈值内
```

### 8.4 完整验证清单

- [ ] Production guard 通过
- [ ] CORS 配置正确
- [ ] Cookie Secure 启用
- [ ] 数据库迁移完成
- [ ] 组织表存在
- [ ] 默认组织创建
- [ ] 认证功能正常
- [ ] API 路由正常
- [ ] OAuth 流程正常
- [ ] 连接器工作正常
- [ ] 性能在阈值内
- [ ] 日志正常输出

---

## 9. 回滚方案 (Rollback Plan)

如果迁移出现问题，可以回滚到 v0.7.0-rc.1：

### 9.1 回滚步骤

```bash
# 1. 停止服务
docker compose down
# 或
pm2 stop api

# 2. 切换到旧版本
git checkout v0.7.0-rc.1

# 3. 恢复数据库
cp data/backups/app-pre-p8-migration.db data/app.db

# 4. 重新安装依赖
npm install

# 5. 启动服务
docker compose up -d
# 或
npm run start:api

# 6. 验证
curl http://localhost:3003/api/v1/health
```

### 9.2 回滚后验证

```bash
# 验证版本
cat package.json | grep version

# 验证数据库
sqlite3 data/app.db "SELECT * FROM schema_version ORDER BY version DESC LIMIT 1;"
# 应显示版本 17 或更低

# 验证功能
npm run test:p7
```

---

## 常见问题 (FAQ)

### Q: 迁移后启动失败，提示缺少 APP_SECRET_KEY？

A: 生产环境必须配置 `APP_SECRET_KEY`。添加到 `.env.production` 或环境变量中。

### Q: CORS 配置后前端无法访问？

A: 确保 `ALLOWED_ORIGINS` 包含前端域名，格式为完整 URL（包含协议）。

### Q: PostgreSQL 连接失败？

A: 检查 `DATABASE_URL` 格式是否正确，确保 PostgreSQL 服务运行中。

### Q: OAuth 授权失败？

A: 检查 OAuth provider 配置，确保 redirect URI 在 provider 中已注册。

### Q: 迁移后看不到之前的数据？

A: 确保数据库迁移成功运行，检查 `schema_version` 表。

---

**Need Help?**

- See `docs/troubleshooting.md`
- See `docs/release/ROLLBACK_RUNBOOK.md`
- Check `.sisyphus/notepads/phase8-ga-readiness/learnings.md`
