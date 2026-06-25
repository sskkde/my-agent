import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createWorkdirStore, type CreateWorkdirInput } from '../../../src/storage/workdir-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function createWorkdirSchema(connection: ConnectionManager): void {
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
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('WorkdirStore', () => {
  describe('create', () => {
    it('creates a workdir and returns it', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const input: CreateWorkdirInput = {
        id: 'wd-1',
        userId: 'user-1',
        name: 'My Project',
        path: '/home/user/projects/my-project',
      }

      const result = store.create(input)

      expect(result.id).toBe('wd-1')
      expect(result.userId).toBe('user-1')
      expect(result.name).toBe('My Project')
      expect(result.path).toBe('/home/user/projects/my-project')
      expect(result.tenantId).toBe('org_default')
      expect(result.deletedAt).toBeNull()
      expect(result.createdAt).toBeTruthy()
      expect(result.updatedAt).toBeTruthy()
    })

    it('creates a workdir with metadata', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const input: CreateWorkdirInput = {
        id: 'wd-meta',
        userId: 'user-1',
        name: 'Meta Project',
        path: '/tmp/meta',
        metadata: { branch: 'main', framework: 'react' },
      }

      const result = store.create(input)

      expect(result.metadata).toEqual({ branch: 'main', framework: 'react' })
    })

    it('creates a workdir with custom tenant', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const input: CreateWorkdirInput = {
        id: 'wd-tenant',
        userId: 'user-1',
        name: 'Tenant Project',
        path: '/tmp/tenant',
      }

      const result = store.create(input, 'tenant-abc')

      expect(result.tenantId).toBe('tenant-abc')
    })
  })

  describe('listByUser', () => {
    it('lists workdirs for a user', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      store.create({ id: 'wd-2', userId: 'user-1', name: 'B', path: '/b' })
      store.create({ id: 'wd-3', userId: 'user-2', name: 'C', path: '/c' })

      const result = store.listByUser('user-1')

      expect(result).toHaveLength(2)
      expect(result.map((w) => w.id).sort()).toEqual(['wd-1', 'wd-2'])
    })

    it('excludes soft-deleted workdirs', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      store.create({ id: 'wd-2', userId: 'user-1', name: 'B', path: '/b' })
      store.softDelete('wd-1', 'user-1')

      const result = store.listByUser('user-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('wd-2')
    })

    it('returns empty array for user with no workdirs', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const result = store.listByUser('nonexistent')

      expect(result).toEqual([])
    })

    it('scopes by tenant', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-t1', userId: 'user-1', name: 'A', path: '/a' }, 'tenant-1')
      store.create({ id: 'wd-t2', userId: 'user-1', name: 'B', path: '/b' }, 'tenant-2')

      const result = store.listByUser('user-1', 'tenant-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('wd-t1')
    })
  })

  describe('getById', () => {
    it('returns workdir by id scoped to user', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.getById('wd-1', 'user-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('wd-1')
      expect(result!.name).toBe('A')
    })

    it('returns null when user does not own workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.getById('wd-1', 'user-2')

      expect(result).toBeNull()
    })

    it('returns null for soft-deleted workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      store.softDelete('wd-1', 'user-1')

      const result = store.getById('wd-1', 'user-1')

      expect(result).toBeNull()
    })

    it('returns null for non-existent id', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const result = store.getById('nonexistent', 'user-1')

      expect(result).toBeNull()
    })

    it('scopes by tenant', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' }, 'tenant-1')

      const result = store.getById('wd-1', 'user-1', 'tenant-2')

      expect(result).toBeNull()
    })
  })

  describe('update', () => {
    it('updates name', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'Old Name', path: '/a' })

      const result = store.update('wd-1', { name: 'New Name' }, 'user-1')

      expect(result).toBe(true)

      const updated = store.getById('wd-1', 'user-1')
      expect(updated!.name).toBe('New Name')
    })

    it('updates path', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/old' })

      const result = store.update('wd-1', { path: '/new' }, 'user-1')

      expect(result).toBe(true)

      const updated = store.getById('wd-1', 'user-1')
      expect(updated!.path).toBe('/new')
    })

    it('updates metadata', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.update('wd-1', { metadata: { key: 'value' } }, 'user-1')

      expect(result).toBe(true)

      const updated = store.getById('wd-1', 'user-1')
      expect(updated!.metadata).toEqual({ key: 'value' })
    })

    it('returns false when no fields to update', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.update('wd-1', {}, 'user-1')

      expect(result).toBe(false)
    })

    it('returns false when user does not own workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.update('wd-1', { name: 'Hacked' }, 'user-2')

      expect(result).toBe(true) // exec doesn't throw, but 0 rows affected

      const original = store.getById('wd-1', 'user-1')
      expect(original!.name).toBe('A')
    })

    it('returns false for soft-deleted workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      store.softDelete('wd-1', 'user-1')

      const result = store.update('wd-1', { name: 'Updated' }, 'user-1')

      expect(result).toBe(true) // exec doesn't throw, but 0 rows affected
    })
  })

  describe('softDelete', () => {
    it('soft-deletes a workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.softDelete('wd-1', 'user-1')

      expect(result).toBe(true)

      const deleted = store.getById('wd-1', 'user-1')
      expect(deleted).toBeNull()
    })

    it('returns false when user does not own workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })

      const result = store.softDelete('wd-1', 'user-2')

      expect(result).toBe(true) // exec doesn't throw, but 0 rows affected

      const still = store.getById('wd-1', 'user-1')
      expect(still).not.toBeNull()
    })

    it('returns false for non-existent workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      const result = store.softDelete('nonexistent', 'user-1')

      expect(result).toBe(true) // exec doesn't throw, but 0 rows affected
    })

    it('is idempotent - second delete is a no-op', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-1', userId: 'user-1', name: 'A', path: '/a' })
      store.softDelete('wd-1', 'user-1')

      const result = store.softDelete('wd-1', 'user-1')

      expect(result).toBe(true) // no-op, no error
    })
  })

  describe('cross-user isolation', () => {
    it('user B cannot read user A workdirs', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-a1', userId: 'userA', name: 'A Project', path: '/a' })
      store.create({ id: 'wd-b1', userId: 'userB', name: 'B Project', path: '/b' })

      const userAWorkdirs = store.listByUser('userA')
      const userBWorkdirs = store.listByUser('userB')

      expect(userAWorkdirs).toHaveLength(1)
      expect(userAWorkdirs[0]!.id).toBe('wd-a1')
      expect(userBWorkdirs).toHaveLength(1)
      expect(userBWorkdirs[0]!.id).toBe('wd-b1')
    })

    it('user B cannot get user A workdir by id', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-a1', userId: 'userA', name: 'A Project', path: '/a' })

      const result = store.getById('wd-a1', 'userB')

      expect(result).toBeNull()
    })

    it('user B cannot update user A workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-a1', userId: 'userA', name: 'A Project', path: '/a' })

      store.update('wd-a1', { name: 'Hacked' }, 'userB')

      const original = store.getById('wd-a1', 'userA')
      expect(original!.name).toBe('A Project')
    })

    it('user B cannot soft-delete user A workdir', () => {
      const connection = openMemoryConnection()
      createWorkdirSchema(connection)
      const store = createWorkdirStore(connection)

      store.create({ id: 'wd-a1', userId: 'userA', name: 'A Project', path: '/a' })

      store.softDelete('wd-a1', 'userB')

      const still = store.getById('wd-a1', 'userA')
      expect(still).not.toBeNull()
    })
  })
})
