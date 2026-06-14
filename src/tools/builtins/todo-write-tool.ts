import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { RuntimeContextDelta, ContextItem } from '../../context/types.js'
import type { Todo, TodoWriteInput } from '../../todo/types.js'
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

interface TodoStore {
  findById(id: string): Todo | null
  findBySession(sessionId: string): Todo[]
  create(input: Omit<Todo, 'createdAt' | 'updatedAt' | 'position'> & { position?: number }): Todo
  update(id: string, input: Partial<Omit<Todo, 'todoId' | 'sessionId' | 'tenantId' | 'createdAt'>>): Todo | null
  remove(id: string): boolean
  replace(sessionId: string, todos: TodoWriteInput[]): Todo[]
}

function mapTodoToOutput(todo: Todo): TodoItemOutput {
  return {
    id: todo.todoId,
    content: todo.content,
    status: todo.status as TodoItemOutput['status'],
    priority: todo.priority as TodoItemOutput['priority'],
    parentId: todo.parentTodoId ?? undefined,
  }
}

function mapInputToWriteInput(input: TodoItemInput): TodoWriteInput {
  return {
    content: input.content,
    status: input.status as TodoStatus,
    priority: input.priority as TodoPriority,
    parentTodoId: input.parentId,
  }
}

function createContextDelta(sessionId: string, todos: Todo[]): RuntimeContextDelta {
  // Only include active (non-completed, non-cancelled) todos
  const activeTodos = todos.filter(t => t.status === TodoStatus.pending || t.status === TodoStatus.in_progress)
  
  const items: ContextItem[] = activeTodos.map(todo => ({
    itemId: `todo-${todo.todoId}`,
    sourceType: 'system_note' as const,
    semanticType: 'entity_state' as const,
    content: `Todo: ${todo.content} [${todo.status}] [${todo.priority}]`,
    structuredPayload: {
      id: todo.todoId,
      content: todo.content,
      status: todo.status,
      priority: todo.priority,
      parentId: todo.parentTodoId ?? undefined,
    },
  }))

  return {
    runId: sessionId,
    source: 'runtime_note',
    items,
  }
}

export function createTodowriteTool(todoStore?: TodoStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as Partial<TodowriteParams>

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
    const sessionId = typedParams.sessionId || 'default-session'

    // Handle modes
    let result: TodowriteResult
    let allTodos: Todo[]

    switch (mode) {
      case TodoWriteMode.append: {
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map(t => ({
            todoId: t.id,
            sessionId,
            tenantId: 'default',
            content: t.content,
            status: t.status as TodoStatus,
            priority: t.priority as TodoPriority,
            parentTodoId: t.parentId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }))
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
                todoId: input.id,
                sessionId,
                tenantId: 'default',
                content: input.content,
                status: input.status as TodoStatus,
                priority: input.priority as TodoPriority,
                parentTodoId: input.parentId ?? null,
              })
              added.push(created)
            } catch (e) {
              // Continue with other todos if one fails
            }
          }
          allTodos = todoStore.findBySession(sessionId)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            addedCount: added.length,
          }
        }
        break
      }

      case TodoWriteMode.replace: {
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map(t => ({
            todoId: t.id,
            sessionId,
            tenantId: 'default',
            content: t.content,
            status: t.status as TodoStatus,
            priority: t.priority as TodoPriority,
            parentTodoId: t.parentId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }))
          result = {
            todos: inputTodos.map(t => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, parentId: t.parentId })),
            addedCount: inputTodos.length,
          }
          allTodos = fakeTodos
        } else {
          const writeInputs: TodoWriteInput[] = inputTodos.map(t => mapInputToWriteInput(t))
          allTodos = todoStore.replace(sessionId, writeInputs)
          result = {
            todos: allTodos.map(mapTodoToOutput),
            addedCount: allTodos.length,
          }
        }
        break
      }

      case TodoWriteMode.update: {
        if (!todoStore) {
          const fakeTodos: Todo[] = inputTodos.map(t => ({
            todoId: t.id,
            sessionId,
            tenantId: 'default',
            content: t.content,
            status: t.status as TodoStatus,
            priority: t.priority as TodoPriority,
            parentTodoId: t.parentId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }))
          result = {
            todos: inputTodos.map(t => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, parentId: t.parentId })),
            updatedCount: inputTodos.length,
          }
          allTodos = fakeTodos
        } else {
          let updated = 0
          for (const input of inputTodos) {
            const existing = todoStore.findById(input.id)
            if (existing) {
              const updateInput: Partial<Omit<Todo, 'todoId' | 'sessionId' | 'tenantId' | 'createdAt'>> = {}
              if (input.content) updateInput.content = input.content
              if (input.status) updateInput.status = input.status as TodoStatus
              if (input.priority) updateInput.priority = input.priority as TodoPriority
              todoStore.update(input.id, updateInput)
              updated++
            }
          }
          allTodos = todoStore.findBySession(sessionId)
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
            if (todoStore.remove(input.id)) {
              removed++
            }
          }
          allTodos = todoStore.findBySession(sessionId)
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
    const contextDelta = createContextDelta(sessionId, allTodos)

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
      structuredContent: result as unknown as Record<string, unknown>,
    }
  }

  return {
    name: 'todowrite',
    description: 'Write todos with explicit mode. Modes: append (add new), replace (replace all), update (modify existing), remove (delete by ID). The mode parameter is REQUIRED on every call.',
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
        sessionId: { type: 'string', description: 'Session ID (optional)' },
      },
      required: ['mode', 'todos'],
    },
    handler,
  }
}
