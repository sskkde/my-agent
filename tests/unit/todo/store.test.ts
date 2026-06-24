import { describe, it, expect, afterEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../helpers/db.js'
import {
  createTodoStore,
  type Todo,
  type CreateTodoInput,
  type UpdateTodoInput,
  DEFAULT_OWNER_AGENT_ID,
} from '../../../src/todo/store.js'
import { TodoStatus, TodoPriority } from '../../../src/todo/types.js'

const databases: TestDatabase[] = []

function openTestDatabase(): TestDatabase {
  const db = createTestDatabase(':memory:')
  databases.push(db)
  return db
}

function createTestSchema(db: TestDatabase): void {
  // Create sessions table (foreign key dependency)
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'closed')),
      message_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'org_default'
    )
  `)

  // Create todos table with hierarchical structure
  db.exec(`
    CREATE TABLE todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
      priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low')),
      parent_id TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      owner_agent_id TEXT NOT NULL DEFAULT 'foreground.default',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES todos(id) ON DELETE CASCADE
    )
  `)

  // Create indexes
  db.exec(`CREATE INDEX idx_todos_session ON todos(session_id)`)
  db.exec(`CREATE INDEX idx_todos_parent ON todos(parent_id) WHERE parent_id IS NOT NULL`)
  db.exec(`CREATE INDEX idx_todos_status ON todos(status)`)
  db.exec(`CREATE INDEX idx_todos_position ON todos(session_id, parent_id, position)`)
  db.exec(`CREATE INDEX idx_todos_tenant ON todos(tenant_id)`)
  db.exec(`CREATE INDEX idx_todos_owner ON todos(tenant_id, session_id, owner_agent_id)`)
}

function seedTestSession(db: TestDatabase, sessionId: string = 'sess-1', tenantId: string = 'org_default'): void {
  db.exec(
    `INSERT INTO sessions (session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      'user-1',
      'Test Session',
      'active',
      0,
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      tenantId,
    ],
  )
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close()
  }
})

