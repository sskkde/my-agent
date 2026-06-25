# Agent Platform

A multi-agent platform for task orchestration and execution. This platform provides a scalable, resource-managed environment for running AI-powered agents with support for LLM providers, background task processing, and robust error handling.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20 or later) - Required for running the TypeScript application
- **SQLite3** - Database for persistent storage
- **npm** - Package manager (comes with Node.js)
- **Docker** (optional) - For containerized deployment

## Docker 快速开始

使用 Docker Compose 可以快速启动整个平台：

```bash
# 构建镜像
docker compose build

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

启动后访问：
- **API**: http://localhost:3003
- **Web UI**: http://localhost:3002

Docker 配置说明：
- 数据持久化存储在 `agent_data` volume
- API 服务包含健康检查，确保服务就绪后再启动 Web
- 默认使用 `WEB_SEARCH_BACKEND=auto`，Docker Compose 可通过内置 SearXNG 服务提供 Web 搜索

## Installation

Clone the repository and install dependencies:

```bash
# Install dependencies
npm install
```

## Database Setup

Initialize the database with migrations:

```bash
# Run database migrations
npm run db:migrate
```

This creates the necessary tables and schema for the agent platform.

## Development

Start the development server:

```bash
# Start in development mode
npm run start:dev
```

## Frontend UI

The platform includes a React-based web UI for interacting with agents.

### Installation

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd web && npm install
```

### Running the Application

Start both the API server and frontend dev server:

```bash
# Start the API server (runs on port 3003)
npm run start:api

# In another terminal, start the frontend (runs on port 3002)
cd web && npm run dev
```

Or use the convenience scripts from the root:

```bash
# Start API server
npm run start:api

# Start frontend dev server
npm run dev:web
```

### Expected Ports

- **API Server**: http://localhost:3003
- **Frontend (Vite)**: http://localhost:3002

### Port Exposure Policy

All servers (API, Vite dev, debug, e2e) bind to `localhost` by default. Binding to `localhost` restricts the service to the local network interface; it does not provide a complete browser-origin security boundary.

**API Server**: Production public ingress requires an explicit `HOST=0.0.0.0` environment variable. Setting `NODE_ENV=production` alone does **not** expose the API publicly.

**Vite Dev Server**: Binds to `localhost` by default but can be overridden via `VITE_HOST` environment variable (e.g., `VITE_HOST=0.0.0.0` for network access). **Security warning**: Exposing Vite to external networks allows anyone with network access to execute arbitrary build commands and access your source code. Only use `VITE_HOST` in trusted development environments.

The Vite configuration includes a hard-coded `allowedHosts: ['agent.nas-1.club']` setting. Future production deployments requiring custom allowed hosts should migrate this to an environment variable (e.g., `VITE_ALLOWED_HOSTS`) with appropriate security validation.

### Building

```bash
# Build frontend for production
cd web && npm run build

# Or use the convenience script
npm run build:web
```

### Testing

```bash
# Run API tests
npm run test:api

# Run frontend tests
cd web && npm test

# Or use the convenience script
npm run test:web
```

### MVP Notes

- The MVP is local-only with no authentication
- Server-Sent Events (SSE) are used for real-time task updates

## MVP 功能

平台提供以下核心功能：

### 会话管理

- 创建和管理对话会话
- 会话历史记录和上下文保持
- 实时消息流（SSE）
- 会话元数据管理

### 审批流程

- 工具调用前的权限审批
- 三态审批响应：拒绝、一次性批准（60分钟）、永久批准（24小时）
- 会话窗口内审批弹窗（SessionConsoleTab）
- 审批请求和响应机制
- 可配置的审批策略
- 审批历史记录

### 工作流

- 多步骤任务编排
- 工作流定义和执行
- 步骤依赖管理
- 错误处理和重试

### 触发器

- 事件驱动的自动化
- 触发器规则配置
- 条件匹配和执行
- 触发器日志
- 定时触发（Cron 调度）
- Webhook 触发器
- 连接器事件触发器

### Runtime Tools

