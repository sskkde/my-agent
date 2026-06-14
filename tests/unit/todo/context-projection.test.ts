/**
 * TDD RED Phase Tests for Todo Context Projection
 * 
 * Tests for projecting active todos into agent/session context at turn start.
 * These tests will FAIL because the implementation doesn't exist yet.
 */

import { describe, it, expect } from 'vitest'
import type { ContextItem } from '../../../src/context/types.js'

// Types that will be defined in the todo domain module
type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

interface TodoItem {
  todoId: string
  sessionId: string
  tenantId: string
  parentTodoId?: string
  position: number
  status: TodoStatus
  priority: 'high' | 'medium' | 'low'
  content: string
  createdAt: string
  updatedAt: string
}

interface TodoProjectionInput {
  sessionId: string
  todos: TodoItem[]
  maxItems?: number
  maxTokens?: number
}

// Note: TodoProjectionResult is defined by the implementation - we use inference

// This module doesn't exist yet - imports will FAIL
import {
  projectActiveTodosToContext,
  buildTodoContextDelta,
  getTodoSummaryForPlanContextView,
} from '../../../src/todo/context-projection.js'

// Helper to create mock todo items
function createMockTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    todoId: `todo-${Math.random().toString(36).slice(2)}`,
    sessionId: 'session-001',
    tenantId: 'org_default',
    position: Math.floor(Math.random() * 100),
    status: 'pending',
    priority: 'medium',
    content: 'Test todo content',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('Todo Context Projection (RED Phase)', () => {
  describe('projectActiveTodosToContext', () => {
    it('should exist and be callable', () => {
      expect(projectActiveTodosToContext).toBeDefined()
      expect(typeof projectActiveTodosToContext).toBe('function')
    })

    it('should return TodoProjectionResult with contextItems array', () => {
      const input: TodoProjectionInput = {
        sessionId: 'session-001',
        todos: [
          createMockTodo({ status: 'pending', content: 'Write unit tests' }),
          createMockTodo({ status: 'in_progress', content: 'Implement feature' }),
        ],
      }

      const result = projectActiveTodosToContext(input)

      expect(result).toBeDefined()
      expect(result.contextItems).toBeDefined()
      expect(Array.isArray(result.contextItems)).toBe(true)
    })

    it('should include only pending and in_progress todos in projection', () => {
      const todos: TodoItem[] = [
        createMockTodo({ todoId: 'todo-1', status: 'pending', content: 'Pending task' }),
        createMockTodo({ todoId: 'todo-2', status: 'in_progress', content: 'Active task' }),
        createMockTodo({ todoId: 'todo-3', status: 'completed', content: 'Done task' }),
        createMockTodo({ todoId: 'todo-4', status: 'cancelled', content: 'Cancelled task' }),
      ]

      const input: TodoProjectionInput = {
        sessionId: 'session-001',
        todos,
      }

      const result = projectActiveTodosToContext(input)

      // Should only include pending and in_progress
      expect(result.includedCount).toBe(2)
      expect(result.excludedCount).toBe(2)
      expect(result.contextItems.length).toBe(2)

      // Verify excluded todos are NOT in context items
      const todoIds = result.contextItems.map((item: ContextItem) => item.structuredPayload?.todoId)
      expect(todoIds).toContain('todo-1')
      expect(todoIds).toContain('todo-2')
      expect(todoIds).not.toContain('todo-3')
      expect(todoIds).not.toContain('todo-4')
    })

    it('should exclude completed todos from default projection', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'completed', content: 'Completed task 1' }),
        createMockTodo({ status: 'completed', content: 'Completed task 2' }),
        createMockTodo({ status: 'pending', content: 'Pending task' }),
      ]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems.length).toBe(1)
      expect(result.excludedCount).toBe(2)
    })

    it('should exclude cancelled todos from default projection', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'cancelled', content: 'Cancelled task' }),
        createMockTodo({ status: 'in_progress', content: 'Active task' }),
      ]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems.length).toBe(1)
      expect(result.excludedCount).toBe(1)
    })

    it('should produce ContextItem with correct sourceType', () => {
      const todos = [createMockTodo({ status: 'pending', content: 'Test todo' })]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems[0].sourceType).toBe('plan_state')
    })

    it('should produce ContextItem with structuredPayload containing todo data', () => {
      const todo = createMockTodo({
        todoId: 'todo-abc',
        status: 'pending',
        priority: 'high',
        content: 'Critical task',
      })

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos: [todo],
      })

      const item = result.contextItems[0]
      expect(item.structuredPayload).toBeDefined()
      expect(item.structuredPayload?.todoId).toBe('todo-abc')
      expect(item.structuredPayload?.status).toBe('pending')
      expect(item.structuredPayload?.priority).toBe('high')
      expect(item.content).toContain('Critical task')
    })

    it('should enforce item limit with truncation', () => {
      const todos: TodoItem[] = Array.from({ length: 20 }, (_, i) =>
        createMockTodo({
          todoId: `todo-${i}`,
          status: 'pending',
          content: `Task number ${i}`,
          position: i,
        }),
      )

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
        maxItems: 5,
      })

      // Should limit to 5 items
      expect(result.contextItems.length).toBe(5)
      expect(result.totalTodosCount).toBe(20)
      expect(result.includedCount).toBe(5)
      expect(result.excludedCount).toBe(15)
    })

    it('should show truncation note when items exceed limit', () => {
      const todos: TodoItem[] = Array.from({ length: 10 }, (_, i) =>
        createMockTodo({
          todoId: `todo-${i}`,
          status: 'pending',
          content: `Task ${i}`,
        }),
      )

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
        maxItems: 3,
      })

      expect(result.truncatedNote).toBeDefined()
      expect(result.truncatedNote).toContain('Showing 3 of 10')
    })

    it('should enforce token budget limit', () => {
      const todos: TodoItem[] = Array.from({ length: 10 }, (_, i) =>
        createMockTodo({
          todoId: `todo-${i}`,
          status: 'pending',
          content: `This is a longer todo item description for testing token limits - task number ${i}`,
        }),
      )

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
        maxTokens: 100, // Very small budget
      })

      // Should limit based on token estimate
      const totalTokens = result.contextItems.reduce(
        (sum: number, item: ContextItem) => sum + (item.estimatedTokens ?? 0),
        0,
      )
      expect(totalTokens).toBeLessThanOrEqual(100)
    })

    it('should return empty array when no active todos exist', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'completed' }),
        createMockTodo({ status: 'cancelled' }),
      ]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems).toEqual([])
      expect(result.includedCount).toBe(0)
      expect(result.excludedCount).toBe(2)
    })

    it('should preserve priority ordering in projection', () => {
      const todos: TodoItem[] = [
        createMockTodo({ todoId: 'low', status: 'pending', priority: 'low', position: 0 }),
        createMockTodo({ todoId: 'high', status: 'pending', priority: 'high', position: 2 }),
        createMockTodo({ todoId: 'medium', status: 'pending', priority: 'medium', position: 1 }),
      ]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      // High priority should come first
      expect(result.contextItems[0].structuredPayload?.todoId).toBe('high')
    })

    it('should include estimatedTokens for each context item', () => {
      const todos = [createMockTodo({ status: 'pending', content: 'Test todo content' })]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems[0].estimatedTokens).toBeDefined()
      expect(result.contextItems[0].estimatedTokens).toBeGreaterThan(0)
    })
  })

  describe('buildTodoContextDelta', () => {
    it('should exist and be callable', () => {
      expect(buildTodoContextDelta).toBeDefined()
      expect(typeof buildTodoContextDelta).toBe('function')
    })

    it('should return RuntimeContextDelta with correct structure', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'pending', content: 'New pending todo' }),
        createMockTodo({ status: 'in_progress', content: 'Active todo' }),
      ]

      const delta = buildTodoContextDelta({
        runId: 'run-001',
        sessionId: 'session-001',
        todos,
      })

      expect(delta).toBeDefined()
      expect(delta.runId).toBe('run-001')
      expect(delta.source).toBe('plan_state')
      expect(delta.items).toBeDefined()
      expect(Array.isArray(delta.items)).toBe(true)
    })

    it('should create RuntimeContextDelta after todowrite mutation', () => {
      // Simulating a todowrite mutation that adds/updates todos
      const updatedTodos: TodoItem[] = [
        createMockTodo({ todoId: 'new-todo', status: 'pending', content: 'Newly created todo' }),
      ]

      const delta = buildTodoContextDelta({
        runId: 'run-002',
        sessionId: 'session-001',
        todos: updatedTodos,
        iteration: 3,
      })

      expect(delta.runId).toBe('run-002')
      expect(delta.iteration).toBe(3)
      expect(delta.items.length).toBe(1)
    })

    it('should only include active todos in delta', () => {
      const todos: TodoItem[] = [
        createMockTodo({ todoId: 'active-1', status: 'pending' }),
        createMockTodo({ todoId: 'active-2', status: 'in_progress' }),
        createMockTodo({ todoId: 'done-1', status: 'completed' }),
        createMockTodo({ todoId: 'cancelled-1', status: 'cancelled' }),
      ]

      const delta = buildTodoContextDelta({
        runId: 'run-001',
        sessionId: 'session-001',
        todos,
      })

      expect(delta.items.length).toBe(2)
      const todoIds = delta.items.map((item: ContextItem) => item.structuredPayload?.todoId)
      expect(todoIds).toContain('active-1')
      expect(todoIds).toContain('active-2')
      expect(todoIds).not.toContain('done-1')
      expect(todoIds).not.toContain('cancelled-1')
    })

    it('should set source to plan_state', () => {
      const delta = buildTodoContextDelta({
        runId: 'run-001',
        sessionId: 'session-001',
        todos: [createMockTodo({ status: 'pending' })],
      })

      expect(delta.source).toBe('plan_state')
    })

    it('should include iteration number from context', () => {
      const delta = buildTodoContextDelta({
        runId: 'run-001',
        sessionId: 'session-001',
        todos: [createMockTodo({ status: 'pending' })],
        iteration: 5,
      })

      expect(delta.iteration).toBe(5)
    })

    it('should provide replaceKeys for todo status changes', () => {
      // When a todo changes from pending to in_progress, we should replace the old item
      const todos: TodoItem[] = [
        createMockTodo({
          todoId: 'todo-changing',
          status: 'in_progress',
          content: 'Updated task status',
        }),
      ]

      const delta = buildTodoContextDelta({
        runId: 'run-001',
        sessionId: 'session-001',
        todos,
        previousStatuses: {
          'todo-changing': 'pending',
        },
      })

      expect(delta.replaceKeys).toBeDefined()
      expect(delta.replaceKeys).toContain('todo-changing')
    })
  })

  describe('getTodoSummaryForPlanContextView', () => {
    it('should exist and be callable', () => {
      expect(getTodoSummaryForPlanContextView).toBeDefined()
      expect(typeof getTodoSummaryForPlanContextView).toBe('function')
    })

    it('should return todoSummary array for PlanContextView', () => {
      const todos: TodoItem[] = [
        createMockTodo({
          todoId: 'todo-1',
          sessionId: 'session-001',
          status: 'pending',
          content: 'Task 1',
        }),
        createMockTodo({
          todoId: 'todo-2',
          sessionId: 'session-001',
          status: 'in_progress',
          content: 'Task 2',
        }),
      ]

      const summary = getTodoSummaryForPlanContextView({
        sessionId: 'session-001',
        todos,
      })

      expect(summary).toBeDefined()
      expect(Array.isArray(summary)).toBe(true)
    })

    it('should group todos by owner agent type', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'pending', content: 'Todo for main agent' }),
        createMockTodo({ status: 'in_progress', content: 'Todo for subagent' }),
      ]

      const summary = getTodoSummaryForPlanContextView({
        sessionId: 'session-001',
        todos,
      })

      // Each summary entry should have todoListId, ownerAgentType, status
      expect(summary[0]).toHaveProperty('todoListId')
      expect(summary[0]).toHaveProperty('ownerAgentType')
      expect(summary[0]).toHaveProperty('status')
    })

    it('should only include active todos in summary', () => {
      const todos: TodoItem[] = [
        createMockTodo({ todoId: 't1', status: 'pending' }),
        createMockTodo({ todoId: 't2', status: 'in_progress' }),
        createMockTodo({ todoId: 't3', status: 'completed' }),
        createMockTodo({ todoId: 't4', status: 'cancelled' }),
      ]

      const summary = getTodoSummaryForPlanContextView({
        sessionId: 'session-001',
        todos,
      })

      // Summary should reflect only active todos
      expect(summary.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Integration with ContextBundle', () => {
    it('should produce ContextItems compatible with ContextBundle.orderedItems', () => {
      const todos: TodoItem[] = [
        createMockTodo({ status: 'pending', content: 'Task to integrate' }),
      ]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      // Verify context items have all required ContextBundle fields
      const item = result.contextItems[0]
      expect(item.itemId).toBeDefined()
      expect(item.sourceType).toBeDefined()
      expect(item.semanticType).toBeDefined()
      expect(item.content).toBeDefined()
      expect(typeof item.content).toBe('string')
    })

    it('should set semanticType to plan_view for todo items', () => {
      const todos = [createMockTodo({ status: 'pending', content: 'Test' })]

      const result = projectActiveTodosToContext({
        sessionId: 'session-001',
        todos,
      })

      expect(result.contextItems[0].semanticType).toBe('plan_view')
    })
  })
})