import type { TodoStatus, TodoPriority } from './types.js'
import { MAX_TODO_DEPTH } from './types.js'

export const DEFAULT_OWNER_AGENT_ID = 'foreground.default'

export interface Todo {
  id: string
  sessionId: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  parentId: string | undefined
  depth: number
  position: number
  metadata: Record<string, unknown> | undefined
  tenantId: string
  ownerAgentId: string
  createdAt: string
  updatedAt: string
}

export interface CreateTodoInput {
  id: string
  sessionId: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  parentId?: string
  metadata?: Record<string, unknown>
  position?: number
  ownerAgentId?: string
}

export interface UpdateTodoInput {
  content?: string
  status?: TodoStatus
  priority?: TodoPriority
  metadata?: Record<string, unknown>
}

interface TodoRow {
  id: string
  session_id: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  parent_id: string | null
  depth: number
  position: number
  metadata: string | null
  tenant_id: string
  owner_agent_id: string
  created_at: string
  updated_at: string
}

interface DatabaseConnection {
  exec(sql: string, params?: unknown[]): void
  query<T>(sql: string, params?: unknown[]): T[]
  transaction?<T>(fn: () => T): () => T
}

export interface TodoStore {
  create(input: CreateTodoInput): Todo
  findById(id: string): Todo | null
  findBySession(sessionId: string): Todo[]
  findBySessionAndOwner(sessionId: string, ownerAgentId: string): Todo[]
  update(id: string, input: UpdateTodoInput): Todo | null
  remove(id: string): boolean
  replace(sessionId: string, todos: CreateTodoInput[], ownerAgentId?: string): Todo[]
}

class TodoStoreImpl implements TodoStore {
  private db: DatabaseConnection
  private tenantId: string

  constructor(db: DatabaseConnection, tenantId: string = 'org_default') {
    this.db = db
    this.tenantId = tenantId
  }

