import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createWorkdirStore } from '../../../src/storage/workdir-store.js'
import { createSessionWorkdirStateStore } from '../../../src/storage/session-workdir-state-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createSchema(connection: ConnectionManager): void {
  connection.exec(`
    CREATE TABLE work_directories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      metadata TEXT
    )
  `)
  connection.exec(`CREATE INDEX idx_work_directories_user ON work_directories(tenant_id, user_id)`)
  connection.exec(`CREATE INDEX idx_work_directories_deleted ON work_directories(tenant_id, user_id, deleted_at)`)

  connection.exec(`
    CREATE TABLE session_workdir_state (
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      active_work_dir_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, session_id),
      FOREIGN KEY (active_work_dir_id) REFERENCES work_directories(id)
    )
  `)
  connection.exec(`CREATE INDEX idx_session_workdir_state_session ON session_workdir_state(tenant_id, user_id, session_id)`)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('SessionWorkdirStateStore', () => {
  describe('getActive', () => {
    it('returns null when no active workdir is set', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createSessionWorkdirStateStore(connection)

      const result = store.getActive('session-1', 'user-1')

      expect(result).toBeNull()
    })

    it('returns active workdir state after setting', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')

      const result = stateStore.getActive('session-1', 'user-1')

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe('session-1')
      expect(result!.userId).toBe('user-1')
      expect(result!.activeWorkDirId).toBe('wd-1')
      expect(result!.tenantId).toBe('org_default')
    })

    it('returns null when active workdir has been soft-deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')
      wdStore.softDelete('wd-1', 'user-1')

      const result = stateStore.getActive('session-1', 'user-1')

      expect(result).toBeNull()
    })

    it('scopes by tenant', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' }, 'tenant-1')
      stateStore.setActive('session-1', 'wd-1', 'user-1', 'tenant-1')

      const result = stateStore.getActive('session-1', 'user-1', 'tenant-2')

      expect(result).toBeNull()
    })

    it('scopes by user', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')

      const result = stateStore.getActive('session-1', 'user-2')

      expect(result).toBeNull()
    })
  })

  describe('setActive', () => {
    it('sets active workdir for a session', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = stateStore.setActive('session-1', 'wd-1', 'user-1')

      expect(result).toBe(true)

      const active = stateStore.getActive('session-1', 'user-1')
      expect(active!.activeWorkDirId).toBe('wd-1')
    })

    it('updates active workdir when already set', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      wdStore.create({ id: 'wd-2', userId: 'user-1', name: 'B', path: '/b' })

      stateStore.setActive('session-1', 'wd-1', 'user-1')
      stateStore.setActive('session-1', 'wd-2', 'user-1')

      const active = stateStore.getActive('session-1', 'user-1')
      expect(active!.activeWorkDirId).toBe('wd-2')
    })

    it('returns false when workdir does not belong to user', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = stateStore.setActive('session-1', 'wd-1', 'user-2')

      expect(result).toBe(false)
    })

    it('returns false when workdir is soft-deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      wdStore.softDelete('wd-1', 'user-1')

      const result = stateStore.setActive('session-1', 'wd-1', 'user-1')

      expect(result).toBe(false)
    })

    it('returns false when workdir does not exist', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      const result = stateStore.setActive('session-1', 'nonexistent', 'user-1')

      expect(result).toBe(false)
    })

    it('returns false when workdir belongs to different tenant', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' }, 'tenant-1')

      const result = stateStore.setActive('session-1', 'wd-1', 'user-1', 'tenant-2')

      expect(result).toBe(false)
    })
  })

  describe('clearActive', () => {
    it('clears active workdir for a session', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')

      const result = stateStore.clearActive('session-1', 'user-1')

      expect(result).toBe(true)

      const active = stateStore.getActive('session-1', 'user-1')
      expect(active).toBeNull()
    })

    it('returns true even when no active workdir was set', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      const result = stateStore.clearActive('session-1', 'user-1')

      expect(result).toBe(true)
    })

    it('only clears the specified session', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')
      stateStore.setActive('session-2', 'wd-1', 'user-1')

      stateStore.clearActive('session-1', 'user-1')

      const session1 = stateStore.getActive('session-1', 'user-1')
      const session2 = stateStore.getActive('session-2', 'user-1')

      expect(session1).toBeNull()
      expect(session2).not.toBeNull()
      expect(session2!.activeWorkDirId).toBe('wd-1')
    })
  })

  describe('session isolation', () => {
    it('session A active workdir does not affect session B', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      wdStore.create({ id: 'wd-2', userId: 'user-1', name: 'B', path: '/b' })

      stateStore.setActive('session-A', 'wd-1', 'user-1')
      stateStore.setActive('session-B', 'wd-2', 'user-1')

      const activeA = stateStore.getActive('session-A', 'user-1')
      const activeB = stateStore.getActive('session-B', 'user-1')

      expect(activeA!.activeWorkDirId).toBe('wd-1')
      expect(activeB!.activeWorkDirId).toBe('wd-2')
    })

    it('clearing session A does not affect session B', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-A', 'wd-1', 'user-1')
      stateStore.setActive('session-B', 'wd-1', 'user-1')

      stateStore.clearActive('session-A', 'user-1')

      const activeB = stateStore.getActive('session-B', 'user-1')
      expect(activeB).not.toBeNull()
    })
  })

  describe('deleted workdir protection', () => {
    it('getActive returns null after workdir is soft-deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-1')

      wdStore.softDelete('wd-1', 'user-1')

      const result = stateStore.getActive('session-1', 'user-1')
      expect(result).toBeNull()
    })

    it('cannot set a deleted workdir as active', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      wdStore.softDelete('wd-1', 'user-1')

      const result = stateStore.setActive('session-1', 'wd-1', 'user-1')

      expect(result).toBe(false)
    })
  })

  describe('cross-user isolation', () => {
    it('user B cannot set user A workdir as active', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-A', name: 'A', path: '/a' })

      const result = stateStore.setActive('session-1', 'wd-1', 'user-B')

      expect(result).toBe(false)
    })

    it('user B cannot get user A session state', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-A', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-A')

      const result = stateStore.getActive('session-1', 'user-B')

      expect(result).toBeNull()
    })

    it('user B cannot clear user A session state', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const wdStore = createWorkdirStore(connection)
      const stateStore = createSessionWorkdirStateStore(connection)

      wdStore.create({ id: 'wd-1', userId: 'user-A', name: 'A', path: '/a' })
      stateStore.setActive('session-1', 'wd-1', 'user-A')

      stateStore.clearActive('session-1', 'user-B')

      const still = stateStore.getActive('session-1', 'user-A')
      expect(still).not.toBeNull()
    })
  })
})
