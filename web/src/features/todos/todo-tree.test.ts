import { describe, it, expect } from 'vitest'
import { buildTodoTree } from './todo-tree'
import type { TodoItem } from '../../api/types'

// =============================================================================
// Test fixtures - flat TODO data representing backend response
// =============================================================================

const createFlatTodo = (
  todoId: string,
  content: string,
  position: number,
  parentTodoId?: string | null,
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' = 'pending',
  priority: 'high' | 'medium' | 'low' = 'medium'
): TodoItem => ({
  todoId,
  sessionId: 'session-1',
  content,
  status,
  priority,
  parentTodoId: parentTodoId ?? undefined,
  position,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
})

describe('buildTodoTree', () => {
  // ===========================================================================
  // Basic functionality tests
  // ===========================================================================

  it('returns empty array for empty input', () => {
    const result = buildTodoTree([])
    expect(result).toEqual([])
  })

  it('returns single root item with empty children', () => {
    const todos = [createFlatTodo('todo-1', 'Single task', 0)]
    const result = buildTodoTree(todos)

    expect(result).toHaveLength(1)
    expect(result[0].todoId).toBe('todo-1')
    expect(result[0].children).toEqual([])
  })

  it('returns multiple root items sorted by position', () => {
    // Note: Backend may return items in any order; we test position-based sorting
    const todos = [
      createFlatTodo('todo-3', 'Third root', 2),
      createFlatTodo('todo-1', 'First root', 0),
      createFlatTodo('todo-2', 'Second root', 1),
    ]
    const result = buildTodoTree(todos)

    expect(result).toHaveLength(3)
    expect(result[0].todoId).toBe('todo-1')
    expect(result[1].todoId).toBe('todo-2')
    expect(result[2].todoId).toBe('todo-3')
  })

  // ===========================================================================
  // Parent-child nesting tests
  // ===========================================================================

  it('nests children under parent correctly', () => {
    const todos = [
      createFlatTodo('parent-1', 'Parent task', 0, null),
      createFlatTodo('child-1', 'Child task', 0, 'parent-1'),
      createFlatTodo('child-2', 'Child task 2', 1, 'parent-1'),
    ]
    const result = buildTodoTree(todos)

    expect(result).toHaveLength(1)
    expect(result[0].todoId).toBe('parent-1')
    expect(result[0].children).toHaveLength(2)
    expect(result[0].children![0].todoId).toBe('child-1')
    expect(result[0].children![1].todoId).toBe('child-2')
  })

  it('handles 3-level nesting (parent-child-grandchild)', () => {
    const todos = [
      createFlatTodo('grandparent', 'Grandparent', 0, null),
      createFlatTodo('parent', 'Parent', 0, 'grandparent'),
      createFlatTodo('child', 'Child', 0, 'parent'),
    ]
    const result = buildTodoTree(todos)

    // Level 0: grandparent
    expect(result).toHaveLength(1)
    expect(result[0].todoId).toBe('grandparent')

    // Level 1: parent
    expect(result[0].children).toHaveLength(1)
    expect(result[0].children![0].todoId).toBe('parent')

    // Level 2: child
    expect(result[0].children![0].children).toHaveLength(1)
    expect(result[0].children![0].children![0].todoId).toBe('child')
  })

  // ===========================================================================
  // Sibling ordering tests
  // ===========================================================================

  it('sorts sibling children by position ascending', () => {
    const todos = [
      createFlatTodo('parent', 'Parent', 0, null),
      createFlatTodo('child-3', 'Third child', 2, 'parent'),
      createFlatTodo('child-1', 'First child', 0, 'parent'),
      createFlatTodo('child-2', 'Second child', 1, 'parent'),
    ]
    const result = buildTodoTree(todos)

    const children = result[0].children!
    expect(children).toHaveLength(3)
    expect(children[0].todoId).toBe('child-1')
    expect(children[1].todoId).toBe('child-2')
    expect(children[2].todoId).toBe('child-3')
  })

  it('sorts nested children at each level', () => {
    const todos = [
      createFlatTodo('gp', 'Grandparent', 0, null),
      createFlatTodo('p2', 'Parent 2', 1, 'gp'),
      createFlatTodo('p1', 'Parent 1', 0, 'gp'),
      createFlatTodo('c2', 'Child of p1', 1, 'p1'),
      createFlatTodo('c1', 'Child of p1', 0, 'p1'),
    ]
    const result = buildTodoTree(todos)

    // Parents sorted by position
    expect(result[0].children![0].todoId).toBe('p1')
    expect(result[0].children![1].todoId).toBe('p2')

    // Children of p1 sorted by position
    const p1Children = result[0].children![0].children!
    expect(p1Children[0].todoId).toBe('c1')
    expect(p1Children[1].todoId).toBe('c2')
  })

  // ===========================================================================
  // Orphan handling tests
  // ===========================================================================

  it('keeps orphan (parentTodoId references non-existent parent) as root', () => {
    const todos = [
      createFlatTodo('orphan', 'Orphan task', 0, 'non-existent-parent'),
      createFlatTodo('root', 'Root task', 1, null),
    ]
    const result = buildTodoTree(todos)

    // Orphan should be a root (sorted by position)
    expect(result).toHaveLength(2)
    expect(result[0].todoId).toBe('orphan')
    expect(result[0].parentTodoId).toBe('non-existent-parent')
    expect(result[1].todoId).toBe('root')
  })

  it('handles multiple orphans alongside valid parent-child', () => {
    const todos = [
      createFlatTodo('orphan-1', 'Orphan 1', 0, 'missing-1'),
      createFlatTodo('valid-parent', 'Valid Parent', 1, null),
      createFlatTodo('valid-child', 'Valid Child', 0, 'valid-parent'),
      createFlatTodo('orphan-2', 'Orphan 2', 2, 'missing-2'),
    ]
    const result = buildTodoTree(todos)

    // Roots sorted by position: orphan-1, valid-parent, orphan-2
    expect(result).toHaveLength(3)
    expect(result[0].todoId).toBe('orphan-1')
    expect(result[1].todoId).toBe('valid-parent')
    expect(result[2].todoId).toBe('orphan-2')

    // Valid parent has child
    expect(result[1].children!).toHaveLength(1)
    expect(result[1].children![0].todoId).toBe('valid-child')
  })

  // ===========================================================================
  // Field preservation tests
  // ===========================================================================

  it('preserves all fields on root items', () => {
    const todos = [
      createFlatTodo('todo-1', 'Task with all fields', 0, null, 'in_progress', 'high'),
    ]
    const result = buildTodoTree(todos)

    const item = result[0]
    expect(item.todoId).toBe('todo-1')
    expect(item.sessionId).toBe('session-1')
    expect(item.content).toBe('Task with all fields')
    expect(item.status).toBe('in_progress')
    expect(item.priority).toBe('high')
    expect(item.position).toBe(0)
    expect(item.createdAt).toBe('2024-01-01T00:00:00Z')
    expect(item.updatedAt).toBe('2024-01-01T00:00:00Z')
    expect(item.parentTodoId).toBeUndefined()
  })

  it('preserves all fields on nested children', () => {
    const todos = [
      createFlatTodo('parent', 'Parent', 0, null),
      createFlatTodo('child', 'Child', 0, 'parent', 'completed', 'low'),
    ]
    const result = buildTodoTree(todos)

    const child = result[0].children![0]
    expect(child.todoId).toBe('child')
    expect(child.sessionId).toBe('session-1')
    expect(child.content).toBe('Child')
    expect(child.status).toBe('completed')
    expect(child.priority).toBe('low')
    expect(child.position).toBe(0)
    expect(child.createdAt).toBe('2024-01-01T00:00:00Z')
    expect(child.updatedAt).toBe('2024-01-01T00:00:00Z')
    expect(child.parentTodoId).toBe('parent')
  })

  // ===========================================================================
  // Complex scenario tests
  // ===========================================================================

  it('handles mixed structure: roots, nested children, and orphans', () => {
    const todos = [
      // Roots
      createFlatTodo('root-1', 'Root 1', 0, null),
      createFlatTodo('root-2', 'Root 2', 2, null),
      
      // Nested structure under root-1
      createFlatTodo('child-1', 'Child 1', 0, 'root-1'),
      createFlatTodo('grandchild-1', 'Grandchild 1', 0, 'child-1'),
      
      // Orphan
      createFlatTodo('orphan', 'Orphan', 1, 'missing'),
      
      // Another child of root-1 (position 1)
      createFlatTodo('child-2', 'Child 2', 1, 'root-1'),
    ]
    const result = buildTodoTree(todos)

    // Roots sorted by position: root-1 (0), orphan (1), root-2 (2)
    expect(result).toHaveLength(3)
    expect(result[0].todoId).toBe('root-1')
    expect(result[1].todoId).toBe('orphan')
    expect(result[2].todoId).toBe('root-2')

    // root-1 has children sorted by position
    const root1Children = result[0].children!
    expect(root1Children).toHaveLength(2)
    expect(root1Children[0].todoId).toBe('child-1')
    expect(root1Children[1].todoId).toBe('child-2')

    // child-1 has grandchild
    expect(root1Children[0].children!).toHaveLength(1)
    expect(root1Children[0].children![0].todoId).toBe('grandchild-1')
  })

  it('preserves tenantId field when present', () => {
    const todos: TodoItem[] = [
      {
        todoId: 'todo-1',
        sessionId: 'session-1',
        tenantId: 'tenant-abc',
        content: 'Task with tenant',
        status: 'pending',
        priority: 'medium',
        parentTodoId: undefined,
        position: 0,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]
    const result = buildTodoTree(todos)

    expect(result[0].tenantId).toBe('tenant-abc')
  })
})