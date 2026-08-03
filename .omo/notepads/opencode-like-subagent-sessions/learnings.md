# Learnings — opencode-like-subagent-sessions (Wave 1, Todo 1: SQLite child-session migration)

Append-only notepad. Never overwrite existing entries.

## 2026-08-03 — Todo 1: child-session columns migration (v74)

### What was done
- Appended `childSessionColumnsMigration` (version 74, `add_child_session_columns`) to
  `src/storage/all-stores-migrations.ts` after `sessionReasoningDepthMigration` (v73) and
  registered it as the last entry in `allStoreMigrations`. v1–v73 untouched.
- New nullable/defaulted columns on `sessions`: `parent_session_id TEXT`,
  `task_id TEXT`, `agent_profile TEXT`, `launch_mode TEXT`
  (CHECK NULL|foreground|background), `subagent_depth INTEGER NOT NULL DEFAULT 0`,
  `session_kind TEXT NOT NULL DEFAULT 'foreground'` (CHECK foreground|subagent).
- Partial indexes: `idx_sessions_parent_session_id` (WHERE parent_session_id IS NOT NULL),
  `idx_sessions_task_id` (WHERE task_id IS NOT NULL), both with `IF NOT EXISTS`.
- `down` drops only the two new indexes (SQLite cannot drop columns — matches v32/v73 style).
- Test `tests/unit/storage/child-session-migration.test.ts` (5 tests): full `:memory:` run of
  all 74 migrations, `PRAGMA table_info/index_list` assertions, pre-migration row preserved
  with defaults (NULL parent/task/agent_profile/launch_mode, depth 0, kind 'foreground'),
  internal subagent-shaped row insert, and runner double-apply idempotency.

### Key facts for later todos
- Migration runner (`src/storage/migrations.ts`) skips already-applied versions AND swallows
  `duplicate column name`/`already exists` errors for `ALTER TABLE ... ADD COLUMN` — but
  non-ALTER statements throw, hence `CREATE INDEX IF NOT EXISTS` is required for idempotency.
- Runner enforces contiguous versions (`version === currentVersion + 1`) and rejects duplicate
  versions — appending `// v74` after v73 in the array is mandatory, order matters.
- `connection.query('PRAGMA table_info(...)')` works via better-sqlite3 prepared statements
  (see tests/integration/storage/index-coverage.test.ts for the index-info pattern).
- Existing sessions columns: session_id(PK), user_id, title, status(CHECK active|archived|closed),
  message_count, last_activity_at, created_at, updated_at, metadata, tenant_id (NOT NULL
  DEFAULT 'org_default'), selected_model, selected_provider_id, reasoning_depth (v73).
  Existing indexes: idx_sessions_user_activity, idx_sessions_status, idx_sessions_tenant.
  No name collisions with the new indexes.
- `session-store.ts` INSERT (session_id, user_id, title, status, message_count, last_activity_at,
  created_at, updated_at, metadata, tenant_id) remains valid — all new columns defaulted/nullable.
- `session_kind` CHECK is ('foreground','subagent'); `launch_mode` CHECK is NULL|('foreground','background').
  Todo 6 policy should map session_kind/launch_mode accordingly; background children are
  launch_mode='background' with session_kind='subagent'.
- Typecheck: pre-existing errors in `src/search/search-subagent.ts` (TS7034/TS7005, `phase1Built`)
  exist on clean HEAD; unrelated to this change (verified via stash baseline).
- `.omo/` is gitignored — evidence/notepad files are local-only; commit contains only
  `src/storage/all-stores-migrations.ts` + the test file.

### Risks / notes for Todo 3+ (store layer)
- Todo 3 must NOT trust client-supplied tenant/user; child queries parent+tenant scoped.
- task_id equals the child session_id (per plan); resume = new run attempt in same child session.
- Normal session list must exclude session_kind='subagent' rows by default.
# learnings.md — opencode-like-subagent-sessions

## Task 5 (2026-08-03): Lock public tool/result/error contracts

### Contract facts discovered (lock in tests, don't re-derive)
- `foreground_launch_subagent` `runtimeActionId` is **server-generated** by the launch
  facade (`act_*` prefix), NOT the dispatcher's `actionId` field. Tests must not equate them.
- `search_subagent` result intentionally has NO `finalAnswer`/`userVisibleResponse` —
  the kernel synthesizes the user-visible answer.
