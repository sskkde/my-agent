# Agent Platform Admin Guide

> Version: 1.1 (Phase 6)
> Last Updated: 2026-05-15

## Overview

This guide covers administrative tasks for the Agent Platform, including LLM provider configuration, agent settings, security policies, RBAC, API key management, and database management.

---

## LLM Provider Configuration

The platform supports multiple LLM providers. Configure at least one provider before deploying.

### Supported Providers

| Provider   | Type         | Description             |
| ---------- | ------------ | ----------------------- |
| OpenRouter | `openrouter` | Multi-model API gateway |
| Ollama     | `ollama`     | Local LLM runtime       |

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

| Scope         | Description           | Precedence |
| ------------- | --------------------- | ---------- |
| Global        | Default for all users | Lowest     |
| User Override | Per-user settings     | Highest    |

### Configuration Fields

| Field                 | Type     | Description                           |
| --------------------- | -------- | ------------------------------------- |
| `providerId`          | string   | Preferred LLM provider                |
| `model`               | string   | Specific model to use                 |
| `systemPrompt`        | string   | Base system prompt                    |
| `routingPrompt`       | string   | Custom routing instructions           |
| `allowedToolIds`      | string[] | Permitted tool IDs                    |
| `allowedSkillIds`     | string[] | Permitted skill IDs                   |
| `routingTimeoutMs`    | number   | LLM routing timeout (default: 60000)  |
| `repairAttempts`      | number   | JSON repair retries (default: 1)      |
| `searchLlmProviderId` | string   | Provider for web search summarization |
| `searchLlmModel`      | string   | Model for web search                  |

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

| Tool ID             | Description           | Risk Level |
| ------------------- | --------------------- | ---------- |
| `artifact.create`   | Create artifacts      | Medium     |
| `artifact.update`   | Update artifacts      | Medium     |
| `ask_user`          | Request user input    | Low        |
| `status.query`      | Query run status      | Low        |
| `memory.retrieve`   | Retrieve memories     | Low        |
| `transcript.search` | Search transcripts    | Low        |
| `plan.patch`        | Modify execution plan | High       |
| `docs.search`       | Search documentation  | Low        |
| `file.read`         | Read files            | Medium     |
| `file.glob`         | List files            | Low        |
| `file.grep`         | Search file contents  | Medium     |
| `session.list`      | List sessions         | Low        |
| `session.history`   | View session history  | Low        |
| `web.fetch`         | Fetch web content     | Medium     |
| `web.search`        | Web search            | Medium     |

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

| Variable         | Required | Default         | Description                                |
| ---------------- | -------- | --------------- | ------------------------------------------ |
| `APP_SECRET_KEY` | Yes      | —               | Encryption key for API keys (32 hex chars) |
| `NODE_ENV`       | No       | `development`   | Environment mode                           |
| `LOG_LEVEL`      | No       | `info`          | Logging verbosity                          |
| `DATABASE_PATH`  | No       | `./data/app.db` | SQLite database path                       |
| `HOST`           | No       | `localhost`     | Server bind address                        |
| `PORT`           | No       | `3003`          | Server port                                |

### LLM Providers

| Variable             | Required | Description                |
| -------------------- | -------- | -------------------------- |
| `OPENROUTER_API_KEY` | No\*     | OpenRouter API key         |
| `OLLAMA_BASE_URL`    | No\*     | Ollama server URL          |
| `MVP_USE_MOCK_LLM`   | No       | Enable mock LLM (dev only) |

\*At least one provider required unless using mock mode.

### Web Search

| Variable             | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `WEB_SEARCH_BACKEND` | Backend: `auto`, `searxng`, `tavily`, `remote`, `playwright`, `none` |
| `SEARXNG_BASE_URL`   | SearXNG instance URL                                                 |
| `TAVILY_API_KEY`     | Tavily API key                                                       |
| `TAVILY_BASE_URL`    | Tavily API endpoint                                                  |
| `WEB_SEARCH_API_URL` | Legacy remote API URL                                                |
| `WEB_SEARCH_API_KEY` | Legacy remote API key                                                |

