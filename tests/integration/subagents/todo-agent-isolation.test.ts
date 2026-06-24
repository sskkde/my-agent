/**
 * Same-session agent isolation integration tests.
 *
 * These tests exercise the actual TodoStore (real SQLite) AND the
 * todowrite/todolist tool handlers, proving that two subagents (or a
 * subagent + background agent) sharing the same session cannot see or
 * replace each other's todos.
 *
 * The tool handlers derive ownerAgentId from context.agentId, then scope
 * all reads via findBySessionAndOwner. The store's replace() scopes
 * DELETE to the derived ownerAgentId, so agent A replace never touches
 * agent B's rows.
 *
 * Scenarios covered:
 *   1. Subagent A and B each write todos in same session (store-level)
 *   2. Each todolist sees only its own todos (tool handler + store)
 *   3. Foreground/API findBySession (broad route) sees both owners' todos
 *   4. Subagent A replace does NOT delete B's todos
 *   5. Background agent can write/list its own todos
 *   6. Background agent cannot see subagent A's list unless using broad UI route
 *   7. Tool handler derives ownerAgentId correctly from context
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../helpers/db.js'
import {
  createTodoStore,
  type TodoStore,
  type CreateTodoInput,
  DEFAULT_OWNER_AGENT_ID,
} from '../../../src/todo/store.js'
import { TodoStatus, TodoPriority } from '../../../src/todo/types.js'
import { createTodolistTool } from '../../../src/tools/builtins/todo-list-tool.js'
import { createTodowriteTool } from '../../../src/tools/builtins/todo-write-tool.js'
import type { ToolExecutionContext, ToolExecutionResult } from '../../../src/tools/types.js'
import type { TodolistResult } from '../../../src/tools/builtins/todo-list-tool.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const databases: TestDatabase[] = []

function openTestDatabase(): TestDatabase {
  const db = createTestDatabase(':memory:')
  databases.push(db)
  return db
}

function createTestSchema(db: TestDatabase): void {
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

  db.exec(`CREATE INDEX idx_todos_session ON todos(session_id)`)
  db.exec(`CREATE INDEX idx_todos_parent ON todos(parent_id) WHERE parent_id IS NOT NULL`)
  db.exec(`CREATE INDEX idx_todos_status ON todos(status)`)
  db.exec(`CREATE INDEX idx_todos_position ON todos(session_id, parent_id, position)`)
  db.exec(`CREATE INDEX idx_todos_tenant ON todos(tenant_id)`)
  db.exec(`CREATE INDEX idx_todos_owner ON todos(tenant_id, session_id, owner_agent_id)`)
}

function seedTestSession(db: TestDatabase, sessionId: string = 'sess-shared'): void {
  db.exec(
    `INSERT INTO sessions (session_id, user_id, title, status, message_count, last_activity_at, created_at, updated_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      'user-1',
      'Shared Session',
      'active',
      0,
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      '2026-06-01T00:00:00.000Z',
      'org_default',
    ],
  )
}

/** Create a todo input with sensible defaults */
function makeTodo(
  id: string,
  content: string,
  owner: string,
  opts: Partial<Pick<CreateTodoInput, 'status' | 'priority'>> = {},
): CreateTodoInput {
  return {
    id,
    sessionId: 'sess-shared',
    content,
    status: opts.status ?? TodoStatus.pending,
    priority: opts.priority ?? TodoPriority.medium,
    ownerAgentId: owner,
  }
}

/**
 * Build a ToolExecutionContext for a specific agent identity.
 * This mirrors what the tool-executor passes to handlers.
 */
function makeContext(opts: { sessionId: string; agentId?: string; agentType?: string }): ToolExecutionContext {
  return {
    toolCallId: `tc-${opts.agentId ?? opts.agentType ?? 'default'}-${Date.now()}`,
    toolName: 'todowrite',
    userId: 'user-1',
    sessionId: opts.sessionId,
    agentId: opts.agentId,
    agentType: opts.agentType ?? 'subagent',
    permissionContext: {
      userId: 'user-1',
      sessionId: opts.sessionId,
    } as ToolExecutionContext['permissionContext'],
    executionStartTime: new Date().toISOString(),
    stores: {
      toolExecutionStore: {
        updateStatus: () => {},
        saveResult: () => {},
      },
    },
  }
}

