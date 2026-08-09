import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgresAdapter } from '../../../src/storage/adapters/postgres/postgres-adapter.js'
import {
  createPgMigrationRunner,
  type PgMigrationRunner,
} from '../../../src/storage/adapters/postgres/migration-runner.js'
import { pgStoreMigrations } from '../../../src/storage/adapters/postgres/pg-migrations.js'

/**
 * Child-session schema parity on PostgreSQL (opencode-like-subagent-sessions, Todo 2).
 *
 * Applies the repository PG migration runner to EMPTY DISPOSABLE databases and
 * asserts the child-session/subagent feature columns, tables and indexes, then
 * reruns idempotently (runner-level version skip AND SQL-level DO $$ guards).
 *
 * Known pre-existing PG drift (documented, NOT repaired here — out of scope):
 *
 * 1. Broken baseline migrations (verified empirically on PG 16.13):
 *    - v4 `create_summaries_table`: `CREATE INDEX ... ON summaries(related_refs->>'planId')`
 *      — expression indexes need parens around operator expressions; this SQL has
 *      NEVER been runnable on PostgreSQL.
 *    - v37 `create_long_term_memories_table`: same `->>` issue.
 *    - v53 `add_tenant_id_to_all_tables`: adds tenant_id to `mcp_servers`, a table
 *      that only exists in the legacy `adapters/postgres/migrations/*.sql` files and
 *      is NOT created by any `pgStoreMigrations` entry, so the migration fails.
 *    v38/v39 fail as a consequence: they alter/create tables owned by v37, so
 *    when the runner rolls the broken v37 transaction back their prerequisites
 *    are gone. All of these are recorded as "assumed applied" in the test's
 *    `migrations` table so the runner's strict +1 version sequence stays intact.
 * 2. Missing versions: `pgStoreMigrations` only carries v1..v53 + v59/60/62/65,
 *    so even with the workaround the FULL registry cannot be applied from scratch
 *    (the runner throws "Migration version gap detected" at v58). This test applies
 *    the contiguous v1..v57 subset and asserts the gap error separately.
 */
const MAINTENANCE_URL = process.env.DATABASE_URL
const hasDatabase = typeof MAINTENANCE_URL === 'string' && MAINTENANCE_URL.length > 0

/** Contiguous baseline (existing migrations, no version gaps). */
const BASELINE = pgStoreMigrations.filter((m) => m.version <= 53)
/** Feature batch added by Todo 2: subagent tables, reasoning_depth, child columns. */
const FEATURE_BATCH = pgStoreMigrations.filter((m) => m.version >= 54 && m.version <= 57)
/** Everything the runner can apply from scratch today. */
const CONTIGUOUS = pgStoreMigrations.filter((m) => m.version <= 57)

/** Pre-existing broken baseline migrations + their dependent chain (documented above). */
const ASSUMED_APPLIED_BASELINE = new Set<number>([4, 37, 38, 39, 53])

interface DisposableDb {
  name: string
  url: string
}

