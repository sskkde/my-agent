# Docker Deployment Guide

> Version: 1.0 (Phase 5)
> Last Updated: 2026-05-13

## Overview

The Agent Platform can be deployed using Docker Compose for simple setups or Kubernetes for production environments. This guide covers Docker Compose deployment.

---

## Quick Start

### Prerequisites

- Docker Engine 20.10 or later
- Docker Compose v2 or later
- At least 2GB RAM available
- Persistent storage for data

### Basic Deployment

```bash
# Clone the repository
git clone <repository-url>
cd agent-platform

# Build and start services
docker compose up -d

# View logs
docker compose logs -f

# Check service status
docker compose ps
```

### Access Points

After successful deployment:
- **API**: http://localhost:3003
- **Web UI**: http://localhost:3002
- **Swagger UI**: http://localhost:3003/api/docs

---

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Required
APP_SECRET_KEY=your-secret-key-here-use-openssl-rand-hex-32

# LLM Provider (configure at least one)
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
# or
OLLAMA_BASE_URL=http://your-ollama-host:11434

# Optional
LOG_LEVEL=info
WEB_SEARCH_BACKEND=auto
SEARXNG_BASE_URL=http://searxng:8080
SEARXNG_SECRET=<generate-with-openssl-rand-hex-32>
```

The bundled SearXNG service mounts `searxng/settings.yml`, which enables JSON output for the internal `web.search` tool. Set `SEARXNG_SECRET` in the shell environment or deployment environment to override the local Compose fallback.

### Docker Compose Configuration

The default `docker-compose.yml` provides:

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3003:3003"
    volumes:
      - agent_data:/data
    environment:
      - HOST=0.0.0.0
      - PORT=3003
      - DATABASE_PATH=/data/agent-platform.db
      - NODE_ENV=development
      - APP_SECRET_KEY=dev-secret-key-change-in-production
      - WEB_SEARCH_BACKEND=auto
      - SEARXNG_BASE_URL=http://searxng:8080
      - SEARXNG_SECRET=${SEARXNG_SECRET:-agent-platform-local-searxng-secret-change-me}
    volumes:
      - ./searxng/settings.yml:/etc/searxng/settings.yml
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3003/api/health"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  web:
    build:
      context: .
      dockerfile: web/Dockerfile
    ports:
      - "3002:3002"
    environment:
      - VITE_PORT=3002
      - VITE_HOST=0.0.0.0
      - VITE_API_TARGET=http://api:3003
    depends_on:
      api:
        condition: service_healthy

volumes:
  agent_data:
```

---

## Customization

### Using docker-compose.override.yml

Create `docker-compose.override.yml` for local customizations:

```yaml
services:
  api:
    environment:
      - LOG_LEVEL=debug
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
    volumes:
      - ./data:/data  # Use local directory instead of volume

  web:
    environment:
      - VITE_API_TARGET=http://localhost:3003
```

Docker Compose automatically merges this with the base configuration.

### Custom Ports

```yaml
services:
  api:
    ports:
      - "8080:3003"  # API on port 8080

  web:
    ports:
      - "8000:3002"  # Web UI on port 8000
```

### External Database Path

```yaml
services:
  api:
    volumes:
      - /mnt/persistent-storage/agent-data:/data
```

---

## Health Checks

### API Health Check

The API service includes a built-in health check:

```yaml
healthcheck:
  test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3003/api/health"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

**Parameters:**
- `interval`: Time between health checks
- `timeout`: Maximum time to wait for response
- `retries`: Failed checks before marking unhealthy
- `start_period`: Grace period during startup

### Manual Health Check

```bash
# Check API health
curl http://localhost:3003/api/health

# Check from inside container
docker compose exec api wget -q -O- http://127.0.0.1:3003/api/health
```

---

## Volume Management

### Default Volume

Data is stored in the `agent_data` Docker volume:

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect agent_data

# Backup volume
docker run --rm -v agent_data:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz /data
```

### Using Host Directory

For easier backup and access:

```yaml
services:
  api:
    volumes:
      - ./data:/data
```

### Backup and Restore

