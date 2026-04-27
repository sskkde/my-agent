# Operations Runbook

This runbook contains operational procedures for the Agent Platform, including restart procedures, resource tuning, environment configuration, and troubleshooting.

## Restart and Recovery Procedure

### Graceful Shutdown

When shutting down the platform, follow these steps to ensure all pending work is handled properly:

1. **Initiate graceful shutdown**
   ```bash
   # Send SIGTERM signal
   kill -TERM <pid>
   ```

2. **Wait for shutdown to complete** (default timeout: 30 seconds)
   - The platform will drain the pending queue
   - Cancel in-flight work with recovery points saved
   - Run all registered shutdown hooks
   - Close database connections

3. **Verify shutdown**
   ```bash
   # Check process is no longer running
   ps aux | grep node
   ```

### Startup Procedure

1. **Pre-flight checks**
   ```bash
   # Check database is accessible
   npm run db:health

   # Verify environment variables
   cat .env
   ```

2. **Start the application**
   ```bash
   npm run start:dev
   ```

3. **Verify startup**
   - Check console output for "Application is ready" message
   - Review health checks in logs
   - Confirm recovery state shows pending items

### Recovery After Restart

The platform automatically recovers state on startup:

1. **Pending Approvals** - Approval requests awaiting user action
2. **Active Waits** - Wait conditions monitoring external events
3. **Pending Background Runs** - Queued or running background tasks
4. **Pending Runtime Actions** - Actions queued for execution

Review recovery state in startup logs:
```
Recovery State:
- Pending Approvals: N
- Active Waits: N
- Pending Runs: N
- Pending Actions: N
```

## Resource Tuning (2C2G Configuration)

For a 2-core, 2GB memory environment, use these optimized resource limits:

```typescript
const RESOURCE_CONFIG = {
  maxConcurrentPlannerRunsPerSession: 3,
  maxConcurrentLLMCalls: 2,
  maxCacheSizeMB: 256,
  maxContextTokens: 8000,
};
```

### Resource Configuration Reference

| Setting | 2C2G Value | Description |
|---------|------------|-------------|
| `maxConcurrentPlannerRunsPerSession` | 3 | Max planning operations per session |
| `maxConcurrentLLMCalls` | 2 | Concurrent LLM API calls |
| `maxCacheSizeMB` | 256 | Memory cache limit |
| `maxContextTokens` | 8000 | Context window for LLM calls |
| `maxConcurrentForegroundTurns` | 10 | User session turns |
| `maxConcurrentBackgroundRuns` | 5 | Background task limit |
| `sqliteQueueMaxDepth` | 100 | Database queue depth |

### Adjusting Resource Limits

Modify values in `src/runtime/resource-limits.ts`:

```typescript
export const DEFAULT_RESOURCE_CONFIG: ResourceConfig = {
  // Adjust these values based on your hardware
  maxCacheSizeMB: 256,      // Reduce if memory constrained
  maxContextTokens: 8000,   // Reduce for smaller context windows
  maxConcurrentLLMCalls: 2, // Reduce if hitting rate limits
};
```

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | API key for OpenRouter | `sk-or-v1-...` |
| `OLLAMA_BASE_URL` | Base URL for Ollama | `http://localhost:11434` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `DATABASE_PATH` | SQLite database file | `./data/app.db` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown timeout | `30000` |

### Configuration Example

```bash
# LLM Providers
OPENROUTER_API_KEY=your_openrouter_api_key_here
OLLAMA_BASE_URL=http://localhost:11434

# Application
NODE_ENV=production
LOG_LEVEL=warn
DATABASE_PATH=./data/production.db
SHUTDOWN_TIMEOUT_MS=60000
```

## Common Issues and Solutions

### Database Connection Errors

**Symptom:** `Failed to establish database connection`

**Solutions:**
1. Check database file exists: `ls -la data/`
2. Verify permissions: `chmod 644 data/app.db`
3. Run migrations: `npm run db:migrate`
4. Check disk space: `df -h`

### LLM API Rate Limiting

**Symptom:** `429 Too Many Requests` errors

**Solutions:**
1. Reduce `maxConcurrentLLMCalls` to 1
2. Add exponential backoff in your LLM client
3. Consider upgrading your API tier
4. Implement request queuing

### Memory Exhaustion

**Symptom:** `JavaScript heap out of memory`

**Solutions:**
1. Reduce `maxCacheSizeMB` to 128 or lower
2. Lower `maxContextTokens` to 4000
3. Reduce concurrent operations
4. Add swap space to the server

### Slow Query Performance

**Symptom:** Database queries taking too long

**Solutions:**
1. Run database health check: `npm run db:health`
2. Check for long-running transactions
3. Verify indexes exist on frequently queried columns
4. Consider vacuuming the database

### Startup Failures

**Symptom:** Application fails during startup

**Solutions:**
1. Check logs for specific error stage
2. Verify all environment variables are set
3. Run typecheck: `npm run typecheck`
4. Check Node.js version: `node --version` (requires v20+)

## Log Locations and Debugging

### Log Output

Logs are written to stdout/stderr. Capture them with:

```bash
# Run with logging to file
npm run start:dev 2>&1 | tee app.log

# Using systemd/journald
journalctl -u agent-platform -f
```

### Debug Logging

Enable verbose logging:

```bash
LOG_LEVEL=debug npm run start:dev
```

### Log Levels

| Level | Use Case |
|-------|----------|
| `error` | Critical failures only |
| `warn` | Warnings and recoverable errors |
| `info` | General operational information |
| `debug` | Detailed debugging information |
| `trace` | Very verbose internal details |

### Health Check Endpoints

The platform provides health information through:

1. **Console output** on startup
2. **Health check registry** - Access via `getHealth()` method
3. **Recovery state** - Shows pending items after restart

### Debugging Commands

```bash
# Check database status
npm run db:health

# Backup before investigation
npm run db:backup

# Type check for errors
npm run typecheck

# Run specific test
npx vitest run tests/unit/specific.test.ts
```

### Getting Help

When reporting issues, include:

1. Node.js version: `node --version`
2. Platform version from package.json
3. Relevant log excerpts
4. Environment (development/production)
5. Resource configuration values
