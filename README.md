# Agent Platform

A multi-agent platform for task orchestration and execution. This platform provides a scalable, resource-managed environment for running AI-powered agents with support for LLM providers, background task processing, and robust error handling.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20 or later) - Required for running the TypeScript application
- **SQLite3** - Database for persistent storage
- **npm** - Package manager (comes with Node.js)

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
# Start the API server (runs on port 3000)
npm run start:api

# In another terminal, start the frontend (runs on port 5173)
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

- **API Server**: http://localhost:3000
- **Frontend (Vite)**: http://localhost:5173

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

## License

MIT
