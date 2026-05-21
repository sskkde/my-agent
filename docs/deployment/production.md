# 生产部署指南

> 版本: v0.8.0 GA
> 最后更新: 2026-05-21

本指南涵盖 Agent Platform 的生产环境部署，包括前置条件、环境配置、Docker 部署、手动部署、健康检查、备份恢复、监控和故障响应。

---

## 目录

1. [前置条件](#前置条件)
2. [环境配置](#环境配置)
3. [Docker 部署](#docker-部署)
4. [手动部署](#手动部署)
5. [健康检查](#健康检查)
6. [备份与恢复](#备份与恢复)
7. [监控](#监控)
8. [故障响应](#故障响应)

---

## 前置条件

### 系统要求

| 组件 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 1 核心 | 2-4 核心 |
| 内存 | 1 GB | 4 GB |
| 存储 | 10 GB | 50 GB SSD |
| 网络 | 100 Mbps | 1 Gbps |

### 软件依赖

| 软件 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | v20+ | 运行时 |
| npm | v10+ | 包管理 |
| SQLite | 3.x | 默认数据库 |
| Docker | 24+ | 容器化部署（可选） |
| PostgreSQL | 15+ | 替代数据库（可选） |

### 网络要求

- **入站端口**: 
  - 3003 (API)
  - 3002 (Web UI)
  - 443 (HTTPS，通过反向代理)
- **出站端口**:
  - 443 (LLM Provider API)
  - 443 (OAuth Provider)
  - 各种连接器依赖端口

---

## 环境配置

### 必需环境变量

生产环境**必须**配置以下变量：

```bash
# 安全密钥（用于加密 Provider API Key 等）
APP_SECRET_KEY=<32位以上的随机字符串>

# 环境标识
NODE_ENV=production

# CORS 允许的源（逗号分隔，不能使用 *）
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com

# 数据库路径（SQLite）
DATABASE_PATH=/data/agent-platform.db
# 或 PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/agent_platform

# 公开访问 URL（用于 OAuth 回调）
PUBLIC_BASE_URL=https://app.example.com

# Cookie 安全标志
COOKIE_SECURE=true

# 代理信任配置（若在反向代理后）
TRUST_PROXY=1

# 备份目录
BACKUP_DIR=/var/backups/agent-platform

# 日志级别（不能为 debug）
LOG_LEVEL=info
```

### 生成安全密钥

```bash
# 生成 APP_SECRET_KEY
openssl rand -hex 32

# 生成 API_AUTH_TOKEN（用于引导认证）
openssl rand -hex 32
```

### LLM Provider 配置

至少配置一个 LLM Provider：

```bash
# OpenRouter
OPENROUTER_API_KEY=sk-or-xxx

# 或 Ollama（本地部署）
OLLAMA_BASE_URL=http://localhost:11434
```

### 完整环境变量参考

参见 [环境变量参考](./env-reference.md)。

---

## Docker 部署

### 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  api:
    image: agent-platform:latest
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3003:3003"
    environment:
      - NODE_ENV=production
      - APP_SECRET_KEY=${APP_SECRET_KEY}
      - ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
      - DATABASE_PATH=/data/agent-platform.db
      - PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
      - COOKIE_SECURE=true
      - TRUST_PROXY=1
      - BACKUP_DIR=/data/backups
      - LOG_LEVEL=info
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
    volumes:
      - agent_data:/data
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3003/api/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    restart: unless-stopped

  web:
    image: agent-platform-web:latest
    build:
      context: ./web
      dockerfile: Dockerfile
    ports:
      - "3002:3002"
    environment:
      - VITE_API_TARGET=http://api:3003
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  agent_data:
```

### 启动服务

```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 验证健康状态
curl http://localhost:3003/api/v1/health
```

### 环境变量文件

创建 `.env` 文件：

```bash
# .env
APP_SECRET_KEY=your_generated_secret_key_here
ALLOWED_ORIGINS=https://your-domain.com
PUBLIC_BASE_URL=https://your-domain.com
OPENROUTER_API_KEY=sk-or-xxx
```

---

## 手动部署

### 1. 安装依赖

```bash
# 克隆代码
git clone https://github.com/your-org/agent-platform.git
cd agent-platform

# 安装后端依赖
npm install

# 安装前端依赖
cd web && npm install && cd ..
```

### 2. 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置
vim .env
```

### 3. 初始化数据库

```bash
# 创建数据目录
mkdir -p /data

# 运行迁移
npm run db:migrate

# 验证数据库
npm run db:health
```

### 4. 构建前端

```bash
cd web
npm run build
cd ..
```

### 5. 创建系统服务

创建 `/etc/systemd/system/agent-platform.service`：

```ini
[Unit]
Description=Agent Platform API
After=network.target

[Service]
Type=simple
User=agent-platform
Group=agent-platform
WorkingDirectory=/opt/agent-platform
Environment="NODE_ENV=production"
EnvironmentFile=/opt/agent-platform/.env
ExecStart=/usr/bin/node /opt/agent-platform/dist/api/server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

创建 `/etc/systemd/system/agent-platform-web.service`：

```ini
[Unit]
Description=Agent Platform Web UI
After=network.target agent-platform.service

[Service]
Type=simple
User=agent-platform
Group=agent-platform
WorkingDirectory=/opt/agent-platform/web
ExecStart=/usr/bin/npx serve -s dist -l 3002
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 6. 启动服务

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl enable agent-platform agent-platform-web
sudo systemctl start agent-platform agent-platform-web

# 验证
curl http://localhost:3003/api/v1/health
```

---

## 健康检查

### 端点

| 端点 | 用途 | 响应 |
|------|------|------|
| `/api/v1/health` | 基础健康状态 | `{status, timestamp, modules}` |
| `/api/v1/health/ready` | 就绪状态（含数据库检查） | `{status, timestamp, checks}` |

### 响应示例

```json
// GET /api/v1/health
{
  "ok": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-05-21T10:30:00.000Z",
    "modules": {
      "database": "healthy",
      "memory": "healthy"
    }
  },
  "requestId": "req-xxx"
}

// GET /api/v1/health/ready
{
  "ok": true,
  "data": {
    "status": "ready",
    "timestamp": "2026-05-21T10:30:00.000Z",
    "checks": {
      "database": { "status": "pass", "latency_ms": 5 },
      "migrations": { "status": "pass", "version": 53 }
    }
  },
  "requestId": "req-xxx"
}
```

### Kubernetes 探针配置

```yaml
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 3003
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /api/v1/health/ready
    port: 3003
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

---

## 备份与恢复

### 自动备份脚本

创建 `/usr/local/bin/backup-agent-platform.sh`：

```bash
#!/bin/bash
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/agent-platform}"
DB_PATH="${DATABASE_PATH:-/data/agent-platform.db}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# SQLite 备份
if [[ "$DATABASE_URL" == "" ]]; then
  sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/agent-platform-$DATE.db'"
  gzip "$BACKUP_DIR/agent-platform-$DATE.db"
else
  # PostgreSQL 备份
  pg_dump "$DATABASE_URL" > "$BACKUP_DIR/agent-platform-$DATE.sql"
  gzip "$BACKUP_DIR/agent-platform-$DATE.sql"
fi

# 清理旧备份
find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $(ls -t $BACKUP_DIR/*.gz | head -1)"
```

### Cron 定时任务

```cron
# 每天凌晨 2 点执行备份
0 2 * * * /usr/local/bin/backup-agent-platform.sh >> /var/log/agent-platform-backup.log 2>&1
```

### 恢复流程

**SQLite 恢复**：

```bash
# 停止服务
sudo systemctl stop agent-platform

# 解压备份
gunzip /var/backups/agent-platform/agent-platform-YYYYMMDD.db.gz

# 恢复数据库
cp /var/backups/agent-platform/agent-platform-YYYYMMDD.db /data/agent-platform.db

# 启动服务
sudo systemctl start agent-platform

# 验证
curl http://localhost:3003/api/v1/health
```

**PostgreSQL 恢复**：

```bash
# 停止服务
sudo systemctl stop agent-platform

# 恢复数据库
gunzip -c /var/backups/agent-platform/agent-platform-YYYYMMDD.sql.gz | psql "$DATABASE_URL"

# 启动服务
sudo systemctl start agent-platform
```

---

## 监控

### Prometheus 指标

指标端点：`/api/v1/metrics`

### 关键指标

| 指标 | 描述 | 告警阈值 |
|------|------|----------|
| `http_request_duration_seconds` | API 延迟 | P95 > 500ms (警告), > 2s (严重) |
| `http_requests_total` | 请求计数 | - |
| `api_error_rate` | 错误率 | > 5% (警告), > 10% (严重) |
| `llm_latency_seconds` | LLM 延迟 | > 30s (警告) |
| `dlq_entries_count` | 死信队列大小 | > 100 (警告) |
| `database_size_bytes` | 数据库大小 | > 10GB (警告) |

### 告警规则示例

```yaml
groups:
  - name: agent-platform
    rules:
      - alert: APIHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API 延迟过高"

      - alert: APIHighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API 错误率超过 10%"

      - alert: DLQBacklog
        expr: dlq_entries_count > 100
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "死信队列积压"
```

### Grafana Dashboard

导入预配置 Dashboard：参见 [Dashboard 指南](../observability/dashboard-guide.md)。

---

## 故障响应

### 故障等级

| 等级 | 响应时间 | 描述 |
|------|----------|------|
| P0 (严重) | < 5 分钟 | 服务不可用 |
| P1 (高) | < 15 分钟 | 功能严重受损 |
| P2 (中) | < 1 小时 | 功能部分受损 |

### 常见故障处理

#### 1. API 不可用

```bash
# 检查服务状态
sudo systemctl status agent-platform

# 检查日志
journalctl -u agent-platform -n 100

# 检查端口
netstat -tlnp | grep 3003

# 重启服务
sudo systemctl restart agent-platform
```

#### 2. 数据库锁定

```bash
# 检查 SQLite 锁
lsof /data/agent-platform.db

# 检查 WAL 文件
ls -la /data/agent-platform.db-wal

# 重启服务清理锁
sudo systemctl restart agent-platform
```

#### 3. 高内存使用

```bash
# 检查内存使用
free -h
ps aux --sort=-%mem | head -10

# 清理缓存
sync && echo 3 > /proc/sys/vm/drop_caches

# 调整资源限制
export MAX_CACHE_SIZE_MB=128
```

#### 4. 凭证泄露

```bash
# 撤销泄露的 API Key
curl -X DELETE http://localhost:3003/api/v1/api-keys/{key-id} \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 强制登出所有会话
sqlite3 /data/agent-platform.db "DELETE FROM auth_tokens WHERE user_id = 'compromised-user-id'"

# 轮换 APP_SECRET_KEY（需要重新加密所有凭证）
# 注意：这需要数据迁移，请联系支持团队
```

### 故障响应流程

参见 [故障 Runbook](../observability/incident-runbook.md)。

---

## 安全加固

### 反向代理配置 (Nginx)

```nginx
upstream api {
    server 127.0.0.1:3003;
}

upstream web {
    server 127.0.0.1:3002;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    # TLS 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;

    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # API 代理
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 支持
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }

    # Web UI 代理
    location / {
        proxy_pass http://web;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 防火墙配置

```bash
# 允许必要端口
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp

# 启用防火墙
ufw enable
```

---

## 维护日程

| 任务 | 频率 | 自动化 |
|------|------|--------|
| 数据库备份 | 每日 | Cron |
| 日志轮转 | 每周 | logrotate |
| 安全更新 | 每月 | 手动 |
| 密钥轮换 | 每季度 | 手动 |
| 版本升级 | 按需 | 手动 |

---

## 升级流程

```bash
# 1. 备份
/usr/local/bin/backup-agent-platform.sh

# 2. 停止服务
sudo systemctl stop agent-platform-web agent-platform

# 3. 更新代码
git pull origin main

# 4. 安装依赖
npm install
cd web && npm install && cd ..

# 5. 运行迁移
npm run db:migrate

# 6. 构建前端
cd web && npm run build && cd ..

# 7. 启动服务
sudo systemctl start agent-platform agent-platform-web

# 8. 验证
curl http://localhost:3003/api/v1/health
```

---

## 相关文档

- [生产安全模型](../security/production-security-model.md)
- [已知限制](../security/known-limitations.md)
- [环境变量参考](./env-reference.md)
- [PostgreSQL 部署](./postgres.md)
- [故障 Runbook](../observability/incident-runbook.md)
- [SLO/SLI 文档](../observability/slo-sli.md)
