import { TodoStatus, TodoPriority } from '../../src/todo/types.js'

export interface TodoFixture {
  id: string
  sessionId: string
  content: string
  status: TodoStatus
  priority: TodoPriority
  parentId?: string
  depth: number
  position: number
  metadata?: Record<string, unknown>
  tenantId: string
  createdAt: string
  updatedAt: string
}

export function createTodoFixture(
  overrides: Partial<TodoFixture> & { id: string; sessionId: string },
): TodoFixture {
  const now = new Date().toISOString()
  return {
    content: 'Test todo item',
    status: TodoStatus.pending,
    priority: TodoPriority.medium,
    depth: 0,
    position: 0,
    tenantId: 'org_default',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createNestedTodoTree(sessionId: string): TodoFixture[] {
  const now = new Date().toISOString()
  const todos: TodoFixture[] = []

  todos.push({
    id: 'todo_root_1',
    sessionId,
    content: 'Root Todo 1',
    status: TodoStatus.pending,
    priority: TodoPriority.high,
    depth: 0,
    position: 0,
    tenantId: 'org_default',
    createdAt: now,
    updatedAt: now,
  })

  todos.push({
    id: 'todo_child_1',
    sessionId,
    content: 'Child Todo 1',
    status: TodoStatus.in_progress,
    priority: TodoPriority.medium,
    parentId: 'todo_root_1',
    depth: 1,
    position: 0,
    tenantId: 'org_default',
    createdAt: now,
    updatedAt: now,
  })

  todos.push({
    id: 'todo_grandchild_1',
    sessionId,
    content: 'Grandchild Todo 1',
    status: TodoStatus.pending,
    priority: TodoPriority.low,
    parentId: 'todo_child_1',
    depth: 2,
    position: 0,
    tenantId: 'org_default',
    createdAt: now,
    updatedAt: now,
  })

  todos.push({
    id: 'todo_root_2',
    sessionId,
    content: 'Root Todo 2',
    status: TodoStatus.completed,
    priority: TodoPriority.low,
    depth: 0,
    position: 1,
    tenantId: 'org_default',
    createdAt: now,
    updatedAt: now,
  })

  return todos
}

export function createDepthTestTodos(sessionId: string): TodoFixture[] {
  const now = new Date().toISOString()
  const todos: TodoFixture[] = []

  for (let i = 0; i <= 3; i++) {
    todos.push({
      id: `todo_depth_${i}`,
      sessionId,
      content: `Depth ${i} Todo`,
      status: TodoStatus.pending,
      priority: TodoPriority.medium,
      parentId: i > 0 ? `todo_depth_${i - 1}` : undefined,
      depth: i,
      position: 0,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    })
  }

  return todos
}

export function createPriorityOrderedTodos(sessionId: string): TodoFixture[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'todo_low',
      sessionId,
      content: 'Low Priority Todo',
      status: TodoStatus.pending,
      priority: TodoPriority.low,
      depth: 0,
      position: 2,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'todo_medium',
      sessionId,
      content: 'Medium Priority Todo',
      status: TodoStatus.pending,
      priority: TodoPriority.medium,
      depth: 0,
      position: 1,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'todo_high',
      sessionId,
      content: 'High Priority Todo',
      status: TodoStatus.pending,
      priority: TodoPriority.high,
      depth: 0,
      position: 0,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function createStatusVariationTodos(sessionId: string): TodoFixture[] {
  const now = new Date().toISOString()
  return [
    {
      id: 'todo_pending',
      sessionId,
      content: 'Pending Todo',
      status: TodoStatus.pending,
      priority: TodoPriority.medium,
      depth: 0,
      position: 0,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'todo_in_progress',
      sessionId,
      content: 'In Progress Todo',
      status: TodoStatus.in_progress,
      priority: TodoPriority.medium,
      depth: 0,
      position: 1,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'todo_completed',
      sessionId,
      content: 'Completed Todo',
      status: TodoStatus.completed,
      priority: TodoPriority.medium,
      depth: 0,
      position: 2,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'todo_cancelled',
      sessionId,
      content: 'Cancelled Todo',
      status: TodoStatus.cancelled,
      priority: TodoPriority.medium,
      depth: 0,
      position: 3,
      tenantId: 'org_default',
      createdAt: now,
      updatedAt: now,
    },
  ]
}