  create(input: CreateTodoInput): Todo {
    if (input.parentId === input.id) {
      throw new Error('Circular parent reference: todo cannot be its own parent')
    }

    const ownerAgentId = input.ownerAgentId ?? DEFAULT_OWNER_AGENT_ID
    let depth = 0
    let parentId: string | null = null

    if (input.parentId) {
      const parent = this.findById(input.parentId)
      if (!parent) {
        throw new Error(`Parent todo not found: ${input.parentId}`)
      }
      if (parent.sessionId !== input.sessionId) {
        throw new Error('Parent todo must belong to the same session')
      }
      if (parent.ownerAgentId !== ownerAgentId) {
        throw new Error('Parent todo must belong to the same owner agent')
      }

      depth = parent.depth + 1
      parentId = input.parentId

      if (depth > MAX_TODO_DEPTH) {
        throw new Error(
          `Maximum depth exceeded: depth ${depth} is greater than maximum allowed depth of ${MAX_TODO_DEPTH}`,
        )
      }
    }

    let position = input.position
    if (position === undefined) {
      const maxPosition = this.getMaxPosition(input.sessionId, parentId)
      position = maxPosition + 1
    }

    const now = new Date().toISOString()

    this.db.exec(
      `INSERT INTO todos (
        id, session_id, content, status, priority, parent_id, depth, position, metadata, tenant_id, owner_agent_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.sessionId,
        input.content,
        input.status,
        input.priority,
        parentId,
        depth,
        position,
        input.metadata ? JSON.stringify(input.metadata) : null,
        this.tenantId,
        ownerAgentId,
        now,
        now,
      ],
    )

    const created = this.findById(input.id)
    if (!created) {
      throw new Error(`Todo was not created: ${input.id}`)
    }

    return created
  }

  findById(id: string): Todo | null {
    const rows = this.db.query<TodoRow>('SELECT * FROM todos WHERE id = ? AND tenant_id = ?', [id, this.tenantId])

    if (rows.length === 0) {
      return null
    }

    return this.mapRow(rows[0])
  }

  findBySession(sessionId: string): Todo[] {
    const rows = this.db.query<TodoRow>('SELECT * FROM todos WHERE session_id = ? AND tenant_id = ?', [
      sessionId,
      this.tenantId,
    ])

    const todos = rows.map((row) => this.mapRow(row))
    return this.sortHierarchically(todos)
  }

  findBySessionAndOwner(sessionId: string, ownerAgentId: string): Todo[] {
    const rows = this.db.query<TodoRow>(
      'SELECT * FROM todos WHERE session_id = ? AND tenant_id = ? AND owner_agent_id = ?',
      [sessionId, this.tenantId, ownerAgentId],
    )

    const todos = rows.map((row) => this.mapRow(row))
    return this.sortHierarchically(todos)
  }

  update(id: string, input: UpdateTodoInput): Todo | null {
    const existing = this.findById(id)
    if (!existing) {
      return null
    }

    const updates: string[] = []
    const values: unknown[] = []

    if (input.content !== undefined) {
      updates.push('content = ?')
      values.push(input.content)
    }
    if (input.status !== undefined) {
      updates.push('status = ?')
      values.push(input.status)
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?')
      values.push(input.priority)
    }
    if (input.metadata !== undefined) {
      updates.push('metadata = ?')
      values.push(JSON.stringify(input.metadata))
    }

    if (updates.length === 0) {
      return existing
    }

    let updatedAt = new Date().toISOString()
    if (updatedAt === existing.createdAt) {
      const date = new Date(existing.createdAt)
      date.setMilliseconds(date.getMilliseconds() + 1)
      updatedAt = date.toISOString()
    }

    updates.push('updated_at = ?')
    values.push(updatedAt)
    values.push(id)
    values.push(this.tenantId)

    this.db.exec(`UPDATE todos SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`, values)

    return {
      ...existing,
      ...input,
      updatedAt,
    }
  }

  remove(id: string): boolean {
    const existing = this.findById(id)
    if (!existing) {
      return false
    }

    this.db.exec('DELETE FROM todos WHERE id = ? AND tenant_id = ?', [id, this.tenantId])

    return this.findById(id) === null
  }

  replace(sessionId: string, todos: CreateTodoInput[], ownerAgentId?: string): Todo[] {
    const effectiveOwnerAgentId = ownerAgentId ?? todos[0]?.ownerAgentId ?? DEFAULT_OWNER_AGENT_ID

    const existingTodos = this.findBySessionAndOwner(sessionId, effectiveOwnerAgentId)

    const deleteTodos = (): void => {
      this.db.exec('DELETE FROM todos WHERE session_id = ? AND tenant_id = ? AND owner_agent_id = ?', [
        sessionId,
        this.tenantId,
        effectiveOwnerAgentId,
      ])
    }

    const createTodos = (): Todo[] => {
      const created: Todo[] = []
      for (const input of todos) {
        created.push(this.create({ ...input, sessionId, ownerAgentId: effectiveOwnerAgentId }))
      }
      return created
    }

    if (this.db.transaction) {
      const txn = this.db.transaction((): Todo[] => {
        deleteTodos()
        return createTodos()
      })
      try {
        return txn()
      } catch (error) {
        deleteTodos()
        for (const todo of existingTodos) {
          this.db.exec(
            `INSERT INTO todos (
              id, session_id, content, status, priority, parent_id, depth, position, metadata, tenant_id, owner_agent_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              todo.id,
              todo.sessionId,
              todo.content,
              todo.status,
              todo.priority,
              todo.parentId ?? null,
              todo.depth,
              todo.position,
              todo.metadata ? JSON.stringify(todo.metadata) : null,
              this.tenantId,
              todo.ownerAgentId,
              todo.createdAt,
              todo.updatedAt,
            ],
          )
        }
        throw error
      }
    } else {
      const created: Todo[] = []
      try {
        deleteTodos()
        for (const input of todos) {
          created.push(this.create({ ...input, sessionId, ownerAgentId: effectiveOwnerAgentId }))
        }
        return created
      } catch (error) {
        for (const todo of created) {
          this.db.exec('DELETE FROM todos WHERE id = ? AND tenant_id = ?', [todo.id, this.tenantId])
        }
        for (const todo of existingTodos) {
          this.db.exec(
            `INSERT INTO todos (
              id, session_id, content, status, priority, parent_id, depth, position, metadata, tenant_id, owner_agent_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              todo.id,
              todo.sessionId,
              todo.content,
              todo.status,
              todo.priority,
              todo.parentId ?? null,
              todo.depth,
              todo.position,
              todo.metadata ? JSON.stringify(todo.metadata) : null,
              this.tenantId,
              todo.ownerAgentId,
              todo.createdAt,
              todo.updatedAt,
            ],
          )
        }
        throw error
      }
    }
  }

  private getMaxPosition(sessionId: string, parentId: string | null): number {
    const rows = this.db.query<{ max_position: number | null }>(
      'SELECT MAX(position) as max_position FROM todos WHERE session_id = ? AND parent_id IS ? AND tenant_id = ?',
      [sessionId, parentId, this.tenantId],
    )

    return rows[0]?.max_position ?? -1
  }

  private sortHierarchically(todos: Todo[]): Todo[] {
    if (todos.length === 0) return []

    const byId = new Map<string, Todo>()
    const childrenByParent = new Map<string | undefined, Todo[]>()

    for (const todo of todos) {
      byId.set(todo.id, todo)
      const parentKey = todo.parentId
      if (!childrenByParent.has(parentKey)) {
        childrenByParent.set(parentKey, [])
      }
      childrenByParent.get(parentKey)!.push(todo)
    }

    for (const children of childrenByParent.values()) {
      children.sort((a, b) => {
        if (a.position !== b.position) {
          return a.position - b.position
        }
        return a.id.localeCompare(b.id)
      })
    }

    const result: Todo[] = []
    const visit = (parentId: string | undefined): void => {
      const children = childrenByParent.get(parentId) || []
      for (const child of children) {
        result.push(child)
        visit(child.id)
      }
    }

    visit(undefined)
    return result
  }

  private mapRow(row: TodoRow): Todo {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      status: row.status,
      priority: row.priority,
      parentId: row.parent_id ?? undefined,
      depth: row.depth,
      position: row.position,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      tenantId: row.tenant_id,
      ownerAgentId: row.owner_agent_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export function createTodoStore(db: DatabaseConnection, tenantId?: string): TodoStore {
  return new TodoStoreImpl(db, tenantId)
}