**Backup:**
```bash
# Stop services
docker compose down

# Copy database
cp ./data/agent-platform.db ./backups/agent-platform.db.$(date +%Y%m%d)

# Restart services
docker compose up -d
```

**Restore:**
```bash
# Stop services
docker compose down

# Restore database
cp ./backups/agent-platform.db.20260513 ./data/agent-platform.db

# Start services
docker compose up -d
```

---

## Logs and Debugging

### Viewing Logs

```bash
# All services
docker compose logs

# Specific service
docker compose logs api
docker compose logs web

# Follow logs
docker compose logs -f api

# Last N lines
docker compose logs --tail=100 api
```

### Executing Commands in Containers

```bash
# Shell access
docker compose exec api sh

# Run database migration
docker compose exec api npm run db:migrate

# Check database health
docker compose exec api npm run db:health
```

### Debugging Startup Issues

```bash
# View detailed startup logs
docker compose up --no-log-prefix

# Check container status
docker compose ps

# Inspect container
docker compose inspect api
```

---

## Networking

### Default Network

Docker Compose creates a default network for inter-service communication.

### Service Discovery

Services can communicate using service names:
- API accessible at `http://api:3003` from other containers
- Web accessible at `http://web:3002` from other containers

### External Access

Ports are exposed on the host:
- API: `localhost:3003`
- Web: `localhost:3002`

### Reverse Proxy Integration

To use with a reverse proxy like Nginx or Traefik:

```yaml
services:
  api:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.example.com`)"
    # Remove ports mapping if using Traefik

  web:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.web.rule=Host(`app.example.com`)"
```

---

## Scaling

### Horizontal Scaling (Stateless Services)

The web service can be scaled:

```bash
docker compose up -d --scale web=3
```

**Note**: API service contains stateful database connections and is not suitable for horizontal scaling without external database configuration.

### Resource Limits

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

---

## Maintenance

### Updating

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose build
docker compose up -d
```

### Database Migration

```bash
# Run migrations after update
docker compose exec api npm run db:migrate
```

### Cleanup

```bash
# Remove stopped containers
docker compose rm

# Remove unused images
docker image prune

# Full cleanup (warning: removes volumes)
docker compose down -v
```

---

## Production Deployment

### Overview

For production deployment, use the `docker-compose.prod.yml` overlay configuration that adds:

- Docker secrets for sensitive values
- Resource limits and reservations
- Restart policies
- Non-root user execution
- Structured logging with rotation
- Separate backup volume

### Quick Start (Production)

