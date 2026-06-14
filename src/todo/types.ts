/**
 * Todo Domain Types and Enums
 * 
 * This module defines the core types and enums for the Todo domain.
 * Todos are hierarchical task items with a maximum depth of 3 levels.
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Status of a todo item.
 * - pending: Not yet started
 * - in_progress: Currently being worked on
 * - completed: Successfully finished
 * - cancelled: Abandoned or cancelled
 */
export enum TodoStatus {
  pending = 'pending',
  in_progress = 'in_progress',
  completed = 'completed',
  cancelled = 'cancelled',
}

/**
 * Priority level of a todo item.
 * - high: Urgent, needs immediate attention
 * - medium: Normal priority
 * - low: Can be deferred
 */
export enum TodoPriority {
  high = 'high',
  medium = 'medium',
  low = 'low',
}

/**
 * Write mode for todowrite operations.
 * - append: Add new todos to existing list
 * - replace: Replace all todos for a session (transactional)
 * - update: Update specific todo fields
 * - remove: Delete todos
 */
export enum TodoWriteMode {
  append = 'append',
  replace = 'replace',
  update = 'update',
  remove = 'remove',
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum depth for todo nesting.
 * - Depth 0: Root todo (parentTodoId = null)
 * - Depth 1: First child
 * - Depth 2: Second child
 * - Depth 3: Third child (maximum allowed)
 */
export const MAX_TODO_DEPTH = 3

// ============================================================================
// Types
// ============================================================================

/**
 * A todo item with full domain representation.
 */
export interface Todo {
  /** Unique identifier for the todo */
  todoId: string
  /** Session this todo belongs to */
  sessionId: string
  /** Tenant ID for multi-tenancy */
  tenantId: string
  /** Parent todo ID for hierarchical nesting (null for root todos) */
  parentTodoId: string | null
  /** Position among siblings (0-indexed) */
  position: number
  /** Content/description of the todo */
  content: string
  /** Current status */
  status: TodoStatus
  /** Priority level */
  priority: TodoPriority
  /** ISO timestamp when todo was created */
  createdAt: string
  /** ISO timestamp when todo was last updated */
  updatedAt: string
}

/**
 * Input for creating a new todo.
 */
export interface TodoWriteInput {
  /** Content/description of the todo */
  content: string
  /** Initial status (defaults to pending) */
  status: TodoStatus
  /** Priority level */
  priority: TodoPriority
  /** Parent todo ID for hierarchical nesting (optional) */
  parentTodoId?: string
}

/**
 * Parameters for todowrite operation.
 */
export interface TodoWriteParams {
  /** Write mode (REQUIRED - no default) */
  mode: TodoWriteMode
  /** Todos to operate on */
  todos: TodoWriteInput[]
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Validates if a value is a valid TodoStatus.
 */
export function isValidTodoStatus(value: string): value is TodoStatus {
  return Object.values(TodoStatus).includes(value as TodoStatus)
}

/**
 * Validates if a value is a valid TodoPriority.
 */
export function isValidTodoPriority(value: string): value is TodoPriority {
  return Object.values(TodoPriority).includes(value as TodoPriority)
}

/**
 * Validates if a value is a valid TodoWriteMode.
 */
export function isValidTodoWriteMode(value: string): value is TodoWriteMode {
  return Object.values(TodoWriteMode).includes(value as TodoWriteMode)
}