### Resource Limits

| Variable                   | Default | Description             |
| -------------------------- | ------- | ----------------------- |
| `MAX_CONCURRENT_LLM_CALLS` | 2       | Concurrent LLM requests |
| `MAX_CACHE_SIZE_MB`        | 256     | Memory cache limit      |
| `MAX_CONTEXT_TOKENS`       | 8000    | Context window size     |

### Connectors

| Variable                         | Default    | Description                   |
| -------------------------------- | ---------- | ----------------------------- |
| `CONNECTOR_MODE`                 | `mock`     | Connector mode                |
| `GENERIC_HTTP_CONNECTOR_NETWORK` | `disabled` | HTTP connector network access |
| `REPLAY_PREVIEW_ONLY`            | `true`     | Replay preview safety mode    |

### Shutdown

| Variable              | Default | Description               |
| --------------------- | ------- | ------------------------- |
| `SHUTDOWN_TIMEOUT_MS` | 30000   | Graceful shutdown timeout |

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

| Level   | Description                     |
| ------- | ------------------------------- |
| `trace` | Extremely verbose debugging     |
| `debug` | Detailed debugging information  |
| `info`  | General operational information |
| `warn`  | Warning conditions              |
| `error` | Error conditions                |
| `fatal` | Critical errors                 |

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

## API Auth Token

The platform supports optional Bearer token authentication for API access. This is useful for programmatic access (scripts, CI/CD, integrations) where cookie-based session auth is not practical.

### Enabling API Token Auth

Set the `API_AUTH_TOKEN` environment variable:

```bash
# In .env or environment
API_AUTH_TOKEN=your-secure-token-here
```

When set, all API requests (except exempt paths) must include the `Authorization` header:

```bash
curl -H "Authorization: Bearer your-secure-token-here" http://localhost:3003/api/sessions
```

### Exempt Paths

The following paths do not require token auth:

- `GET /api/health` — Liveness check
- `GET /api/health/ready` — Readiness check
- `GET /api/docs` — Swagger UI
- `GET /api/docs/json` — OpenAPI JSON spec
- `POST /api/setup/user` — Initial user setup
- `GET /api/setup/status` — Setup status
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `GET /api/tools` — Tool catalog
- `/api/webhooks/*` — Webhook endpoints

### Disabling API Token Auth

To disable, simply unset `API_AUTH_TOKEN` or set it to an empty string. When not set, the platform behaves as before — all authenticated endpoints require cookie session auth only.

### Security Notes

- API token auth is **optional** and **off by default** — local development is unaffected.
- Cookie session auth and Bearer token auth can coexist — browser users use cookies, API clients use tokens.
- This is a simple static token check, not RBAC. For role-based access control, see P6/P7 roadmap.
- Use a strong, random token in production (e.g., `openssl rand -hex 32`).

---

## Role-Based Access Control (RBAC)

The platform implements a 3-tier role system for access control.

### Role Hierarchy

| Role      | Description         | Permissions                               |
| --------- | ------------------- | ----------------------------------------- |
| `admin`   | Full system access  | All resources, all actions                |
| `user`    | Standard user       | Own resources CRUD, public resources Read |
| `service` | Programmatic access | Execute on specific resources only        |

### Permission Model

Permissions follow the pattern: `resource:action`

**Resource Types:**

- `session` — Chat sessions
- `run` — Workflow and planner runs
- `workflow` — Workflow definitions
- `trigger` — Trigger configurations
- `connector` — Connector instances
- `approval` — Approval requests
- `memory` — Memory entries
- `settings` — System settings
- `api_key` — API keys (admin only)

**Actions:**

- `create` — Create new resources
- `read` — View resources
- `update` — Modify resources
- `delete` — Remove resources
- `execute` — Run workflows/triggers
- `manage` — Administrative actions

### Role Permissions

**Admin Role:**

- All permissions on all resources
- Can manage other users' resources
- Can create/manage API keys
- Can modify system settings

**User Role:**

- Full CRUD on own resources
- Read access to public resources
- Execute workflows and triggers
- No access to settings or API key management