```bash
# 1. Create secrets directory
mkdir -p secrets

# 2. Generate required secrets
openssl rand -hex 32 > secrets/app_secret_key.txt

# 3. Copy and configure environment
cp .env.production.example .env
# Edit .env with your production values

# 4. Validate configuration
docker compose -f docker-compose.yml -f docker-compose.prod.yml config

# 5. Deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Docker Secrets Management

Production uses Docker secrets for sensitive configuration:

**Required Secrets:**

| Secret | Description | Generate Command |
|--------|-------------|------------------|
| `app_secret_key` | Application encryption key | `openssl rand -hex 32 > secrets/app_secret_key.txt` |

**Optional Secrets (OAuth):**

| Secret | Description |
|--------|-------------|
| `google_client_id` | Google OAuth client ID |
| `google_client_secret` | Google OAuth client secret |
| `postgres_password` | PostgreSQL password |

**Directory Structure:**

```
.
├── docker-compose.yml
├── docker-compose.prod.yml
├── secrets/
│   ├── app_secret_key.txt
│   ├── google_client_id.txt      # optional
│   └── google_client_secret.txt  # optional
└── .env
```

**Security Notes:**

- Secrets directory should be restricted: `chmod 700 secrets`
- Secret files should be readable only by owner: `chmod 600 secrets/*`
- Never commit secrets to version control
- Add `secrets/` to `.gitignore`

### Environment Configuration

Use `.env.production.example` as a template:

```bash
# Required
APP_SECRET_KEY=<from-docker-secret>
COOKIE_SECURE=true
TRUST_PROXY=1
ALLOWED_ORIGINS=https://your-domain.com
PUBLIC_BASE_URL=https://your-domain.com

# LLM Provider (configure at least one)
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
```

**Critical Settings:**

| Setting | Description | Required |
|---------|-------------|----------|
| `ALLOWED_ORIGINS` | CORS allowed origins (no wildcards) | Yes |
| `COOKIE_SECURE` | Enable secure cookies | Yes (HTTPS) |
| `TRUST_PROXY` | Trust reverse proxy headers | If behind proxy |
| `PUBLIC_BASE_URL` | Public URL for OAuth | If using OAuth |

### Resource Limits

Production configuration includes resource limits:

| Service | CPU Limit | Memory Limit | CPU Reserved | Memory Reserved |
|---------|-----------|--------------|--------------|-----------------|
| api | 1.0 | 512M | 0.5 | 256M |
| web | 0.5 | 256M | 0.25 | 128M |

Adjust in `docker-compose.prod.yml` based on your workload:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
```

### Logging Configuration

Production uses JSON file logging with rotation:

```yaml
logging:
  driver: 'json-file'
  options:
    max-size: '10m'
    max-file: '3'
```

View logs:

```bash
# All services
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs

# Follow specific service
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
```

### PostgreSQL (Optional)

For production workloads requiring PostgreSQL:

1. Uncomment `postgres` service in `docker-compose.prod.yml`
2. Uncomment `postgres_password` secret
3. Set `DATABASE_URL` in `.env`:

```env
DATABASE_URL=postgresql://agentplatform@postgres:5432/agentplatform
```

4. Generate PostgreSQL password:

```bash
openssl rand -hex 16 > secrets/postgres_password.txt
```

### Backup Strategy

**Automated Backups:**

The production configuration includes a dedicated backup volume:

```yaml
volumes:
  agent_backups:
    driver: local
```

**Manual Backup:**

```bash
# SQLite backup
docker compose exec api sqlite3 /app/data/app.db ".backup /app/backups/backup-$(date +%Y%m%d).db"

# Or from host
cp ./data/app.db ./backups/app.db.$(date +%Y%m%d)
```

**Scheduled Backups (cron):**

```bash
# Add to crontab
0 2 * * * cd /path/to/agent-platform && docker compose exec -T api npm run db:backup
```

### Health Monitoring

**Health Check Endpoints:**

```bash
# API health
curl https://your-domain.com/api/v1/health

# Expected response
{"status":"ok","timestamp":"2026-05-21T10:00:00Z"}
```

**Container Health:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### Security Checklist

- [ ] Changed `APP_SECRET_KEY` from default
- [ ] Using Docker secrets for sensitive values
- [ ] `ALLOWED_ORIGINS` configured (no wildcards)
- [ ] `COOKIE_SECURE=true` (HTTPS required)
- [ ] Running as non-root user (`user: '1000:1000'`)
- [ ] TLS termination configured (reverse proxy)
- [ ] Log rotation enabled
- [ ] Resource limits set
- [ ] Backup strategy implemented
- [ ] Secrets directory permissions restricted (`chmod 700 secrets`)

### Reverse Proxy Integration

**Nginx Example:**

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Traefik Labels (add to docker-compose.prod.yml):**

```yaml
services:
  web:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.web.rule=Host(`app.example.com`)"
      - "traefik.http.routers.web.tls.certresolver=letsencrypt"
```

### Updating Production

```bash
# 1. Pull latest changes
git pull

# 2. Backup database
docker compose exec api npm run db:backup

# 3. Rebuild and restart
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 4. Run migrations if needed
docker compose exec api npm run db:migrate

# 5. Verify health
curl https://your-domain.com/api/v1/health
```

For more details, see the [Production Deployment Guide](./production.md).

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs api

# Common issues:
# - Missing APP_SECRET_KEY
# - Invalid LLM provider configuration
# - Port already in use
```

### Database Errors

```bash
# Check database health
docker compose exec api npm run db:health

# Run migrations manually
docker compose exec api npm run db:migrate
```

### Network Issues

```bash
# Check network connectivity
docker compose exec api ping web

# Inspect network
docker network ls
docker network inspect agent-platform_default
```

### Volume Permission Issues

```bash
# Fix permissions on host
sudo chown -R 1000:1000 ./data
```
