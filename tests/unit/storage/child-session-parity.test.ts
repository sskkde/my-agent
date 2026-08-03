import { describe, it, expect } from 'vitest'
import { pgStoreMigrations } from '../../../src/storage/adapters/postgres/pg-migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'

/**
 * Feature-parity gate for the opencode-like-subagent-sessions plan (Todo 2).
 *
 * The gate compares NAMED FEATURE CAPABILITIES/COLUMNS between the SQLite
 * migration list (`allStoreMigrations`) and the PostgreSQL migration list
 * (`pgStoreMigrations`). It deliberately does NOT require historical migration
 * version numbers to match: SQLite has 74 versions, PG has far fewer (known
 * pre-existing drift, documented in the last test of this file and in
 * `tests/integration/postgres/child-session-schema.test.ts`).
 *
 * SQLite side of the child-session schema lives in `all-stores-migrations.ts`
 * v74 (Todo 1); PG side lives in `pg-migrations.ts` v54-v57 (Todo 2).
 * Every capability below is declared on BOTH sides today, so both directions
 * of the gate are enforced.
 */
interface ChildSessionCapability {
  name: string
  pgPattern: string
  sqlitePattern: string
}

export const CHILD_SESSION_CAPABILITY_LIST: ChildSessionCapability[] = [
  // ── Child-session columns on `sessions` (PG v57 ⇄ SQLite v74)
  { name: 'sessions.parent_session_id', pgPattern: 'sessions ADD COLUMN parent_session_id', sqlitePattern: 'sessions ADD COLUMN parent_session_id' },
  { name: 'sessions.task_id', pgPattern: 'sessions ADD COLUMN task_id', sqlitePattern: 'sessions ADD COLUMN task_id' },
  { name: 'sessions.agent_profile', pgPattern: 'sessions ADD COLUMN agent_profile', sqlitePattern: 'sessions ADD COLUMN agent_profile' },
  { name: 'sessions.launch_mode', pgPattern: 'sessions ADD COLUMN launch_mode', sqlitePattern: 'sessions ADD COLUMN launch_mode' },
  { name: 'sessions.subagent_depth (INTEGER NOT NULL DEFAULT 0)', pgPattern: 'sessions ADD COLUMN subagent_depth', sqlitePattern: 'sessions ADD COLUMN subagent_depth' },
  { name: 'sessions.session_kind (TEXT NOT NULL DEFAULT foreground)', pgPattern: 'sessions ADD COLUMN session_kind', sqlitePattern: 'sessions ADD COLUMN session_kind' },
  { name: 'sessions parent index', pgPattern: 'idx_sessions_parent_session_id', sqlitePattern: 'idx_sessions_parent_session_id' },
  { name: 'sessions task index', pgPattern: 'idx_sessions_task_id', sqlitePattern: 'idx_sessions_task_id' },
  // ── Shared subagent surface (PG v54/v55 ⇄ SQLite v56/v57)
  { name: 'subagent_runs table', pgPattern: 'CREATE TABLE IF NOT EXISTS subagent_runs', sqlitePattern: 'CREATE TABLE IF NOT EXISTS subagent_runs' },
  { name: 'subagent_transcripts table', pgPattern: 'CREATE TABLE IF NOT EXISTS subagent_transcripts', sqlitePattern: 'CREATE TABLE IF NOT EXISTS subagent_transcripts' },
  // ── sessions.reasoning_depth (PG v56 ⇄ SQLite v73)
  { name: 'sessions.reasoning_depth', pgPattern: 'sessions ADD COLUMN reasoning_depth', sqlitePattern: 'sessions ADD COLUMN reasoning_depth' },
]

function collectUpSql(migrations: { up: string }[]): string {
  return migrations.map((m) => m.up).join('\n')
}

const pgSql = collectUpSql(pgStoreMigrations)
const sqliteSql = collectUpSql(allStoreMigrations)

describe('child-session feature parity (SQLite ⇄ PostgreSQL)', () => {
  it('PG declares every capability in the child-session capability list', () => {
    const missing = CHILD_SESSION_CAPABILITY_LIST.filter((c) => !pgSql.includes(c.pgPattern))
    expect(missing.map((c) => c.name)).toEqual([])
  })

  it('SQLite declares every capability in the child-session capability list', () => {
    const missing = CHILD_SESSION_CAPABILITY_LIST.filter((c) => !sqliteSql.includes(c.sqlitePattern))
    expect(missing.map((c) => c.name)).toEqual([])
  })

  it('cross-DB consistency: every capability SQLite declares is declared by PG', () => {
    const inconsistent = CHILD_SESSION_CAPABILITY_LIST.filter(
      (c) => sqliteSql.includes(c.sqlitePattern) && !pgSql.includes(c.pgPattern),
    )
    expect(inconsistent.map((c) => c.name)).toEqual([])
  })

  it('gate is capability-based: does not require historical migration version numbers to match', () => {
    // Documented pre-existing drift (NOT repaired by this todo):
    //   SQLite: 74 versions (v1..v74)
    //   PG:     v1..v53 + v54-v57 (Todo 2) + v59/60/62/65; still missing v58,
    //           v61, v63-64, v66-73 (subagent_provider_preferences, todos,
    //           session channel mappings, workdirs, system settings, context
    //           metrics, user settings, mock provider type, memory extraction
    //           columns, LTM entity index). The integration test asserts the
    //           runner's version-gap behavior for the unported range.
    expect(pgStoreMigrations.length).toBeLessThan(allStoreMigrations.length)
    expect(pgStoreMigrations.some((m) => m.version >= 54 && m.version <= 57)).toBe(true)
  })
})
