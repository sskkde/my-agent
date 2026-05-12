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
- 默认禁用 Web 搜索（`WEB_SEARCH_BACKEND=none`），可在 `docker-compose.yml` 中配置

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
Production public ingress requires an explicit `HOST=0.0.0.0` environment variable. Setting `NODE_ENV=production` alone does **not** expose the API publicly.
The Vite dev server is always bound to `localhost` and cannot be exposed via environment variables.

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
- **Foreground** - Handles user-facing interactions and sessions
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
| `allowedToolIds` | string[] | Permitted tool IDs |
| `allowedSkillIds` | string[] | Permitted skill IDs |
| `routingTimeoutMs` | number | LLM routing timeout |
| `repairAttempts` | number | JSON repair retry count |

## License

MIT
