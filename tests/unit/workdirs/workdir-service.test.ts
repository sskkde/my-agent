/**
 * WorkdirService Unit Tests
 *
 * Covers:
 * - Default workdir auto-create/select
 * - Local-user behavior is deterministic
 * - Duplicate default creation returns same active workdir
 * - Quotas reject writes before disk mutation
 * - Soft-deleted workdir cannot be active
 * - Session close/archive leaves workdir record intact
 * - Mkdir failure recovery
 * - Create/rename/soft-delete workdirs
 * - Set/get/clear active workdir per session
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createWorkdirStore } from '../../../src/storage/workdir-store.js'
import {
  createSessionWorkdirStateStore,
} from '../../../src/storage/session-workdir-state-store.js'
import {
  createWorkdirService,
  WorkdirServiceError,
  DEFAULT_WORKDIR_NAME,
  LOCAL_USER_ID,
  type FileSystemOps,
} from '../../../src/workdirs/workdir-service.js'

// =============================================================================
// HELPERS
// =============================================================================

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
  connection.exec(
    `CREATE INDEX idx_session_workdir_state_session ON session_workdir_state(tenant_id, user_id, session_id)`,
  )
}

function createMockFsOps(overrides?: Partial<FileSystemOps>): FileSystemOps {
  return {
    mkdir: overrides?.mkdir ?? (() => {}),
  }
}

function createFailingFsOps(errorMessage = 'ENOSPC: no space left on device'): FileSystemOps {
  return {
    mkdir: () => {
      throw new Error(errorMessage)
    },
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('WorkdirService', () => {
  afterEach(() => {
    while (connections.length > 0) {
      connections.pop()?.close()
    }
  })

  // =========================================================================
  // createDefaultWorkdir
  // =========================================================================

  describe('createDefaultWorkdir', () => {
    it('creates a default workdir with correct name and path', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const workdir = service.createDefaultWorkdir('user-1')

      expect(workdir.name).toBe(DEFAULT_WORKDIR_NAME)
      expect(workdir.userId).toBe('user-1')
      expect(workdir.id).toBeTruthy()
      expect(workdir.path).toBeTruthy()
      expect(workdir.deletedAt).toBeNull()
    })

    it('returns existing default workdir on second call (idempotent)', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const first = service.createDefaultWorkdir('user-1')
      const second = service.createDefaultWorkdir('user-1')

      expect(first.id).toBe(second.id)
      expect(first.name).toBe(second.name)
    })

    it('creates separate default workdirs for different users', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd1 = service.createDefaultWorkdir('user-1')
      const wd2 = service.createDefaultWorkdir('user-2')

      expect(wd1.id).not.toBe(wd2.id)
      expect(wd1.userId).toBe('user-1')
      expect(wd2.userId).toBe('user-2')
    })

    it('supports custom tenant', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const workdir = service.createDefaultWorkdir('user-1', 'tenant-abc')

      expect(workdir.tenantId).toBe('tenant-abc')
    })

    it('creates default after a previous one was soft-deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const first = service.createDefaultWorkdir('user-1')
      service.softDeleteWorkdir(first.id, 'user-1')

      // listByUser filters deleted, so findByName won't find it — should create new
      const second = service.createDefaultWorkdir('user-1')

      expect(second.id).not.toBe(first.id)
      expect(second.name).toBe(DEFAULT_WORKDIR_NAME)
    })
  })

  // =========================================================================
  // Local-user handling
  // =========================================================================

  describe('local-user handling', () => {
    it('treats local-user as a single deterministic user', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd1 = service.createDefaultWorkdir(LOCAL_USER_ID)
      const wd2 = service.createDefaultWorkdir(LOCAL_USER_ID)

      expect(wd1.id).toBe(wd2.id)
      expect(wd1.userId).toBe(LOCAL_USER_ID)
    })

    it('local-user workdirs are isolated from other users', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const localWd = service.createDefaultWorkdir(LOCAL_USER_ID)
      const userWd = service.createDefaultWorkdir('real-user')

      expect(localWd.id).not.toBe(userWd.id)
      expect(localWd.userId).toBe(LOCAL_USER_ID)
      expect(userWd.userId).toBe('real-user')
    })

    it('local-user can create named workdirs', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir(LOCAL_USER_ID, 'my-project')

      expect(wd.name).toBe('my-project')
      expect(wd.userId).toBe(LOCAL_USER_ID)
    })

    it('local-user active workdir resolution works', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createDefaultWorkdir(LOCAL_USER_ID)
      service.setActiveWorkdir('session-1', wd.id, LOCAL_USER_ID)

      const active = service.getActiveWorkdir('session-1', LOCAL_USER_ID)

      expect(active).not.toBeNull()
      expect(active!.id).toBe(wd.id)
    })
  })

  // =========================================================================
  // createWorkdir
  // =========================================================================

  describe('createWorkdir', () => {
    it('creates a named workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'my-project')

      expect(wd.name).toBe('my-project')
      expect(wd.userId).toBe('user-1')
      expect(wd.id).toBeTruthy()
    })

    it('rejects duplicate names for same user', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      service.createWorkdir('user-1', 'my-project')

      expect(() => service.createWorkdir('user-1', 'my-project')).toThrow(WorkdirServiceError)
      try {
        service.createWorkdir('user-1', 'my-project')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkdirServiceError)
        expect((error as WorkdirServiceError).code).toBe('WORKDIR_NAME_CONFLICT')
      }
    })

    it('allows same name for different users', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd1 = service.createWorkdir('user-1', 'shared-name')
      const wd2 = service.createWorkdir('user-2', 'shared-name')

      expect(wd1.id).not.toBe(wd2.id)
    })

    it('allows same name after soft-delete of previous', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const first = service.createWorkdir('user-1', 'recyclable')
      service.softDeleteWorkdir(first.id, 'user-1')

      // Should not conflict since the previous one is soft-deleted
      const second = service.createWorkdir('user-1', 'recyclable')

      expect(second.id).not.toBe(first.id)
      expect(second.name).toBe('recyclable')
    })

    it('rejects empty name', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      expect(() => service.createWorkdir('user-1', '')).toThrow(WorkdirServiceError)
      expect(() => service.createWorkdir('user-1', '   ')).toThrow(WorkdirServiceError)
    })

    it('rejects name with path traversal', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      expect(() => service.createWorkdir('user-1', '../escape')).toThrow(WorkdirServiceError)
      expect(() => service.createWorkdir('user-1', 'foo/bar')).toThrow(WorkdirServiceError)
      expect(() => service.createWorkdir('user-1', 'foo\\bar')).toThrow(WorkdirServiceError)
    })

    it('rejects name exceeding max length', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const longName = 'a'.repeat(129)
      expect(() => service.createWorkdir('user-1', longName)).toThrow(WorkdirServiceError)
    })
  })

  // =========================================================================
  // renameWorkdir
  // =========================================================================

  describe('renameWorkdir', () => {
    it('renames a workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'old-name')
      const renamed = service.renameWorkdir(wd.id, 'user-1', 'new-name')

      expect(renamed.name).toBe('new-name')
      expect(renamed.id).toBe(wd.id)
    })

    it('throws if workdir not found', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      expect(() => service.renameWorkdir('nonexistent', 'user-1', 'new-name')).toThrow(WorkdirServiceError)
    })

    it('throws if new name conflicts with existing workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      service.createWorkdir('user-1', 'existing')
      const wd2 = service.createWorkdir('user-1', 'other')

      expect(() => service.renameWorkdir(wd2.id, 'user-1', 'existing')).toThrow(WorkdirServiceError)
    })

    it('allows renaming to the same name (no-op)', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'stable')
      const renamed = service.renameWorkdir(wd.id, 'user-1', 'stable')

      expect(renamed.name).toBe('stable')
    })

    it('validates ownership — cannot rename another user workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'theirs')

      expect(() => service.renameWorkdir(wd.id, 'user-2', 'stolen')).toThrow(WorkdirServiceError)
    })
  })

  // =========================================================================
  // softDeleteWorkdir
  // =========================================================================

  describe('softDeleteWorkdir', () => {
    it('soft-deletes a workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'doomed')
      service.softDeleteWorkdir(wd.id, 'user-1')

      // Should not appear in active list
      const list = store.listByUser('user-1')
      expect(list.find((w) => w.id === wd.id)).toBeUndefined()
    })

    it('is idempotent — no error if already deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'double-delete')
      service.softDeleteWorkdir(wd.id, 'user-1')
      // Second delete should not throw
      expect(() => service.softDeleteWorkdir(wd.id, 'user-1')).not.toThrow()
    })

    it('is idempotent for nonexistent workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      // Should not throw for nonexistent id
      expect(() => service.softDeleteWorkdir('nonexistent', 'user-1')).not.toThrow()
    })

    it('validates ownership — cannot delete another user workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'protected')

      // User-2 tries to delete — should be no-op (idempotent, not found for user-2)
      service.softDeleteWorkdir(wd.id, 'user-2')

      // Workdir still exists for user-1
      const found = store.getById(wd.id, 'user-1')
      expect(found).not.toBeNull()
    })

    it('does NOT delete physical files', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      let mkdirCalled = false
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: {
          mkdir: (_path) => {
            mkdirCalled = true
            // No-op: just record that mkdir was called
          },
        },
      })

      const wd = service.createWorkdir('user-1', 'files-persist')
      expect(mkdirCalled).toBe(true)

      // After soft-delete, no file deletion should occur
      // (We verify by checking the service doesn't call any delete operation)
      service.softDeleteWorkdir(wd.id, 'user-1')
      // Success = no error, no file deletion attempted
    })
  })

  // =========================================================================
  // getActiveWorkdir / setActiveWorkdir / clearActiveWorkdir
  // =========================================================================

  describe('session active workdir', () => {
    it('returns null when no active workdir is set', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const result = service.getActiveWorkdir('session-1', 'user-1')
      expect(result).toBeNull()
    })

    it('sets and gets active workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'active-one')
      service.setActiveWorkdir('session-1', wd.id, 'user-1')

      const active = service.getActiveWorkdir('session-1', 'user-1')

      expect(active).not.toBeNull()
      expect(active!.id).toBe(wd.id)
      expect(active!.name).toBe('active-one')
    })

    it('updates active workdir on second set', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd1 = service.createWorkdir('user-1', 'first')
      const wd2 = service.createWorkdir('user-1', 'second')

      service.setActiveWorkdir('session-1', wd1.id, 'user-1')
      service.setActiveWorkdir('session-1', wd2.id, 'user-1')

      const active = service.getActiveWorkdir('session-1', 'user-1')
      expect(active!.id).toBe(wd2.id)
    })

    it('clears active workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'to-clear')
      service.setActiveWorkdir('session-1', wd.id, 'user-1')
      service.clearActiveWorkdir('session-1', 'user-1')

      const active = service.getActiveWorkdir('session-1', 'user-1')
      expect(active).toBeNull()
    })

    it('clearActiveWorkdir is idempotent', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      service.clearActiveWorkdir('session-1', 'user-1')
      expect(() => service.clearActiveWorkdir('session-1', 'user-1')).not.toThrow()
    })

    it('throws on setActiveWorkdir for nonexistent workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      expect(() => service.setActiveWorkdir('session-1', 'nonexistent', 'user-1')).toThrow(WorkdirServiceError)
    })

    it('throws on setActiveWorkdir for soft-deleted workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'will-delete')
      service.softDeleteWorkdir(wd.id, 'user-1')

      expect(() => service.setActiveWorkdir('session-1', wd.id, 'user-1')).toThrow(WorkdirServiceError)
    })

    it('validates ownership on setActiveWorkdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'theirs')

      expect(() => service.setActiveWorkdir('session-1', wd.id, 'user-2')).toThrow(WorkdirServiceError)
    })

    it('sessions are independent — different sessions can have different active workdirs', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd1 = service.createWorkdir('user-1', 'proj-a')
      const wd2 = service.createWorkdir('user-1', 'proj-b')

      service.setActiveWorkdir('session-1', wd1.id, 'user-1')
      service.setActiveWorkdir('session-2', wd2.id, 'user-1')

      expect(service.getActiveWorkdir('session-1', 'user-1')!.id).toBe(wd1.id)
      expect(service.getActiveWorkdir('session-2', 'user-1')!.id).toBe(wd2.id)
    })
  })

  // =========================================================================
  // Soft-deleted workdir cannot be active
  // =========================================================================

  describe('soft-deleted workdir active state', () => {
    it('getActiveWorkdir returns null after workdir is soft-deleted', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'will-die')
      service.setActiveWorkdir('session-1', wd.id, 'user-1')

      // Verify it's active first
      expect(service.getActiveWorkdir('session-1', 'user-1')).not.toBeNull()

      // Soft-delete
      service.softDeleteWorkdir(wd.id, 'user-1')

      // The INNER JOIN in getActive filters deleted workdirs
      const active = service.getActiveWorkdir('session-1', 'user-1')
      expect(active).toBeNull()
    })
  })

  // =========================================================================
  // Session close/archive leaves workdir record intact
  // =========================================================================

  describe('session close/archive leaves workdir intact', () => {
    it('clearing active workdir does not delete the workdir record', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'persistent')
      service.setActiveWorkdir('session-1', wd.id, 'user-1')

      // Simulate session close by clearing active workdir
      service.clearActiveWorkdir('session-1', 'user-1')

      // Workdir record still exists
      const found = store.getById(wd.id, 'user-1')
      expect(found).not.toBeNull()
      expect(found!.name).toBe('persistent')
    })

    it('multiple sessions referencing same workdir — clearing one does not affect others', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'shared')
      service.setActiveWorkdir('session-1', wd.id, 'user-1')
      service.setActiveWorkdir('session-2', wd.id, 'user-1')

      // Close session-1
      service.clearActiveWorkdir('session-1', 'user-1')

      // Session-2 still references the workdir
      expect(service.getActiveWorkdir('session-2', 'user-1')!.id).toBe(wd.id)
    })
  })

  // =========================================================================
  // Quota enforcement
  // =========================================================================

  describe('quota enforcement', () => {
    it('rejects writes before disk mutation when path depth exceeded', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      let mkdirCalled = false
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        quotaConfig: { maxDepth: 1 }, // Very restrictive — rejects depth 2 (userId/workdirId)
        fsOps: {
          mkdir: () => {
            mkdirCalled = true
          },
        },
      })

      // The workdir path depth is always 2 (userId/workdirId), which exceeds maxDepth=1.
      // The quota check happens BEFORE mkdir — so mkdir must never be called.
      expect(() => service.createWorkdir('user-1', 'normal')).toThrow(WorkdirServiceError)
      expect(mkdirCalled).toBe(false)

      try {
        service.createWorkdir('user-1', 'normal')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkdirServiceError)
        expect((error as WorkdirServiceError).code).toBe('WORKDIR_QUOTA_EXCEEDED')
      }
    })

    it('rejects createWorkdir when mkdir fails (recovery)', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createFailingFsOps('disk full'),
      })

      expect(() => service.createWorkdir('user-1', 'will-fail')).toThrow(WorkdirServiceError)

      try {
        service.createWorkdir('user-1', 'will-fail')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkdirServiceError)
        expect((error as WorkdirServiceError).code).toBe('WORKDIR_MKDIR_FAILED')
      }

      // DB row should be soft-deleted (recovery)
      const list = store.listByUser('user-1')
      expect(list).toHaveLength(0)
    })

    it('recovery deletes DB row when mkdir fails for default workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createFailingFsOps('permission denied'),
      })

      expect(() => service.createDefaultWorkdir('user-1')).toThrow(WorkdirServiceError)

      // DB row should be cleaned up
      const list = store.listByUser('user-1')
      expect(list).toHaveLength(0)
    })

    it('idempotent default creation after recovery — creates new workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      let failFirst = true
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: {
          mkdir: () => {
            if (failFirst) {
              failFirst = false
              throw new Error('transient error')
            }
            // Second call succeeds
          },
        },
      })

      // First call fails
      expect(() => service.createDefaultWorkdir('user-1')).toThrow(WorkdirServiceError)

      // Second call should succeed (recovery cleaned up the old row)
      const wd = service.createDefaultWorkdir('user-1')
      expect(wd.name).toBe(DEFAULT_WORKDIR_NAME)
      expect(wd.deletedAt).toBeNull()
    })
  })

  // =========================================================================
  // Cross-user isolation
  // =========================================================================

  describe('cross-user isolation', () => {
    it('user-2 cannot see user-1 workdirs', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'private')

      // user-2 tries to set it as active — should fail
      expect(() => service.setActiveWorkdir('session-x', wd.id, 'user-2')).toThrow(WorkdirServiceError)
    })

    it('user-2 cannot rename user-1 workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'theirs')

      expect(() => service.renameWorkdir(wd.id, 'user-2', 'hacked')).toThrow(WorkdirServiceError)
    })

    it('user-2 cannot delete user-1 workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const store = createWorkdirStore(connection)
      const service = createWorkdirService({
        workdirStore: store,
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const wd = service.createWorkdir('user-1', 'protected')

      // User-2 tries to delete — no-op (idempotent)
      service.softDeleteWorkdir(wd.id, 'user-2')

      // Still exists for user-1
      const found = store.getById(wd.id, 'user-1')
      expect(found).not.toBeNull()
    })
  })

  // =========================================================================
  // Duplicate default creation
  // =========================================================================

  describe('duplicate default creation', () => {
    it('calling createDefaultWorkdir multiple times returns the same workdir', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: createMockFsOps(),
      })

      const results = Array.from({ length: 5 }, () => service.createDefaultWorkdir('user-1'))
      const ids = results.map((r) => r.id)

      // All should be the same id
      expect(new Set(ids).size).toBe(1)
    })

    it('createDefaultWorkdir only calls mkdir once', () => {
      const connection = openMemoryConnection()
      createSchema(connection)
      let mkdirCount = 0
      const service = createWorkdirService({
        workdirStore: createWorkdirStore(connection),
        sessionStateStore: createSessionWorkdirStateStore(connection),
        fsOps: {
          mkdir: () => {
            mkdirCount++
          },
        },
      })

      service.createDefaultWorkdir('user-1')
      service.createDefaultWorkdir('user-1')
      service.createDefaultWorkdir('user-1')

      expect(mkdirCount).toBe(1)
    })
  })

  // =========================================================================
  // Error class
  // =========================================================================

  describe('WorkdirServiceError', () => {
    it('has correct code and message', () => {
      const error = new WorkdirServiceError('WORKDIR_NOT_FOUND', 'not found')

      expect(error.code).toBe('WORKDIR_NOT_FOUND')
      expect(error.message).toBe('not found')
      expect(error.name).toBe('WorkdirServiceError')
      expect(error).toBeInstanceOf(Error)
    })

    it('carries optional details', () => {
      const error = new WorkdirServiceError('WORKDIR_MKDIR_FAILED', 'disk full', { path: '/tmp/test' })

      expect(error.details).toEqual({ path: '/tmp/test' })
    })
  })
})
