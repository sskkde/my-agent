import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js'
import type { RuntimeContextDelta, ContextItem } from '../../context/types.js'
import type { CreateTodoInput, Todo, TodoStore, UpdateTodoInput } from '../../todo/store.js'
import { TodoStatus, TodoPriority, TodoWriteMode, isValidTodoWriteMode } from '../../todo/types.js'

export interface TodowriteParams {
  mode: 'append' | 'replace' | 'update' | 'remove'
  todos: TodoItemInput[]
  sessionId?: string
}

export interface TodoItemInput {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentId?: string
}

export interface TodowriteResult {
  todos: TodoItemOutput[]
  addedCount?: number
  updatedCount?: number
  removedCount?: number
}

export interface TodoItemOutput {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentId?: string
}

function mapTodoToOutput(todo: Todo): TodoItemOutput {
  return {
    id: todo.id,
    content: todo.content,
    status: todo.status as TodoItemOutput['status'],
    priority: todo.priority as TodoItemOutput['priority'],
    parentId: todo.parentId,
  }
}

function mapInputToCreateInput(input: TodoItemInput, sessionId: string, ownerAgentId: string): CreateTodoInput {
  return {
    id: input.id,
    sessionId,
    content: input.content,
    status: input.status as TodoStatus,
    priority: input.priority as TodoPriority,
    parentId: input.parentId,
    ownerAgentId,
  }
}

function makeEphemeralTodo(input: TodoItemInput, sessionId: string, ownerAgentId: string): Todo {
  const now = new Date().toISOString()
  return {
    id: input.id,
    sessionId,
    content: input.content,
    status: input.status as TodoStatus,
    priority: input.priority as TodoPriority,
    parentId: input.parentId,
    depth: 0,
    position: 0,
    metadata: undefined,
    tenantId: 'default',
    ownerAgentId,
    createdAt: now,
    updatedAt: now,
  }
}

function makeStructuredContent(result: TodowriteResult): Record<string, unknown> {
  const content: Record<string, unknown> = { todos: result.todos }
  if (result.addedCount !== undefined) content.addedCount = result.addedCount
  if (result.updatedCount !== undefined) content.updatedCount = result.updatedCount
  if (result.removedCount !== undefined) content.removedCount = result.removedCount
  return content
}

function createContextDelta(sessionId: string, todos: Todo[]): RuntimeContextDelta {
  // Only include active (non-completed, non-cancelled) todos
  const activeTodos = todos.filter(t => t.status === TodoStatus.pending || t.status === TodoStatus.in_progress)
  
  const items: ContextItem[] = activeTodos.map(todo => ({
    itemId: `todo-${todo.id}`,
    sourceType: 'system_note' as const,
    semanticType: 'entity_state' as const,
    content: `Todo: ${todo.content} [${todo.status}] [${todo.priority}]`,
    structuredPayload: {
      id: todo.id,
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
      parentId: todo.parentId,
    },
  }))

  return {
    runId: sessionId,
    source: 'runtime_note',
    items,
  }
}

