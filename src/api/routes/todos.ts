import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import { isValidTodoStatus, isValidTodoPriority, TodoStatus, TodoPriority } from '../../todo/types.js'
import { DEFAULT_OWNER_AGENT_ID } from '../../todo/store.js'
import { randomUUID } from 'crypto'

interface CreateTodoBody {
  content: string
  priority?: 'high' | 'medium' | 'low'
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  parentTodoId?: string
  ownerAgentId?: string
}

interface UpdateTodoBody {
  content?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority?: 'high' | 'medium' | 'low'
}

interface SessionParams {
  sessionId: string
}

interface TodoQueryParams {
  ownerAgentId?: string
}

interface TodoParams extends SessionParams {
  todoId: string
}

/**
 * Check if the user can access the session.
 * Returns true if:
 * - No user is logged in (local mode)
 * - The user owns the session
 * - The user is an admin
 */
function canAccessSession(request: FastifyRequest, session: { userId: string }): boolean {
  const userId = request.user?.userId
  const role = request.user?.role
  // No user (local mode) or user owns the session or user is admin
  return !userId || session.userId === userId || role === 'admin'
}

/**
 * Map store Todo to API TodoItem format.
 * ownerAgentId is included as an additive/optional field for backward compatibility.
 */
function mapTodoToItem(todo: {
  id: string
  sessionId: string
  content: string
  status: string
  priority: string
  parentId?: string
  position: number
  ownerAgentId?: string
  createdAt: string
  updatedAt: string
}) {
  return {
    todoId: todo.id,
    sessionId: todo.sessionId,
    content: todo.content,
    status: todo.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
    priority: todo.priority as 'high' | 'medium' | 'low',
    parentTodoId: todo.parentId,
    position: todo.position,
    ownerAgentId: todo.ownerAgentId,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  }
}

