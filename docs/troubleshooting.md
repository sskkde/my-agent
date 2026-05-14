# Troubleshooting Guide

> Version: 1.0 (Phase 5)
> Last Updated: 2026-05-13

## Quick Reference

| Issue | Section |
|-------|---------|
| Server won't start | [Startup Errors](#startup-errors) |
| Database migration failed | [Database Migration Issues](#database-migration-issues) |
| LLM not responding | [LLM Provider Connection Failures](#llm-provider-connection-failures) |
| Webhooks not delivered | [Webhook Delivery Failures](#webhook-delivery-failures) |
| Slow performance | [Memory and Performance Issues](#memory-and-performance-issues) |
| Rate limit errors | [Rate Limiting Issues](#rate-limiting-issues) |

---

## Startup Errors

### Error: "APP_SECRET_KEY is required"

**Cause**: The encryption key for API keys is not configured.

**Solution**:
```bash
# Generate a secure key
openssl rand -hex 32

# Set in environment
export APP_SECRET_KEY=<generated-key>

# Or in .env file
echo "APP_SECRET_KEY=<generated-key>" >> .env
```

### Error: "Port 3003 already in use"

**Cause**: Another process is using the port.

**Solution**:
```bash
# Find the process
lsof -i :3003

# Kill the process (if safe)
kill -9 <PID>

# Or use a different port
PORT=3004 npm run start:api
```

### Error: "Cannot find module"

**Cause**: Dependencies not installed.

**Solution**:
```bash
# Install dependencies
npm install

# For frontend
cd web && npm install
```

### Error: "Database is locked"

**Cause**: Another process has the database open, or improper shutdown.

**Solution**:
```bash
# Ensure no other processes are using the database
lsof data/app.db

# If clear, restart the server
npm run start:api

# If corrupted, restore from backup
cp backups/app.db.YYYYMMDD data/app.db
```

### Error: "EADDRINUSE" in Docker

**Cause**: Port conflict in Docker environment.

**Solution**:
```bash
# Stop all containers
docker compose down

# Check for orphaned containers
docker ps -a | grep agent-platform

# Remove orphaned containers
docker rm -f <container-id>

# Restart
docker compose up -d
```

---

## Database Migration Issues

### Error: "Migration failed"

**Cause**: Migration script error or database corruption.

**Solution**:
```bash
# Check migration status
npm run db:health

# Run migrations manually
npm run db:migrate

# If still failing, check database integrity
sqlite3 data/app.db "PRAGMA integrity_check;"
```

### Error: "Schema version mismatch"

**Cause**: Database schema is out of sync with code.

**Solution**:
```bash
# Check current version
sqlite3 data/app.db "SELECT * FROM schema_version;"

# Run pending migrations
npm run db:migrate

# If migrations don't resolve, backup and reinitialize
cp data/app.db data/app.db.backup
rm data/app.db
npm run db:migrate
# Note: This loses existing data
```

### Error: "no such table"

**Cause**: Database not initialized or migration not run.

**Solution**:
```bash
# Run migrations
npm run db:migrate

# Verify tables exist
sqlite3 data/app.db ".tables"
```

### Database Recovery

```bash
# Check integrity
sqlite3 data/app.db "PRAGMA integrity_check;"

# Export to SQL
sqlite3 data/app.db .dump > dump.sql

# Rebuild database
rm data/app.db
sqlite3 data/app.db < dump.sql
```

---

## LLM Provider Connection Failures

### Error: "OpenRouter API key invalid"

**Cause**: Invalid or expired API key.

**Solution**:
1. Verify key at https://openrouter.ai/keys
2. Update environment variable:
   ```bash
   export OPENROUTER_API_KEY=sk-or-valid-key
   ```
3. Restart server

### Error: "Ollama connection refused"

**Cause**: Ollama not running or wrong URL.

**Solution**:
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama if not running
ollama serve

# Update URL if different
export OLLAMA_BASE_URL=http://your-ollama-host:11434
```

### Error: "LLM timeout"

**Cause**: Model response taking too long.

**Solution**:
```bash
# Increase timeout in agent config
PATCH /api/agents/foreground.default/config
{
  "routingTimeoutMs": 120000
}
```

### Error: "No LLM provider configured"

**Cause**: No provider environment variables set.

**Solution**:
```bash
# Configure at least one provider
export OPENROUTER_API_KEY=your-key
# or
export OLLAMA_BASE_URL=http://localhost:11434

# Or use mock mode for development (not production)
export MVP_USE_MOCK_LLM=true
```

### Error: "Model not found"

**Cause**: Specified model not available with provider.

**Solution**:
```bash
# List available models (OpenRouter)
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  https://openrouter.ai/api/v1/models

# Update agent config with valid model
PATCH /api/agents/foreground.default/config
{
  "model": "anthropic/claude-3-opus"
}
```

---

## Webhook Delivery Failures

### Error: "Webhook delivery failed"

**Cause**: Target endpoint unreachable or returning errors.

**Solution**:
1. Check webhook logs in Observability tab
2. Verify target endpoint is accessible
3. Check for valid SSL certificates

### Error: "DLQ entry created"

**Cause**: Webhook delivery failed and was moved to Dead Letter Queue.

**Solution**:
```bash
# View DLQ entries via API
GET /api/dlq?status=pending

# Retry specific entry
POST /api/dlq/:entryId/retry

# Or discard after review
POST /api/dlq/:entryId/discard
```

### Webhook Debugging

```bash
# Test webhook endpoint manually
curl -X POST https://your-webhook-url \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Check server logs
docker compose logs api | grep webhook
```

---

## Memory and Performance Issues

### Issue: High memory usage

**Cause**: Large conversation contexts or insufficient cleanup.

**Solution**:
```bash
# Reduce context window
export MAX_CONTEXT_TOKENS=4000

# Clear old sessions
# Via API: DELETE /api/sessions/:sessionId

# Restart server to clear in-memory cache
```

### Issue: Slow API responses

**Cause**: Database bloat or network latency.

**Solution**:
```bash
# Check database size
ls -lh data/app.db

# Vacuum database
sqlite3 data/app.db "VACUUM;"

# Check for long-running queries
sqlite3 data/app.db "SELECT * FROM sqlite_master;"
```

### Issue: LLM responses slow

**Cause**: Model complexity or provider latency.

**Solution**:
1. Use a faster/smaller model
2. Check provider status page
3. Consider local Ollama for lower latency

### Issue: Database growing large

**Cause**: Accumulation of sessions, runs, and logs.

**Solution**:
```bash
# Check table sizes
sqlite3 data/app.db "
SELECT 
  name,
  (SELECT COUNT(*) FROM sqlite_master m WHERE m.name = t.name) as rows
FROM sqlite_master t WHERE type='table';
"

# Archive old data (manual process)
# Or implement retention policy
```

---

## Rate Limiting Issues

### Error: "Too many requests"

**Cause**: Rate limit exceeded.

**Solution**:
1. Wait for rate limit window to reset
2. Check rate limit headers in response:
   - `x-ratelimit-reset`: Reset timestamp
   - `x-ratelimit-remaining`: Remaining requests

### Adjusting Rate Limits

Rate limits are configured in `src/api/server.ts`. For Docker deployment:

```yaml
# docker-compose.override.yml
services:
  api:
    environment:
      - RATE_LIMIT_MAX=200  # Increase limit
```

---

## Log Viewing Commands

### Local Development

```bash
# View server logs (real-time)
npm run start:api

# With debug level
LOG_LEVEL=debug npm run start:api
```

### Docker

```bash
# View all logs
docker compose logs

# Follow specific service
docker compose logs -f api

# Last N lines
docker compose logs --tail=100 api

# Filter logs
docker compose logs api | grep ERROR
```

### Kubernetes

```bash
# Pod logs
kubectl logs -f deployment/agent-api

# Multiple pods
kubectl logs -l app=agent-api --all-containers

# Previous container (after restart)
kubectl logs deployment/agent-api --previous
```

---

## Common Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `VALIDATION_ERROR` | Request validation failed | Check request body format |
| `BAD_REQUEST` | Invalid input | Check required fields |
| `UNAUTHORIZED` | Authentication required | Provide valid credentials |
| `FORBIDDEN` | Permission denied | Check user permissions |
| `NOT_FOUND` | Resource not found | Verify resource ID |
| `INTERNAL_ERROR` | Server error | Check server logs |
| `PROVIDER_ERROR` | LLM provider error | Check provider config |

---

## Health Check Commands

```bash
# Basic health check
curl http://localhost:3003/api/health

# Database health
npm run db:health

# Container health (Docker)
docker compose ps
docker inspect agent-platform-api-1 --format='{{.State.Health.Status}}'
```

---

## Getting Help

1. **Check Logs**: Review server logs for error details
2. **Check Documentation**: Review relevant sections of this guide
3. **Check DLQ**: Look for failed operations in Dead Letter Queue
4. **Check Provider Status**: Verify LLM provider status page
5. **Search Issues**: Check repository issues for similar problems
6. **Create Issue**: If unresolved, create a detailed bug report with:
   - Error message and stack trace
   - Steps to reproduce
   - Environment details (Node version, OS, etc.)
   - Relevant log snippets