export function createTodowriteTool(todoStore?: TodoStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const typedParams = params as Partial<TodowriteParams>

    const effectiveSessionId = context.sessionId
    if (!effectiveSessionId) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'No session available. Session ID is required for todo operations.',
          recoverable: true,
        },
      }
    }

    // Owner identity is derived from execution context, NOT from caller params.
    // This ensures each agent (foreground, subagent, background) only sees its own todos.
    const ownerAgentId = context.agentId ?? context.agentType ?? 'foreground.default'

    // Validate required mode parameter
    if (!typedParams.mode) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'The "mode" parameter is required. Must be one of: append, replace, update, remove.',
          recoverable: true,
        },
      }
    }

    // Validate mode value
    if (!isValidTodoWriteMode(typedParams.mode)) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: `Invalid mode "${typedParams.mode}". Must be one of: append, replace, update, remove.`,
          recoverable: true,
        },
      }
    }

    // Validate required todos parameter
    if (!typedParams.todos) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'The "todos" parameter is required.',
          recoverable: true,
        },
      }
    }

    if (!Array.isArray(typedParams.todos)) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'The "todos" parameter must be an array.',
          recoverable: true,
        },
      }
    }

    const mode = typedParams.mode as TodoWriteMode
    const inputTodos = typedParams.todos as TodoItemInput[]

    // Handle modes
    let result: TodowriteResult
    let allTodos: Todo[]

    switch (mode) {
      case TodoWriteMode.append: {
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map((todo) => makeEphemeralTodo(todo, effectiveSessionId, ownerAgentId))
          result = {
            todos: inputTodos.map(t => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, parentId: t.parentId })),
            addedCount: inputTodos.length,
          }
          allTodos = fakeTodos
        } else {
          const added: Todo[] = []
          for (const input of inputTodos) {
            try {
              const created = todoStore.create({
                id: input.id,
                sessionId: effectiveSessionId,
                content: input.content,
                status: input.status as TodoStatus,
                priority: input.priority as TodoPriority,
                parentId: input.parentId,
                ownerAgentId,
              })
              added.push(created)
            } catch (error) {
              return {
                success: false,
                error: {
                  code: 'TODO_CREATE_FAILED',
                  message: error instanceof Error ? error.message : 'Failed to create todo.',
                  recoverable: true,
                },
              }
            }
          }
          allTodos = todoStore.findBySessionAndOwner(effectiveSessionId, ownerAgentId)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            addedCount: added.length,
          }
        }
        break
      }

      case TodoWriteMode.replace: {
        // Owner-scoped: replaces only todos belonging to ownerAgentId, not all session todos.
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map((todo) => makeEphemeralTodo(todo, effectiveSessionId, ownerAgentId))
          result = {
            todos: inputTodos.map(t => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, parentId: t.parentId })),
            addedCount: inputTodos.length,
          }
          allTodos = fakeTodos
        } else {
          const writeInputs: CreateTodoInput[] = inputTodos.map((todo) =>
            mapInputToCreateInput(todo, effectiveSessionId, ownerAgentId),
          )
          allTodos = todoStore.replace(effectiveSessionId, writeInputs, ownerAgentId)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            addedCount: allTodos.length,
          }
        }
        break
      }

      case TodoWriteMode.update: {
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map((todo) => makeEphemeralTodo(todo, effectiveSessionId, ownerAgentId))
          result = {
            todos: inputTodos.map(t => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, parentId: t.parentId })),
            updatedCount: inputTodos.length,
          }
          allTodos = fakeTodos
        } else {
          let updated = 0
          for (const input of inputTodos) {
            const existing = todoStore.findById(input.id)
            if (existing?.sessionId === effectiveSessionId && existing.ownerAgentId === ownerAgentId) {
              const updateInput: UpdateTodoInput = {}
              if (input.content) updateInput.content = input.content
              if (input.status) updateInput.status = input.status as TodoStatus
              if (input.priority) updateInput.priority = input.priority as TodoPriority
              todoStore.update(input.id, updateInput)
              updated++
            }
          }
          allTodos = todoStore.findBySessionAndOwner(effectiveSessionId, ownerAgentId)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            updatedCount: updated,
          }
        }
        break
      }

      case TodoWriteMode.remove: {
        if (!todoStore) {
          result = {
            todos: [],
            removedCount: inputTodos.length,
          }
          allTodos = []
        } else {
          let removed = 0
          for (const input of inputTodos) {
            const existing = todoStore.findById(input.id)
            if (existing?.sessionId === effectiveSessionId && existing.ownerAgentId === ownerAgentId && todoStore.remove(input.id)) {
              removed++
            }
          }
          allTodos = todoStore.findBySessionAndOwner(effectiveSessionId, ownerAgentId)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            removedCount: removed,
          }
        }
        break
      }

      default:
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: `Unknown mode: ${mode}`,
            recoverable: true,
          },
        }
    }

    // Create context delta with active todos only
    const contextDelta = createContextDelta(effectiveSessionId, allTodos)

    // Build result preview
    let preview = ''
    if (result.addedCount !== undefined) preview = `Added ${result.addedCount} todo(s). `
    if (result.updatedCount !== undefined) preview = `Updated ${result.updatedCount} todo(s). `
    if (result.removedCount !== undefined) preview = `Removed ${result.removedCount} todo(s). `
    preview += `Total: ${result.todos.length} todo(s).`

    return {
      success: true,
      data: result,
      contextDelta,
      resultPreview: preview.trim(),
      structuredContent: makeStructuredContent(result),
    }
  }

  return {
    name: 'todowrite',
    description: 'Write todos with explicit mode. Modes: append (add new), replace (owner-scoped replace — only replaces todos owned by the calling agent), update (modify existing), remove (delete by ID). The mode parameter is REQUIRED on every call. Session and owner are derived from execution context.',
    category: 'write',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['append', 'replace', 'update', 'remove'],
          description: 'Write mode (REQUIRED)',
        },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Todo ID' },
              content: { type: 'string', description: 'Todo content/description' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'], description: 'Todo status' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority level' },
              parentId: { type: 'string', description: 'Parent todo ID for nesting' },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
          description: 'Array of todo items',
        },
        sessionId: { type: 'string', description: 'Deprecated. Ignored; session is derived from execution context.' },
      },
      required: ['mode', 'todos'],
    },
    handler,
  }
}