平台提供运行时命令执行工具，支持 shell 命令执行、后台进程管理和代码执行：

- **exec** - 执行 shell 命令，支持超时、后台执行和输出管理
- **bash** - exec 工具的别名
- **process** - 管理后台进程会话（list、poll、kill、clear）
- **code_execution** - 执行 JavaScript/TypeScript/Bash 代码

⚠️ **安全提示**：这些工具不提供沙箱隔离，在代理环境中执行命令。所有工具都需要审批，并具有硬性安全边界（超时限制、输出限制、工作区边界、危险命令拒绝列表）。

详细文档请参阅 [docs/tools.md](docs/tools.md)。

### 连接器管理

- 连接器列表和详情查看
- 连接器实例配置
- 工具和事件清单查看
- Mock 连接器支持

### 可观测性控制台

- 运行列表和状态过滤
- 时间线视图
- 回放预览（只读，无副作用）
- 运行审计和追踪

### 死信队列（DLQ）

- 失败事件捕获和存储
- 重试机制
- 丢弃和审计追踪
- 幂等性保证

### 文件上传

平台支持在会话中上传、下载和删除文件附件。

**上传 API：**

```bash
# 上传文件到会话（multipart/form-data）
POST /api/v1/sessions/:sessionId/files

# 获取文件元数据
GET /api/v1/files/:fileId

# 下载文件内容
GET /api/v1/files/:fileId/download

# 删除文件
DELETE /api/v1/files/:fileId
```

**行为说明：**

- 文本类文件（`.txt`, `.md`, `.csv`, `.json`）在上传时自动提取文本预览，预览内容会注入到 LLM 上下文中
- 二进制文件（图片、PDF 等）仅存储原始字节，LLM 上下文中只包含文件名、MIME 类型和大小等元数据，不包含文件内容
- 文件字节持久化写入磁盘，下载时以流式返回并设置安全响应头

