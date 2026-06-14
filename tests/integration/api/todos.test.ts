/**
 * Todo API Integration Tests (TDD RED Phase)
 *
 * Contract tests for Todo CRUD operations under session scope.
 * These tests define the expected API behavior before implementation.
 *
 * Routes:
 * - POST   /api/v1/sessions/:sessionId/todos       - Create todo
 * - GET    /api/v1/sessions/:sessionId/todos       - List todos
 * - PATCH  /api/v1/sessions/:sessionId/todos/:id   - Update todo
 * - DELETE /api/v1/sessions/:sessionId/todos/:id   - Delete todo
 *
 * Expected to FAIL until routes are implemented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'

// Todo types expected from API
interface TodoItem {
  todoId: string
  sessionId: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentTodoId?: string
  position: number
  createdAt: string
  updatedAt: string
}

interface CreateTodoRequest {
  content: string
  priority?: 'high' | 'medium' | 'low'
  parentTodoId?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

interface UpdateTodoRequest {
  content?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: 'high' | 'medium' | 'low'
}

describe('Todo API', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string
  let sessionId: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie

    // Create a test session for todos
    const sessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify({}),
    })
    const sessionBody = (await sessionResponse.json()) as { data: { session: { sessionId: string } } }
    sessionId = sessionBody.data.session.sessionId
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/todos - Create Todo
  // ===========================================================================
  describe('POST /api/v1/sessions/:sessionId/todos', () => {
    it('should create a todo with required fields', async () => {
      const createRequest: CreateTodoRequest = {
        content: 'Test todo item',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(createRequest),
      })

      expect(response.status).toBe(201)

      const body = (await response.json()) as { ok: boolean; data: { todo: TodoItem }; requestId: string }
      expect(body.ok).toBe(true)
      expect(body.data.todo).toBeDefined()
      expect(body.data.todo.todoId).toBeDefined()
      expect(body.data.todo.sessionId).toBe(sessionId)
      expect(body.data.todo.content).toBe('Test todo item')
      expect(body.data.todo.status).toBe('pending')
      expect(body.data.todo.priority).toBe('medium')
      expect(body.data.todo.position).toBe(0)
      expect(body.data.todo.createdAt).toBeDefined()
      expect(body.data.todo.updatedAt).toBeDefined()
      expect(body.requestId).toBeDefined()
    })

    it('should create todo with all optional fields', async () => {
      const createRequest: CreateTodoRequest = {
        content: 'High priority todo',
        priority: 'high',
        status: 'in_progress',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(createRequest),
      })

      expect(response.status).toBe(201)

      const body = (await response.json()) as { ok: boolean; data: { todo: TodoItem } }
      expect(body.data.todo.priority).toBe('high')
      expect(body.data.todo.status).toBe('in_progress')
    })

    it('should create nested todo with parentTodoId', async () => {
      // Create parent todo first
      const parentResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Parent todo' }),
      })
      const parentBody = (await parentResponse.json()) as { data: { todo: TodoItem } }
      const parentTodoId = parentBody.data.todo.todoId

      // Create child todo
      const childResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Child todo', parentTodoId }),
      })

      expect(childResponse.status).toBe(201)

      const childBody = (await childResponse.json()) as { ok: boolean; data: { todo: TodoItem } }
      expect(childBody.data.todo.parentTodoId).toBe(parentTodoId)
    })

    it('should return 400 for missing content', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)

      const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('BAD_REQUEST')
      expect(body.error.message).toContain('content')
    })

    it('should return 400 for empty content', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: '' }),
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid priority', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Test', priority: 'invalid' }),
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Test', status: 'invalid' }),
      })

      expect(response.status).toBe(400)
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Test' }),
      })

      expect(response.status).toBe(404)

      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' }),
      })

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // GET /api/v1/sessions/:sessionId/todos - List Todos
  // ===========================================================================
  describe('GET /api/v1/sessions/:sessionId/todos', () => {
    it('should list todos for session', async () => {
      // Create a todo first
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'List test todo' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        ok: boolean
        data: { todos: TodoItem[]; total: number }
        requestId: string
      }
      expect(body.ok).toBe(true)
      expect(Array.isArray(body.data.todos)).toBe(true)
      expect(body.data.total).toBeGreaterThanOrEqual(1)
      expect(body.requestId).toBeDefined()
    })

    it('should return empty array for session with no todos', async () => {
      // Create a new session without todos
      const newSessionResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      })
      const newSessionBody = (await newSessionResponse.json()) as { data: { session: { sessionId: string } } }
      const newSessionId = newSessionBody.data.session.sessionId

      const response = await fetch(`${baseUrl}/api/v1/sessions/${newSessionId}/todos`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { ok: boolean; data: { todos: TodoItem[]; total: number } }
      expect(body.data.todos).toEqual([])
      expect(body.data.total).toBe(0)
    })

    it('should return todos ordered by position', async () => {
      // Create multiple todos
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'First todo' }),
      })
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Second todo' }),
      })

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })

      const body = (await response.json()) as { data: { todos: TodoItem[] } }
      const positions = body.data.todos.map((t) => t.position)
      // Positions should be ascending
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThanOrEqual(positions[i - 1])
      }
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/todos`, {
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`)

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // PATCH /api/v1/sessions/:sessionId/todos/:todoId - Update Todo
  // ===========================================================================
  describe('PATCH /api/v1/sessions/:sessionId/todos/:todoId', () => {
    let testTodoId: string

    beforeAll(async () => {
      // Create a todo for update tests
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Todo to update' }),
      })
      const body = (await response.json()) as { data: { todo: TodoItem } }
      testTodoId = body.data.todo.todoId
    })

    it('should update todo status', async () => {
      const updateRequest: UpdateTodoRequest = {
        status: 'completed',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(updateRequest),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { ok: boolean; data: { todo: TodoItem } }
      expect(body.ok).toBe(true)
      expect(body.data.todo.status).toBe('completed')
    })

    it('should update todo content', async () => {
      const updateRequest: UpdateTodoRequest = {
        content: 'Updated content',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(updateRequest),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { todo: TodoItem } }
      expect(body.data.todo.content).toBe('Updated content')
    })

    it('should update todo priority', async () => {
      const updateRequest: UpdateTodoRequest = {
        priority: 'high',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(updateRequest),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { todo: TodoItem } }
      expect(body.data.todo.priority).toBe('high')
    })

    it('should update multiple fields at once', async () => {
      const updateRequest: UpdateTodoRequest = {
        content: 'Multi-update',
        status: 'in_progress',
        priority: 'low',
      }

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify(updateRequest),
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { todo: TodoItem } }
      expect(body.data.todo.content).toBe('Multi-update')
      expect(body.data.todo.status).toBe('in_progress')
      expect(body.data.todo.priority).toBe('low')
    })

    it('should update updatedAt timestamp', async () => {
      // Get current todo
      const getResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })
      const getBody = (await getResponse.json()) as { data: { todos: TodoItem[] } }
      const originalTodo = getBody.data.todos.find((t) => t.todoId === testTodoId)
      const originalUpdatedAt = originalTodo!.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ status: 'pending' }),
      })

      const updatedResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })
      const updatedBody = (await updatedResponse.json()) as { data: { todos: TodoItem[] } }
      const updatedTodo = updatedBody.data.todos.find((t) => t.todoId === testTodoId)

      expect(new Date(updatedTodo!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(originalUpdatedAt).getTime(),
      )
    })

    it('should return 400 for invalid status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ status: 'invalid' }),
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid priority', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ priority: 'invalid' }),
      })

      expect(response.status).toBe(400)
    })

    it('should return 404 for non-existent todo', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/non-existent-todo-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(404)

      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${testTodoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      })

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // DELETE /api/v1/sessions/:sessionId/todos/:todoId - Delete Todo
  // ===========================================================================
  describe('DELETE /api/v1/sessions/:sessionId/todos/:todoId', () => {
    it('should delete a todo', async () => {
      // Create a todo to delete
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Todo to delete' }),
      })
      const createBody = (await createResponse.json()) as { data: { todo: TodoItem } }
      const todoId = createBody.data.todo.todoId

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${todoId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(200)

      const body = (await response.json()) as { ok: boolean; data: { success: boolean }; requestId: string }
      expect(body.ok).toBe(true)
      expect(body.data.success).toBe(true)
      expect(body.requestId).toBeDefined()
    })

    it('should return 404 when deleting non-existent todo', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/non-existent-todo-id`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)

      const body = (await response.json()) as { ok: boolean; error: { code: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should cascade delete descendants', async () => {
      // Create parent todo
      const parentResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Parent for cascade delete' }),
      })
      const parentBody = (await parentResponse.json()) as { data: { todo: TodoItem } }
      const parentTodoId = parentBody.data.todo.todoId

      // Create child todo
      const childResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Child todo', parentTodoId }),
      })
      const childBody = (await childResponse.json()) as { data: { todo: TodoItem } }
      const childTodoId = childBody.data.todo.todoId

      // Delete parent
      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/${parentTodoId}`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      // Child should also be deleted (404)
      const checkChildResponse = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })
      const checkChildBody = (await checkChildResponse.json()) as { data: { todos: TodoItem[] } }
      const childExists = checkChildBody.data.todos.some((t) => t.todoId === childTodoId)

      expect(childExists).toBe(false)
    })

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/todos/some-todo-id`, {
        method: 'DELETE',
        headers: { Cookie: authCookie },
      })

      expect(response.status).toBe(404)
    })

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/some-todo-id`, {
        method: 'DELETE',
      })

      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // Response Envelope Contract Tests
  // ===========================================================================
  describe('Response Envelope Contract', () => {
    it('should return standard success envelope for POST', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ content: 'Envelope test' }),
      })

      const body = (await response.json()) as { ok: boolean; data: unknown; requestId: string }

      expect(body).toHaveProperty('ok')
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('requestId')
      expect(body.ok).toBe(true)
      expect(typeof body.requestId).toBe('string')
      expect(body.requestId.length).toBeGreaterThan(0)
    })

    it('should return standard success envelope for GET', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        headers: { Cookie: authCookie },
      })

      const body = (await response.json()) as { ok: boolean; data: unknown; requestId: string }

      expect(body).toHaveProperty('ok')
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('requestId')
    })

    it('should return standard error envelope for 400', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })

      const body = (await response.json()) as { ok: boolean; error: { code: string; message: string }; requestId: string }

      expect(body).toHaveProperty('ok')
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('requestId')
      expect(body.ok).toBe(false)
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
    })

    it('should return standard error envelope for 404', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/todos/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ status: 'completed' }),
      })

      const body = (await response.json()) as { ok: boolean; error: { code: string; message: string }; requestId: string }

      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })
})
