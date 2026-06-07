import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'

interface IndexInfo {
  indexName: string
  columns: string[]
}

function getIndexes(connection: ConnectionManager, tableName: string): IndexInfo[] {
  const indexList = connection.query<{ name: string }>(`PRAGMA index_list('${tableName}')`)

  return indexList.map((idx) => {
    const cols = connection.query<{ name: string }>(`PRAGMA index_info('${idx.name}')`)
    return {
      indexName: idx.name,
      columns: cols.map((c) => c.name),
    }
  })
}

function hasIndex(connection: ConnectionManager, tableName: string, expectedName: string): boolean {
  const indexes = getIndexes(connection, tableName)
  return indexes.some((idx) => idx.indexName === expectedName)
}

function hasIndexOnColumns(connection: ConnectionManager, tableName: string, expectedColumns: string[]): boolean {
  const colSet = new Set(expectedColumns)
  const indexes = getIndexes(connection, tableName)
  return indexes.some((idx) => {
    const idxColSet = new Set(idx.columns)
    if (idxColSet.size !== colSet.size) return false
    return [...colSet].every((c) => idxColSet.has(c))
  })
}

describe('Index Coverage', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(allStoreMigrations)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('planner_runs indexes', () => {
    it('should have composite index on (user_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'planner_runs', ['user_id', 'status'])).toBe(true)
    })

    it('should have index on (session_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'planner_runs', ['session_id', 'status'])).toBe(true)
    })

    it('should have index on plan_id', () => {
      expect(hasIndexOnColumns(connection, 'planner_runs', ['plan_id'])).toBe(true)
    })

    it('should have idx_planner_runs_user_status by name', () => {
      expect(hasIndex(connection, 'planner_runs', 'idx_planner_runs_user_status')).toBe(true)
    })
  })

  describe('runtime_actions indexes', () => {
    it('should have index on idempotency_key', () => {
      expect(hasIndexOnColumns(connection, 'runtime_actions', ['idempotency_key'])).toBe(true)
    })

    it('should have index on (source_module, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'runtime_actions', ['source_module', 'created_at'])).toBe(true)
    })

    it('should have index on status', () => {
      expect(hasIndexOnColumns(connection, 'runtime_actions', ['status'])).toBe(true)
    })

    it('should have index on session_id', () => {
      expect(hasIndexOnColumns(connection, 'runtime_actions', ['session_id'])).toBe(true)
    })

    it('should have idx_runtime_actions_idempotency by name', () => {
      expect(hasIndex(connection, 'runtime_actions', 'idx_runtime_actions_idempotency')).toBe(true)
    })
  })

  describe('events indexes', () => {
    it('should have composite index on (session_id, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'events', ['session_id', 'created_at'])).toBe(true)
    })

    it('should have composite index on (user_id, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'events', ['user_id', 'created_at'])).toBe(true)
    })

    it('should have composite index on (event_type, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'events', ['event_type', 'created_at'])).toBe(true)
    })

    it('should have composite index on (source_module, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'events', ['source_module', 'created_at'])).toBe(true)
    })

    it('should have index on run_id', () => {
      expect(hasIndexOnColumns(connection, 'events', ['run_id'])).toBe(true)
    })

    it('should have index on planner_run_id', () => {
      expect(hasIndexOnColumns(connection, 'events', ['planner_run_id'])).toBe(true)
    })

    it('should have index on correlation_id', () => {
      expect(hasIndexOnColumns(connection, 'events', ['correlation_id'])).toBe(true)
    })

    it('should have index on causation_id', () => {
      expect(hasIndexOnColumns(connection, 'events', ['causation_id'])).toBe(true)
    })

    it('should have idx_events_session_created by name', () => {
      expect(hasIndex(connection, 'events', 'idx_events_session_created')).toBe(true)
    })

    it('should have idx_events_run by name', () => {
      expect(hasIndex(connection, 'events', 'idx_events_run')).toBe(true)
    })

    it('should have idx_events_planner_run by name', () => {
      expect(hasIndex(connection, 'events', 'idx_events_planner_run')).toBe(true)
    })
  })

  describe('approval_requests indexes', () => {
    it('should have composite index on (user_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'approval_requests', ['user_id', 'status'])).toBe(true)
    })

    it('should have composite index on (session_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'approval_requests', ['session_id', 'status'])).toBe(true)
    })

    it('should have partial index on expires_at', () => {
      expect(hasIndex(connection, 'approval_requests', 'idx_approval_requests_expires')).toBe(true)
    })

    it('should have idx_approval_requests_user_status by name', () => {
      expect(hasIndex(connection, 'approval_requests', 'idx_approval_requests_user_status')).toBe(true)
    })
  })

  describe('plans indexes', () => {
    it('should have composite index on (user_id, updated_at)', () => {
      expect(hasIndexOnColumns(connection, 'plans', ['user_id', 'updated_at'])).toBe(true)
    })

    it('should have index on status', () => {
      expect(hasIndexOnColumns(connection, 'plans', ['status'])).toBe(true)
    })

    it('should have partial index on objective_hash', () => {
      expect(hasIndex(connection, 'plans', 'idx_plans_objective_hash')).toBe(true)
    })

    it('should have idx_plans_user_updated by name', () => {
      expect(hasIndex(connection, 'plans', 'idx_plans_user_updated')).toBe(true)
    })
  })

  describe('tool_executions indexes', () => {
    it('should have composite index on (tool_name, started_at)', () => {
      expect(hasIndexOnColumns(connection, 'tool_executions', ['tool_name', 'started_at'])).toBe(true)
    })

    it('should have index on status', () => {
      expect(hasIndexOnColumns(connection, 'tool_executions', ['status'])).toBe(true)
    })

    it('should have index on session_id', () => {
      expect(hasIndexOnColumns(connection, 'tool_executions', ['session_id'])).toBe(true)
    })
  })

  describe('tool_results indexes', () => {
    it('should have index on tool_call_id', () => {
      expect(hasIndexOnColumns(connection, 'tool_results', ['tool_call_id'])).toBe(true)
    })

    it('should have index on session_id', () => {
      expect(hasIndexOnColumns(connection, 'tool_results', ['session_id'])).toBe(true)
    })

    it('should have composite index on (tool_name, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'tool_results', ['tool_name', 'created_at'])).toBe(true)
    })
  })

  describe('sessions indexes', () => {
    it('should have composite index on (user_id, last_activity_at)', () => {
      expect(hasIndexOnColumns(connection, 'sessions', ['user_id', 'last_activity_at'])).toBe(true)
    })

    it('should have index on status', () => {
      expect(hasIndexOnColumns(connection, 'sessions', ['status'])).toBe(true)
    })
  })

  describe('workflow_runs indexes', () => {
    it('should have composite index on (workflow_id, started_at)', () => {
      expect(hasIndexOnColumns(connection, 'workflow_runs', ['workflow_id', 'started_at'])).toBe(true)
    })

    it('should have composite index on (owner_user_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'workflow_runs', ['owner_user_id', 'status'])).toBe(true)
    })
  })

  describe('background_runs indexes', () => {
    it('should have composite index on (user_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'background_runs', ['user_id', 'status'])).toBe(true)
    })

    it('should have composite index on (session_id, status)', () => {
      expect(hasIndexOnColumns(connection, 'background_runs', ['session_id', 'status'])).toBe(true)
    })
  })

  describe('kernel_runs indexes', () => {
    it('should have composite index on (session_id, created_at)', () => {
      expect(hasIndexOnColumns(connection, 'kernel_runs', ['session_id', 'created_at'])).toBe(true)
    })

    it('should have index on agent_id', () => {
      expect(hasIndexOnColumns(connection, 'kernel_runs', ['agent_id'])).toBe(true)
    })

    it('should have index on status', () => {
      expect(hasIndexOnColumns(connection, 'kernel_runs', ['status'])).toBe(true)
    })
  })

  describe('agent_configs unique indexes', () => {
    it('should have unique index on (agent_id, scope) for global scope', () => {
      expect(hasIndex(connection, 'agent_configs', 'idx_agent_configs_unique')).toBe(true)
    })

    it('should have index on agent_id', () => {
      expect(hasIndexOnColumns(connection, 'agent_configs', ['agent_id'])).toBe(true)
    })
  })
})
