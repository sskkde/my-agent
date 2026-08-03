import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSubagentRunStore } from '../../../src/storage/subagent-run-store.js'
import { createSubagentTranscriptStore } from '../../../src/storage/subagent-transcript-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): ConnectionManager {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
  return connection
}

function makeConnection(): ConnectionManager {
  const connection = openMemoryConnection()
  applyAll(connection)
  return connection
}

function getColumnNames(connection: ConnectionManager, tableName: string): string[] {
  return connection.query<{ name: string }>(`PRAGMA table_info('${tableName}')`).map((column) => column.name)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

function makeRunRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subagentRunId: 'run_1',
    userId: 'user_1',
    agentType: 'subagent',
    status: 'queued',
    taskSpecJson: '{"objective":"x"}',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('subagent store tenancy', () => {
  describe('schema', () => {
    it('adds child linkage and tenancy columns to subagent_runs and subagent_transcripts', () => {
      const connection = makeConnection()

      const runsColumns = getColumnNames(connection, 'subagent_runs')
      expect(runsColumns).toContain('tenant_id')
      expect(runsColumns).toContain('child_session_id')
      expect(runsColumns).toContain('task_id')

      const transcriptsColumns = getColumnNames(connection, 'subagent_transcripts')
      expect(transcriptsColumns).toContain('tenant_id')
      expect(transcriptsColumns).toContain('session_id')
      expect(transcriptsColumns).toContain('user_id')
    })
  })

  describe('subagent run store', () => {
    it('filters getById by tenant and round-trips child session linkage', () => {
      const store = createSubagentRunStore(makeConnection())
      store.create(
        makeRunRecord({ subagentRunId: 'run_a', childSessionId: 'sess_child', taskId: 'sess_child' }) as never,
        'tenant_a',
      )

      const found = store.getById('run_a', 'tenant_a')
      expect(found?.subagentRunId).toBe('run_a')
      expect(found?.childSessionId).toBe('sess_child')
      expect(found?.taskId).toBe('sess_child')
      expect(found?.tenantId).toBe('tenant_a')

      expect(store.getById('run_a', 'tenant_b')).toBeNull()
    })

    it('defaults to org_default tenant for legacy callers', () => {
      const store = createSubagentRunStore(makeConnection())
      store.create(makeRunRecord({ subagentRunId: 'run_legacy' }) as never)

      const found = store.getById('run_legacy')
      expect(found?.tenantId).toBe('org_default')
      expect(store.getById('run_legacy', 'org_default')?.subagentRunId).toBe('run_legacy')
    })

    it('filters query by tenant while keeping user/child/task filters', () => {
      const store = createSubagentRunStore(makeConnection())
      const now = new Date().toISOString()
      store.create(
        makeRunRecord({ subagentRunId: 'run_a1', childSessionId: 'sess_child', taskId: 'sess_child' }) as never,
        'tenant_a',
      )
      store.create(makeRunRecord({ subagentRunId: 'run_a2' }) as never, 'tenant_a')
      store.create(makeRunRecord({ subagentRunId: 'run_b1' }) as never, 'tenant_b')

      const tenantARuns = store.query({ userId: 'user_1' }, 'tenant_a')
      expect(tenantARuns.map((r) => r.subagentRunId).sort()).toEqual(['run_a1', 'run_a2'])

      expect(store.query({ childSessionId: 'sess_child' }, 'tenant_a').map((r) => r.subagentRunId)).toEqual(['run_a1'])
      expect(store.query({ childSessionId: 'sess_child' }, 'tenant_b')).toEqual([])
      expect(store.query({ taskId: 'sess_child' }, 'tenant_a').map((r) => r.subagentRunId)).toEqual(['run_a1'])
      expect(store.query({ userId: 'user_1', status: 'queued', limit: 1 }, 'tenant_a').length).toBe(1)
      expect(store.query({ userId: 'user_1' }, 'tenant_b').map((r) => r.subagentRunId)).toEqual(['run_b1'])
      expect(now).toBeTruthy()
    })

    it('scopes updateStatus by tenant', () => {
      const store = createSubagentRunStore(makeConnection())
      store.create(makeRunRecord({ subagentRunId: 'run_a' }) as never, 'tenant_a')

      store.updateStatus('run_a', 'completed', 'tenant_b')
      expect(store.getById('run_a', 'tenant_a')?.status).toBe('queued')

      store.updateStatus('run_a', 'completed', 'tenant_a')
      expect(store.getById('run_a', 'tenant_a')?.status).toBe('completed')
    })

    it('scopes saveResult by tenant and never hard-deletes rows', () => {
      const store = createSubagentRunStore(makeConnection())
      store.create(makeRunRecord({ subagentRunId: 'run_a' }) as never, 'tenant_a')

      store.saveResult('run_a', { answer: 'x' }, 'tenant_b')
      expect(store.getById('run_a', 'tenant_a')?.resultJson).toBeUndefined()

      store.saveResult('run_a', { answer: 'x' }, 'tenant_a')
      const saved = store.getById('run_a', 'tenant_a')
      expect(JSON.parse(saved?.resultJson ?? '{}')).toEqual({ answer: 'x' })
      // Row still exists after result save — no delete.
      expect(store.getById('run_a', 'tenant_a')?.subagentRunId).toBe('run_a')
    })
  })

  describe('subagent transcript store', () => {
    it('filters getByRunId by tenant and round-trips session/user linkage', () => {
      const store = createSubagentTranscriptStore(makeConnection())
      store.append(
        {
          id: 'trans_1',
          subagentRunId: 'run_a',
          eventType: 'started',
          contentJson: '{}',
          createdAt: new Date().toISOString(),
          sessionId: 'sess_parent',
          userId: 'user_1',
        },
        'tenant_a',
      )

      const records = store.getByRunId('run_a', 'tenant_a')
      expect(records.length).toBe(1)
      expect(records[0]?.sessionId).toBe('sess_parent')
      expect(records[0]?.userId).toBe('user_1')
      expect(records[0]?.tenantId).toBe('tenant_a')

      expect(store.getByRunId('run_a', 'tenant_b')).toEqual([])
    })

    it('defaults to org_default tenant for legacy appends', () => {
      const store = createSubagentTranscriptStore(makeConnection())
      store.append({
        id: 'trans_legacy',
        subagentRunId: 'run_legacy',
        eventType: 'started',
        contentJson: '{}',
        createdAt: new Date().toISOString(),
      })

      expect(store.getByRunId('run_legacy')?.[0]?.tenantId).toBe('org_default')
      expect(store.getByRunId('run_legacy', 'org_default').length).toBe(1)
    })

    it('filters getByEventType by tenant', () => {
      const store = createSubagentTranscriptStore(makeConnection())
      store.append(
        {
          id: 'trans_1',
          subagentRunId: 'run_a',
          eventType: 'started',
          contentJson: '{}',
          createdAt: new Date().toISOString(),
        },
        'tenant_a',
      )
      store.append(
        {
          id: 'trans_2',
          subagentRunId: 'run_a',
          eventType: 'done',
          contentJson: '{}',
          createdAt: new Date().toISOString(),
        },
        'tenant_b',
      )

      const started = store.getByEventType('run_a', 'started', 'tenant_a')
      expect(started.map((r) => r.id)).toEqual(['trans_1'])
      expect(store.getByEventType('run_a', 'started', 'tenant_b')).toEqual([])
      expect(store.getByEventType('run_a', 'done', 'tenant_a')).toEqual([])
    })
  })
})