describe('TodoStore', () => {
  describe('create', () => {
    it('creates a todo with all required fields', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      const input: CreateTodoInput = {
        id: 'todo-1',
        sessionId: 'sess-1',
        content: 'Implement feature X',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      }

      const result = store.create(input)

      expect(result.id).toBe('todo-1')
      expect(result.sessionId).toBe('sess-1')
      expect(result.content).toBe('Implement feature X')
      expect(result.status).toBe('pending')
      expect(result.priority).toBe('high')
      expect(result.parentId).toBeUndefined()
      expect(result.depth).toBe(0)
      expect(result.position).toBe(0)
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
    })

    it('creates a todo with optional parent_id', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create parent todo
      store.create({
        id: 'todo-parent',
        sessionId: 'sess-1',
        content: 'Parent task',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      // Create child todo
      const child = store.create({
        id: 'todo-child',
        sessionId: 'sess-1',
        content: 'Child task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'todo-parent',
      })

      expect(child.parentId).toBe('todo-parent')
      expect(child.depth).toBe(1)
    })

    it('auto-increments position for siblings', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      const todo1 = store.create({
        id: 'todo-1',
        sessionId: 'sess-1',
        content: 'First task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      const todo2 = store.create({
        id: 'todo-2',
        sessionId: 'sess-1',
        content: 'Second task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      const todo3 = store.create({
        id: 'todo-3',
        sessionId: 'sess-1',
        content: 'Third task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      expect(todo1.position).toBe(0)
      expect(todo2.position).toBe(1)
      expect(todo3.position).toBe(2)
    })

    it('rejects circular parent reference', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create a todo
      store.create({
        id: 'todo-1',
        sessionId: 'sess-1',
        content: 'Task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      // Try to set parent to itself (circular)
      expect(() =>
        store.create({
          id: 'todo-1',
          sessionId: 'sess-1',
          content: 'Task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'todo-1', // Self-reference
        }),
      ).toThrow(/circular/i)
    })

    it('rejects depth > 3', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create depth 0
      const t0 = store.create({
        id: 't0',
        sessionId: 'sess-1',
        content: 'Depth 0',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      expect(t0.depth).toBe(0)

      // Create depth 1
      const t1 = store.create({
        id: 't1',
        sessionId: 'sess-1',
        content: 'Depth 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 't0',
      })
      expect(t1.depth).toBe(1)

      // Create depth 2
      const t2 = store.create({
        id: 't2',
        sessionId: 'sess-1',
        content: 'Depth 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 't1',
      })
      expect(t2.depth).toBe(2)

      // Create depth 3
      const t3 = store.create({
        id: 't3',
        sessionId: 'sess-1',
        content: 'Depth 3',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 't2',
      })
      expect(t3.depth).toBe(3)

      // Try depth 4 - should fail
      expect(() =>
        store.create({
          id: 't4',
          sessionId: 'sess-1',
          content: 'Depth 4',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 't3',
        }),
      ).toThrow(/depth.*3/i)
    })
  })

  describe('findById', () => {
    it('returns todo by id', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'todo-find',
        sessionId: 'sess-1',
        content: 'Find me',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      const result = store.findById('todo-find')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('todo-find')
      expect(result?.content).toBe('Find me')
    })

    it('returns null for non-existent id', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)
      const result = store.findById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findBySession', () => {
    it('lists todos by session in hierarchical order', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db, 'sess-1')
      seedTestSession(db, 'sess-2')

      const store = createTodoStore(db)

      // Session 1 todos
      store.create({
        id: 't1-s1',
        sessionId: 'sess-1',
        content: 'Task 1',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })
      store.create({
        id: 't2-s1',
        sessionId: 'sess-1',
        content: 'Task 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      // Session 2 todo
      store.create({
        id: 't1-s2',
        sessionId: 'sess-2',
        content: 'Other session task',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
      })

      const result = store.findBySession('sess-1')

      expect(result).toHaveLength(2)
      expect(result.map((t: Todo) => t.id)).toEqual(['t1-s1', 't2-s1'])
    })

    it('returns todos sorted by parent, then position', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Root level todos
      store.create({
        id: 'root-2',
        sessionId: 'sess-1',
        content: 'Root 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      store.create({
        id: 'root-1',
        sessionId: 'sess-1',
        content: 'Root 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        position: 0, // Explicit position
      })

      // Child of root-1
      store.create({
        id: 'child-1',
        sessionId: 'sess-1',
        content: 'Child of Root 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'root-1',
      })

      const result = store.findBySession('sess-1')

      // Should be ordered: root-1, child-1, root-2 (parent-first, then position)
      expect(result).toHaveLength(3)
      expect(result[0]?.id).toBe('root-1')
      expect(result[1]?.id).toBe('child-1')
      expect(result[2]?.id).toBe('root-2')
    })

    it('returns empty array for session with no todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      const result = store.findBySession('sess-empty')

      expect(result).toEqual([])
    })
  })

  describe('update', () => {
    it('updates todo fields', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'todo-update',
        sessionId: 'sess-1',
        content: 'Original content',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      const input: UpdateTodoInput = {
        content: 'Updated content',
        status: TodoStatus.in_progress,
        priority: TodoPriority.high,
      }

      const result = store.update('todo-update', input)

      expect(result).not.toBeNull()
      expect(result?.content).toBe('Updated content')
      expect(result?.status).toBe('in_progress')
      expect(result?.priority).toBe('high')
      expect(result?.updatedAt).not.toBe(result?.createdAt)
    })

    it('returns null for non-existent id', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)
      const result = store.update('nonexistent', { content: 'Updated' })

      expect(result).toBeNull()
    })

    it('updates only provided fields', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'todo-partial',
        sessionId: 'sess-1',
        content: 'Original',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      const result = store.update('todo-partial', { status: TodoStatus.completed })

      expect(result?.content).toBe('Original') // Unchanged
      expect(result?.priority).toBe('medium') // Unchanged
      expect(result?.status).toBe('completed') // Changed
    })
  })

  describe('remove', () => {
    it('removes a todo', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'todo-remove',
        sessionId: 'sess-1',
        content: 'To be removed',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
      })

      const result = store.remove('todo-remove')

      expect(result).toBe(true)
      expect(store.findById('todo-remove')).toBeNull()
    })

    it('cascades delete to descendants', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create hierarchy
      store.create({
        id: 'parent',
        sessionId: 'sess-1',
        content: 'Parent',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })
      store.create({
        id: 'child-1',
        sessionId: 'sess-1',
        content: 'Child 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'parent',
      })
      store.create({
        id: 'grandchild',
        sessionId: 'sess-1',
        content: 'Grandchild',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
        parentId: 'child-1',
      })
      store.create({
        id: 'child-2',
        sessionId: 'sess-1',
        content: 'Child 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'parent',
      })

      // Remove parent - should cascade
      const result = store.remove('parent')

      expect(result).toBe(true)
      expect(store.findById('parent')).toBeNull()
      expect(store.findById('child-1')).toBeNull()
      expect(store.findById('grandchild')).toBeNull()
      expect(store.findById('child-2')).toBeNull()
    })

    it('returns false for non-existent id', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)
      const result = store.remove('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('replace', () => {
    it('replaces all todos for session in a transaction', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create initial todos
      store.create({
        id: 'old-1',
        sessionId: 'sess-1',
        content: 'Old Task 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      store.create({
        id: 'old-2',
        sessionId: 'sess-1',
        content: 'Old Task 2',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
      })

      // Replace with new todos
      const newTodos: CreateTodoInput[] = [
        {
          id: 'new-1',
          sessionId: 'sess-1',
          content: 'New Task 1',
          status: TodoStatus.in_progress,
          priority: TodoPriority.high,
        },
        {
          id: 'new-2',
          sessionId: 'sess-1',
          content: 'New Task 2',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
        },
        {
          id: 'new-3',
          sessionId: 'sess-1',
          content: 'New Task 3',
          status: TodoStatus.pending,
          priority: TodoPriority.low,
        },
      ]

      const result = store.replace('sess-1', newTodos)

      expect(result).toHaveLength(3)
      expect(result.map((t: Todo) => t.id)).toEqual(['new-1', 'new-2', 'new-3'])

      // Verify old todos are gone
      expect(store.findById('old-1')).toBeNull()
      expect(store.findById('old-2')).toBeNull()

      // Verify new todos exist
      expect(store.findById('new-1')).not.toBeNull()
      expect(store.findById('new-2')).not.toBeNull()
      expect(store.findById('new-3')).not.toBeNull()
    })

    it('rolls back on validation error during replace', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create initial todo
      store.create({
        id: 'existing',
        sessionId: 'sess-1',
        content: 'Existing Task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      // Try to replace with invalid todo (depth > 3)
      const newTodos: CreateTodoInput[] = [
        {
          id: 'valid',
          sessionId: 'sess-1',
          content: 'Valid Task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
        },
        {
          id: 'invalid',
          sessionId: 'sess-1',
          content: 'Invalid Task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'nonexistent-parent', // Will fail
        },
      ]

      expect(() => store.replace('sess-1', newTodos)).toThrow()

      // Verify original todo still exists (rollback)
      expect(store.findById('existing')).not.toBeNull()
    })
  })

  describe('tenant isolation', () => {
    it('tenant A cannot see tenant B todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db, 'sess-a', 'org_tenant_a')
      seedTestSession(db, 'sess-b', 'org_tenant_b')

      const storeA = createTodoStore(db, 'org_tenant_a')
      const storeB = createTodoStore(db, 'org_tenant_b')

      // Create todo for tenant A
      storeA.create({
        id: 'todo-a',
        sessionId: 'sess-a',
        content: 'Tenant A Todo',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      // Create todo for tenant B
      storeB.create({
        id: 'todo-b',
        sessionId: 'sess-b',
        content: 'Tenant B Todo',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      // Tenant A should only see its own todos
      const todosA = storeA.findBySession('sess-a')
      expect(todosA).toHaveLength(1)
      expect(todosA[0]?.id).toBe('todo-a')

      // Tenant B should only see its own todos
      const todosB = storeB.findBySession('sess-b')
      expect(todosB).toHaveLength(1)
      expect(todosB[0]?.id).toBe('todo-b')

      // Cross-tenant access should return null
      expect(storeA.findById('todo-b')).toBeNull()
      expect(storeB.findById('todo-a')).toBeNull()
    })

    it('cannot update cross-tenant todo', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db, 'sess-a', 'org_tenant_a')
      seedTestSession(db, 'sess-b', 'org_tenant_b')

      const storeA = createTodoStore(db, 'org_tenant_a')
      const storeB = createTodoStore(db, 'org_tenant_b')

      // Create todo for tenant A
      storeA.create({
        id: 'todo-a',
        sessionId: 'sess-a',
        content: 'Tenant A Todo',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      // Tenant B tries to update tenant A's todo
      const result = storeB.update('todo-a', { status: TodoStatus.completed })

      expect(result).toBeNull()

      // Verify tenant A's todo is unchanged
      const todoA = storeA.findById('todo-a')
      expect(todoA?.status).toBe('pending')
    })

    it('cannot remove cross-tenant todo', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db, 'sess-a', 'org_tenant_a')
      seedTestSession(db, 'sess-b', 'org_tenant_b')

      const storeA = createTodoStore(db, 'org_tenant_a')
      const storeB = createTodoStore(db, 'org_tenant_b')

      // Create todo for tenant A
      storeA.create({
        id: 'todo-a',
        sessionId: 'sess-a',
        content: 'Tenant A Todo',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })

      // Tenant B tries to remove tenant A's todo
      const result = storeB.remove('todo-a')

      expect(result).toBe(false)

      // Verify tenant A's todo still exists
      expect(storeA.findById('todo-a')).not.toBeNull()
    })
  })

  describe('hierarchical ordering', () => {
    it('maintains correct position for children under different parents', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      // Create two root todos
      const root1 = store.create({
        id: 'root-1',
        sessionId: 'sess-1',
        content: 'Root 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      const root2 = store.create({
        id: 'root-2',
        sessionId: 'sess-1',
        content: 'Root 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      // Add children to root-1
      const child1_1 = store.create({
        id: 'child-1-1',
        sessionId: 'sess-1',
        content: 'Child 1-1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'root-1',
      })
      const child1_2 = store.create({
        id: 'child-1-2',
        sessionId: 'sess-1',
        content: 'Child 1-2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'root-1',
      })

      // Add children to root-2
      const child2_1 = store.create({
        id: 'child-2-1',
        sessionId: 'sess-1',
        content: 'Child 2-1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'root-2',
      })

      expect(root1.position).toBe(0)
      expect(root2.position).toBe(1)
      expect(child1_1.position).toBe(0) // Position resets per parent
      expect(child1_2.position).toBe(1)
      expect(child2_1.position).toBe(0) // Position resets per parent
    })
  })

  describe('metadata', () => {
    it('stores and retrieves metadata', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      const metadata = { labels: ['urgent', 'backend'], estimate: 4 }

      const todo = store.create({
        id: 'todo-meta',
        sessionId: 'sess-1',
        content: 'Task with metadata',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        metadata,
      })

      expect(todo.metadata).toEqual(metadata)

      const found = store.findById('todo-meta')
      expect(found?.metadata).toEqual(metadata)
    })

    it('updates metadata', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'todo-meta-update',
        sessionId: 'sess-1',
        content: 'Task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        metadata: { old: 'value' },
      })

      const result = store.update('todo-meta-update', {
        metadata: { new: 'value', extra: 123 },
      })

      expect(result?.metadata).toEqual({ new: 'value', extra: 123 })
    })
  })

  describe('edge cases - empty replace', () => {
    it('replaces all todos with empty array', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 't1',
        sessionId: 'sess-1',
        content: 'Task 1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      store.create({
        id: 't2',
        sessionId: 'sess-1',
        content: 'Task 2',
        status: TodoStatus.in_progress,
        priority: TodoPriority.high,
      })

      const result = store.replace('sess-1', [])

      expect(result).toHaveLength(0)
      expect(store.findBySession('sess-1')).toHaveLength(0)
      expect(store.findById('t1')).toBeNull()
      expect(store.findById('t2')).toBeNull()
    })

    it('empty replace on empty session returns empty array', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      const result = store.replace('sess-1', [])

      expect(result).toHaveLength(0)
    })
  })

  describe('edge cases - non-existent IDs', () => {
    it('update returns null for non-existent id with consistent behavior', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)

      expect(store.update('todo-does-not-exist', { content: 'Updated' })).toBeNull()
      expect(store.update('todo-does-not-exist', { status: TodoStatus.completed })).toBeNull()
      expect(store.update('todo-does-not-exist', { priority: TodoPriority.high })).toBeNull()
    })

    it('remove returns false for non-existent id', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)

      expect(store.remove('todo-does-not-exist')).toBe(false)
      expect(store.remove('another-fake-id')).toBe(false)
    })

    it('findById returns null for non-existent id without throwing', () => {
      const db = openTestDatabase()
      createTestSchema(db)

      const store = createTodoStore(db)

      expect(store.findById('nonexistent')).toBeNull()
      expect(store.findById('')).toBeNull()
    })

    it('create with non-existent parent throws descriptive error', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      expect(() =>
        store.create({
          id: 'todo-orphan',
          sessionId: 'sess-1',
          content: 'Orphan task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'non-existent-parent',
        }),
      ).toThrow(/Parent todo not found/)
    })
  })

  describe('edge cases - error message stability', () => {
    it('circular reference error contains stable keyword', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 't1',
        sessionId: 'sess-1',
        content: 'Task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      try {
        store.create({
          id: 't1',
          sessionId: 'sess-1',
          content: 'Task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 't1',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/circular/i)
      }
    })

    it('depth exceeded error contains stable keyword and limit', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'd0',
        sessionId: 'sess-1',
        content: 'D0',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      store.create({
        id: 'd1',
        sessionId: 'sess-1',
        content: 'D1',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'd0',
      })
      store.create({
        id: 'd2',
        sessionId: 'sess-1',
        content: 'D2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'd1',
      })
      store.create({
        id: 'd3',
        sessionId: 'sess-1',
        content: 'D3',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentId: 'd2',
      })

      try {
        store.create({
          id: 'd4',
          sessionId: 'sess-1',
          content: 'D4',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'd3',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/depth.*3/i)
      }
    })

    it('parent not found error contains stable keyword', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      try {
        store.create({
          id: 't1',
          sessionId: 'sess-1',
          content: 'Task',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'missing',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/Parent todo not found/)
      }
    })
  })

  describe('edge cases - replace rollback preserves original data', () => {
    it('rollback restores original todos on validation failure', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'orig-1',
        sessionId: 'sess-1',
        content: 'Original 1',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      })
      store.create({
        id: 'orig-2',
        sessionId: 'sess-1',
        content: 'Original 2',
        status: TodoStatus.in_progress,
        priority: TodoPriority.medium,
      })

      const invalidTodos = [
        {
          id: 'ok',
          sessionId: 'sess-1',
          content: 'Valid',
          status: TodoStatus.pending as const,
          priority: TodoPriority.medium as const,
        },
        {
          id: 'bad',
          sessionId: 'sess-1',
          content: 'Invalid parent',
          status: TodoStatus.pending as const,
          priority: TodoPriority.medium as const,
          parentId: 'nonexistent-parent',
        },
      ]

      expect(() => store.replace('sess-1', invalidTodos)).toThrow()

      const remaining = store.findBySession('sess-1')
      expect(remaining).toHaveLength(2)
      expect(remaining.map((t) => t.id).sort()).toEqual(['orig-1', 'orig-2'])
    })

    it('rollback restores todos with correct content and status', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 't1',
        sessionId: 'sess-1',
        content: 'Keep me',
        status: TodoStatus.in_progress,
        priority: TodoPriority.high,
      })

      expect(() =>
        store.replace('sess-1', [
          {
            id: 'bad',
            sessionId: 'sess-1',
            content: 'Fail',
            status: TodoStatus.pending,
            priority: TodoPriority.low,
            parentId: 'no-such-parent',
          },
        ]),
      ).toThrow()

      const restored = store.findById('t1')
      expect(restored).not.toBeNull()
      expect(restored?.content).toBe('Keep me')
      expect(restored?.status).toBe('in_progress')
      expect(restored?.priority).toBe('high')
    })
  })

  describe('edge cases - replace with nested hierarchy', () => {
    it('replace can create nested todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      const todos = store.replace('sess-1', [
        { id: 'root', sessionId: 'sess-1', content: 'Root', status: TodoStatus.pending, priority: TodoPriority.high },
        {
          id: 'child',
          sessionId: 'sess-1',
          content: 'Child',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'root',
        },
        {
          id: 'grandchild',
          sessionId: 'sess-1',
          content: 'Grandchild',
          status: TodoStatus.pending,
          priority: TodoPriority.low,
          parentId: 'child',
        },
      ])

      expect(todos).toHaveLength(3)
      const root = store.findById('root')
      const child = store.findById('child')
      const grandchild = store.findById('grandchild')

      expect(root?.depth).toBe(0)
      expect(child?.depth).toBe(1)
      expect(grandchild?.depth).toBe(2)
    })

    it('replace rejects depth > 3 in new todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      expect(() =>
        store.replace('sess-1', [
          { id: 'd0', sessionId: 'sess-1', content: 'D0', status: TodoStatus.pending, priority: TodoPriority.high },
          {
            id: 'd1',
            sessionId: 'sess-1',
            content: 'D1',
            status: TodoStatus.pending,
            priority: TodoPriority.medium,
            parentId: 'd0',
          },
          {
            id: 'd2',
            sessionId: 'sess-1',
            content: 'D2',
            status: TodoStatus.pending,
            priority: TodoPriority.low,
            parentId: 'd1',
          },
          {
            id: 'd3',
            sessionId: 'sess-1',
            content: 'D3',
            status: TodoStatus.pending,
            priority: TodoPriority.low,
            parentId: 'd2',
          },
          {
            id: 'd4',
            sessionId: 'sess-1',
            content: 'D4',
            status: TodoStatus.pending,
            priority: TodoPriority.low,
            parentId: 'd3',
          },
        ]),
      ).toThrow(/depth/i)
    })
  })

  describe('owner agent isolation', () => {
    it('defaults ownerAgentId to foreground.default when not specified', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      const todo = store.create({
        id: 'todo-default-owner',
        sessionId: 'sess-1',
        content: 'Task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })

      expect(todo.ownerAgentId).toBe(DEFAULT_OWNER_AGENT_ID)
      expect(todo.ownerAgentId).toBe('foreground.default')
    })

    it('owner A and B can create todos in same session', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'todo-a1',
        sessionId: 'sess-1',
        content: 'Owner A task',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        ownerAgentId: 'agent-alpha',
      })
      store.create({
        id: 'todo-b1',
        sessionId: 'sess-1',
        content: 'Owner B task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-beta',
      })

      const all = store.findBySession('sess-1')
      expect(all).toHaveLength(2)
      expect(all.map((t) => t.id).sort()).toEqual(['todo-a1', 'todo-b1'])
    })

    it('rejects parent todo from a different session', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db, 'sess-1')
      seedTestSession(db, 'sess-2')

      const store = createTodoStore(db)
      store.create({
        id: 'parent-other-session',
        sessionId: 'sess-2',
        content: 'Parent from another session',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-alpha',
      })

      expect(() =>
        store.create({
          id: 'child-cross-session',
          sessionId: 'sess-1',
          content: 'Child in current session',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'parent-other-session',
          ownerAgentId: 'agent-alpha',
        }),
      ).toThrow('Parent todo must belong to the same session')
    })

    it('rejects parent todo from a different owner', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'parent-alpha',
        sessionId: 'sess-1',
        content: 'Alpha parent',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-alpha',
      })

      expect(() =>
        store.create({
          id: 'child-beta',
          sessionId: 'sess-1',
          content: 'Beta child',
          status: TodoStatus.pending,
          priority: TodoPriority.medium,
          parentId: 'parent-alpha',
          ownerAgentId: 'agent-beta',
        }),
      ).toThrow('Parent todo must belong to the same owner agent')
    })

    it('findBySessionAndOwner returns only the specified owner todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'todo-a1',
        sessionId: 'sess-1',
        content: 'Owner A task 1',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        ownerAgentId: 'agent-alpha',
      })
      store.create({
        id: 'todo-a2',
        sessionId: 'sess-1',
        content: 'Owner A task 2',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-alpha',
      })
      store.create({
        id: 'todo-b1',
        sessionId: 'sess-1',
        content: 'Owner B task',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
        ownerAgentId: 'agent-beta',
      })

      const alphaTodos = store.findBySessionAndOwner('sess-1', 'agent-alpha')
      expect(alphaTodos).toHaveLength(2)
      expect(alphaTodos.map((t) => t.id).sort()).toEqual(['todo-a1', 'todo-a2'])
      expect(alphaTodos.every((t) => t.ownerAgentId === 'agent-alpha')).toBe(true)

      const betaTodos = store.findBySessionAndOwner('sess-1', 'agent-beta')
      expect(betaTodos).toHaveLength(1)
      expect(betaTodos[0]?.id).toBe('todo-b1')
      expect(betaTodos[0]?.ownerAgentId).toBe('agent-beta')
    })

    it('findBySession returns all owners (backward compatible)', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'todo-a',
        sessionId: 'sess-1',
        content: 'Owner A',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        ownerAgentId: 'agent-alpha',
      })
      store.create({
        id: 'todo-b',
        sessionId: 'sess-1',
        content: 'Owner B',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-beta',
      })
      store.create({
        id: 'todo-default',
        sessionId: 'sess-1',
        content: 'Default owner',
        status: TodoStatus.pending,
        priority: TodoPriority.low,
      })

      const all = store.findBySession('sess-1')
      expect(all).toHaveLength(3)
      const owners = all.map((t) => t.ownerAgentId).sort()
      expect(owners).toEqual(['agent-alpha', 'agent-beta', 'foreground.default'])
    })

    it('owner A replace does not delete owner B todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'a-old-1',
        sessionId: 'sess-1',
        content: 'Owner A old task',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        ownerAgentId: 'agent-alpha',
      })
      store.create({
        id: 'b-keep-1',
        sessionId: 'sess-1',
        content: 'Owner B task (must survive)',
        status: TodoStatus.in_progress,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-beta',
      })

      const result = store.replace('sess-1', [
        {
          id: 'a-new-1',
          sessionId: 'sess-1',
          content: 'Owner A new task',
          status: TodoStatus.pending,
          priority: TodoPriority.high,
          ownerAgentId: 'agent-alpha',
        },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('a-new-1')
      expect(result[0]?.ownerAgentId).toBe('agent-alpha')

      expect(store.findById('a-old-1')).toBeNull()
      expect(store.findById('b-keep-1')).not.toBeNull()
      expect(store.findById('b-keep-1')?.ownerAgentId).toBe('agent-beta')

      const alphaTodos = store.findBySessionAndOwner('sess-1', 'agent-alpha')
      expect(alphaTodos).toHaveLength(1)
      expect(alphaTodos[0]?.id).toBe('a-new-1')

      const betaTodos = store.findBySessionAndOwner('sess-1', 'agent-beta')
      expect(betaTodos).toHaveLength(1)
      expect(betaTodos[0]?.id).toBe('b-keep-1')
    })

    it('replace with default owner only affects default-owner todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)

      store.create({
        id: 'default-old',
        sessionId: 'sess-1',
        content: 'Default owner old',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      })
      store.create({
        id: 'alpha-keep',
        sessionId: 'sess-1',
        content: 'Alpha owner (must survive)',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        ownerAgentId: 'agent-alpha',
      })

      store.replace('sess-1', [
        {
          id: 'default-new',
          sessionId: 'sess-1',
          content: 'Default owner new',
          status: TodoStatus.in_progress,
          priority: TodoPriority.low,
        },
      ])

      expect(store.findById('default-old')).toBeNull()
      expect(store.findById('default-new')).not.toBeNull()
      expect(store.findById('default-new')?.ownerAgentId).toBe('foreground.default')
      expect(store.findById('alpha-keep')).not.toBeNull()
      expect(store.findById('alpha-keep')?.ownerAgentId).toBe('agent-alpha')
    })

    it('findBySessionAndOwner returns empty for owner with no todos', () => {
      const db = openTestDatabase()
      createTestSchema(db)
      seedTestSession(db)

      const store = createTodoStore(db)
      store.create({
        id: 'todo-a',
        sessionId: 'sess-1',
        content: 'Owner A task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'agent-alpha',
      })

      const result = store.findBySessionAndOwner('sess-1', 'agent-nonexistent')
      expect(result).toEqual([])
    })
  })
})