**Service Role:**

- Execute-only on specific permitted resources
- Used for programmatic integrations
- Limited to explicitly granted permissions

### Configuring User Roles

User roles are assigned during account creation. The first user created via `/api/v1/setup/user` automatically receives the `admin` role.

For subsequent users, roles must be assigned by an existing admin through the user management interface (future feature) or directly via database modification.

### RBAC API Endpoints

RBAC is enforced transparently on all API endpoints. Denied requests return:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Role 'user' cannot perform 'manage' on 'settings'"
  },
  "requestId": "..."
}
```

---

## API Key Management

API keys enable programmatic access to the platform without browser sessions.

### Key Format

- Prefix: `ak_` (identifies as API key Bearer token)
- Length: 32 characters total
- Storage: SHA-256 hashed (only first 8 chars visible for identification)

### Creating API Keys

```bash
POST /api/v1/api-keys
{
  "name": "CI/CD Integration",
  "role": "service",
  "expiresAt": "2027-01-01T00:00:00Z"  // Optional
}
```

Response includes the full key (shown once):

```json
{
  "ok": true,
  "data": {
    "id": "key_abc123",
    "name": "CI/CD Integration",
    "role": "service",
    "key": "ak_xxxxxxxxxxxxxxxxxxxxxxxx", // Save this!
    "prefix": "ak_xxxxxx",
    "expiresAt": "2027-01-01T00:00:00Z"
  }
}
```

**Warning:** The full key is only returned once. Store it securely.

### Listing API Keys

```bash
GET /api/v1/api-keys
```

Returns keys with prefix (for identification), not the full key.

### Revoking API Keys

```bash
DELETE /api/v1/api-keys/:keyId
```

Revoked keys immediately lose access.

### Using API Keys

Include in the `Authorization` header:

```bash
curl -H "Authorization: Bearer ak_xxxxxxxxxxxxxxxxxxxxxxxx" \
  http://localhost:3003/api/v1/sessions
```

### Key Security Best Practices

1. **Rotate regularly** — Create new keys before old ones expire
2. **Use minimal role** — Grant only necessary permissions
3. **Set expiration** — Prevent indefinite access
4. **Revoke immediately** — Delete compromised keys without delay
5. **Never log keys** — Avoid exposing in logs or error messages

### Service Role Keys

Service role API keys are designed for integrations:

- Can have no associated user (pure programmatic access)
- Limited to specific resource types
- Audit trail shows `service` role in run history

---

## API Version Migration (/api/v1/)

Phase 6 introduces the `/api/v1/` prefix for all API endpoints.

### Migration Path

**Legacy endpoints (deprecated):**

- `/api/sessions` → `/api/v1/sessions`
- `/api/workflows` → `/api/v1/workflows`
- `/api/triggers` → `/api/v1/triggers`
- etc.

**Automatic redirects:** Legacy endpoints redirect to `/api/v1/` equivalents with HTTP 307 (preserves POST/PUT body).

### Endpoint Mapping

| Legacy                   | V1                          |
| ------------------------ | --------------------------- |
| `/api/sessions`          | `/api/v1/sessions`          |
| `/api/workflows`         | `/api/v1/workflows`         |
| `/api/triggers`          | `/api/v1/triggers`          |
| `/api/connectors`        | `/api/v1/connectors`        |
| `/api/approvals`         | `/api/v1/approvals`         |
| `/api/agents/:id/config` | `/api/v1/agents/:id/config` |
| `/api/providers`         | `/api/v1/providers`         |
| `/api/metrics`           | `/api/v1/metrics`           |
| `/api/dlq`               | `/api/v1/dlq`               |

### Timeline

- **Phase 6:** `/api/v1/` is the canonical path, legacy redirects active
- **Phase 7:** Legacy paths deprecated with warning headers
- **Phase 8+:** Legacy paths may be removed

### Client Migration

Update API clients to use `/api/v1/` prefix:

```javascript
// Before
const API_BASE = '/api'