- `createForegroundLaunchSubagentToolDefinition()` (no deps) and
  `createSearchSubagentToolDefinition(deps)` are directly callable in unit tests for
  schema assertions — the placeholder handler makes the no-deps launch definition safe.
- Projection: `buildForegroundToolProjection` needs EITHER a `ToolRegistry` OR a
  `schema` on every summary tool — bare `{name, category, sensitivity, description}`
  summaries throw "Tool schema unavailable". Include `schema: {type:'object',properties:{}}`.
- `buildObservationSummary('search_subagent', error)` already prefixes `Search failed: ` —
  pass the bare message to the error field, not a pre-prefixed one.
- `sanitizeErrorMessage` (src/tools/error-sanitizer.ts) redacts `sk-`/`ak-`/bearer/token/
  password/AWS/hex/base64/private-key/connection-string patterns and caps at 500 chars —
  reuse it, do not write a second redactor. Also strip ANSI/control chars separately
  (it doesn't).

### Schema additions are strictly additive
- Tool `required` arrays are the contract; new child-task fields (`taskId`,
  `background`) must only ever appear in `properties`, never in `required`.
- Mirror the executor's validator (`tool-executor.validateParams`): required-presence +
  declared type checks. Arrays need `Array.isArray` — `typeof [] === 'object'`.

### Bounded-result policy (reused by Todos 8/16)
- `child-task-contract.ts` lives in `src/foreground/tools/` — import boundary test only
  forbids foreground→connectors/memory, so importing `src/tools/tool-result-reference.ts`
  and `src/tools/error-sanitizer.ts` is fine.
- 32KiB threshold must stay aligned with `INLINE_THRESHOLD` from tool-result-reference;
  policy module decides mode, caller persists via `processToolOutput` when mode==='ref'.

### Environment notes
- `npm run typecheck` fails on HEAD baseline (search-subagent.ts `phase1Built` implicit
  any, commit 64f2807 era) and parallel-wave Todo 6 files — verify per-delta, don't chase.
- Architecture import-boundaries test fails on HEAD: type-only import
  `src/kernel/model-input/model-input-types.ts → src/memory/types.js` (pre-existing).

## 2026-08-03 — Todo 6: child task policy module (src/subagents/child-task-policy.ts)

### What was done
- Pure, framework-free typed module (no DB/HTTP imports; only registry/tool/envelope type
  interfaces + `toLLMToolDefinition`). Unit-testable with in-memory fixtures.
- Exports (single source of truth for Todo 7 runtime + Todo 10 tool integration):
  - Constants: `MAX_SUBAGENT_DEPTH = 3`, `MAX_CHILD_LAUNCHES_PER_PARENT_TURN = 8`,
    `CHILD_TASK_LAUNCH_SOURCE = 'main_agent_delegation'`, `ORCHESTRATION_LAUNCH_TOOL_IDS`
    (foreground_launch_subagent, search_subagent, launch_background_subagent,
    foreground_spawn_planner, foreground_resume_planner, foreground_cancel_or_modify_task),
    `SEARCH_CHILD_TOOL_IDS = ['web_search']`.
  - Error codes as consts: SUBAGENT_DEPTH_EXCEEDED, SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
    SUBAGENT_PROFILE_UNKNOWN, SUBAGENT_TOOL_DENIED, CHILD_TASK_ID_MISMATCH,
    CHILD_LAUNCH_SOURCE_INVALID + typed `ChildTaskPolicyError` (code field).
  - Functions: resolveSessionVisibility (depth 0 → foreground, >=1 → internal),
    resolveChildTaskId/assertChildTaskIdMatchesSession (taskId === childSessionId),
    assertChildLaunchSource, isDepthWithinLimit/assertDepthAllowed,
    isLaunchCountWithinLimit/assertLaunchAllowed, resolveChildProfile,
    buildChildToolProjection, assertToolRequestAllowed, buildSearchChildProjection,
    evaluateChildLaunch (single decision point; throws BEFORE any row could be created).
- `buildChildToolProjection` mirrors the `buildToolProjection` pattern from
  kernel-adapter.ts:21-59 (profile allowlist ∩ requested tools, then
  `envelopeRegistry.getAllowedToolIds('subagent', catalog)`) with three policy
  refinements: (1) agentType hard-pinned to 'subagent' (label normalization could
  theoretically map a profile to 'main'; children are always subagent),
  (2) orchestration launch tools stripped unless `allowNestedLaunch && depth < MAX`,
  (3) unregistered tool IDs dropped from `toolIds` (kernel-adapter keeps phantom IDs
  in toolIds and only skips the LLM def — deliberate hardening for children).

### Key facts for later todos
- Launch-limit semantics are STRICT: `launchesInParentTurn` counts launches already
  made; a new launch is allowed only while count < 8. `assertLaunchAllowed(8)` throws
  (that is the 9th launch). Off-by-one gotcha caught by the red phase.
- Do NOT import `registerBuiltInSubagents` from registry.ts — it lives in
  `src/subagents/builtin-definitions.ts` (red-phase failure #1).
- The subagent envelope allows 'internal'/'read'/'search'/'write' categories and
  denies exec/bash/code_execution/admin_config/manage_users — but `search_subagent`
  and `foreground_launch_subagent` sit in allowed categories, so the explicit
  ORCHESTRATION_LAUNCH_TOOL_IDS strip is REQUIRED (envelope alone is not enough).
- Subagent task IDs: runtime must generate childSessionId first, then pass it to
  evaluateChildLaunch so taskId === childSessionId is decided by the policy.
- Baseline typecheck (ad64424) already fails with 2 errors in src/search/search-subagent.ts
  (TS7034/TS7005 `phase1Built`) — pre-existing, unrelated to this wave; verified via
  detached worktree. Todo 6 adds zero typecheck errors.
- Worktree discipline: shared branch with parallel agents — NEVER run `git stash pop`
  here; an old auto-stash (stash@{0}) got popped accidentally and polluted 7 files
  (recovered via `git checkout HEAD --`; stash left untouched afterwards).
# opencode-like-subagent-sessions — learnings (Todo 2: PostgreSQL mirror)

## Runner behavior (critical for PG work)
- `createPgMigrationRunner` (migration-runner.ts) enforces a STRICT +1 version
  sequence. The full `pgStoreMigrations` registry (v1..v53 + v59/60/62/65)
  CANNOT be applied to an empty DB — it throws "Migration version gap detected"
  at v58. Tests must apply contiguous subsets or record skipped versions in the
  `migrations` table first.
- Each migration runs in its own transaction; a failing migration rolls back
  completely (tables from earlier statements in the same migration are gone).
- `getLatestPgMigrationVersion()` reads the LAST array element — insert new
  migrations before the trailing entries or the "latest" changes.

## Pre-existing broken baseline (verified on PG 16.13, NOT repaired)
- v4 `create_summaries_table` and v37 `create_long_term_memories_table` use
  `CREATE INDEX ... ON t(col->>'x')` — operator expressions in index definitions
  require parentheses on PostgreSQL; this SQL has never been runnable.
- v53 `add_tenant_id_to_all_tables` references `mcp_servers`, which only exists
  in the legacy `adapters/postgres/migrations/*.sql` files — no registry
  migration creates it.
- v38/v39 are collateral: they alter/create tables owned by v37.
- Workaround used in tests: record v4/v37/v38/v39/v53 as "assumed applied" rows
  in the `migrations` table; apply everything else through the real runner.

## Capability parity decisions
- PG feature migrations appended at versions 54-57 (subagent_runs, subagent_
  transcripts, reasoning_depth, child-session columns) while SQLite uses
  v56/57/73/74 — version numbers intentionally diverge; the parity gate compares
  named capabilities. `pgStoreMigrations` still misses v58, v61, v63-64, v66-73
  (todos, workdirs, channel mappings, system settings, user settings, context
  metrics, mock provider, subagent_provider_preferences, ...) — separate drift.
- Index name alignment matters: Todo 1's SQLite v74 uses
  `idx_sessions_parent_session_id` (NOT `idx_sessions_parent_session`) — PG
  must match exactly or the parity gate's name-based checks miss it.
- Todo 1 landed mid-task (commit ad64424); the parity test was written with a
  `pending-todo-1` flag and auto-upgraded to full both-sides enforcement.

## Local PG test setup
- Local server at localhost:5432 accepts `postgres`/`postgres` (CI mirrors:
  `postgres://postgres:postgres@localhost:5432/agent_test`). No DATABASE_URL in
  `.env` — tests skip without it (`describe.skipIf(!hasDatabase)`).
- Disposable DB pattern: connect to maintenance URL → `CREATE DATABASE
  aptest_*` → open adapter on it → run migrations → close → `DROP DATABASE ...
  WITH (FORCE)` (PG 13+).
- `pg` driver rejects multi-statement strings in one query; the runner splits on
  `;` respecting `$$`/quotes (private method — mirrored in the test).
