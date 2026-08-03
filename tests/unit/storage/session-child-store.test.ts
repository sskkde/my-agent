import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSessionStore, type SessionStore } from '../../../src/storage/session-store.js'

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): MigrationRunner {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
  return runner
}

function makeStore(): SessionStore {
  const connection = openMemoryConnection()
  applyAll(connection)
  return createSessionStore(connection)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('session-store child session queries', () => {
  describe('createChildSession', () => {
    it('creates a subagent-kind session linked to the parent with taskId = child sessionId by default', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })

      const child = store.createChildSession({
        sessionId: 'sess_child',
        userId: 'user_1',
        parentSessionId: 'sess_parent',
      })

      expect(child.sessionKind).toBe('subagent')
      expect(child.parentSessionId).toBe('sess_parent')
      expect(child.taskId).toBe('sess_child')
      expect(child.subagentDepth).toBe(1)
      expect(child.launchMode).toBe('foreground')
      expect(child.status).toBe('active')

      const stored = store.getById('sess_child')
      expect(stored?.sessionKind).toBe('subagent')
      expect(stored?.parentSessionId).toBe('sess_parent')
      expect(stored?.taskId).toBe('sess_child')
      expect(stored?.subagentDepth).toBe(1)
      expect(stored?.launchMode).toBe('foreground')
    })

    it('honors explicit taskId, agentProfile, launchMode and subagentDepth', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })

      store.createChildSession({
        sessionId: 'sess_deep',
        userId: 'user_1',
        parentSessionId: 'sess_parent',
        taskId: 'sess_deep',
        agentProfile: 'researcher',
        launchMode: 'background',
        subagentDepth: 2,
        title: 'Deep research',
      })

      const stored = store.getById('sess_deep')
      expect(stored?.agentProfile).toBe('researcher')
      expect(stored?.launchMode).toBe('background')
      expect(stored?.subagentDepth).toBe(2)
      expect(stored?.title).toBe('Deep research')
    })
  })

  describe('getChildSessionById', () => {
    it('returns the child session for a subagent-kind id and null for foreground sessions', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      const child = store.getChildSessionById('sess_child')
      expect(child?.sessionId).toBe('sess_child')
      expect(child?.sessionKind).toBe('subagent')

      expect(store.getChildSessionById('sess_parent')).toBeNull()
      expect(store.getChildSessionById('sess_missing')).toBeNull()
    })

    it('is tenant-scoped: same id under another tenant returns null', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      expect(store.getChildSessionById('sess_child', 'tenant_other')).toBeNull()
    })
  })

  describe('getByTaskId', () => {
    it('finds the child session by task id (taskId = childSessionId identity rule)', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      const found = store.getByTaskId('sess_child')
      expect(found?.sessionId).toBe('sess_child')
      expect(found?.taskId).toBe('sess_child')
      expect(found?.parentSessionId).toBe('sess_parent')
    })

    it('is user-scoped: a foreign userId never resolves the child', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      expect(store.getByTaskId('sess_child', 'user_other')).toBeNull()
    })

    it('is tenant-scoped: a foreign tenant never resolves the child', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      expect(store.getByTaskId('sess_child', 'user_1', 'tenant_other')).toBeNull()
    })

    it('returns null for an unknown task id', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      expect(store.getByTaskId('sess_unknown')).toBeNull()
    })
  })

  describe('list exclusion and child listing', () => {
    it('excludes session_kind=subagent rows from the default list', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.create({ sessionId: 'sess_other', userId: 'user_1', title: 'Other' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      const all = store.list({ userId: 'user_1' })
      expect(all.map((s) => s.sessionId).sort()).toEqual(['sess_other', 'sess_parent'])

      const active = store.list({ userId: 'user_1', status: 'active' })
      expect(active.map((s) => s.sessionId)).not.toContain('sess_child')
    })

    it('excludes children from getCount', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })

      expect(store.getCount({ userId: 'user_1' })).toBe(1)
    })

    it('lists children of a parent with pagination and tenant scoping', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({
        sessionId: 'sess_c1',
        userId: 'user_1',
        parentSessionId: 'sess_parent',
        taskId: 'sess_c1',
      })
      store.createChildSession({
        sessionId: 'sess_c2',
        userId: 'user_1',
        parentSessionId: 'sess_parent',
        taskId: 'sess_c2',
      })
      store.create({ sessionId: 'sess_other', userId: 'user_2', title: 'Foreign' })
      store.createChildSession({
        sessionId: 'sess_x1',
        userId: 'user_2',
        parentSessionId: 'sess_other',
        taskId: 'sess_x1',
      })

      const children = store.listChildren('sess_parent')
      expect(children.map((s) => s.sessionId).sort()).toEqual(['sess_c1', 'sess_c2'])
      expect(children.every((s) => s.sessionKind === 'subagent')).toBe(true)

      expect(store.listChildren('sess_parent', { limit: 1 }).length).toBe(1)
      expect(store.listChildren('sess_parent', { limit: 1, offset: 1 }).map((s) => s.sessionId)).toEqual(['sess_c2'])
      expect(store.listChildren('sess_parent', undefined, 'tenant_other')).toEqual([])
    })
  })

  describe('countChildLaunches', () => {
    it('counts child sessions launched under a parent (per parent turn)', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_c1', userId: 'user_1', parentSessionId: 'sess_parent' })
      store.createChildSession({ sessionId: 'sess_c2', userId: 'user_1', parentSessionId: 'sess_parent' })
      store.create({ sessionId: 'sess_other', userId: 'user_1', title: 'Other' })

      expect(store.countChildLaunches('sess_parent')).toBe(2)
      expect(store.countChildLaunches('sess_other')).toBe(0)
    })

    it('supports a since window and tenant scoping', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_c1', userId: 'user_1', parentSessionId: 'sess_parent' })
      store.createChildSession({ sessionId: 'sess_c2', userId: 'user_1', parentSessionId: 'sess_parent' })

      const future = new Date(Date.now() + 60_000).toISOString()
      expect(store.countChildLaunches('sess_parent', future)).toBe(0)
      expect(store.countChildLaunches('sess_parent', undefined, 'tenant_other')).toBe(0)
    })
  })

  describe('archiveDescendants', () => {
    it('soft-archives child and grandchild sessions recursively without deleting rows', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })
      store.createChildSession({ sessionId: 'sess_grand', userId: 'user_1', parentSessionId: 'sess_child' })
      store.create({ sessionId: 'sess_unrelated', userId: 'user_1', title: 'Unrelated' })

      const archivedCount = store.archiveDescendants('sess_parent')
      expect(archivedCount).toBe(2)

      expect(store.getById('sess_child')?.status).toBe('archived')
      expect(store.getById('sess_grand')?.status).toBe('archived')
      // Parent itself is NOT archived by this method (caller archives it separately).
      expect(store.getById('sess_parent')?.status).toBe('active')
      // Unrelated sessions are untouched.
      expect(store.getById('sess_unrelated')?.status).toBe('active')
      // Rows still exist — soft archive, never a hard delete.
      expect(store.getChildSessionById('sess_child')?.sessionId).toBe('sess_child')
    })

    it('is tenant-scoped and idempotent', () => {
      const store = makeStore()
      store.create({ sessionId: 'sess_parent', userId: 'user_1', title: 'Parent' })
      store.create({ sessionId: 'sess_foreign_parent', userId: 'user_2', title: 'Foreign' })
      store.createChildSession({ sessionId: 'sess_child', userId: 'user_1', parentSessionId: 'sess_parent' })
      store.createChildSession({
        sessionId: 'sess_foreign_child',
        userId: 'user_2',
        parentSessionId: 'sess_foreign_parent',
      })

      expect(store.archiveDescendants('sess_parent')).toBe(1)
      expect(store.archiveDescendants('sess_parent')).toBe(0)

      expect(store.getById('sess_child')?.status).toBe('archived')
      expect(store.getById('sess_foreign_child')?.status).toBe('active')

      expect(store.archiveDescendants('sess_parent', 'tenant_other')).toBe(0)
    })
  })

  describe('source compatibility', () => {
    it('keeps the plain create path working and mapping child fields on getById', () => {
      const store = makeStore()
      const session = store.create({
        sessionId: 'sess_plain',
        userId: 'user_1',
        title: 'Plain',
        sessionKind: 'subagent',
        parentSessionId: 'sess_parent',
        taskId: 'sess_plain',
        subagentDepth: 3,
      })

      expect(session.sessionId).toBe('sess_plain')
      const stored = store.getById('sess_plain')
      expect(stored?.sessionKind).toBe('subagent')
      expect(stored?.parentSessionId).toBe('sess_parent')
      expect(stored?.taskId).toBe('sess_plain')
      expect(stored?.subagentDepth).toBe(3)
    })
  })
})
