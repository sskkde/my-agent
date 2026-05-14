# Production Deployment Guide

> Version: 1.0 (Phase 5)
> Last Updated: 2026-05-13

## Overview

This guide covers production deployment considerations for the Agent Platform, including security hardening, high availability, monitoring, and maintenance procedures.

---

## Environment Configuration

### Complete Environment Variable List

#### Core Configuration

| Variable | Required | Production Default | Description |
|----------|----------|-------------------|-------------|
| `APP_SECRET_KEY` | **Yes** | — | 32-byte hex string for encryption |
| `NODE_ENV` | Yes | `production` | Environment mode |
| `LOG_LEVEL` | No | `info` | Logging verbosity |
| `DATABASE_PATH` | No | `/data/agent-platform.db` | SQLite database path |
| `HOST` | Yes | `0.0.0.0` | Server bind address |
| `PORT` | No | `3003` | Server port |
| `SHUTDOWN_TIMEOUT_MS` | No | `30000` | Graceful shutdown timeout |

#### LLM Providers

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | No* | OpenRouter API key |
| `OLLAMA_BASE_URL` | No* | Ollama server URL |

*Configure at least one provider.

#### Web Search

| Variable | Description |
|----------|-------------|
| `WEB_SEARCH_BACKEND` | `auto`, `searxng`, `tavily`, `remote`, `playwright`, `none` |
| `SEARXNG_BASE_URL` | SearXNG instance URL |
| `TAVILY_API_KEY` | Tavily API key |
| `TAVILY_BASE_URL` | Tavily API endpoint |

#### Resource Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_LLM_CALLS` | 2 | Concurrent LLM requests |
| `MAX_CACHE_SIZE_MB` | 256 | Memory cache limit |
| `MAX_CONTEXT_TOKENS` | 8000 | Context window size |

#### Connectors

| Variable | Default | Description |
|----------|---------|-------------|
| `CONNECTOR_MODE` | `mock` | Connector mode (`mock`, `production`) |
| `GENERIC_HTTP_CONNECTOR_NETWORK` | `disabled` | HTTP connector network access |
| `REPLAY_PREVIEW_ONLY` | `true` | Replay preview safety mode |

### Generating Secure Keys

```bash
# Generate APP_SECRET_KEY
openssl rand -hex 32
```

---

## Production Checklist

### Pre-Deployment

- [ ] Generate and securely store `APP_SECRET_KEY`
- [ ] Configure at least one LLM provider
- [ ] Set `NODE_ENV=production`
- [ ] Configure persistent storage for database
- [ ] Set up backup strategy
- [ ] Configure reverse proxy with TLS
- [ ] Review and configure firewall rules

### Security

- [ ] Use HTTPS for all external traffic
- [ ] Configure secure cookies
- [ ] Review CORS settings
- [ ] Set up rate limiting
- [ ] Configure log aggregation
- [ ] Review connector permissions

### Monitoring

- [ ] Set up health check monitoring
- [ ] Configure alerting for critical errors
- [ ] Monitor resource usage (CPU, memory, disk)
- [ ] Track LLM API costs and usage

---

## Reverse Proxy Configuration

### Nginx Example

```nginx
upstream api {
    server 127.0.0.1:3003;
}

upstream web {
    server 127.0.0.1:3002;
}

# API endpoint
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

    location / {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE support
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}

# Web UI
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

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

### SSL/TLS Configuration

Recommended TLS settings:

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers on;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:50m;
ssl_stapling on;
ssl_stapling_verify on;
```

---

## Data Backup and Restore

### Automated Backup Script

```bash
#!/bin/bash
# backup-agent-platform.sh

BACKUP_DIR="/var/backups/agent-platform"
DATE=$(date +%Y%m%d_%H%M%S)
DB_PATH="/data/agent-platform.db"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/agent-platform-$DATE.db'"

# Compress backup
gzip "$BACKUP_DIR/agent-platform-$DATE.db"

# Remove backups older than 30 days
find "$BACKUP_DIR" -name "*.gz" -mtime +30 -delete

echo "Backup completed: agent-platform-$DATE.db.gz"
```

### Cron Job (Daily at 2 AM)

```cron
0 2 * * * /usr/local/bin/backup-agent-platform.sh >> /var/log/agent-platform-backup.log 2>&1
```

### Restore Procedure

```bash
# Stop the service
systemctl stop agent-platform

# Decompress backup
gunzip /var/backups/agent-platform/agent-platform-YYYYMMDD.db.gz

# Restore database
cp /var/backups/agent-platform/agent-platform-YYYYMMDD.db /data/agent-platform.db

# Start the service
systemctl start agent-platform

# Verify
curl http://localhost:3003/api/health
```

