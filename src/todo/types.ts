/**
 * Todo Domain Types and Enums
 *
 * This module defines the core types and enums for the Todo domain.
 * Todos are hierarchical task items with a maximum depth of 3 levels.
 *
 * ## Ownership Semantics
 *
 * Todo ownership is **context-derived**, not parameter-based:
 * - `sessionId` is resolved from `ToolExecutionContext.sessionId` first;
 *   the deprecated `params.sessionId` is a fallback for backward compat.
 * - `ownerAgentId` is derived from `context.agentId ?? context.agentType ?? 'foreground.default'`.
 * - All read/write operations (list, append, update, remove) are scoped
 *   to the calling agent's owner identity within a session.
 * - `replace` mode only replaces todos owned by the current owner —
 *   it does NOT affect todos belonging to other agents in the same session.
 * - Background agents have a narrow exception: the todo tools are allowed
 *   via `categoryExceptionToolIds` in the background tool envelope, even
 *   though background agents normally cannot use write-category tools.
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
 * - append: Add new todos to the owner's list within the session
 * - replace: Replace all todos for the current owner only (owner-scoped, transactional)
 * - update: Update specific todo fields by ID
 * - remove: Delete todos by ID
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