// After
const API_BASE = '/api/v1'
```

The web frontend and E2E tests already use `/api/v1/` paths.

---

## Connector Configuration

Connectors enable integration with external systems.

### Available Connector Types

| Type       | Description          | Auth Method      |
| ---------- | -------------------- | ---------------- |
| `github`   | GitHub API           | API Key / OAuth  |
| `slack`    | Slack API            | OAuth2           |
| `calendar` | Google Calendar      | OAuth2           |
| `contacts` | Google Contacts      | OAuth2           |
| `docs`     | Google Docs / Notion | OAuth2 / API Key |
| `web`      | Web Search           | None / API Key   |

### Connector Modes

| Mode   | Description         | Use Case             |
| ------ | ------------------- | -------------------- |
| `mock` | Simulated responses | Development, testing |
| `live` | Real API calls      | Production           |

Set via environment:

```bash
CONNECTOR_MODE=mock  # Development
CONNECTOR_MODE=live   # Production
```

Or per-connector:

```bash
CALENDAR_MOCK_MODE=true
CONTACTS_MOCK_MODE=true
DOCS_MOCK_MODE=true
```

### Creating Connector Instances

1. Navigate to **Connectors** tab in web UI
2. Click "Add Instance"
3. Configure:
   - Name (human-readable)
   - Connector type
   - Authentication credentials
4. Save instance

### Authentication Types

| Type      | Description       | Storage                               |
| --------- | ----------------- | ------------------------------------- |
| `api_key` | Static API key    | Encrypted at rest                     |
| `oauth2`  | OAuth 2.0 flow    | Token encrypted, refresh token stored |
| `basic`   | Username/password | Encrypted at rest                     |

### Connector Security

- Credentials are encrypted using `APP_SECRET_KEY`
- OAuth tokens are refreshed automatically
- Network access controlled via environment variables
- Private IP addresses blocked for HTTP transports

### Mock Connectors

For development without external service access:

```bash
# Enable mock mode globally
CONNECTOR_MODE=mock

# Or per connector type
GITHUB_MOCK_MODE=true
SLACK_MOCK_MODE=true
```

Mock connectors return realistic responses without making real API calls.

---

## Alerting Configuration

The alerting system monitors metrics and sends notifications when conditions are met.

### Alert Rules

Alert rules define conditions that trigger notifications.

**Condition Types:**

- `threshold` — Fire when metric exceeds a value
- `rate` — Fire when metric rate of change exceeds threshold
- `absence` — Fire when no metrics received in window

**Operators:**

- `>` — Greater than
- `<` — Less than
- `>=` — Greater than or equal
- `<=` — Less than or equal
- `==` — Equal to

### Creating Alert Rules

```bash
POST /api/v1/alerts/rules
{
  "name": "High Error Rate",
  "metricModule": "gateway",
  "metricName": "request_errors_total",
  "conditionType": "threshold",
  "operator": ">",
  "threshold": 100,
  "windowSeconds": 300,
  "severity": "warning",
  "webhookUrl": "https://hooks.example.com/alert"
}
```

### Alert Severity Levels

| Level      | Description                  |
| ---------- | ---------------------------- |
| `critical` | Requires immediate attention |
| `warning`  | Needs investigation soon     |
| `info`     | Informational notification   |

### Alert States

| State      | Description                    |
| ---------- | ------------------------------ |
| `idle`     | Condition not met              |
| `firing`   | Condition currently met        |
| `resolved` | Condition was met, now cleared |

### Notification Webhooks

When an alert fires or resolves, POST to configured webhook:

```json
{
  "ruleId": "rule_abc123",
  "ruleName": "High Error Rate",
  "state": "firing",
  "severity": "warning",
  "value": 150,
  "threshold": 100,
  "timestamp": "2026-05-15T10:30:00Z",
  "labels": {
    "module": "gateway"
  }
}
```

### Evaluating Alerts

Alerts are evaluated:

- On schedule (configurable per rule)
- On-demand via API: `POST /api/v1/alerts/rules/:ruleId/evaluate`

### Monitoring Alert Status

```bash
# List all alert states
GET /api/v1/alerts/states

