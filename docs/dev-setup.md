# Development Environment Setup Guide

This guide walks you through setting up a local development environment from scratch.

## Prerequisites

Ensure the following are installed:

- **Node.js** v20 or later
- **npm** (comes with Node.js)
- **git**
- **SQLite3** (optional, database file created automatically)

Verify Node.js version:
```bash
node --version  # Should show v20.x.x or higher
```

## Quick Start

### 1. Clone the Repository

```bash
git clone <repo-url>
cd <project-directory>
```

### 2. Install Dependencies

```bash
npm install
```

Note: This project uses `better-sqlite3`, a native module. If the build fails, see the troubleshooting section below.

### 3. Configure Environment

Copy the example environment file and configure required settings:

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Description | Example |
|----------|-------------|---------|
| `APP_SECRET_KEY` | Encryption key for API keys (generate with `openssl rand -hex 32`) | `a1b2c3d4...` |
| `DATABASE_PATH` | SQLite database file path | `./data/app.db` |
| `OPENROUTER_API_KEY` | OpenRouter API key (or use Ollama) | `sk-or-v1-...` |
| `OLLAMA_BASE_URL` | Ollama endpoint for local LLM | `http://localhost:11434` |

### 4. Run Database Migrations

```bash
npm run db:migrate
```

This creates the database file and applies all schema migrations from `migrations/`.

### 5. Start the API Server

```bash
npm run start:api
```

The API runs on http://localhost:3003 by default.

### 6. Verify the Installation

Check the health endpoint:

```bash
curl -s http://localhost:3003/api/health
```

Expected response:
```json
{"status":"ok"}
```

### 7. (Optional) Start the Frontend

Install frontend dependencies and start the development server:

```bash
npm --prefix web install
npm run dev:web
```

The frontend runs on http://localhost:3002 and proxies `/api` requests to the backend.

## Ports

| Service | Port |
|---------|------|
| API Server | 3003 |
| Frontend (Vite) | 3002 |

All servers bind to `localhost` by default. Production public ingress requires `HOST=0.0.0.0`.

## Common Troubleshooting

### better-sqlite3 Build Failures

The native module requires build tools. Install them:

```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3

# macOS
xcode-select --install

# Windows
npm install --global windows-build-tools
```

Then retry:
```bash
npm rebuild better-sqlite3
```

### Port Conflicts

If ports 3002 or 3003 are in use:

```bash
# Find process using the port
lsof -i :3003

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3004 npm run start:api
```

### npm Registry Issues

If packages fail to download, try:

```bash
# Clear cache
npm cache clean --force

# Use different registry
npm install --registry=https://registry.npmmirror.com
```

### Database Errors

If migrations fail or database is corrupted:

```bash
# Check database health
npm run db:health

# Remove and reinitialize (development only!)
rm -f ./data/app.db
npm run db:migrate
```

## Next Steps

- Review [README.md](../README.md) for full feature documentation
- Check [docs/RUNBOOK.md](./RUNBOOK.md) for operational troubleshooting
- Run tests: `npm test`
- Type check: `npm run typecheck`
