import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createBackgroundRunStore } from '../../../src/storage/background-run-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createSchema(connection: ConnectionManager): void {
  connection.exec(`
    CREATE TABLE background_runs (
      background_run_id TEXT PRIMARY KEY,
      subagent_run_id TEXT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      agent_type TEXT NOT NULL,
      agent_profile TEXT,
      status TEXT NOT NULL,
      launch_source TEXT NOT NULL,
      checkpoint_data TEXT,
      recovery_point TEXT,
      result_data TEXT,
      error_message TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      expires_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      task_spec_json TEXT,
      task_id TEXT,
      child_session_id TEXT,
      notification_type TEXT,
      notification_payload_json TEXT,
      notification_delivered_at TEXT
    )
  `)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('BackgroundRunStore claim/unclaim notification', () => {
  it('claims a pending notification exactly once (second claim returns false)', () => {
    const connection = openMemoryConnection()
    createSchema(connection)
    const store = createBackgroundRunStore(connection)
    store.create({
      backgroundRunId: 'bg-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      agentType: 'document_processor',
      status: 'completed',
      launchSource: 'subagent_runtime',
      notificationType: 'completed',
      notificationPayload: { summary: 'done' },
    })

    expect(store.claimNotification('bg-1', '2026-08-09T00:00:00.000Z')).toBe(true)
    expect(store.claimNotification('bg-1', '2026-08-09T00:00:01.000Z')).toBe(false)
  })

  it('does not claim an unknown or already-delivered run', () => {
    const connection = openMemoryConnection()
    createSchema(connection)
    const store = createBackgroundRunStore(connection)
    store.create({
      backgroundRunId: 'bg-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      agentType: 'document_processor',
      status: 'completed',
      launchSource: 'subagent_runtime',
    })
    store.markNotificationDelivered('bg-1', '2026-08-09T00:00:00.000Z')

    expect(store.claimNotification('bg-missing', '2026-08-09T00:00:00.000Z')).toBe(false)
    expect(store.claimNotification('bg-1', '2026-08-09T00:00:01.000Z')).toBe(false)
  })

  it('unclaims so a pending notification can be claimed again', () => {
    const connection = openMemoryConnection()
    createSchema(connection)
    const store = createBackgroundRunStore(connection)
    store.create({
      backgroundRunId: 'bg-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      agentType: 'document_processor',
      status: 'completed',
      launchSource: 'subagent_runtime',
    })

    expect(store.claimNotification('bg-1', '2026-08-09T00:00:00.000Z')).toBe(true)
    store.unclaimNotification('bg-1')
    expect(store.claimNotification('bg-1', '2026-08-09T00:00:02.000Z')).toBe(true)
  })

  it('unclaim is a no-op for an unknown run', () => {
    const connection = openMemoryConnection()
    createSchema(connection)
    const store = createBackgroundRunStore(connection)

    expect(() => store.unclaimNotification('bg-missing')).not.toThrow()
  })
})
