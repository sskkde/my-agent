# 环境变量参考

> 版本: v0.8.0 GA
> 最后更新: 2026-05-21

本文档列出 Agent Platform 的所有环境变量，包括用途、默认值和生产环境要求。

---

## 目录

1. [核心配置](#核心配置)
2. [安全配置](#安全配置)
3. [数据库配置](#数据库配置)
4. [LLM Provider 配置](#llm-provider-配置)
5. [Web 搜索配置](#web-搜索配置)
6. [连接器配置](#连接器配置)
7. [资源限制配置](#资源限制配置)
8. [文件上传配置](#文件上传配置)
9. [运行时配置](#运行时配置)
10. [OAuth 配置](#oauth-配置)
11. [生产环境必需变量](#生产环境必需变量)

---

## 核心配置

### NODE_ENV

| 属性 | 值 |
|------|-----|
| **用途** | 环境标识（development/production/test） |
| **默认值** | `development` |
| **生产要求** | 必须设置为 `production` |

**影响**：
- `production`: 启用生产安全检查、CORS 限制、Cookie Secure 标志
- `development`: 宽松的安全配置，便于本地开发
- `test`: 测试模式，使用内存数据库

---

### LOG_LEVEL

| 属性 | 值 |
|------|-----|
| **用途** | 日志输出级别 |
| **默认值** | `info` |
| **可选值** | `debug`, `info`, `warn`, `error` |
| **生产要求** | 不能设置为 `debug` |

**示例**：
```bash
LOG_LEVEL=info
```

---

### PORT

| 属性 | 值 |
|------|-----|
| **用途** | API 服务监听端口 |
| **默认值** | `3003` |
| **范围** | 0-65535 |
| **生产要求** | 可选，使用默认值或自定义 |

**示例**：
```bash
PORT=3003
```

---

### HOST

| 属性 | 值 |
|------|-----|
| **用途** | API 服务绑定地址 |
| **默认值** | `localhost` |
| **生产要求** | 公开访问需设置为 `0.0.0.0` |

**重要**：`NODE_ENV=production` 不会自动暴露服务。公开访问必须显式设置 `HOST=0.0.0.0`。

**示例**：
```bash
# 本地开发（默认）
HOST=localhost

# 生产公开访问
HOST=0.0.0.0
```

---

### PUBLIC_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | 应用的公开访问 URL |
| **默认值** | 无 |
| **生产要求** | **必需** |

用于 OAuth 回调 URL 生成和外部链接。

**示例**：
```bash
PUBLIC_BASE_URL=https://app.example.com
```

---

### SHUTDOWN_TIMEOUT_MS

| 属性 | 值 |
|------|-----|
| **用途** | 优雅关闭超时时间（毫秒） |
| **默认值** | `30000` (30秒) |
| **生产要求** | 可选 |

---

## 安全配置

### APP_SECRET_KEY

| 属性 | 值 |
|------|-----|
| **用途** | 加密密钥（用于 Provider API Key、OAuth Token 等） |
| **默认值** | 无 |
| **生产要求** | **必需**，至少 32 字符 |

**生成方式**：
```bash
openssl rand -hex 32
```

**安全要求**：
- 不能使用占位符（如 `your_secret_key`, `changeme`）
- 应定期轮换（建议每季度）
- 泄露后需重新加密所有凭证

---

### API_AUTH_TOKEN

| 属性 | 值 |
|------|-----|
| **用途** | 引导认证令牌（Bearer Token） |
| **默认值** | 无 |
| **生产要求** | 至少设置 `API_AUTH_TOKEN` 或创建 API Key |

用于初始系统设置和紧急访问。建议在初始设置后轮换。

**使用方式**：
```http
Authorization: Bearer <API_AUTH_TOKEN>
```

---

### API_KEY_BOOTSTRAP

| 属性 | 值 |
|------|-----|
| **用途** | API Key 引导标志 |
| **默认值** | 无 |
| **生产要求** | 若未设置 `API_AUTH_TOKEN`，需配置此变量 |

当 `API_AUTH_TOKEN` 未设置时，检查是否已有 API Key 存在。

---

### ALLOWED_ORIGINS

| 属性 | 值 |
|------|-----|
| **用途** | CORS 允许的源（逗号分隔） |
| **默认值** | 无 |
| **生产要求** | **必需**，不能使用 `*` |

**示例**：
```bash
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

**开发环境**：自动允许所有源（`origin: true`）

---

### COOKIE_SECURE

| 属性 | 值 |
|------|-----|
| **用途** | Cookie Secure 标志 |
| **默认值** | 无（开发环境自动为 false） |
| **生产要求** | **必需**，必须为 `true` |

**示例**：
```bash
COOKIE_SECURE=true
```

---

### TRUST_PROXY

| 属性 | 值 |
|------|-----|
| **用途** | 信任代理配置（用于获取真实 IP） |
| **默认值** | 无 |
| **生产要求** | **必需** |

**可选值**：
- `true` 或 `1`：信任所有代理
- 逗号分隔的 IP 列表：信任指定代理

**示例**：
```bash
# 信任所有代理
TRUST_PROXY=1

# 信任指定代理
TRUST_PROXY=10.0.0.1,10.0.0.2
```

---

## 数据库配置

### DATABASE_PATH

| 属性 | 值 |
|------|-----|
| **用途** | SQLite 数据库文件路径 |
| **默认值** | `./data/app.db` |
| **生产要求** | 必须设置 `DATABASE_PATH` 或 `DATABASE_URL` |

**示例**：
```bash
DATABASE_PATH=/data/agent-platform.db
```

---

### DATABASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | PostgreSQL 连接字符串 |
| **默认值** | 无 |
| **生产要求** | 若使用 PostgreSQL 则必需 |

**格式**：
```bash
DATABASE_URL=postgresql://user:password@host:5432/database
```

**注意**：设置 `DATABASE_URL` 时，系统自动使用 PostgreSQL 模式。

---

### BACKUP_DIR

| 属性 | 值 |
|------|-----|
| **用途** | 数据库备份目录 |
| **默认值** | 无 |
| **生产要求** | **必需** |

**示例**：
```bash
BACKUP_DIR=/var/backups/agent-platform
```

---

## LLM Provider 配置

至少配置一个 Provider。

### OPENROUTER_API_KEY

| 属性 | 值 |
|------|-----|
| **用途** | OpenRouter API Key |
| **默认值** | 无 |
| **生产要求** | 至少配置一个 Provider |

**示例**：
```bash
OPENROUTER_API_KEY=sk-or-xxx
```

---

### OPENROUTER_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | OpenRouter API 基础 URL |
| **默认值** | `https://openrouter.ai/api/v1` |
| **生产要求** | 可选 |

---

### OPENAI_API_KEY

| 属性 | 值 |
|------|-----|
| **用途** | OpenAI API Key |
| **默认值** | 无 |
| **生产要求** | 至少配置一个 Provider |

---

### OPENAI_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | OpenAI API 基础 URL（用于自定义端点） |
| **默认值** | 无 |
| **生产要求** | 可选 |

---

### OLLAMA_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | Ollama 服务 URL |
| **默认值** | `http://localhost:11434` |
| **生产要求** | 若使用 Ollama 则必需 |

---

### MVP_USE_MOCK_LLM

| 属性 | 值 |
|------|-----|
| **用途** | 使用 Mock LLM（用于开发/测试） |
| **默认值** | `false` |
| **生产要求** | **禁止使用** |

**注意**：不要在生产环境设置此变量。

---

## Web 搜索配置

### WEB_SEARCH_BACKEND

| 属性 | 值 |
|------|-----|
| **用途** | Web 搜索后端选择 |
| **默认值** | `auto` |
| **可选值** | `auto`, `searxng`, `tavily`, `remote`, `playwright`, `auto-browser`, `none` |

**后端说明**：

| 后端 | 描述 | 要求 |
|------|------|------|
| `auto` | 自动选择（SearXNG → Tavily → Remote） | 至少配置一个轻量级 Provider |
| `searxng` | 自托管 SearXNG | `SEARXNG_BASE_URL` |
| `tavily` | Tavily API | `TAVILY_API_KEY` |
| `remote` | 自定义搜索 API | `WEB_SEARCH_API_URL` + `WEB_SEARCH_API_KEY` |
| `playwright` | 通过 CloakBrowser 兼容 Playwright 的浏览器抓取 DuckDuckGo | 已安装 CloakBrowser 浏览器二进制 |
| `auto-browser` | 轻量级 → CloakBrowser 回退 | 已安装 CloakBrowser 浏览器二进制 |
| `none` | 禁用 Web 搜索 | 无 |

---

### SEARXNG_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | SearXNG 实例 URL |
| **默认值** | 无 |
| **生产要求** | 使用 SearXNG 后端时必需 |

---

### TAVILY_API_KEY

| 属性 | 值 |
|------|-----|
| **用途** | Tavily API Key |
| **默认值** | 无 |
| **生产要求** | 使用 Tavily 后端时必需 |

---

### TAVILY_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | Tavily API 端点 |
| **默认值** | `https://api.tavily.com` |
| **生产要求** | 可选 |

---

### WEB_SEARCH_API_URL

| 属性 | 值 |
|------|-----|
| **用途** | 遗留远程搜索 API URL |
| **默认值** | 无 |
| **生产要求** | 使用 Remote 后端时必需 |

---

### WEB_SEARCH_API_KEY

| 属性 | 值 |
|------|-----|
| **用途** | 遗留远程搜索 API Key |
| **默认值** | 无 |
| **生产要求** | 使用 Remote 后端时必需 |

---

## 连接器配置

### CONNECTOR_MODE

| 属性 | 值 |
|------|-----|
| **用途** | 连接器模式 |
| **默认值** | `mock` |
| **可选值** | `mock`, `production` |
| **生产要求** | 建议使用 `production` |

---

### GENERIC_HTTP_CONNECTOR_NETWORK

| 属性 | 值 |
|------|-----|
| **用途** | 通用 HTTP 连接器网络访问 |
| **默认值** | `disabled` |
| **可选值** | `enabled`, `disabled` |
| **生产要求** | 仅在可信环境启用 |

**安全警告**：启用后允许连接器访问任意 HTTP 端点，可能导致 SSRF 攻击。

---

### GENERIC_HTTP_MOCK_MODE

| 属性 | 值 |
|------|-----|
| **用途** | 通用 HTTP 连接器 Mock 模式 |
| **默认值** | 无（取决于 `CONNECTOR_MODE`） |
| **可选值** | `true`, `false` |

---

### CALENDAR_MOCK_MODE

| 属性 | 值 |
|------|-----|
| **用途** | 日历连接器 Mock 模式 |
| **默认值** | 无 |

---

### CONTACTS_MOCK_MODE

| 属性 | 值 |
|------|-----|
| **用途** | 联系人连接器 Mock 模式 |
| **默认值** | 无 |

---

### DOCS_MOCK_MODE

| 属性 | 值 |
|------|-----|
| **用途** | 文档连接器 Mock 模式 |
| **默认值** | 无 |

---

### REPLAY_PREVIEW_ONLY

| 属性 | 值 |
|------|-----|
| **用途** | 回放预览模式（只读，无副作用） |
| **默认值** | `true` |
| **生产要求** | 建议保持 `true` |

---

## 资源限制配置

### MAX_CONCURRENT_LLM_CALLS

| 属性 | 值 |
|------|-----|
| **用途** | 最大并发 LLM 调用数 |
| **默认值** | `2` |
| **生产要求** | 可选 |

---

### MAX_CACHE_SIZE_MB

| 属性 | 值 |
|------|-----|
| **用途** | 内存缓存最大大小（MB） |
| **默认值** | `256` |
| **生产要求** | 可选 |

---

### MAX_CONTEXT_TOKENS

| 属性 | 值 |
|------|-----|
| **用途** | 上下文窗口大小 |
| **默认值** | `8000` |
| **生产要求** | 可选 |

---

## 文件上传配置

### UPLOAD_DIR

| 属性 | 值 |
|------|-----|
| **用途** | 文件上传存储目录 |
| **默认值** | `./data/uploads` |
| **生产要求** | 建议设置为持久化存储路径 |

**示例**：
```bash
UPLOAD_DIR=/data/uploads
```

---

### UPLOAD_MAX_FILE_SIZE_BYTES

| 属性 | 值 |
|------|-----|
| **用途** | 单个文件最大大小（字节） |
| **默认值** | `10485760` (10 MiB) |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_MAX_FILE_SIZE_BYTES=10485760
```

---

### UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE

| 属性 | 值 |
|------|-----|
| **用途** | 每条消息最大附件数 |
| **默认值** | `5` |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE=5
```

---

### UPLOAD_ALLOWED_MIME_TYPES

| 属性 | 值 |
|------|-----|
| **用途** | 允许上传的 MIME 类型（逗号分隔） |
| **默认值** | `text/plain,text/markdown,text/csv,application/json,image/png,image/jpeg,image/gif,image/webp,application/pdf` |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_ALLOWED_MIME_TYPES=text/plain,text/markdown,application/json,image/png,image/jpeg,application/pdf
```

---

### UPLOAD_ALLOWED_EXTENSIONS

| 属性 | 值 |
|------|-----|
| **用途** | 允许上传的文件扩展名（逗号分隔，含前导点） |
| **默认值** | `.txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf` |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_ALLOWED_EXTENSIONS=.txt,.md,.json,.png,.jpg,.pdf
```

---

### UPLOAD_PER_SESSION_QUOTA_BYTES

| 属性 | 值 |
|------|-----|
| **用途** | 单个会话的存储配额（字节） |
| **默认值** | `104857600` (100 MiB) |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_PER_SESSION_QUOTA_BYTES=104857600
```

---

### UPLOAD_PREVIEW_MAX_BYTES

| 属性 | 值 |
|------|-----|
| **用途** | 文本预览提取的最大字节数 |
| **默认值** | `4096` |
| **生产要求** | 可选 |

**示例**：
```bash
UPLOAD_PREVIEW_MAX_BYTES=4096
```

---

## 运行时配置

### HOSTNAME

| 属性 | 值 |
|------|-----|
| **用途** | 实例主机名（用于监控标识） |
| **默认值** | `local-1` |
| **生产要求** | 可选 |

---

### API_BASE_URL

| 属性 | 值 |
|------|-----|
| **用途** | CLI 工具使用的 API 基础 URL |
| **默认值** | `http://localhost:3003` |
| **生产要求** | 可选 |

---

## OAuth 配置

### GOOGLE_CLIENT_ID

| 属性 | 值 |
|------|-----|
| **用途** | Google OAuth 客户端 ID |
| **默认值** | 无 |
| **生产要求** | 使用 Google OAuth 时必需 |

---

### GOOGLE_CLIENT_SECRET

| 属性 | 值 |
|------|-----|
| **用途** | Google OAuth 客户端密钥 |
| **默认值** | 无 |
| **生产要求** | 使用 Google OAuth 时必需 |

---

## 生产环境必需变量

以下变量在生产环境（`NODE_ENV=production`）中**必须**设置：

| 变量 | 要求 |
|------|------|
| `APP_SECRET_KEY` | 必需，≥32 字符，非占位符 |
| `NODE_ENV` | 必需，必须为 `production` |
| `ALLOWED_ORIGINS` | 必需，显式 URL 列表，不能为 `*` |
| `DATABASE_PATH` 或 `DATABASE_URL` | 必需 |
| `PUBLIC_BASE_URL` | 必需，有效 HTTP/HTTPS URL |
| `COOKIE_SECURE` | 必需，必须为 `true` |
| `TRUST_PROXY` | 必需 |
| `BACKUP_DIR` | 必需 |
| `LOG_LEVEL` | 不能为 `debug` |
| `API_AUTH_TOKEN` 或 API Key | 至少配置一种认证方式 |

**生产环境启动检查**：

系统启动时会自动验证生产配置。如验证失败：
- 服务拒绝启动
- 控制台输出明确的错误信息
- 进程以非零状态码退出

---

## 快速参考表

### 核心变量

| 变量 | 默认值 | 生产必需 |
|------|--------|----------|
| `NODE_ENV` | `development` | ✓ |
| `LOG_LEVEL` | `info` | ✓ (非debug) |
| `PORT` | `3003` | - |
| `HOST` | `localhost` | 公开访问需 `0.0.0.0` |
| `PUBLIC_BASE_URL` | - | ✓ |

### 安全变量

| 变量 | 默认值 | 生产必需 |
|------|--------|----------|
| `APP_SECRET_KEY` | - | ✓ |
| `API_AUTH_TOKEN` | - | ✓ (或API Key) |
| `ALLOWED_ORIGINS` | - | ✓ |
| `COOKIE_SECURE` | - | ✓ |
| `TRUST_PROXY` | - | ✓ |

### 数据库变量

| 变量 | 默认值 | 生产必需 |
|------|--------|----------|
| `DATABASE_PATH` | `./data/app.db` | ✓ (或DATABASE_URL) |
| `DATABASE_URL` | - | - |
| `BACKUP_DIR` | - | ✓ |

### LLM Provider 变量

| 变量 | 默认值 | 生产必需 |
|------|--------|----------|
| `OPENROUTER_API_KEY` | - | 至少一个 |
| `OPENAI_API_KEY` | - | - |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | - |

### 文件上传变量

| 变量 | 默认值 | 生产必需 |
|------|--------|----------|
| `UPLOAD_DIR` | `./data/uploads` | 建议持久化路径 |
| `UPLOAD_MAX_FILE_SIZE_BYTES` | `10485760` (10 MiB) | - |
| `UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE` | `5` | - |
| `UPLOAD_ALLOWED_MIME_TYPES` | text,image,json,pdf | - |
| `UPLOAD_ALLOWED_EXTENSIONS` | .txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf | - |
| `UPLOAD_PER_SESSION_QUOTA_BYTES` | `104857600` (100 MiB) | - |
| `UPLOAD_PREVIEW_MAX_BYTES` | `4096` | - |

---

## 相关文档

- [生产部署指南](./production.md)
- [生产安全模型](../security/production-security-model.md)
- [已知限制](../security/known-limitations.md)
