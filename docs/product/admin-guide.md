# Agent Platform Admin Guide

> Version: 1.0 (Phase 5)
> Last Updated: 2026-05-13

## Overview

This guide covers administrative tasks for the Agent Platform, including LLM provider configuration, agent settings, security policies, and database management.

---

## LLM Provider Configuration

The platform supports multiple LLM providers. Configure at least one provider before deploying.

### Supported Providers

| Provider | Type | Description |
|----------|------|-------------|
| OpenRouter | `openrouter` | Multi-model API gateway |
| Ollama | `ollama` | Local LLM runtime |

### Configuring OpenRouter

1. Obtain an API key from [OpenRouter](https://openrouter.ai/keys)
2. Set the environment variable:
   ```bash
   OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
   ```
3. Or configure via API:
   ```bash
   POST /api/providers
   {
     "providerType": "openrouter",
     "displayName": "OpenRouter",
     "apiKey": "sk-or-xxxxxxxxxxxx",
     "baseUrl": "https://openrouter.ai/api/v1",
     "selectedModel": "anthropic/claude-3-opus"
   }
   ```

### Configuring Ollama

1. Install and run [Ollama](https://ollama.com/)
2. Pull a model: `ollama pull llama2`
3. Set the environment variable:
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434
   ```
4. Or configure via API:
   ```bash
   POST /api/providers
   {
     "providerType": "ollama",
     "displayName": "Local Ollama",
     "baseUrl": "http://localhost:11434",
     "selectedModel": "llama2"
   }
   ```

### Testing Provider Configuration

```bash
POST /api/providers/:providerId/test
```

This endpoint validates the provider configuration and attempts a test call.

### Mock Mode (Development Only)

For development without an LLM provider:
```bash
MVP_USE_MOCK_LLM=true
```

**Warning**: Never use mock mode in production. It returns deterministic responses without actual AI processing.

---

## Agent Configuration

Agent configuration controls LLM behavior at the agent level. The primary agent is `foreground.default`.

### Configuration Scope

| Scope | Description | Precedence |
|-------|-------------|------------|
| Global | Default for all users | Lowest |
| User Override | Per-user settings | Highest |

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `providerId` | string | Preferred LLM provider |
| `model` | string | Specific model to use |
| `systemPrompt` | string | Base system prompt |
| `routingPrompt` | string | Custom routing instructions |
| `allowedToolIds` | string[] | Permitted tool IDs |
| `allowedSkillIds` | string[] | Permitted skill IDs |
| `routingTimeoutMs` | number | LLM routing timeout (default: 60000) |
| `repairAttempts` | number | JSON repair retries (default: 1) |
| `searchLlmProviderId` | string | Provider for web search summarization |
| `searchLlmModel` | string | Model for web search |

### Global Configuration

```bash
PATCH /api/agents/foreground.default/config
{
  "providerId": "openrouter",
  "model": "anthropic/claude-3-opus",
  "systemPrompt": "You are a helpful assistant...",
  "allowedToolIds": ["search", "read_file", "write_file"],
  "routingTimeoutMs": 60000
}
```

### User Override Configuration

```bash
PATCH /api/agents/foreground.default/config/override
{
  "providerId": "ollama",
  "model": "llama2"
}
```

To reset a user override:
```bash
DELETE /api/agents/foreground.default/config/override
```

### Viewing Current Configuration

```bash
GET /api/agents/foreground.default/config
```

Returns global config, user override, and effective merged config.

---

## Tool Permission Policies

Control which tools are available to the agent.

### Available Tools

| Tool ID | Description | Risk Level |
|---------|-------------|------------|
| `artifact.create` | Create artifacts | Medium |
| `artifact.update` | Update artifacts | Medium |
| `ask_user` | Request user input | Low |
| `status.query` | Query run status | Low |
| `memory.retrieve` | Retrieve memories | Low |
| `transcript.search` | Search transcripts | Low |
| `plan.patch` | Modify execution plan | High |
| `docs.search` | Search documentation | Low |
| `file.read` | Read files | Medium |
| `file.glob` | List files | Low |
| `file.grep` | Search file contents | Medium |
| `session.list` | List sessions | Low |
| `session.history` | View session history | Low |
| `web.fetch` | Fetch web content | Medium |
| `web.search` | Web search | Medium |

### Configuring Tool Permissions

Via agent configuration:
```bash
PATCH /api/agents/foreground.default/config
{
  "allowedToolIds": ["ask_user", "status.query", "memory.retrieve"]
}
```

### Security Considerations

- Limit `file.read`, `file.grep` to trusted environments
- `web.fetch` and `web.search` may expose sensitive queries
- Review connector tool permissions separately

---

## Approval Policies

Sensitive operations require explicit user approval.

### Approval Flow

1. Agent requests to execute a sensitive tool
2. Approval request is created and stored
3. User reviews and responds (approve/reject)
4. Agent proceeds or handles rejection

### Configuring Approval Requirements

Approval requirements are enforced at the tool and connector level. Tools with `requiresApproval: true` will trigger the approval flow.

### Approval API Endpoints

```bash
# List pending approvals
GET /api/approvals?status=pending

# Get approval details
GET /api/approvals/:approvalId

# Respond to approval
POST /api/approvals/:approvalId/respond
{
  "approved": true,
  "reason": "Optional reason for the decision"
}
```

---

## Database Management

### Migrations

The platform uses SQLite with migrations stored in `migrations/`.

**Running migrations:**
```bash
npm run db:migrate
```

**Migration files are auto-applied on server start in development mode.**

### Database Health Check

```bash
npm run db:health
```

Output includes:
- Database file path
- Current schema version
- Table row counts
- Integrity status

### Backup

```bash
npm run db:backup
```

Creates a timestamped backup in `data/backups/`.

**Recommended backup schedule:**
- Daily automated backups for production
- Retain at least 7 days of backups
- Test restore procedures monthly

### Manual Backup

```bash
# Simple file copy
cp data/app.db data/app.db.backup.$(date +%Y%m%d)
```

### Restore

```bash
# Stop the server
# Replace database file
cp data/backups/app.db.20260513 data/app.db
# Restart server
npm run start:api
```

---

## Environment Variables Reference

### Core Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_SECRET_KEY` | Yes | — | Encryption key for API keys (32 hex chars) |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `DATABASE_PATH` | No | `./data/app.db` | SQLite database path |
| `HOST` | No | `localhost` | Server bind address |
| `PORT` | No | `3003` | Server port |

### LLM Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | No* | OpenRouter API key |
| `OLLAMA_BASE_URL` | No* | Ollama server URL |
| `MVP_USE_MOCK_LLM` | No | Enable mock LLM (dev only) |

*At least one provider required unless using mock mode.

### Web Search

| Variable | Description |
|----------|-------------|
| `WEB_SEARCH_BACKEND` | Backend: `auto`, `searxng`, `tavily`, `remote`, `playwright`, `none` |
| `SEARXNG_BASE_URL` | SearXNG instance URL |
| `TAVILY_API_KEY` | Tavily API key |
| `TAVILY_BASE_URL` | Tavily API endpoint |
| `WEB_SEARCH_API_URL` | Legacy remote API URL |
| `WEB_SEARCH_API_KEY` | Legacy remote API key |

### Resource Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_LLM_CALLS` | 2 | Concurrent LLM requests |
| `MAX_CACHE_SIZE_MB` | 256 | Memory cache limit |
| `MAX_CONTEXT_TOKENS` | 8000 | Context window size |

### Connectors

| Variable | Default | Description |
|----------|---------|-------------|
| `CONNECTOR_MODE` | `mock` | Connector mode |
| `GENERIC_HTTP_CONNECTOR_NETWORK` | `disabled` | HTTP connector network access |
| `REPLAY_PREVIEW_ONLY` | `true` | Replay preview safety mode |

### Shutdown

| Variable | Default | Description |
|----------|---------|-------------|
| `SHUTDOWN_TIMEOUT_MS` | 30000 | Graceful shutdown timeout |

---

## Rate Limiting

The platform supports rate limiting via Fastify's rate-limit plugin.

### Default Configuration

Rate limiting is applied globally to all API routes.

### Configuration (via code)

Rate limiting is configured in `src/api/server.ts`. Default settings:
- Time window: 1 minute
- Max requests per window: 100

### Monitoring Rate Limits

Rate limit headers are included in API responses:
- `x-ratelimit-limit`: Maximum requests per window
- `x-ratelimit-remaining`: Remaining requests in current window
- `x-ratelimit-reset`: Unix timestamp when the window resets

---

## Log Level Management

### Available Levels

| Level | Description |
|-------|-------------|
| `trace` | Extremely verbose debugging |
| `debug` | Detailed debugging information |
| `info` | General operational information |
| `warn` | Warning conditions |
| `error` | Error conditions |
| `fatal` | Critical errors |

### Setting Log Level

```bash
LOG_LEVEL=debug npm run start:api
```

### Log Files

Logs are written to stdout/stderr. Use your process manager or container orchestration to capture logs.

**Example with pm2:**
```bash
pm2 start npm --name "agent-api" -- run start:api
pm2 logs agent-api
```

---

## Security Best Practices

### API Key Management

- Never commit API keys to version control
- Use `APP_SECRET_KEY` to encrypt keys at rest
- Rotate keys periodically
- Use environment-specific keys

### Network Security

- Bind to `localhost` by default
- Use `HOST=0.0.0.0` only behind a reverse proxy
- Enable HTTPS via reverse proxy or load balancer
- Configure CORS appropriately

### Access Control

- Review user permissions regularly
- Audit approval history
- Monitor DLQ for suspicious failures

### Data Protection

- Enable regular backups
- Test restore procedures
- Consider encryption at rest for sensitive data
- Implement data retention policies

---

## Monitoring

### Health Endpoints

```bash
# Basic health check
GET /api/health

# Returns: { "status": "ok", "timestamp": "..." }
```

### Observability Console

Access the web UI to monitor:
- Active runs
- Run history
- Failed operations (DLQ)
- Timeline views

### Metrics to Monitor

- Request latency
- Error rates
- LLM API latency
- Database size
- Memory usage

---

## Troubleshooting

See the [Troubleshooting Guide](../troubleshooting.md) for common issues and solutions.
