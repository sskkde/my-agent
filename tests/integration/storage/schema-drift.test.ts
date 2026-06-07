import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations, getLatestMigrationVersion } from '../../../src/storage/all-stores-migrations.js'

function tableExists(connection: ConnectionManager, tableName: string): boolean {
  const rows = connection.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [
    tableName,
  ])
  return rows.length > 0 && rows[0]?.name === tableName
}

function getTableColumns(connection: ConnectionManager, tableName: string): string[] {
  const rows = connection.query<{ name: string }>(`PRAGMA table_info(${tableName})`)
  return rows.map((r) => r.name)
}

function tableHasColumn(connection: ConnectionManager, tableName: string, column: string): boolean {
  return getTableColumns(connection, tableName).includes(column)
}

describe('Schema Drift', () => {
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

  describe('Migration completeness', () => {
    it('should apply all migrations successfully', () => {
      const version = migrations.getCurrentVersion()
      const latest = getLatestMigrationVersion()
      expect(version).toBe(latest)
    })
  })

  describe('Critical table existence', () => {
    it('should have planner_runs table', () => {
      expect(tableExists(connection, 'planner_runs')).toBe(true)
    })

    it('should have runtime_actions table', () => {
      expect(tableExists(connection, 'runtime_actions')).toBe(true)
    })

    it('should have events table', () => {
      expect(tableExists(connection, 'events')).toBe(true)
    })

    it('should have approval_requests table', () => {
      expect(tableExists(connection, 'approval_requests')).toBe(true)
    })

    it('should have plans table', () => {
      expect(tableExists(connection, 'plans')).toBe(true)
    })
  })

  describe('planner_runs columns', () => {
    const TABLE = 'planner_runs'

    it('should have planner_run_id primary key', () => {
      expect(tableHasColumn(connection, TABLE, 'planner_run_id')).toBe(true)
    })

    it('should have plan_id foreign key', () => {
      expect(tableHasColumn(connection, TABLE, 'plan_id')).toBe(true)
    })

    it('should have user_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'user_id')).toBe(true)
    })

    it('should have session_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'session_id')).toBe(true)
    })

    it('should have status column', () => {
      expect(tableHasColumn(connection, TABLE, 'status')).toBe(true)
    })

    it('should have checkpoint column', () => {
      expect(tableHasColumn(connection, TABLE, 'checkpoint')).toBe(true)
    })

    it('should have background_run_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'background_run_id')).toBe(true)
    })

    it('should have workflow_run_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'workflow_run_id')).toBe(true)
    })

    it('should have created_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'created_at')).toBe(true)
    })

    it('should have updated_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'updated_at')).toBe(true)
    })
  })

  describe('runtime_actions columns', () => {
    const TABLE = 'runtime_actions'

    it('should have action_id primary key', () => {
      expect(tableHasColumn(connection, TABLE, 'action_id')).toBe(true)
    })

    it('should have action_type column', () => {
      expect(tableHasColumn(connection, TABLE, 'action_type')).toBe(true)
    })

    it('should have idempotency_key column', () => {
      expect(tableHasColumn(connection, TABLE, 'idempotency_key')).toBe(true)
    })

    it('should have source_module column', () => {
      expect(tableHasColumn(connection, TABLE, 'source_module')).toBe(true)
    })

    it('should have target_runtime column', () => {
      expect(tableHasColumn(connection, TABLE, 'target_runtime')).toBe(true)
    })

    it('should have target_action column', () => {
      expect(tableHasColumn(connection, TABLE, 'target_action')).toBe(true)
    })

    it('should have payload column', () => {
      expect(tableHasColumn(connection, TABLE, 'payload')).toBe(true)
    })

    it('should have status column', () => {
      expect(tableHasColumn(connection, TABLE, 'status')).toBe(true)
    })

    it('should have status_message column', () => {
      expect(tableHasColumn(connection, TABLE, 'status_message')).toBe(true)
    })

    it('should have result column', () => {
      expect(tableHasColumn(connection, TABLE, 'result')).toBe(true)
    })

    it('should have created_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'created_at')).toBe(true)
    })

    it('should have updated_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'updated_at')).toBe(true)
    })
  })

  describe('events columns', () => {
    const TABLE = 'events'

    it('should have event_id primary key', () => {
      expect(tableHasColumn(connection, TABLE, 'event_id')).toBe(true)
    })

    it('should have event_type column', () => {
      expect(tableHasColumn(connection, TABLE, 'event_type')).toBe(true)
    })

    it('should have source_module column', () => {
      expect(tableHasColumn(connection, TABLE, 'source_module')).toBe(true)
    })

    it('should have user_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'user_id')).toBe(true)
    })

    it('should have session_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'session_id')).toBe(true)
    })

    it('should have correlation_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'correlation_id')).toBe(true)
    })

    it('should have causation_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'causation_id')).toBe(true)
    })

    it('should have idempotency_key column', () => {
      expect(tableHasColumn(connection, TABLE, 'idempotency_key')).toBe(true)
    })

    it('should have planner_run_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'planner_run_id')).toBe(true)
    })

    it('should have plan_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'plan_id')).toBe(true)
    })

    it('should have run_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'run_id')).toBe(true)
    })

    it('should have payload column', () => {
      expect(tableHasColumn(connection, TABLE, 'payload')).toBe(true)
    })

    it('should have sensitivity column', () => {
      expect(tableHasColumn(connection, TABLE, 'sensitivity')).toBe(true)
    })

    it('should have retention_class column', () => {
      expect(tableHasColumn(connection, TABLE, 'retention_class')).toBe(true)
    })

    it('should have created_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'created_at')).toBe(true)
    })
  })

  describe('approval_requests columns', () => {
    const TABLE = 'approval_requests'

    it('should have id primary key', () => {
      expect(tableHasColumn(connection, TABLE, 'id')).toBe(true)
    })

    it('should have user_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'user_id')).toBe(true)
    })

    it('should have session_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'session_id')).toBe(true)
    })

    it('should have status column', () => {
      expect(tableHasColumn(connection, TABLE, 'status')).toBe(true)
    })

    it('should have risk_level column', () => {
      expect(tableHasColumn(connection, TABLE, 'risk_level')).toBe(true)
    })

    it('should have scope column', () => {
      expect(tableHasColumn(connection, TABLE, 'scope')).toBe(true)
    })

    it('should have scope_type column (migration v45)', () => {
      expect(tableHasColumn(connection, TABLE, 'scope_type')).toBe(true)
    })

    it('should have scope_ref column (migration v45)', () => {
      expect(tableHasColumn(connection, TABLE, 'scope_ref')).toBe(true)
    })

    it('should have approval_code column (migration v45)', () => {
      expect(tableHasColumn(connection, TABLE, 'approval_code')).toBe(true)
    })

    it('should have action_type column', () => {
      expect(tableHasColumn(connection, TABLE, 'action_type')).toBe(true)
    })

    it('should have resource column', () => {
      expect(tableHasColumn(connection, TABLE, 'resource')).toBe(true)
    })

    it('should have justification column', () => {
      expect(tableHasColumn(connection, TABLE, 'justification')).toBe(true)
    })

    it('should have requested_by column', () => {
      expect(tableHasColumn(connection, TABLE, 'requested_by')).toBe(true)
    })

    it('should have requested_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'requested_at')).toBe(true)
    })

    it('should have expires_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'expires_at')).toBe(true)
    })

    it('should have responded_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'responded_at')).toBe(true)
    })

    it('should have response_by column', () => {
      expect(tableHasColumn(connection, TABLE, 'response_by')).toBe(true)
    })

    it('should have response_reason column', () => {
      expect(tableHasColumn(connection, TABLE, 'response_reason')).toBe(true)
    })

    it('should have idempotency_key column', () => {
      expect(tableHasColumn(connection, TABLE, 'idempotency_key')).toBe(true)
    })

    it('should have metadata column', () => {
      expect(tableHasColumn(connection, TABLE, 'metadata')).toBe(true)
    })

    it('should have source_context column', () => {
      expect(tableHasColumn(connection, TABLE, 'source_context')).toBe(true)
    })

    it('should have created_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'created_at')).toBe(true)
    })

    it('should have updated_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'updated_at')).toBe(true)
    })
  })

  describe('plans columns', () => {
    const TABLE = 'plans'

    it('should have plan_id primary key', () => {
      expect(tableHasColumn(connection, TABLE, 'plan_id')).toBe(true)
    })

    it('should have user_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'user_id')).toBe(true)
    })

    it('should have session_id column', () => {
      expect(tableHasColumn(connection, TABLE, 'session_id')).toBe(true)
    })

    it('should have objective column', () => {
      expect(tableHasColumn(connection, TABLE, 'objective')).toBe(true)
    })

    it('should have objective_hash column', () => {
      expect(tableHasColumn(connection, TABLE, 'objective_hash')).toBe(true)
    })

    it('should have status column', () => {
      expect(tableHasColumn(connection, TABLE, 'status')).toBe(true)
    })

    it('should have current_version column', () => {
      expect(tableHasColumn(connection, TABLE, 'current_version')).toBe(true)
    })

    it('should have planner_run_ids column', () => {
      expect(tableHasColumn(connection, TABLE, 'planner_run_ids')).toBe(true)
    })

    it('should have steps column', () => {
      expect(tableHasColumn(connection, TABLE, 'steps')).toBe(true)
    })

    it('should have constraints column', () => {
      expect(tableHasColumn(connection, TABLE, 'constraints')).toBe(true)
    })

    it('should have assumptions column', () => {
      expect(tableHasColumn(connection, TABLE, 'assumptions')).toBe(true)
    })

    it('should have created_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'created_at')).toBe(true)
    })

    it('should have updated_at column', () => {
      expect(tableHasColumn(connection, TABLE, 'updated_at')).toBe(true)
    })
  })

  describe('Additional critical tables', () => {
    it('should have kernel_runs table', () => {
      expect(tableExists(connection, 'kernel_runs')).toBe(true)
    })

    it('should have tool_executions table', () => {
      expect(tableExists(connection, 'tool_executions')).toBe(true)
    })

    it('should have background_runs table', () => {
      expect(tableExists(connection, 'background_runs')).toBe(true)
    })

    it('should have workflow_runs table', () => {
      expect(tableExists(connection, 'workflow_runs')).toBe(true)
    })

    it('should have workflow_step_runs table', () => {
      expect(tableExists(connection, 'workflow_step_runs')).toBe(true)
    })

    it('should have permission_grants table', () => {
      expect(tableExists(connection, 'permission_grants')).toBe(true)
    })

    it('should have trigger_registrations table', () => {
      expect(tableExists(connection, 'trigger_registrations')).toBe(true)
    })

    it('should have wait_conditions table', () => {
      expect(tableExists(connection, 'wait_conditions')).toBe(true)
    })

    it('should have artifacts table', () => {
      expect(tableExists(connection, 'artifacts')).toBe(true)
    })

    it('should have tool_results table', () => {
      expect(tableExists(connection, 'tool_results')).toBe(true)
    })

    it('should have sessions table', () => {
      expect(tableExists(connection, 'sessions')).toBe(true)
    })

    it('should have users table', () => {
      expect(tableExists(connection, 'users')).toBe(true)
    })

    it('should have agent_configs table', () => {
      expect(tableExists(connection, 'agent_configs')).toBe(true)
    })

    it('should have tool_result_blobs table (migration v44)', () => {
      expect(tableExists(connection, 'tool_result_blobs')).toBe(true)
    })

    it('should have connector_policies table (migration v46)', () => {
      expect(tableExists(connection, 'connector_policies')).toBe(true)
    })
  })

  describe('P6 key tables', () => {
    it('should have api_keys table (migration v48)', () => {
      expect(tableExists(connection, 'api_keys')).toBe(true)
    })

    it('should have provider_configs table (migration v31)', () => {
      expect(tableExists(connection, 'provider_configs')).toBe(true)
    })

    it('should have auth_tokens table (migration v30)', () => {
      expect(tableExists(connection, 'auth_tokens')).toBe(true)
    })

    it('should have workflow_drafts table (migration v22)', () => {
      expect(tableExists(connection, 'workflow_drafts')).toBe(true)
    })

    it('should have workflow_definitions table (migration v23)', () => {
      expect(tableExists(connection, 'workflow_definitions')).toBe(true)
    })

    it('should have connector_definitions table (migration v19)', () => {
      expect(tableExists(connection, 'connector_definitions')).toBe(true)
    })

    it('should have connector_instances table (migration v20)', () => {
      expect(tableExists(connection, 'connector_instances')).toBe(true)
    })

    it('should have connector_events table (migration v21)', () => {
      expect(tableExists(connection, 'connector_events')).toBe(true)
    })

    it('should have trace_contexts table (migration v24)', () => {
      expect(tableExists(connection, 'trace_contexts')).toBe(true)
    })

    it('should have trace_spans table (migration v25)', () => {
      expect(tableExists(connection, 'trace_spans')).toBe(true)
    })

    it('should have metrics table (migration v26)', () => {
      expect(tableExists(connection, 'metrics')).toBe(true)
    })

    it('should have audit_records table (migration v27)', () => {
      expect(tableExists(connection, 'audit_records')).toBe(true)
    })

    it('should have long_term_memories table (migration v37)', () => {
      expect(tableExists(connection, 'long_term_memories')).toBe(true)
    })

    it('should have webhook_triggers table (migration v40)', () => {
      expect(tableExists(connection, 'webhook_triggers')).toBe(true)
    })

    it('should have webhook_deliveries table (migration v41)', () => {
      expect(tableExists(connection, 'webhook_deliveries')).toBe(true)
    })

    it('should have schedule_triggers table (migration v42)', () => {
      expect(tableExists(connection, 'schedule_triggers')).toBe(true)
    })

    it('should have dead_letter table (migration v47)', () => {
      expect(tableExists(connection, 'dead_letter')).toBe(true)
    })

    it('should have transcripts table (migration v3)', () => {
      expect(tableExists(connection, 'transcripts')).toBe(true)
    })

    it('should have summaries table (migration v4)', () => {
      expect(tableExists(connection, 'summaries')).toBe(true)
    })

    it('should have plan_patches table (migration v6)', () => {
      expect(tableExists(connection, 'plan_patches')).toBe(true)
    })
  })

  /**
   * v60 Migration: Runtime metadata columns for provider discovery
   */
  describe('provider_configs v60 runtime metadata columns', () => {
    const TABLE = 'provider_configs'

    it('should have family column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'family')).toBe(true)
    })

    it('should have protocol column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'protocol')).toBe(true)
    })

    it('should have priority column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'priority')).toBe(true)
    })

    it('should have headers_json column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'headers_json')).toBe(true)
    })

    it('should have capabilities_json column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'capabilities_json')).toBe(true)
    })

    it('should have models_json column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'models_json')).toBe(true)
    })

    it('should have default_model column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'default_model')).toBe(true)
    })

    it('should have options_json column (v60)', () => {
      expect(tableHasColumn(connection, TABLE, 'options_json')).toBe(true)
    })
  })
})
