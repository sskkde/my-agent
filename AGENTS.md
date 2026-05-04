# AGENTS.md

## Quick Reference

```bash
# Backend
npm install                    # Install dependencies
npm run typecheck              # TypeScript check (strict: noUnusedLocals, noUnusedParameters)
npm test                       # All tests (vitest)
npm test -- tests/unit/foo.test.ts   # Single test file
npm test -- -t "test name"    # Single test by name
npm run start:api              # API server (port 3003)

# Frontend (separate package in web/)
npm --prefix web install
npm --prefix web test          # Frontend tests
npm --prefix web run build     # Production build
npm run dev:web                # Dev server (port 3002, proxies /api to 3003)

# E2E (Playwright)
npm run reset:e2e-db           # Reset E2E database first
npm run start:api:e2e          # API on port 3103 with e2e.db
# Then: cd web && npx playwright test (uses ports 3102/3103)
```

## Architecture

**Two-package monorepo**: Root is backend (Fastify + SQLite), `web/` is frontend (React + Vite).

Backend entry: `src/api/server.ts` → creates Fastify server with `createApiContext()`.

Key modules in `src/`:
- `foreground/` - LLM-backed message router (ForegroundAgent)
- `processing/` - Message processor orchestration
- `llm/` - Multi-provider LLM adapter with fallback
- `storage/` - SQLite stores (better-sqlite3, synchronous API)
- `gateway/` - Request gateway and channel registry
- `api/routes/` - Fastify route handlers
- `api/context.ts` - Wires all dependencies together

## Database

SQLite with WAL mode. Migrations in `migrations/` (run via `npm run db:migrate`).

**Critical SQLite quirk**: Expressions in UNIQUE constraints are NOT supported.
```sql
-- WRONG: UNIQUE(agent_id, scope, COALESCE(user_id, ''))
-- RIGHT: Add a generated column, then unique on that:
ALTER TABLE foo ADD COLUMN user_id_key TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_foo_unique ON foo(agent_id, scope, user_id_key);
```

Store pattern: `src/storage/*-store.ts` exports `create*Store(connection)` factory.
Tests use `:memory:` SQLite: `createConnectionManager(':memory:')`.

## Testing

- **Unit tests**: `tests/unit/` - use in-memory SQLite, mock LLM adapters
- **Integration tests**: `tests/integration/` - spin up real Fastify server with `:memory:` DB
- **E2E tests**: `tests/e2e/` and `web/e2e/` - full stack with separate `data/e2e.db`

Integration test pattern:
```typescript
const contextResult = createApiContext({ dbPath: ':memory:' });
if ('code' in contextResult) throw new Error(contextResult.message);
const server = await createApiServer(contextResult);
// ... test with server.inject() or supertest
```

Auth in tests: Create user + auth token manually, pass token in headers.

## LLM Router

ForegroundAgent routes messages through LLM with structured JSON output.
- Router timeout: 10s default
- Repair retry: 1 attempt on malformed JSON
- Bypass: approval metadata and no-provider scenarios skip LLM
- Tool guardrails: server-side intersection of suggested ∩ allowed ∩ known tools

Known tool IDs (sync with `src/api/tool-catalog.ts`):
`artifact.create`, `artifact.update`, `ask_user`, `status.query`, `memory.retrieve`, `transcript.search`, `plan.patch`, `docs.search`

## Agent Config (V1)

Only `foreground.default` is supported. Scope: global + per-user overrides.

API endpoints:
- `GET /api/agents/foreground.default/config`
- `PATCH /api/agents/foreground.default/config/global`
- `PATCH /api/agents/foreground.default/config/override`
- `DELETE /api/agents/foreground.default/config/override`

Provider precedence: session override → agent config → user provider defaults → env providers.

## TypeScript Config

Strict mode with `noUnusedLocals` and `noUnusedParameters`. ESM modules (`"type": "module"`).
Target: ES2022, module: ESNext, moduleResolution: bundler.

Path alias: `@` maps to `src/` (configured in vitest, not tsconfig paths).

## Environment

Copy `.env.example` to `.env`. Key vars:
- `APP_SECRET_KEY` - encrypts provider API keys at rest (required for auth)
- `DATABASE_PATH` - SQLite file path (default: `./data/app.db`)
- `OPENROUTER_API_KEY` / `OLLAMA_BASE_URL` - LLM providers

## Ports

| Service | Dev | E2E |
|---------|-----|-----|
| API | 3003 | 3103 |
| Web | 3002 | 3102 |

## Git Workflow

**Every round of changes must be committed at the end.** After completing a batch of related changes (task, feature, fix), stage and commit with a clear message before moving to the next round.
