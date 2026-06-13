# Release Readiness Baseline — 2026-06-13

Overall status: **NOT READY**

This record captures the requested publish baseline run in Code/CI mode. Raw command output is attached under `.release-readiness/logs/`.

## Command Results

| Command | Result | Exit | Log | Notes |
| --- | --- | ---: | --- | --- |
| `npm install` | PASS | `0` | `.release-readiness/logs/npm-install.log` | See attached log. |
| `npm --prefix web install` | PASS | `0` | `.release-readiness/logs/web-npm-install.log` | See attached log. |
| `npm run typecheck` | PASS | `0` | `.release-readiness/logs/typecheck.log` | See attached log. |
| `npm --prefix web run typecheck` | PASS | `0` | `.release-readiness/logs/web-typecheck.log` | See attached log. |
| `npm run test:unit` | FAIL | `1` | `.release-readiness/logs/test-unit.log` | See attached log. |
| `npm run test:integration` | FAIL | `124` | `.release-readiness/logs/test-integration.log` | Suite failed/hung; terminated for baseline progression. |
| `npm run test:e2e` | FAIL | `124` | `.release-readiness/logs/test-e2e.log` | Suite failed/hung; terminated for baseline progression. |
| `npm run test:web` | FAIL | `1` | `.release-readiness/logs/test-web.log` | See attached log. |
| `npm test` | FAIL | `124` | `.release-readiness/logs/npm-test.log` | Suite failed/hung; terminated for baseline progression. |
| `npm run db:migrate` | PASS | `0` | `.release-readiness/logs/db-migrate.log` | See attached log. |
| `npm run db:health` | PASS | `0` | `.release-readiness/logs/db-health.log` | See attached log. |
| `npm run db:backup` | FAIL | `1` | `.release-readiness/logs/db-backup.log` | Command returned usage/error; backup action missing. |
| `npm run build:web` | PASS | `0` | `.release-readiness/logs/build-web.log` | See attached log. |
| `docker compose build` | FAIL | `127` | `.release-readiness/logs/docker-compose-build.log` | Docker CLI unavailable in this environment. |
| `docker compose up -d` | FAIL | `127` | `.release-readiness/logs/docker-compose-up.log` | Docker CLI unavailable in this environment. |
| `curl -fsS http://localhost:3000/health` | FAIL | `7` | `.release-readiness/logs/api-health.log` | Health check failed because compose services did not start. |
| `curl -fsS http://localhost:5173/` | FAIL | `7` | `.release-readiness/logs/web-health.log` | Health check failed because compose services did not start. |
| `docker compose down` | FAIL | `127` | `.release-readiness/logs/docker-compose-down.log` | Docker CLI unavailable in this environment. |

## Split Issue Backlog

### P0 — Release blockers

1. **P0: Root unit suite regression**
   - Evidence: `npm run test:unit` failed.
   - Failing tests include `tests/unit/search/search-subagent.test.ts` expecting 10 cropped results but receiving 3, and `tests/unit/tools/code-execution.test.ts` expecting a successful TypeScript execution path.
2. **P0: Integration/API contract regressions and hangs**
   - Evidence: `npm run test:integration` failed and was terminated after repeated 15s endpoint timeouts.
   - Failing areas include dispatcher runtime adapter support and API contract lock health/tool endpoints.
3. **P0: E2E baseline instability**
   - Evidence: `npm run test:e2e` was terminated after hanging during API health-dependent flows.
4. **P0: Aggregate `npm test` cannot complete cleanly**
   - Evidence: `npm test` reproduced unit/integration failures and was terminated to allow the baseline to continue.

### P1 — Release readiness gaps

1. **P1: Web test suite regressions**
   - Evidence: `npm run test:web` failed with 14 failed tests and 4 unhandled errors.
   - Failing areas include route integration, TabNav labels, ToolCallCard duplicate text, UsageTab sorting expectations, and markdown performance thresholds.
2. **P1: Database backup command is not release-ready as invoked**
   - Evidence: `npm run db:backup` exited non-zero and printed usage, indicating the baseline invocation lacks the required backup subcommand/options.
3. **P1: Docker smoke cannot run in this environment**
   - Evidence: `docker compose build`, `docker compose up -d`, and `docker compose down` failed with `docker: No such file or directory`.

### P2 — Follow-ups / operational polish

1. **P2: Web tests emit repeated React act() warnings**
   - Evidence: `npm run test:web` logs repeated React state update warnings across multiple component suites.
2. **P2: Production web bundle chunk warning**
   - Evidence: `npm run build:web` passed but emitted a Vite warning for a chunk larger than 500 kB after minification.
3. **P2: npm environment warning**
   - Evidence: npm commands warn that the `http-proxy` env config is unknown and will stop working in a future npm major version.

## Passing Checks

- Dependency install completed for root and `web`.
- Root and web TypeScript typechecks passed.
- Database migrate and health checks passed.
- Web production build passed.