---

## Health Check Probes

### Kubernetes Liveness Probe

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3003
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Kubernetes Readiness Probe

```yaml
readinessProbe:
  httpGet:
    path: /api/health
    port: 3003
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

### Docker Compose Health Check

```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3003/api/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

---

## Monitoring and Alerting

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `api_response_time` | API latency | > 2s (warning), > 5s (critical) |
| `api_error_rate` | HTTP error percentage | > 5% (warning), > 10% (critical) |
| `llm_latency` | LLM API response time | > 30s (warning) |
| `llm_error_rate` | LLM API error rate | > 10% (warning) |
| `database_size` | SQLite file size | > 10GB (warning) |
| `memory_usage` | Container memory | > 80% (warning) |
| `disk_usage` | Storage utilization | > 80% (warning) |
| `dlq_entries` | Dead letter queue size | > 100 (warning) |

### Prometheus Metrics (if configured)

The platform exposes basic health metrics at `/api/health`. For full Prometheus integration, consider adding a metrics endpoint.

### Alerting Rules Example

```yaml
# Prometheus alerting rules
groups:
  - name: agent-platform
    rules:
      - alert: APIHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "API latency is high"

      - alert: APIErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "API error rate exceeds 5%"
```

### Log Aggregation

Configure log shipping to external systems:

**Filebeat configuration:**
```yaml
filebeat.inputs:
  - type: container
    paths:
      - /var/lib/docker/containers/*/*.log
    processors:
      - add_docker_metadata: ~

output.elasticsearch:
  hosts: ["http://elasticsearch:9200"]
```

---

## Resource Requirements

### Minimum Requirements

| Resource | Value | Notes |
|----------|-------|-------|
| CPU | 1 core | More for high traffic |
| Memory | 1 GB | More for caching |
| Disk | 10 GB | Database + logs |
| Network | 100 Mbps | API + LLM calls |

### Recommended Production

| Resource | Value | Notes |
|----------|-------|-------|
| CPU | 2-4 cores | Handle concurrent requests |
| Memory | 4 GB | Adequate caching |
| Disk | 50 GB SSD | Fast I/O for database |
| Network | 1 Gbps | Low latency LLM calls |

### Scaling Considerations

The current architecture uses SQLite, which limits horizontal scaling. For high-availability production:

1. **Option A**: Single instance with vertical scaling
   - Increase CPU and memory as needed
   - Regular database maintenance

2. **Option B**: External PostgreSQL (future)
   - Replace SQLite with PostgreSQL
   - Enables horizontal API scaling
   - Requires codebase modification

---

## Security Hardening

### Network Security

1. **Firewall Configuration**
   ```bash
   # Allow only necessary ports
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```

2. **Internal Network Isolation**
   - API and database should not be directly accessible
   - Use reverse proxy for external access

### Application Security

1. **Secrets Management**
   - Use environment variables or secrets manager
   - Never commit secrets to version control
   - Rotate API keys periodically

2. **Rate Limiting**
   - Configure appropriate rate limits
   - Monitor for abuse patterns

3. **Input Validation**
   - The platform validates inputs via JSON schema
   - Review custom configurations carefully

### Data Security

1. **Encryption at Rest**
   - API keys encrypted with `APP_SECRET_KEY`
   - Consider disk encryption for database

2. **Encryption in Transit**
   - TLS for all external communication
   - Internal network encryption recommended

---

## Maintenance Procedures

### Regular Maintenance

| Task | Frequency | Procedure |
|------|-----------|-----------|
| Database backup | Daily | Automated script |
| Log rotation | Weekly | Automatic via logrotate |
| Security updates | Monthly | Review and apply updates |
| Key rotation | Quarterly | Rotate API keys and secrets |

### Upgrade Procedure

```bash
# 1. Backup database
./scripts/backup.sh

# 2. Stop services
docker compose down
# or
systemctl stop agent-platform

# 3. Pull updates
git pull

# 4. Build and start
docker compose build
docker compose up -d
# or
npm install
npm run db:migrate
systemctl start agent-platform

# 5. Verify
curl http://localhost:3003/api/health
```

### Rollback Procedure

```bash
# 1. Stop current version
docker compose down

# 2. Restore database backup
cp /var/backups/agent-platform/agent-platform-YYYYMMDD.db /data/agent-platform.db

# 3. Checkout previous version
git checkout <previous-tag>

# 4. Build and start
docker compose build
docker compose up -d
```

---

## Troubleshooting Production Issues

See the [Troubleshooting Guide](../troubleshooting.md) for common issues and solutions.

### Emergency Contacts

Document your escalation procedures and contacts:
- On-call engineer
- LLM provider support
- Infrastructure team
