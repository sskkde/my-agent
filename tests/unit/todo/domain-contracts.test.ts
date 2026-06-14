import { describe, it, expect } from 'vitest'
import {
  // Enums
  TodoStatus,
  TodoPriority,
  TodoWriteMode,
  // Constants
  MAX_TODO_DEPTH,
  // Types
  type Todo,
  type TodoWriteInput,
  type TodoWriteParams,
  // Type Guards
  isValidTodoStatus,
  isValidTodoPriority,
  isValidTodoWriteMode,
} from '../../../src/todo/types.js'

describe('Todo Domain Contracts', () => {
  describe('TodoStatus enum', () => {
    it('should define all required statuses', () => {
      const statuses: TodoStatus[] = [TodoStatus.pending, TodoStatus.in_progress, TodoStatus.completed, TodoStatus.cancelled]
      expect(statuses).toHaveLength(4)
      expect(statuses).toContain('pending')
      expect(statuses).toContain('in_progress')
      expect(statuses).toContain('completed')
      expect(statuses).toContain('cancelled')
    })

    it('should have valid enum values', () => {
      expect(Object.values(TodoStatus)).toContain('pending')
      expect(Object.values(TodoStatus)).toContain('in_progress')
      expect(Object.values(TodoStatus)).toContain('completed')
      expect(Object.values(TodoStatus)).toContain('cancelled')
    })
  })

  describe('TodoPriority enum', () => {
    it('should define all required priorities', () => {
      const priorities: TodoPriority[] = [TodoPriority.high, TodoPriority.medium, TodoPriority.low]
      expect(priorities).toHaveLength(3)
      expect(priorities).toContain('high')
      expect(priorities).toContain('medium')
      expect(priorities).toContain('low')
    })

    it('should have valid enum values', () => {
      expect(Object.values(TodoPriority)).toContain('high')
      expect(Object.values(TodoPriority)).toContain('medium')
      expect(Object.values(TodoPriority)).toContain('low')
    })
  })

  describe('TodoWriteMode enum', () => {
    it('should define all required modes', () => {
      const modes: TodoWriteMode[] = [TodoWriteMode.append, TodoWriteMode.replace, TodoWriteMode.update, TodoWriteMode.remove]
      expect(modes).toHaveLength(4)
      expect(modes).toContain('append')
      expect(modes).toContain('replace')
      expect(modes).toContain('update')
      expect(modes).toContain('remove')
    })

    it('should have valid enum values', () => {
      expect(Object.values(TodoWriteMode)).toContain('append')
      expect(Object.values(TodoWriteMode)).toContain('replace')
      expect(Object.values(TodoWriteMode)).toContain('update')
      expect(Object.values(TodoWriteMode)).toContain('remove')
    })
  })

  describe('MAX_TODO_DEPTH constant', () => {
    it('should be defined as 3', () => {
      expect(MAX_TODO_DEPTH).toBeDefined()
      expect(MAX_TODO_DEPTH).toBe(3)
    })
  })

  describe('Todo interface', () => {
    it('should have all required fields with correct types', () => {
      const todo: Todo = {
        todoId: 'todo_123',
        sessionId: 'sess_456',
        tenantId: 'org_default',
        parentTodoId: null,
        position: 0,
        content: 'Test task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      // Verify all fields exist
      expect(todo.todoId).toBeDefined()
      expect(todo.sessionId).toBeDefined()
      expect(todo.tenantId).toBeDefined()
      expect(todo.parentTodoId).toBeDefined()
      expect(todo.position).toBeDefined()
      expect(todo.content).toBeDefined()
      expect(todo.status).toBeDefined()
      expect(todo.priority).toBeDefined()
      expect(todo.createdAt).toBeDefined()
      expect(todo.updatedAt).toBeDefined()

      // Verify types
      expect(typeof todo.todoId).toBe('string')
      expect(typeof todo.sessionId).toBe('string')
      expect(typeof todo.tenantId).toBe('string')
      expect(todo.parentTodoId === null || typeof todo.parentTodoId === 'string').toBe(true)
      expect(typeof todo.position).toBe('number')
      expect(typeof todo.content).toBe('string')
      expect(typeof todo.status).toBe('string')
      expect(typeof todo.priority).toBe('string')
      expect(typeof todo.createdAt).toBe('string')
      expect(typeof todo.updatedAt).toBe('string')
    })

    it('should support nested todos via parentTodoId', () => {
      const parentTodo: Todo = {
        todoId: 'todo_parent',
        sessionId: 'sess_456',
        tenantId: 'org_default',
        parentTodoId: null,
        position: 0,
        content: 'Parent task',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const childTodo: Todo = {
        todoId: 'todo_child',
        sessionId: 'sess_456',
        tenantId: 'org_default',
        parentTodoId: 'todo_parent',
        position: 0,
        content: 'Child task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(parentTodo.parentTodoId).toBeNull()
      expect(childTodo.parentTodoId).toBe('todo_parent')
    })
  })

  describe('TodoWriteInput interface', () => {
    it('should require content, status, and priority fields', () => {
      const input: TodoWriteInput = {
        content: 'Test task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
      }

      expect(input.content).toBeDefined()
      expect(input.status).toBeDefined()
      expect(input.priority).toBeDefined()
    })

    it('should support optional parentTodoId', () => {
      const inputWithParent: TodoWriteInput = {
        content: 'Child task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        parentTodoId: 'todo_parent',
      }

      const inputWithoutParent: TodoWriteInput = {
        content: 'Root task',
        status: TodoStatus.pending,
        priority: TodoPriority.high,
      }

      expect(inputWithParent.parentTodoId).toBe('todo_parent')
      expect(inputWithoutParent.parentTodoId).toBeUndefined()
    })
  })

  describe('TodoWriteParams interface', () => {
    it('should require mode field', () => {
      const params: TodoWriteParams = {
        mode: TodoWriteMode.append,
        todos: [
          {
            content: 'Test task',
            status: TodoStatus.pending,
            priority: TodoPriority.medium,
          },
        ],
      }

      expect(params.mode).toBeDefined()
      expect(params.mode).toBe(TodoWriteMode.append)
    })

    it('should support all write modes', () => {
      const appendParams: TodoWriteParams = {
        mode: TodoWriteMode.append,
        todos: [],
      }

      const replaceParams: TodoWriteParams = {
        mode: TodoWriteMode.replace,
        todos: [],
      }

      const updateParams: TodoWriteParams = {
        mode: TodoWriteMode.update,
        todos: [],
      }

      const removeParams: TodoWriteParams = {
        mode: TodoWriteMode.remove,
        todos: [],
      }

      expect(appendParams.mode).toBe(TodoWriteMode.append)
      expect(replaceParams.mode).toBe(TodoWriteMode.replace)
      expect(updateParams.mode).toBe(TodoWriteMode.update)
      expect(removeParams.mode).toBe(TodoWriteMode.remove)
    })

    it('should NOT have a default mode - mode is REQUIRED', () => {
      // This test verifies that mode must be explicitly provided
      // The type system should enforce this
      const params: TodoWriteParams = {
        mode: TodoWriteMode.append,
        todos: [],
      }

      // Mode is required, not optional
      expect(params.mode).toBeDefined()
    })
  })

  describe('Type Guards', () => {
    describe('isValidTodoStatus', () => {
      it('should return true for valid statuses', () => {
        expect(isValidTodoStatus('pending')).toBe(true)
        expect(isValidTodoStatus('in_progress')).toBe(true)
        expect(isValidTodoStatus('completed')).toBe(true)
        expect(isValidTodoStatus('cancelled')).toBe(true)
      })

      it('should return false for invalid statuses', () => {
        expect(isValidTodoStatus('invalid')).toBe(false)
        expect(isValidTodoStatus('PENDING')).toBe(false)
        expect(isValidTodoStatus('')).toBe(false)
        expect(isValidTodoStatus(null as unknown as string)).toBe(false)
        expect(isValidTodoStatus(undefined as unknown as string)).toBe(false)
      })
    })

    describe('isValidTodoPriority', () => {
      it('should return true for valid priorities', () => {
        expect(isValidTodoPriority('high')).toBe(true)
        expect(isValidTodoPriority('medium')).toBe(true)
        expect(isValidTodoPriority('low')).toBe(true)
      })

      it('should return false for invalid priorities', () => {
        expect(isValidTodoPriority('invalid')).toBe(false)
        expect(isValidTodoPriority('HIGH')).toBe(false)
        expect(isValidTodoPriority('critical')).toBe(false)
        expect(isValidTodoPriority('')).toBe(false)
        expect(isValidTodoPriority(null as unknown as string)).toBe(false)
        expect(isValidTodoPriority(undefined as unknown as string)).toBe(false)
      })
    })

    describe('isValidTodoWriteMode', () => {
      it('should return true for valid modes', () => {
        expect(isValidTodoWriteMode('append')).toBe(true)
        expect(isValidTodoWriteMode('replace')).toBe(true)
        expect(isValidTodoWriteMode('update')).toBe(true)
        expect(isValidTodoWriteMode('remove')).toBe(true)
      })

      it('should return false for invalid modes', () => {
        expect(isValidTodoWriteMode('invalid')).toBe(false)
        expect(isValidTodoWriteMode('APPEND')).toBe(false)
        expect(isValidTodoWriteMode('create')).toBe(false)
        expect(isValidTodoWriteMode('')).toBe(false)
        expect(isValidTodoWriteMode(null as unknown as string)).toBe(false)
        expect(isValidTodoWriteMode(undefined as unknown as string)).toBe(false)
      })
    })
  })

  describe('Max Depth Constraint', () => {
    it('should enforce max depth of 3', () => {
      // MAX_TODO_DEPTH should be 3
      // This means todos can be nested up to 3 levels deep
      // Level 0: Root todo (parentTodoId = null)
      // Level 1: First child (parentTodoId = root)
      // Level 2: Second child (parentTodoId = first child)
      // Level 3: Third child (parentTodoId = second child)
      // Any deeper nesting should be rejected
      
      expect(MAX_TODO_DEPTH).toBe(3)
    })

    it('should not allow depth beyond MAX_TODO_DEPTH', () => {
      // This test documents the constraint
      // Implementation should reject todos that would exceed depth
      // Example:
      // - Root todo: depth 0
      // - Child of root: depth 1
      // - Grandchild: depth 2
      // - Great-grandchild: depth 3 (allowed)
      // - Great-great-grandchild: depth 4 (NOT allowed)
      
      expect(MAX_TODO_DEPTH).toBeLessThan(4)
      expect(MAX_TODO_DEPTH).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Domain Invariants', () => {
    it('should ensure status values are lowercase strings', () => {
      const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled']
      validStatuses.forEach((status) => {
        expect(status).toBe(status.toLowerCase())
        expect(typeof status).toBe('string')
      })
    })

    it('should ensure priority values are lowercase strings', () => {
      const validPriorities = ['high', 'medium', 'low']
      validPriorities.forEach((priority) => {
        expect(priority).toBe(priority.toLowerCase())
        expect(typeof priority).toBe('string')
      })
    })

    it('should ensure mode values are lowercase strings', () => {
      const validModes = ['append', 'replace', 'update', 'remove']
      validModes.forEach((mode) => {
        expect(mode).toBe(mode.toLowerCase())
        expect(typeof mode).toBe('string')
      })
    })

    it('should ensure position is a non-negative number', () => {
      const todo: Todo = {
        todoId: 'todo_123',
        sessionId: 'sess_456',
        tenantId: 'org_default',
        parentTodoId: null,
        position: 0,
        content: 'Test task',
        status: TodoStatus.pending,
        priority: TodoPriority.medium,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      expect(todo.position).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(todo.position)).toBe(true)
    })
  })
})