function withDatabase(connectionString: string, dbName: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${dbName}`
  return url.toString()
}

async function createDisposableDb(maintenanceUrl: string): Promise<DisposableDb> {
  const name = `aptest_child_${Math.random().toString(36).slice(2, 10)}`
  const admin = new PostgresAdapter({ connectionString: maintenanceUrl })
  await admin.getConnection().open()
  try {
    await admin.asyncExec(`CREATE DATABASE ${name}`)
  } finally {
    await admin.getConnection().close()
  }
  return { name, url: withDatabase(maintenanceUrl, name) }
}

async function dropDisposableDb(maintenanceUrl: string, name: string): Promise<void> {
  const admin = new PostgresAdapter({ connectionString: maintenanceUrl })
  await admin.getConnection().open()
  try {
    await admin.asyncExec(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  } finally {
    await admin.getConnection().close()
  }
}

async function openAdapter(url: string): Promise<PostgresAdapter> {
  const adapter = new PostgresAdapter({ connectionString: url })
  await adapter.getConnection().open()
  return adapter
}

/**
 * Apply the baseline through the repository runner, recording the three
 * pre-existing broken migrations (v4/v37/v53) as "assumed applied" so the
 * runner's strict +1 version sequence holds. Every healthy migration is
 * executed by `createPgMigrationRunner` itself.
 */
async function applyBaselineWithWorkaround(adapter: PostgresAdapter, runner: PgMigrationRunner): Promise<void> {
  await runner.init()
  for (const migration of [...BASELINE].sort((a, b) => a.version - b.version)) {
    const current = await runner.getCurrentVersion()
    if (migration.version <= current) {
      continue
    }
    if (ASSUMED_APPLIED_BASELINE.has(migration.version)) {
      await adapter.asyncExec(
        `INSERT INTO migrations (version, name, applied_at, checksum) VALUES ($1, $2, now()::text, 'assumed')`,
        [migration.version, `${migration.name}_assumed_applied_pre_existing_broken`],
      )
      continue
    }
    await runner.apply([migration])
  }
}

interface ColumnMeta {
  dataType: string
  isNullable: string
  columnDefault: string | null
}

async function getColumns(adapter: PostgresAdapter, table: string): Promise<Map<string, ColumnMeta>> {
  const rows = await adapter.asyncQuery<{
    column_name: string
    data_type: string
    is_nullable: string
    column_default: string | null
  }>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return new Map(
    rows.map((r) => [
      r.column_name,
      { dataType: r.data_type, isNullable: r.is_nullable, columnDefault: r.column_default },
    ]),
  )
}

async function getIndexes(adapter: PostgresAdapter, table: string): Promise<Set<string>> {
  const rows = await adapter.asyncQuery<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
    [table],
  )
  return new Set(rows.map((r) => r.indexname))
}

const PROBE_SESSION_ID = 'sess_parity_probe'
const CHILD_SESSION_ID = 'sess_parity_child'
const PROBE_RUN_ID = 'sub_run_parity_probe'

function insertForegroundSessionSql(sessionId: string): string {
  return `INSERT INTO sessions (session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at)
          VALUES ('${sessionId}', 'user_parity', 'probe', 'active', 0, now()::text, now()::text, now()::text)`
}

describe.skipIf(!hasDatabase)('PostgreSQL child-session schema (Todo 2)', () => {
  describe('fresh disposable database', () => {
    let db: DisposableDb
    let adapter: PostgresAdapter
    let runner: PgMigrationRunner

    beforeAll(async () => {
      db = await createDisposableDb(MAINTENANCE_URL!)
      adapter = await openAdapter(db.url)
      runner = createPgMigrationRunner(adapter.getConnection())
      await applyBaselineWithWorkaround(adapter, runner)
      // Probe row in the PRE-feature shape (simulates an existing foreground session).
      await adapter.asyncExec(insertForegroundSessionSql(PROBE_SESSION_ID))
      await runner.apply(FEATURE_BATCH)
    }, 60_000)

    afterAll(async () => {
      await adapter.getConnection().close()
      await dropDisposableDb(MAINTENANCE_URL!, db.name)
    }, 30_000)

    it('adds the six child-session columns to sessions', async () => {
      const cols = await getColumns(adapter, 'sessions')
      for (const name of ['parent_session_id', 'task_id', 'agent_profile', 'launch_mode']) {
        expect(cols.get(name)?.dataType, `sessions.${name}`).toBe('text')
        expect(cols.get(name)?.isNullable, `sessions.${name} nullable`).toBe('YES')
      }
      const depth = cols.get('subagent_depth')
      expect(depth?.dataType).toBe('integer')
      expect(depth?.isNullable).toBe('NO')
      expect(depth?.columnDefault).toContain('0')
      const kind = cols.get('session_kind')
      expect(kind?.dataType).toBe('text')
      expect(kind?.isNullable).toBe('NO')
      expect(kind?.columnDefault).toContain('foreground')
    })

    it('adds sessions.reasoning_depth with default off', async () => {
      const cols = await getColumns(adapter, 'sessions')
      const rd = cols.get('reasoning_depth')
      expect(rd?.dataType).toBe('text')
      expect(rd?.columnDefault).toContain('off')
    })

    it('adds parent and task indexes on sessions', async () => {
      const indexes = await getIndexes(adapter, 'sessions')
      expect(indexes.has('idx_sessions_parent_session_id')).toBe(true)
      expect(indexes.has('idx_sessions_task_id')).toBe(true)
    })

    it('creates subagent_runs with all feature-required columns', async () => {
      const cols = await getColumns(adapter, 'subagent_runs')
      const expected = [
        'subagent_run_id',
        'user_id',
        'session_id',
        'parent_run_id',
        'root_run_id',
        'background_run_id',
        'agent_type',
        'agent_profile',
        'status',
        'task_spec_json',
        'context_bundle_json',
        'provider_id',
        'model',
        'result_json',
        'error_code',
        'error_message',
        'created_at',
        'started_at',
        'completed_at',
        'updated_at',
      ]
      for (const name of expected) {
        expect(cols.has(name), `subagent_runs.${name}`).toBe(true)
      }
      const indexes = await getIndexes(adapter, 'subagent_runs')
      expect(indexes.has('idx_subagent_runs_user_status')).toBe(true)
      expect(indexes.has('idx_subagent_runs_session_status')).toBe(true)
      expect(indexes.has('idx_subagent_runs_background')).toBe(true)
      expect(indexes.has('idx_subagent_runs_agent_profile')).toBe(true)
    })

    it('creates subagent_transcripts with run linkage indexes', async () => {
      const cols = await getColumns(adapter, 'subagent_transcripts')
      for (const name of ['id', 'subagent_run_id', 'event_type', 'content_json', 'created_at']) {
        expect(cols.has(name), `subagent_transcripts.${name}`).toBe(true)
      }
      const indexes = await getIndexes(adapter, 'subagent_transcripts')
      expect(indexes.has('idx_subagent_transcripts_run_id')).toBe(true)
      expect(indexes.has('idx_subagent_transcripts_run_type')).toBe(true)
    })

    it('preserves pre-existing rows and materializes new defaults', async () => {
      const rows = await adapter.asyncQuery<{
        parent_session_id: string | null
        task_id: string | null
        agent_profile: string | null
        launch_mode: string | null
        subagent_depth: number
        session_kind: string
        reasoning_depth: string
      }>(
        `SELECT parent_session_id, task_id, agent_profile, launch_mode, subagent_depth, session_kind, reasoning_depth
           FROM sessions WHERE session_id = $1`,
        [PROBE_SESSION_ID],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].parent_session_id).toBeNull()
      expect(rows[0].task_id).toBeNull()
      expect(rows[0].agent_profile).toBeNull()
      expect(rows[0].launch_mode).toBeNull()
      expect(rows[0].subagent_depth).toBe(0)
      expect(rows[0].session_kind).toBe('foreground')
      expect(rows[0].reasoning_depth).toBe('off')
    })

    it('supports child-shaped session rows and subagent run/transcript inserts', async () => {
      await adapter.asyncExec(
        `INSERT INTO sessions (session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at,
                               parent_session_id, task_id, agent_profile, launch_mode, subagent_depth, session_kind)
         VALUES ('${CHILD_SESSION_ID}', 'user_parity', 'child', 'active', 0, now()::text, now()::text, now()::text,
                 '${PROBE_SESSION_ID}', 'task_parity_1', 'search', 'foreground', 1, 'subagent')`,
      )
      await adapter.asyncExec(
        `INSERT INTO subagent_runs (subagent_run_id, user_id, session_id, parent_run_id, agent_type, agent_profile, status, task_spec_json, created_at, updated_at)
         VALUES ('${PROBE_RUN_ID}', 'user_parity', '${CHILD_SESSION_ID}', 'parent_run_1', 'subagent', 'search', 'completed', '{"task":"probe"}', now()::text, now()::text)`,
      )
      await adapter.asyncExec(
        `INSERT INTO subagent_transcripts (id, subagent_run_id, event_type, content_json, created_at)
         VALUES ('transcript_parity_1', '${PROBE_RUN_ID}', 'text', '{"text":"hello"}', now()::text)`,
      )

      const child = await adapter.asyncQuery<{
        parent_session_id: string
        task_id: string
        subagent_depth: number
        session_kind: string
      }>(`SELECT parent_session_id, task_id, subagent_depth, session_kind FROM sessions WHERE session_id = $1`, [
        CHILD_SESSION_ID,
      ])
      expect(child[0].parent_session_id).toBe(PROBE_SESSION_ID)
      expect(child[0].task_id).toBe('task_parity_1')
      expect(child[0].subagent_depth).toBe(1)
      expect(child[0].session_kind).toBe('subagent')

      const run = await adapter.asyncQuery<{ session_id: string; agent_profile: string }>(
        `SELECT session_id, agent_profile FROM subagent_runs WHERE subagent_run_id = $1`,
        [PROBE_RUN_ID],
      )
      expect(run[0].session_id).toBe(CHILD_SESSION_ID)
      expect(run[0].agent_profile).toBe('search')
    })

    it('reruns idempotently: runner skips applied versions and DO $$ guards swallow direct re-execution', async () => {
      // Runner-level idempotency: all batches are fully skipped on rerun.
      await runner.apply(FEATURE_BATCH)
      await runner.apply(BASELINE)
      await runner.apply(CONTIGUOUS)

      // SQL-level idempotency: re-execute the feature migration SQL directly
      // (bypassing the version table) — the DO $$ information_schema guards
      // must make every statement a no-op.
      for (const migration of FEATURE_BATCH) {
        for (const statement of splitSqlStatements(migration.up)) {
          await adapter.asyncExec(statement)
        }
      }

      const cols = await getColumns(adapter, 'sessions')
      expect(cols.get('parent_session_id')).toBeDefined()
      expect(cols.get('task_id')).toBeDefined()
      const kindRows = await adapter.asyncQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'session_kind'`,
      )
      expect(Number(kindRows[0].count)).toBe(1)

      const rows = await adapter.asyncQuery<{ session_kind: string }>(
        `SELECT session_kind FROM sessions WHERE session_id = $1`,
        [PROBE_SESSION_ID],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].session_kind).toBe('foreground')
    })
  })

  describe('pre-existing columns scenario (guarded migration)', () => {
    let db: DisposableDb
    let adapter: PostgresAdapter

    beforeAll(async () => {
      db = await createDisposableDb(MAINTENANCE_URL!)
      adapter = await openAdapter(db.url)
      const runner = createPgMigrationRunner(adapter.getConnection())
      await applyBaselineWithWorkaround(adapter, runner)
      await adapter.asyncExec(insertForegroundSessionSql(PROBE_SESSION_ID))
      // Simulate a deployment that already carries one of the feature columns.
      await adapter.asyncExec(`ALTER TABLE sessions ADD COLUMN task_id TEXT`)
      // Feature batch must succeed without duplicating the column or losing data.
      await runner.apply(FEATURE_BATCH)
    }, 60_000)

    afterAll(async () => {
      await adapter.getConnection().close()
      await dropDisposableDb(MAINTENANCE_URL!, db.name)
    }, 30_000)

    it('succeeds with exactly one column instance and no data loss', async () => {
      const kindRows = await adapter.asyncQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'task_id'`,
      )
      expect(Number(kindRows[0].count)).toBe(1)

      const rows = await adapter.asyncQuery<{ session_kind: string; subagent_depth: number }>(
        `SELECT session_kind, subagent_depth FROM sessions WHERE session_id = $1`,
        [PROBE_SESSION_ID],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].session_kind).toBe('foreground')
      expect(rows[0].subagent_depth).toBe(0)
    })
  })

  describe('documented pre-existing PG drift', () => {
    describe('broken baseline migrations', () => {
      let db: DisposableDb
      let adapter: PostgresAdapter

      beforeAll(async () => {
        db = await createDisposableDb(MAINTENANCE_URL!)
        adapter = await openAdapter(db.url)
      }, 30_000)

      afterAll(async () => {
        await adapter.getConnection().close()
        await dropDisposableDb(MAINTENANCE_URL!, db.name)
      }, 30_000)

      it('plain baseline apply fails on pre-existing broken SQL (v4 ->>, v37 ->>, v53 mcp_servers)', async () => {
        // Documented pre-existing brokenness: v4/v37 use `->>` in CREATE INDEX
        // without parens (never runnable) and v53 references mcp_servers which no
        // registry migration creates. Todo 2 works around these in the schema
        // tests above instead of rewriting the existing migrations.
        const runner = createPgMigrationRunner(adapter.getConnection())
        await runner.init()
        await expect(runner.apply(BASELINE)).rejects.toThrow()
      })
    })

    describe('missing version numbers', () => {
      let db: DisposableDb
      let adapter: PostgresAdapter

      beforeAll(async () => {
        db = await createDisposableDb(MAINTENANCE_URL!)
        adapter = await openAdapter(db.url)
        const runner = createPgMigrationRunner(adapter.getConnection())
        await applyBaselineWithWorkaround(adapter, runner)
      }, 60_000)

      afterAll(async () => {
        await adapter.getConnection().close()
        await dropDisposableDb(MAINTENANCE_URL!, db.name)
      }, 30_000)

      it('full registry cannot apply from scratch: runner reports the v58+ gap', async () => {
        // Known pre-existing drift: pgStoreMigrations lacks v58, v61, v63-64,
        // v66-73 (subagent_provider_preferences, todos, channel mappings,
        // workdirs, system settings, context metrics, user settings, mock
        // provider type, ...). The runner enforces a strict +1 sequence, so the
        // unported gap surfaces as a version-gap error. Remove/replace this
        // assertion once the drift is repaired (out of scope for Todo 2).
        const runner = createPgMigrationRunner(adapter.getConnection())
        await expect(runner.apply(pgStoreMigrations)).rejects.toThrow(/Migration version gap detected/)
      })
    })
  })
})

/**
 * Mirrors `PgMigrationRunnerImpl.splitSqlStatements` (private): splits a
 * migration's `up` SQL into individual statements, respecting dollar quoting
 * and single-quoted strings. Used to re-execute migration SQL directly and
 * prove the information_schema guards are idempotent independent of the
 * version table.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inDollarQuote = false
  let inSingleQuote = false
  let i = 0

  while (i < sql.length) {
    const char = sql[i]
    const remaining = sql.slice(i)

    if (char === "'" && !inDollarQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      i++
      continue
    }
    if (remaining.startsWith('$$') && !inSingleQuote) {
      inDollarQuote = !inDollarQuote
      current += '$$'
      i += 2
      continue
    }
    if (char === ';' && !inSingleQuote && !inDollarQuote) {
      const trimmed = current.trim()
      if (trimmed.length > 0) {
        statements.push(trimmed)
      }
      current = ''
      i++
      continue
    }
    current += char
    i++
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) {
    statements.push(trimmed)
  }
  return statements
}