export async function registerTodoRoutes(server: FastifyInstance, context: ApiContext): Promise<void> {
  const sessionStore = context.stores.sessionStore
  const todoStore = context.stores.todoStore

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/todos - Create Todo
  // ===========================================================================
  server.post<{ Params: SessionParams; Body: CreateTodoBody }>(
    '/api/v1/sessions/:sessionId/todos',
    async (request: FastifyRequest<{ Params: SessionParams; Body: CreateTodoBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.todos, Action.create)) {
        return reply
      }

      const { sessionId } = request.params
      const { content, priority, status, parentTodoId, ownerAgentId } = request.body || {}

      // Verify session exists and user has access
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      if (!canAccessSession(request, session)) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      // Validate content
      if (content === undefined || content === null) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'content is required', request.requestId))
      }

      if (typeof content !== 'string' || content.trim().length === 0) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'content must be a non-empty string', request.requestId))
      }

      if (ownerAgentId !== undefined) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'ownerAgentId cannot be set via the session todo API', request.requestId))
      }

      // Validate priority
      if (priority !== undefined && !isValidTodoPriority(priority)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Invalid priority: ${priority}. Must be one of: high, medium, low`,
              request.requestId,
            ),
          )
      }

      // Validate status
      if (status !== undefined && !isValidTodoStatus(status)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Invalid status: ${status}. Must be one of: pending, in_progress, completed, cancelled`,
              request.requestId,
            ),
          )
      }

      // Validate parentTodoId if provided
      if (parentTodoId !== undefined) {
        const parentTodo = todoStore.findById(parentTodoId)
        if (!parentTodo) {
          return reply
            .code(400)
            .send(envelopeError('BAD_REQUEST', `Parent todo not found: ${parentTodoId}`, request.requestId))
        }
        if (parentTodo.sessionId !== sessionId) {
          return reply
            .code(400)
            .send(envelopeError('BAD_REQUEST', 'Parent todo must belong to the same session', request.requestId))
        }
        if (parentTodo.ownerAgentId !== DEFAULT_OWNER_AGENT_ID) {
          return reply
            .code(400)
            .send(envelopeError('BAD_REQUEST', 'Parent todo must belong to the same owner agent', request.requestId))
        }
      }

      // Create the todo
      const todoId = randomUUID()
      const effectivePriority = (priority as TodoPriority) || TodoPriority.medium
      const effectiveStatus = (status as TodoStatus) || TodoStatus.pending

      try {
        const created = todoStore.create({
          id: todoId,
          sessionId,
          content: content.trim(),
          status: effectiveStatus,
          priority: effectivePriority,
          parentId: parentTodoId,
        })

        const todoItem = mapTodoToItem(created)
        return reply.code(201).send(success({ todo: todoItem }, request.requestId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create todo'
        return reply.code(400).send(envelopeError('BAD_REQUEST', message, request.requestId))
      }
    },
  )

  // ===========================================================================
  // GET /api/v1/sessions/:sessionId/todos - List Todos
  // ===========================================================================
  server.get<{ Params: SessionParams; Querystring: TodoQueryParams }>(
    '/api/v1/sessions/:sessionId/todos',
    async (request: FastifyRequest<{ Params: SessionParams; Querystring: TodoQueryParams }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.todos, Action.read)) {
        return reply
      }

      const { sessionId } = request.params
      const { ownerAgentId } = request.query

      // Verify session exists and user has access
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      if (!canAccessSession(request, session)) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      // Get todos for the session, optionally filtered by ownerAgentId
      // Default (no ownerAgentId): returns ALL session todos (backward compatible)
      // With ownerAgentId: returns only todos owned by that agent (debugging support)
      const todos = ownerAgentId
        ? todoStore.findBySessionAndOwner(sessionId, ownerAgentId)
        : todoStore.findBySession(sessionId)
      const todoItems = todos.map(mapTodoToItem).sort((a, b) => a.position - b.position)

      return reply.code(200).send(success({ todos: todoItems, total: todoItems.length }, request.requestId))
    },
  )

  // ===========================================================================
  // PATCH /api/v1/sessions/:sessionId/todos/:todoId - Update Todo
  // ===========================================================================
  server.patch<{ Params: TodoParams; Body: UpdateTodoBody }>(
    '/api/v1/sessions/:sessionId/todos/:todoId',
    async (request: FastifyRequest<{ Params: TodoParams; Body: UpdateTodoBody }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.todos, Action.update)) {
        return reply
      }

      const { sessionId, todoId } = request.params
      const { content, status, priority } = request.body || {}

      // Verify session exists and user has access
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      if (!canAccessSession(request, session)) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      // Validate status if provided
      if (status !== undefined && !isValidTodoStatus(status)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Invalid status: ${status}. Must be one of: pending, in_progress, completed, cancelled`,
              request.requestId,
            ),
          )
      }

      // Validate priority if provided
      if (priority !== undefined && !isValidTodoPriority(priority)) {
        return reply
          .code(400)
          .send(
            envelopeError(
              'BAD_REQUEST',
              `Invalid priority: ${priority}. Must be one of: high, medium, low`,
              request.requestId,
            ),
          )
      }

      // Check if todo exists and belongs to the session
      const existingTodo = todoStore.findById(todoId)
      if (!existingTodo) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      if (existingTodo.sessionId !== sessionId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      if (existingTodo.ownerAgentId !== DEFAULT_OWNER_AGENT_ID) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      // Build update input
      const updateInput: { content?: string; status?: TodoStatus; priority?: TodoPriority } = {}
      if (content !== undefined) {
        updateInput.content = content
      }
      if (status !== undefined) {
        updateInput.status = status as TodoStatus
      }
      if (priority !== undefined) {
        updateInput.priority = priority as TodoPriority
      }

      // Update the todo
      const updated = todoStore.update(todoId, updateInput)
      if (!updated) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to update todo', request.requestId))
      }

      const todoItem = mapTodoToItem(updated)
      return reply.code(200).send(success({ todo: todoItem }, request.requestId))
    },
  )

  // ===========================================================================
  // DELETE /api/v1/sessions/:sessionId/todos/:todoId - Delete Todo
  // ===========================================================================
  server.delete<{ Params: TodoParams }>(
    '/api/v1/sessions/:sessionId/todos/:todoId',
    async (request: FastifyRequest<{ Params: TodoParams }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.todos, Action.delete)) {
        return reply
      }

      const { sessionId, todoId } = request.params

      // Verify session exists and user has access
      const session = sessionStore.getById(sessionId)
      if (!session) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
      }

      if (!canAccessSession(request, session)) {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
      }

      // Check if todo exists and belongs to the session
      const existingTodo = todoStore.findById(todoId)
      if (!existingTodo) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      if (existingTodo.sessionId !== sessionId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      if (existingTodo.ownerAgentId !== DEFAULT_OWNER_AGENT_ID) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Todo not found', request.requestId))
      }

      // Delete the todo (cascade delete handled by database)
      const deleted = todoStore.remove(todoId)
      if (!deleted) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to delete todo', request.requestId))
      }

      return reply.code(200).send(success({ success: true }, request.requestId))
    },
  )
}