/** Convenience: extract TodolistResult from handler output */
function asListResult(r: ToolExecutionResult): TodolistResult {
  return r.data as TodolistResult
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Same-session agent isolation (integration)', () => {
  let db: TestDatabase
  let store: TodoStore

  beforeEach(() => {
    db = openTestDatabase()
    createTestSchema(db)
    seedTestSession(db)
    store = createTodoStore(db)
  })

  afterEach(() => {
    while (databases.length > 0) {
      databases.pop()?.close()
    }
  })

  // -------------------------------------------------------------------------
  // Scenario 1: Two agents write todos in same session via store
  // -------------------------------------------------------------------------
  describe('Subagent A and B each write todos in same session', () => {
    it('both create successfully with different ownerAgentId', () => {
      const a = store.create(makeTodo('a-1', 'Alpha task 1', 'agent.alpha'))
      const b = store.create(makeTodo('b-1', 'Beta task 1', 'agent.beta'))

      expect(a.id).toBe('a-1')
      expect(a.ownerAgentId).toBe('agent.alpha')
      expect(b.id).toBe('b-1')
      expect(b.ownerAgentId).toBe('agent.beta')
    })

    it('each findBySessionAndOwner sees only its own todos', () => {
      store.create(makeTodo('a-1', 'Alpha 1', 'agent.alpha'))
      store.create(makeTodo('a-2', 'Alpha 2', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta 1', 'agent.beta'))

      const alphaTodos = store.findBySessionAndOwner('sess-shared', 'agent.alpha')
      expect(alphaTodos).toHaveLength(2)
      expect(alphaTodos.every((t) => t.ownerAgentId === 'agent.alpha')).toBe(true)

      const betaTodos = store.findBySessionAndOwner('sess-shared', 'agent.beta')
      expect(betaTodos).toHaveLength(1)
      expect(betaTodos[0]?.content).toBe('Beta 1')
    })

    it('broad findBySession sees both owners (API/UI route)', () => {
      store.create(makeTodo('a-1', 'Alpha task', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))

      const allTodos = store.findBySession('sess-shared')
      expect(allTodos).toHaveLength(2)
      const ids = allTodos.map((t) => t.id).sort()
      expect(ids).toEqual(['a-1', 'b-1'])
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 2: Replace isolation via store
  // -------------------------------------------------------------------------
  describe('Subagent A replace does not delete B todos', () => {
    it('replace scoped to ownerAgentId — B todos survive', () => {
      // A creates 2 old todos
      store.create(makeTodo('a-old-1', 'Alpha old 1', 'agent.alpha'))
      store.create(makeTodo('a-old-2', 'Alpha old 2', 'agent.alpha'))

      // B creates 1 todo
      store.create(makeTodo('b-keep', 'Beta must survive', 'agent.beta', { status: TodoStatus.in_progress }))

      // A replaces its own todos
      const result = store.replace('sess-shared', [
        {
          id: 'a-new',
          sessionId: 'sess-shared',
          content: 'Alpha new',
          status: TodoStatus.pending,
          priority: TodoPriority.low,
          ownerAgentId: 'agent.alpha',
        },
      ])

      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe('a-new')

      // A's old todos are gone
      expect(store.findById('a-old-1')).toBeNull()
      expect(store.findById('a-old-2')).toBeNull()

      // B's todo survives
      expect(store.findById('b-keep')).not.toBeNull()
      expect(store.findById('b-keep')?.ownerAgentId).toBe('agent.beta')

      // Verify via scoped query
      const betaTodos = store.findBySessionAndOwner('sess-shared', 'agent.beta')
      expect(betaTodos).toHaveLength(1)
      expect(betaTodos[0]?.content).toBe('Beta must survive')
    })

    it('replace with different owner does not affect the other', () => {
      store.create(makeTodo('a-1', 'Alpha 1', 'agent.alpha'))
      store.create(makeTodo('a-2', 'Alpha 2', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta 1', 'agent.beta'))

      // Replace alpha with a single new todo
      store.replace('sess-shared', [
        {
          id: 'a-new',
          sessionId: 'sess-shared',
          content: 'Alpha new',
          status: TodoStatus.pending,
          priority: TodoPriority.low,
          ownerAgentId: 'agent.alpha',
        },
      ])

      // Alpha's old todos gone, new one present
      expect(store.findById('a-1')).toBeNull()
      expect(store.findById('a-2')).toBeNull()
      expect(store.findById('a-new')).not.toBeNull()

      // Beta untouched
      expect(store.findById('b-1')).not.toBeNull()
      expect(store.findBySessionAndOwner('sess-shared', 'agent.beta')).toHaveLength(1)

      // Broad view: 2 todos (a-new + b-1)
      expect(store.findBySession('sess-shared')).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 3: Background agent isolation via store
  // -------------------------------------------------------------------------
  describe('Background agent can write/list its own todos', () => {
    it('background agent writes with its own ownerAgentId', () => {
      const todo = store.create({
        id: 'bg-1',
        sessionId: 'sess-shared',
        content: 'Background research task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        ownerAgentId: 'bg.research-agent',
      })

      expect(todo.ownerAgentId).toBe('bg.research-agent')
      expect(store.findById('bg-1')?.ownerAgentId).toBe('bg.research-agent')
    })

    it('background todolist returns only its own todos', () => {
      store.create(makeTodo('sub-1', 'Subagent task', 'agent.alpha'))
      store.create(makeTodo('bg-1', 'Background task', 'bg.research-agent'))

      const bgTodos = store.findBySessionAndOwner('sess-shared', 'bg.research-agent')
      expect(bgTodos).toHaveLength(1)
      expect(bgTodos[0]?.content).toBe('Background task')

      const subTodos = store.findBySessionAndOwner('sess-shared', 'agent.alpha')
      expect(subTodos).toHaveLength(1)
      expect(subTodos[0]?.content).toBe('Subagent task')
    })

    it('background cannot see subagent A list unless using broad UI route', () => {
      store.create(makeTodo('sub-1', 'Subagent task', 'agent.alpha'))
      store.create(makeTodo('bg-1', 'Background task', 'bg.research-agent'))

      // Owner-scoped: background sees only its own
      const bgTodos = store.findBySessionAndOwner('sess-shared', 'bg.research-agent')
      expect(bgTodos).toHaveLength(1)
      expect(bgTodos[0]?.id).toBe('bg-1')

      // Owner-scoped: subagent sees only its own
      const subTodos = store.findBySessionAndOwner('sess-shared', 'agent.alpha')
      expect(subTodos).toHaveLength(1)
      expect(subTodos[0]?.id).toBe('sub-1')

      // Broad UI route (findBySession): sees both
      const allTodos = store.findBySession('sess-shared')
      expect(allTodos).toHaveLength(2)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 4: Foreground broad view sees all owners
  // -------------------------------------------------------------------------
  describe('Foreground broad view sees all agents todos', () => {
    it('findBySession returns todos from all owners in same session', () => {
      store.create(makeTodo('a-1', 'A', 'agent.alpha'))
      store.create(makeTodo('b-1', 'B', 'agent.beta'))
      store.create(makeTodo('bg-1', 'BG', 'bg.research'))

      const all = store.findBySession('sess-shared')
      expect(all).toHaveLength(3)
      const owners = all.map((t) => t.ownerAgentId).sort()
      expect(owners).toEqual(['agent.alpha', 'agent.beta', 'bg.research'])
    })

    it('owner-scoped queries are strict subsets of broad view', () => {
      store.create(makeTodo('a-1', 'A1', 'agent.alpha'))
      store.create(makeTodo('a-2', 'A2', 'agent.alpha'))
      store.create(makeTodo('b-1', 'B1', 'agent.beta'))

      const all = store.findBySession('sess-shared')
      const alphaOnly = store.findBySessionAndOwner('sess-shared', 'agent.alpha')
      const betaOnly = store.findBySessionAndOwner('sess-shared', 'agent.beta')

      expect(all).toHaveLength(3)
      expect(alphaOnly).toHaveLength(2)
      expect(betaOnly).toHaveLength(1)

      // Union of owner-scoped == broad
      const unionIds = [...alphaOnly.map((t) => t.id), ...betaOnly.map((t) => t.id)].sort()
      const allIds = all.map((t) => t.id).sort()
      expect(unionIds).toEqual(allIds)
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 5: Cross-agent update/remove isolation via store
  // -------------------------------------------------------------------------
  describe('Cross-agent update/remove isolation', () => {
    it('agent A can find agent B todo by id (store findById has no owner guard)', () => {
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))

      // findById is tenant-scoped, not owner-scoped — it finds the row
      const found = store.findById('b-1')
      expect(found).not.toBeNull()
      expect(found?.ownerAgentId).toBe('agent.beta')

      // But findBySessionAndOwner for agent.alpha returns empty
      const alphaTodos = store.findBySessionAndOwner('sess-shared', 'agent.alpha')
      expect(alphaTodos).toHaveLength(0)
    })

    it('agent A remove can delete any todo by id (store has no owner guard on remove)', () => {
      store.create(makeTodo('a-1', 'Alpha task', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))

      // remove uses findById (no owner check) — it can delete B's todo
      const removed = store.remove('b-1')
      expect(removed).toBe(true)
      expect(store.findById('b-1')).toBeNull()

      // This documents: store.remove() has no owner guard. The tool handler
      // should scope via ownerAgentId before calling remove.
      // The isolation is enforced at the tool handler level (todowrite remove
      // mode iterates over the caller's todos, not arbitrary IDs).
      expect(store.findBySessionAndOwner('sess-shared', 'agent.beta')).toHaveLength(0)
    })

    it('update by id succeeds cross-owner (store has no owner guard)', () => {
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))

      const updated = store.update('b-1', { status: TodoStatus.completed })
      expect(updated).not.toBeNull()
      expect(updated?.status).toBe('completed')

      // B's todo is updated but still owned by B
      const betaTodos = store.findBySessionAndOwner('sess-shared', 'agent.beta')
      expect(betaTodos).toHaveLength(1)
      expect(betaTodos[0]?.status).toBe('completed')
    })
  })

  // -------------------------------------------------------------------------
  // Scenario 6: Tool handler ownerAgentId derivation via todolist
  // -------------------------------------------------------------------------
  describe('Tool handler ownerAgentId derivation', () => {
    it('context.agentId takes precedence over context.agentType for todolist', async () => {
      store.create(makeTodo('t-1', 'Task', 'agent.specific-id'))

      const todolist = createTodolistTool(store)
      const ctx = makeContext({
        sessionId: 'sess-shared',
        agentId: 'agent.specific-id',
        agentType: 'subagent',
      })

      const result = await todolist.handler({}, ctx)
      expect(result.success).toBe(true)
      expect(asListResult(result).totalCount).toBe(1)
      expect(asListResult(result).todos[0].content).toBe('Task')
    })

    it('todolist returns empty for agent with no todos', async () => {
      store.create(makeTodo('t-1', 'Task', 'agent.alpha'))

      const todolist = createTodolistTool(store)
      const ctxBeta = makeContext({ sessionId: 'sess-shared', agentId: 'agent.beta' })

      const result = await todolist.handler({}, ctxBeta)
      expect(result.success).toBe(true)
      expect(asListResult(result).totalCount).toBe(0)
    })

    it('falls back to agentType when agentId is missing for todolist', async () => {
      store.create(makeTodo('t-bg', 'BG task', 'background'))

      const todolist = createTodolistTool(store)
      const ctx: ToolExecutionContext = {
        toolCallId: 'tc-no-id',
        toolName: 'todolist',
        userId: 'user-1',
        sessionId: 'sess-shared',
        agentType: 'background',
        // agentId intentionally omitted
        permissionContext: { userId: 'user-1', sessionId: 'sess-shared' } as ToolExecutionContext['permissionContext'],
        executionStartTime: new Date().toISOString(),
        stores: {
          toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} },
        },
      }

      const result = await todolist.handler({}, ctx)
      expect(result.success).toBe(true)
      expect(asListResult(result).totalCount).toBe(1)
      expect(asListResult(result).todos[0].content).toBe('BG task')
    })

    it('defaults to foreground.default when neither agentId nor agentType set', async () => {
      store.create(makeTodo('t-default', 'Default task', DEFAULT_OWNER_AGENT_ID))

      const todolist = createTodolistTool(store)
      const ctx: ToolExecutionContext = {
        toolCallId: 'tc-default',
        toolName: 'todolist',
        userId: 'user-1',
        sessionId: 'sess-shared',
        // both agentId and agentType omitted
        permissionContext: { userId: 'user-1', sessionId: 'sess-shared' } as ToolExecutionContext['permissionContext'],
        executionStartTime: new Date().toISOString(),
        stores: {
          toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} },
        },
      }

      const result = await todolist.handler({}, ctx)
      expect(result.success).toBe(true)
      expect(asListResult(result).totalCount).toBe(1)
      expect(asListResult(result).todos[0].content).toBe('Default task')
    })

    it('two agents with different agentId see different results via todolist', async () => {
      store.create(makeTodo('a-1', 'Alpha task', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))

      const todolist = createTodolistTool(store)

      const ctxA = makeContext({ sessionId: 'sess-shared', agentId: 'agent.alpha' })
      const ctxB = makeContext({ sessionId: 'sess-shared', agentId: 'agent.beta' })

      const resultA = await todolist.handler({}, ctxA)
      const resultB = await todolist.handler({}, ctxB)

      expect(asListResult(resultA).totalCount).toBe(1)
      expect(asListResult(resultA).todos[0].content).toBe('Alpha task')

      expect(asListResult(resultB).totalCount).toBe(1)
      expect(asListResult(resultB).todos[0].content).toBe('Beta task')
    })

    it('todolist returns no contextDelta (read operation)', async () => {
      store.create(makeTodo('t-1', 'Task', 'agent.alpha'))

      const todolist = createTodolistTool(store)
      const ctx = makeContext({ sessionId: 'sess-shared', agentId: 'agent.alpha' })

      const result = await todolist.handler({}, ctx)
      expect(result.success).toBe(true)
      expect(result.contextDelta).toBeUndefined()
    })

    it('todowrite append persists rows through the real TodoStore contract', async () => {
      const todowrite = createTodowriteTool(store)
      const ctx = makeContext({ sessionId: 'sess-shared', agentId: 'agent.writer' })

      const result = await todowrite.handler(
        {
          mode: 'append',
          todos: [{ id: 'written-1', content: 'Persist me', status: 'pending', priority: 'high' }],
        },
        ctx,
      )

      expect(result.success).toBe(true)
      const persisted = store.findById('written-1')
      expect(persisted?.content).toBe('Persist me')
      expect(persisted?.ownerAgentId).toBe('agent.writer')
      expect(asListResult(result).totalCount).toBeUndefined()
      expect((result.data as { addedCount?: number }).addedCount).toBe(1)
    })

    it('todowrite append rejects a parent owned by another agent through real store contract', async () => {
      store.create(makeTodo('alpha-parent', 'Alpha parent', 'agent.alpha'))
      const todowrite = createTodowriteTool(store)
      const ctxBeta = makeContext({ sessionId: 'sess-shared', agentId: 'agent.beta' })

      const result = await todowrite.handler(
        {
          mode: 'append',
          todos: [
            { id: 'beta-child', content: 'Beta child', status: 'pending', priority: 'high', parentId: 'alpha-parent' },
          ],
        },
        ctxBeta,
      )

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('same owner agent')
      expect(store.findById('beta-child')).toBeNull()
    })

    it('todowrite replace through real store only replaces caller owner rows', async () => {
      store.create(makeTodo('a-old', 'Alpha old', 'agent.alpha'))
      store.create(makeTodo('b-keep', 'Beta keep', 'agent.beta'))
      const todowrite = createTodowriteTool(store)
      const ctxAlpha = makeContext({ sessionId: 'sess-shared', agentId: 'agent.alpha' })

      const result = await todowrite.handler(
        {
          mode: 'replace',
          todos: [{ id: 'a-new', content: 'Alpha new', status: 'pending', priority: 'low' }],
        },
        ctxAlpha,
      )

      expect(result.success).toBe(true)
      expect(store.findById('a-old')).toBeNull()
      expect(store.findById('a-new')?.ownerAgentId).toBe('agent.alpha')
      expect(store.findById('b-keep')?.ownerAgentId).toBe('agent.beta')
    })

    it('todowrite update and remove ignore cross-owner ids', async () => {
      store.create(makeTodo('a-1', 'Alpha task', 'agent.alpha'))
      store.create(makeTodo('b-1', 'Beta task', 'agent.beta'))
      const todowrite = createTodowriteTool(store)
      const ctxBeta = makeContext({ sessionId: 'sess-shared', agentId: 'agent.beta' })

      const updateResult = await todowrite.handler(
        {
          mode: 'update',
          todos: [{ id: 'a-1', content: 'Hijacked', status: 'completed', priority: 'low' }],
        },
        ctxBeta,
      )
      const removeResult = await todowrite.handler(
        {
          mode: 'remove',
          todos: [{ id: 'a-1', content: 'Ignored', status: 'cancelled', priority: 'low' }],
        },
        ctxBeta,
      )

      expect(updateResult.success).toBe(true)
      expect(removeResult.success).toBe(true)
      expect(store.findById('a-1')?.content).toBe('Alpha task')
      expect(store.findById('a-1')?.status).toBe(TodoStatus.pending)
      expect((updateResult.data as { updatedCount?: number }).updatedCount).toBe(0)
      expect((removeResult.data as { removedCount?: number }).removedCount).toBe(0)
    })
  })
})
