/**
 * Todo Context Projection
 *
 * Projects active todos into ContextItem arrays for agent/session context.
 * Used at turn start and after todowrite mutations.
 *
 * @module todo/context-projection
 */

import type { ContextItem, RuntimeContextDelta } from '../context/types.js'

// ── Input Types ───────────────────────────────────────────────────────────────

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
type TodoPriority = 'high' | 'medium' | 'low'

interface TodoItem {
  todoId: string
  sessionId: string
  tenantId: string
  parentTodoId?: string
  position: number
  status: TodoStatus
  priority: TodoPriority
  content: string
  ownerAgentId?: string
  createdAt: string
  updatedAt: string
}

interface TodoProjectionInput {
  sessionId: string
  todos: TodoItem[]
  maxItems?: number
  maxTokens?: number
  ownerAgentId?: string
}

// ── Output Types ──────────────────────────────────────────────────────────────

interface TodoProjectionResult {
  contextItems: ContextItem[]
  includedCount: number
  excludedCount: number
  totalTodosCount: number
  truncatedNote?: string
}

interface TodoSummaryEntry {
  todoListId: string
  ownerAgentType: string
  status: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<TodoPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const DEFAULT_MAX_ITEMS = 15

// ── Helpers ───────────────────────────────────────────────────────────────────

function isActive(status: TodoStatus): boolean {
  return status === 'pending' || status === 'in_progress'
}

/**
 * Estimate token count from text content.
 * Uses a simple heuristic: ~1.3 tokens per word.
 */
function estimateTokens(content: string): number {
  const words = content.split(/\s+/).length
  return Math.max(1, Math.ceil(words * 1.3))
}

function formatTodoContent(todo: TodoItem): string {
  return `[${todo.status}] ${todo.content}`
}

function todoToContextItem(todo: TodoItem): ContextItem {
  const content = formatTodoContent(todo)
  return {
    itemId: `todo-ctx-${todo.todoId}`,
    sourceType: 'plan_state',
    semanticType: 'plan_view',
    content,
    structuredPayload: {
      todoId: todo.todoId,
      status: todo.status,
      priority: todo.priority,
    },
    estimatedTokens: estimateTokens(content),
    dedupeKey: todo.todoId,
    freshnessTs: todo.updatedAt,
  }
}

function sortByPriorityAndPosition(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priorityDiff !== 0) return priorityDiff
    return a.position - b.position
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Projects active todos into ContextItem arrays for agent context.
 *
 * - Includes only pending and in_progress todos
 * - Sorts by priority (high > medium > low), then by position
 * - Enforces item count limit (maxItems) with truncation note
 * - Enforces token budget (maxTokens) by estimating per-item cost
 *
 * @param input - Projection input with session, todos, and optional limits
 * @returns Projection result with context items and metadata
 */
export function projectActiveTodosToContext(input: TodoProjectionInput): TodoProjectionResult {
  const { todos, maxItems, maxTokens, ownerAgentId } = input

  const scopedTodos = ownerAgentId
    ? todos.filter((t) => t.ownerAgentId === ownerAgentId)
    : todos

  const totalTodosCount = scopedTodos.length
  const activeTodos = scopedTodos.filter((t) => isActive(t.status))
  const inactiveCount = scopedTodos.length - activeTodos.length

  if (activeTodos.length === 0) {
    return {
      contextItems: [],
      includedCount: 0,
      excludedCount: inactiveCount,
      totalTodosCount,
    }
  }

  // Sort by priority then position
  const sorted = sortByPriorityAndPosition(activeTodos)

  // Apply item count limit
  const effectiveMaxItems = maxItems ?? DEFAULT_MAX_ITEMS
  let selectedTodos = sorted
  let truncatedNote: string | undefined

  if (sorted.length > effectiveMaxItems) {
    selectedTodos = sorted.slice(0, effectiveMaxItems)
    truncatedNote = `Showing ${effectiveMaxItems} of ${sorted.length} active todos. Call todolist to see all.`
  }

  // Apply token budget if specified
  if (maxTokens !== undefined) {
    const items: ContextItem[] = []
    let usedTokens = 0

    for (const todo of selectedTodos) {
      const item = todoToContextItem(todo)
      const itemTokens = item.estimatedTokens ?? 0

      if (usedTokens + itemTokens > maxTokens && items.length > 0) {
        // Would exceed budget - stop adding items
        if (!truncatedNote) {
          truncatedNote = `Showing ${items.length} of ${sorted.length} active todos due to token budget. Call todolist to see all.`
        }
        break
      }

      items.push(item)
      usedTokens += itemTokens
    }

    return {
      contextItems: items,
      includedCount: items.length,
      excludedCount: totalTodosCount - items.length,
      totalTodosCount,
      truncatedNote,
    }
  }

  // Convert to context items
  const contextItems = selectedTodos.map(todoToContextItem)

  return {
    contextItems,
    includedCount: contextItems.length,
    excludedCount: totalTodosCount - contextItems.length,
    totalTodosCount,
    truncatedNote,
  }
}

/**
 * Builds a RuntimeContextDelta from a set of todos.
 *
 * Used after todowrite mutations to inject updated todo state
 * into the context manager's delta pipeline.
 *
 * @param input - Delta input with run context, todos, and optional metadata
 * @returns RuntimeContextDelta compatible with ContextManager.applyDelta()
 */
export function buildTodoContextDelta(input: {
  runId: string
  sessionId: string
  todos: TodoItem[]
  iteration?: number
  previousStatuses?: Record<string, TodoStatus>
  ownerAgentId?: string
}): RuntimeContextDelta {
  const { runId, todos, iteration, previousStatuses, ownerAgentId } = input

  const scopedTodos = ownerAgentId
    ? todos.filter((t) => t.ownerAgentId === ownerAgentId)
    : todos

  const activeTodos = scopedTodos.filter((t) => isActive(t.status))
  const items = activeTodos.map(todoToContextItem)

  // Build replaceKeys for todos that changed status
  const replaceKeys: string[] = []
  if (previousStatuses) {
    for (const [todoId, previousStatus] of Object.entries(previousStatuses)) {
      const current = todos.find((t) => t.todoId === todoId)
      if (current && current.status !== previousStatus) {
        replaceKeys.push(todoId)
      }
    }
  }

  return {
    runId,
    iteration,
    source: 'plan_state',
    items,
    replaceKeys: replaceKeys.length > 0 ? replaceKeys : undefined,
  }
}

/**
 * Generates a todoSummary for PlanContextView.
 *
 * Returns summary entries suitable for the PlanContextView.todoSummary field,
 * grouping active todos by their logical owner agent type.
 *
 * @param input - Input with session ID and todos
 * @returns Array of todo summary entries for PlanContextView
 */
export function getTodoSummaryForPlanContextView(input: {
  sessionId: string
  todos: TodoItem[]
}): TodoSummaryEntry[] {
  const { todos } = input

  const activeTodos = todos.filter((t) => isActive(t.status))

  if (activeTodos.length === 0) {
    return []
  }

  const grouped = new Map<string, TodoItem[]>()
  for (const todo of activeTodos) {
    const owner = todo.ownerAgentId ?? 'foreground.default'
    if (!grouped.has(owner)) {
      grouped.set(owner, [])
    }
    grouped.get(owner)!.push(todo)
  }

  const entries: TodoSummaryEntry[] = []
  for (const [owner, ownerTodos] of grouped) {
    const pendingCount = ownerTodos.filter((t) => t.status === 'pending').length
    const inProgressCount = ownerTodos.filter((t) => t.status === 'in_progress').length

    const statusParts: string[] = []
    if (inProgressCount > 0) statusParts.push(`${inProgressCount} in_progress`)
    if (pendingCount > 0) statusParts.push(`${pendingCount} pending`)

    entries.push({
      todoListId: input.sessionId,
      ownerAgentType: owner,
      status: statusParts.join(', '),
    })
  }

  return entries
}