# Get specific alert state
GET /api/v1/alerts/states/:ruleId
```

### Alert Best Practices

1. **Set appropriate windows** — Avoid alert flapping with longer windows
2. **Use severity appropriately** — Reserve `critical` for true incidents
3. **Configure webhooks** — Ensure notifications reach the right team
4. **Review regularly** — Remove or update stale alert rules
5. **Test alerts** — Verify webhook delivery before relying on alerts

---

## Memory Budget Management

Memory budgets control resource consumption per user.

### Budget Periods

| Period        | Reset Behavior                  |
| ------------- | ------------------------------- |
| `daily`       | Resets at midnight UTC          |
| `monthly`     | Resets on the 1st of each month |
| `per_session` | Never resets (session lifetime) |

### Budget Types

- **Token Budget** — LLM token consumption limit
- **Request Budget** — API request count limit
- **Storage Budget** — Memory storage size limit (MB)

### Setting Budgets

Budgets are configured via agent settings or environment defaults:

```bash
# Environment defaults
DEFAULT_TOKEN_BUDGET_DAILY=100000
DEFAULT_REQUEST_BUDGET_DAILY=1000
DEFAULT_STORAGE_BUDGET_MB=256
```

### Budget Monitoring

```bash
# Get current budget usage
GET /api/v1/budget/usage

# Response
{
  "ok": true,
  "data": {
    "period": "daily",
    "used": {
      "tokens": 45000,
      "requests": 120,
      "storageMb": 128
    },
    "limits": {
      "tokens": 100000,
      "requests": 1000,
      "storageMb": 256
    },
    "percentUsed": 45,
    "resetAt": "2026-05-16T00:00:00Z"
  }
}
```

### Budget Exceeded Behavior

When a budget is exceeded:

1. Request returns `BUDGET_EXCEEDED` error
2. Budget usage details included in response
3. Request is logged but not executed
4. Alert fires if configured

---

## Prometheus Metrics

The platform exposes Prometheus-compatible metrics for monitoring.

### Metrics Endpoint

```bash
GET /api/v1/metrics
```

Unauthenticated endpoint for Prometheus scraping.

### Available Metrics

| Metric                                    | Type      | Description                  |
| ----------------------------------------- | --------- | ---------------------------- |
| `agent_platform_request_total`            | Counter   | Total API requests           |
| `agent_platform_request_duration_seconds` | Histogram | Request latency distribution |
| `agent_platform_active_sessions`          | Gauge     | Currently active sessions    |
| `agent_platform_workflow_runs_total`      | Counter   | Workflow executions          |
| `agent_platform_connector_requests_total` | Counter   | Connector API calls          |
| `agent_platform_memory_usage_bytes`       | Gauge     | Memory cache size            |
| `agent_platform_budget_usage_percent`     | Gauge     | Budget utilization           |

### Metric Labels

Default labels on all metrics:

- `service_name` — Platform identifier
- `version` — Platform version
- `instance` — Instance identifier

### Prometheus Configuration

```yaml
scrape_configs:
  - job_name: 'agent-platform'
    static_configs:
      - targets: ['localhost:3003']
    metrics_path: '/api/v1/metrics'
```

---

## OpenTelemetry Tracing

The platform supports OTLP HTTP JSON export for distributed tracing.

### Trace Export

```bash
POST /api/v1/traces/export
{
  "exporterUrl": "https://otel-collector:4318/v1/traces"
}
```

### Trace Attributes

Spans include:

- `session.id` — Session identifier
- `run.id` — Run identifier
- `user.id` — User identifier
- `agent.name` — Agent name
- `tool.id` — Tool identifier
- `connector.type` — Connector type

### Span Status

| Status              | Description            |
| ------------------- | ---------------------- |
| `STATUS_CODE_OK`    | Successful operation   |
| `STATUS_CODE_ERROR` | Failed operation       |
| `STATUS_CODE_UNSET` | In progress or unknown |

---

## Troubleshooting

See the [Troubleshooting Guide](../troubleshooting.md) for common issues and solutions.