**环境变量（详见 [env-reference.md](docs/deployment/env-reference.md#文件上传配置)）：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UPLOAD_DIR` | `./data/uploads` | 文件存储目录，**生产环境必须挂载持久化卷** |
| `UPLOAD_MAX_FILE_SIZE_BYTES` | `10485760` (10 MiB) | 单个文件大小上限 |
| `UPLOAD_MAX_ATTACHMENTS_PER_MESSAGE` | `5` | 每条消息最大附件数 |
| `UPLOAD_PER_SESSION_QUOTA_BYTES` | `104857600` (100 MiB) | 单会话存储配额 |
| `UPLOAD_PREVIEW_MAX_BYTES` | `4096` | 文本预览提取的最大字节数 |
| `UPLOAD_ALLOWED_MIME_TYPES` | text,image,json,pdf | 允许的 MIME 类型（逗号分隔） |
| `UPLOAD_ALLOWED_EXTENSIONS` | `.txt,.md,.json,.csv,.png,.jpg,.jpeg,.gif,.webp,.pdf` | 允许的扩展名（逗号分隔） |

**持久化要求：** `UPLOAD_DIR` 指向的目录必须位于持久化存储卷上。默认路径 `./data/uploads` 在 Docker 部署中已被 `agent_data` 卷覆盖。如果自定义 `UPLOAD_DIR`，需确保对应目录也做了卷挂载（参见 [Docker 部署指南](docs/deployment/docker.md#file-uploads-storage)）。

### 工作目录（Workdirs）

每个用户拥有隔离的托管工作目录。模型在选定的工作目录内执行文件操作（读取、写入、编辑、搜索、列目录）时无需审批。Shell 命令和代码执行仍需走审批流程。

**托管目录策略：** 模型只能访问用户选定的托管工作目录。不支持任意主机路径。

**环境变量（详见 [env-reference.md](docs/deployment/env-reference.md#工作目录配置)）：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WORKDIR_ROOT` | `./data/workdirs` | 工作目录根路径，**生产环境必须挂载持久化卷** |

**存储配额：**

| 配额 | 默认值 | 说明 |
|------|--------|------|
| 每目录字节上限 | 1 GiB | 单个工作目录的存储空间 |
| 每目录文件数上限 | 100,000 | 单个工作目录中的最大文件数 |
| 目录深度上限 | 10 | 工作目录内的最大嵌套深度 |

**持久化要求：** `WORKDIR_ROOT` 指向的目录必须位于持久化存储卷上。默认路径 `./data/workdirs` 在 Docker 部署中已被 `agent_data` 卷覆盖。如果自定义 `WORKDIR_ROOT`，需确保对应目录也做了卷挂载。

**安全边界：**

- 文件操作（`file_read`, `file_write`, `file_edit`, `file_glob`, `file_grep`, `file_apply_patch`）在选定工作目录内免审批
- `exec`、`code_execution` 等执行工具仍需审批
- 路径穿越（`../`）和符号链接逃逸会被拒绝
- 跨用户隔离由数据库层强制执行
- 不支持访问工作目录之外的任意路径

架构详情参见 [docs/architecture/workdirs.md](docs/architecture/workdirs.md)。

## P6 功能 (Phase 6 Features)

### RBAC 权限控制

- 3 层角色体系（admin > user > service）
- 资源级别权限控制
- 基于权限的 API 访问限制
- 角色继承和权限计算

### API Key 管理

- API Key 创建和管理
- 角色绑定（admin/user/service）
- Key 前缀识别（ak_）
- SHA-256 哈希存储
- 即时撤销机制

### API 版本控制 (/api/v1/)

- 所有 API 端点使用 `/api/v1/` 前缀
- 旧版 `/api/` 自动重定向到 `/api/v1/`
- HTTP 307 重定向保留请求体

### 连接器集成

- GitHub 连接器（API Key / OAuth）
- Google Calendar 连接器（OAuth2）
- Google Contacts 连接器（OAuth2）
- Google Docs / Notion 连接器
- Web Search 连接器
- Mock 模式支持开发测试

### 内存预算管理

- 令牌消耗预算
- API 请求计数预算
- 存储空间预算
- 周期性重置（日/月/会话）
- 预算超限错误处理

### 可观测性增强

- Prometheus 指标导出
- OpenTelemetry 分布式追踪
- 告警规则配置
- Webhook 通知
- 阈值/速率/缺失条件告警

## 开发指南

### 本地开发

```bash
# 安装依赖
npm install
npm --prefix web install

# 运行数据库迁移
npm run db:migrate

# 启动 API 服务（端口 3003）
npm run start:api

# 启动前端开发服务（端口 3002）
npm run dev:web
```

### 测试

```bash
# 运行所有测试
npm test

# 运行单元测试
npm run test:unit

# 运行集成测试
npm run test:integration

# 运行 E2E 测试
npm run test:e2e

# 运行前端测试
npm run test:web
```

### 类型检查

```bash
# 后端类型检查
npm run typecheck

# 前端类型检查
npm --prefix web run typecheck
```

## Testing

Run the test suite to ensure everything works correctly:

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e

# Type check the codebase
npm run typecheck
```

## LLM Provider Configuration

The platform supports multiple LLM providers. Configure your environment variables:

### OpenRouter

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

### Ollama (local)

```bash
OLLAMA_BASE_URL=http://localhost:11434
```

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Then edit `.env` with your actual values.

## Web Search Configuration

The platform supports web search through multiple backends. Configure your preferred search provider:

### Backend Options

| Backend | Description | Requirements |
|---------|-------------|--------------|
| `auto` | Default. Tries SearXNG → Tavily → Remote API | At least one lightweight provider configured |
| `searxng` | Self-hosted SearXNG instance | `SEARXNG_BASE_URL` |
| `tavily` | Tavily API service | `TAVILY_API_KEY` |
| `remote` | Custom remote search API | `WEB_SEARCH_API_URL` + `WEB_SEARCH_API_KEY` |
| `playwright` | Browser-based DuckDuckGo scraping | `npm run install:playwright` |
| `auto-browser` | Tries lightweight providers → Playwright fallback | Playwright installed |
| `none` | Disable web search | None |

### Environment Variables

```bash
# Backend selection (default: auto)
WEB_SEARCH_BACKEND=auto

# SearXNG (lightweight, self-hosted)
SEARXNG_BASE_URL=http://localhost:8080

# Tavily (API-based)
TAVILY_API_KEY=your_tavily_api_key_here
TAVILY_BASE_URL=https://api.tavily.com  # Optional

# Legacy Remote API
WEB_SEARCH_API_URL=https://your-search-api.example.com/search
WEB_SEARCH_API_KEY=your_api_key_here
```

### Playwright Setup (Optional)

For browser-based search fallback, install Chromium:

```bash
npm run install:playwright
```

This is only required if you use `playwright` or `auto-browser` backend modes. Default `auto` mode does not require Playwright.

### Search LLM Configuration

Configure a dedicated LLM for web search summarization through Agent Configuration API:

```bash
PATCH /api/agents/foreground.default/config/global
{
  "searchLlmProviderId": "ollama",
  "searchLlmModel": "llama2"
}
```

Fields:
- `searchLlmProviderId`: Provider ID for search LLM (must support function calling)
- `searchLlmModel`: Model ID for search LLM

These fields follow the same inheritance semantics as `providerId`/`model`: null inherits from global, explicit string overrides.

## Architecture Overview

The agent platform is built around a modular architecture with clear separation of concerns:

**Core Components:**

- **Gateway** - Entry point for all incoming requests
- **Foreground** - Handles user-facing interactions and sessions via kernel-driven architecture
- **Planner** - Plans and orchestrates task execution
- **Dispatcher** - Routes tasks to appropriate subagents
- **Kernel** - Core execution engine for agent logic
- **Tools** - External integrations and capabilities
- **Permissions** - Access control and approval workflows
- **Context** - Session and state management
- **Memory** - Resource limits, caching, and budget management
- **Subagents** - Background task processing
- **Workflows** - Multi-step process definitions
- **Triggers** - Event-driven automation
- **Connectors** - External system integrations
- **Observability** - Metrics, tracing, and monitoring
- **Storage** - Database connection and persistence layer

**Foreground Processing Flow:**

The foreground agent processes user messages through a kernel-driven architecture:

```
ProcessorOrchestration → ForegroundAgent.runTurn() → AgentKernel.run() → projected tools → final response
```

1. **ProcessorOrchestration** hydrates session state and resolves LLM provider/model
2. **ForegroundAgent.runTurn()** builds context bundle and projects safe tools (read/search/internal)
3. **AgentKernel.run()** executes LLM calls with tool loop
4. **Tool Projection** ensures foreground agents only access safe tool categories
5. **Response** is mapped back through the pipeline with transcript persistence

## Runtime Tools

The platform includes runtime command-execution tools for executing shell commands and code:

- **exec** - Execute shell commands with validation, timeout, and output management
- **bash** - Alias for exec tool
- **process** - Manage background process sessions (list, poll, kill, clear)
- **code_execution** - Execute JavaScript/TypeScript/Bash code with temp file cleanup

These tools execute commands in the same environment as the agent with controlled execution, approval requirements, timeouts, and output caps. **They do NOT provide a sandbox.**

For detailed documentation, security boundaries, and usage examples, see [docs/tools.md](docs/tools.md).

## Directory Structure

```
.
├── src/
│   ├── shared/         # Shared types and utilities
│   ├── storage/        # Database and persistence
│   ├── gateway/        # Request gateway
│   ├── foreground/     # User session handling
│   ├── planner/        # Task planning
│   ├── dispatcher/     # Task routing
│   ├── kernel/         # Core execution
│   ├── tools/          # Tool integrations
│   ├── permissions/    # Access control
│   ├── context/        # State management
│   ├── memory/         # Caching and limits
│   ├── subagents/      # Background processing
│   ├── workflows/      # Workflow engine
│   ├── triggers/       # Event triggers
│   ├── connectors/     # External connections
│   ├── observability/  # Monitoring and tracing
│   └── runtime/        # Bootstrap and resource management
├── tests/
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   ├── e2e/            # End-to-end tests
│   ├── fixtures/       # Test data
│   └── docs/           # Documentation tests
├── docs/               # Documentation
├── migrations/         # Database migrations
└── data/               # SQLite database files
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:phase4` | Run Phase 4 specific tests |
| `npm run test:api` | Run API integration tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run start:dev` | Start development server |
| `npm run start:api` | Start API server |
| `npm run dev:web` | Start frontend dev server |
| `npm run build:web` | Build frontend for production |
| `npm run test:web` | Run frontend tests |
| `npm run db:migrate` | Run database migrations |
| `npm run db:health` | Check database health |
| `npm run db:backup` | Backup database |

## Control and Agent Configuration

The platform supports fine-grained control over LLM behavior through agent configuration with scope-based overrides.

### Agent Configuration Scope

Agent configuration follows a hierarchical scope model:

- **Global Scope**: Default configuration applied to all users
- **User Scope**: Per-user overrides that take precedence over global settings

### Configuration Precedence

When resolving agent configuration, the following precedence is applied (highest to lowest):

1. **Session Override**: Temporary runtime overrides (future feature)
2. **Agent Config**: Per-agent settings (e.g., `foreground.default`)
3. **User Provider Defaults**: User-configured LLM provider preferences
4. **Environment Providers**: System-level provider configuration from environment variables

### Model/Provider Precedence

For LLM provider and model selection:

```
session_override > agent_config > user_provider_defaults > env_providers
```

### Configuration Fallback Behavior

When a provider/model fails:

1. **Best-effort fallback**: Automatically try alternative providers
2. **Observable events**: Log and emit events for fallback attempts
3. **User notification**: Inform user when fallback occurs

### LLM Bypass Policy

The platform implements minimal LLM bypass for specific scenarios:

1. **Approval Metadata**: Routes approval responses directly without LLM processing
2. **No-Provider Scenarios**: Returns immediate error when no LLM provider is configured

```typescript
// Bypass 1: Approval responses
if (input.metadata?.isApprovalResponse) {
  return { route: 'approval_handler', ... };
}

// Bypass 2: No provider available
if (!this.llmAdapter) {
  return { route: 'answer_directly', userVisibleResponse: 'No AI provider configured.' };
}
```

### API Versioning

Phase 6 introduces the `/api/v1/` prefix for all API endpoints:

- **Canonical path**: All endpoints use `/api/v1/` prefix
- **Legacy redirect**: `/api/` paths redirect to `/api/v1/` with HTTP 307
- **Migration timeline**: 
  - Phase 6: `/api/v1/` is canonical, redirects active
  - Phase 7: Legacy paths deprecated with warning headers
  - Phase 8+: Legacy paths may be removed

**Client migration example:**
```javascript
// Before
const API_BASE = '/api';

// After
const API_BASE = '/api/v1';
```

The web frontend and E2E tests already use `/api/v1/` paths.

### V1 API Endpoints

#### Agent Configuration API

```bash
# Get agent configuration (returns global, userOverride, and effective config)
GET /api/v1/agents/:agentId/config

# Update global default configuration (admin scope)
PATCH /api/v1/agents/:agentId/config
Content-Type: application/json
{
  "providerId": "openrouter",
  "model": "anthropic/claude-3-opus",
  "systemPrompt": "You are a helpful assistant...",
  "routingPrompt": "Route tasks based on complexity...",
  "allowedToolIds": ["search", "read_file"],
  "allowedSkillIds": ["code-review"],
  "routingTimeoutMs": 60000,
  "repairAttempts": 1
}

# Get current user's override configuration
GET /api/v1/agents/:agentId/config/override

# Update user override configuration
PATCH /api/v1/agents/:agentId/config/override
Content-Type: application/json
{
  "providerId": "ollama",
  "model": "llama2",
  "systemPrompt": "Personal system prompt...",
  "routingPrompt": "Personal routing prompt...",
  "allowedToolIds": ["search"],
  "allowedSkillIds": [],
  "routingTimeoutMs": 15000,
  "repairAttempts": 1
}

# Reset user override to global defaults
DELETE /api/v1/agents/:agentId/config/override
```

#### Provider Configuration API

```bash
# List all configured providers
GET /api/v1/providers

# Get a specific provider configuration
GET /api/v1/providers/:providerId

# Create a new provider configuration
POST /api/v1/providers
Content-Type: application/json
{
  "providerType": "openrouter",
  "displayName": "OpenRouter",
  "apiKey": "sk-or-...",
  "baseUrl": "https://openrouter.ai/api/v1",
  "selectedModel": "anthropic/claude-3-opus"
}

# Update a provider configuration
PATCH /api/v1/providers/:providerId
Content-Type: application/json
{
  "displayName": "Updated Name",
  "enabled": true
}

# Delete a provider configuration
DELETE /api/v1/providers/:providerId

# Test a provider configuration
POST /api/v1/providers/:providerId/test
```

#### Session Management API

```bash
# Create a new session
POST /api/v1/sessions
Content-Type: application/json
{
  "userId": "user-123"
}

# Get session details
GET /api/v1/sessions/:sessionId

# Send a message to a session
POST /api/v1/sessions/:sessionId/messages
Content-Type: application/json
{
  "text": "Hello, how are you?"
}

# Get session transcript
GET /api/v1/sessions/:sessionId/transcript
```

#### Tool Catalog API

```bash
# List all available tools
GET /api/v1/tools

# Get a specific tool definition
GET /api/v1/tools/:toolId
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Human-readable agent name |
| `enabled` | boolean | Whether the agent is active |
| `systemPrompt` | string | Base system prompt for the agent |
| `routingPrompt` | string | Custom routing instructions |
| `providerId` | string | Preferred LLM provider |
| `model` | string | Specific model to use |
| `allowedToolIds` | string[] | Permitted tool IDs (tools execute actions) |
| `allowedSkillIds` | string[] \| null | Permitted skill IDs (skills are documentation-only). See [Skill Allowlist Semantics](#skill-allowlist-semantics) |
| `routingTimeoutMs` | number | LLM routing timeout |
| `repairAttempts` | number | JSON repair retry count |

### Skill Allowlist Semantics

The `allowedSkillIds` field controls which documentation-only skills are visible to an agent. Skills are **not** executable — they provide guidance text that is injected into the model's context. Tools remain the only execution surface.

| Value | Behavior |
|-------|----------|
| `null` (or omitted) | Inherits defaults from the agent profile and agent-type envelope |
| `[]` (empty array) | No skills — the agent receives no skill documentation |
| `["skill-a", "skill-b"]` (explicit list) | Intersects with the agent-type envelope; only skills in both the list and the envelope are projected |

### Skills vs Tools

| Aspect | Skills | Tools |
|--------|--------|-------|
| **Purpose** | Documentation and guidance for the LLM | Executable actions with side effects |
| **Execution** | None — skills are prompt-visible text only | Tools execute code, API calls, file operations |
| **API surface** | `GET /api/v1/skills` (read-only catalog) | `GET /api/v1/tools` + runtime execution |
| **Run endpoint** | None — no `/skills/:id/run` | Tools are invoked during agent runs |
| **Permission model** | `allowedSkillIds` + agent-type envelope | `allowedToolIds` + approval policies |

### Skill System

Skills are **documentation-only records** — metadata plus lazily-loaded markdown instructions. They provide context and guidance to the LLM without executing code.

**Key characteristics:**
- Skills are loaded from a source-controlled registry (built-in, user, plugin, or remote sources)
- Skill descriptions are lazy-loaded: catalog endpoints return metadata only; full documents load on demand
- Each agent type (`main`, `subagent`, `background`, `workflow_step`, `remote`) has its own skill envelope
- Skills cannot contain handlers, scripts, shell commands, or executable code
- Skills are rendered in the model input as documentation text, separate from tool schemas

For detailed skill documentation, see [docs/skills.md](docs/skills.md).

## License

MIT
