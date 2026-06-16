import type { TodoItemWithChildren } from '../../api/client'
import type { TodoItem } from '../../api/types'

/**
 * Converts flat TODO items (with parentTodoId) into nested tree structure (with children arrays).
 * 
 * @param todos - Flat array of TodoItem objects with parentTodoId references
 * @returns Nested array of TodoItemWithChildren with children arrays populated
 * 
 * Features:
 * - Handles multi-level nesting (parent-child-grandchild)
 * - Sorts siblings by position ascending
 * - Preserves orphan todos (parentTodoId points to non-existent parent) as roots
 * - Preserves all fields on each item
 */
export function buildTodoTree(todos: TodoItem[]): TodoItemWithChildren[] {
  // Edge case: empty input
  if (todos.length === 0) {
    return []
  }

  // Step 1: Create a map of all todos with empty children arrays
  const todoMap = new Map<string, TodoItemWithChildren>()
  for (const todo of todos) {
    todoMap.set(todo.todoId, {
      ...todo,
      children: [],
    })
  }

  // Step 2: Build parent-child relationships and collect roots
  const roots: TodoItemWithChildren[] = []
  for (const todo of todos) {
    const node = todoMap.get(todo.todoId)!
    const parentId = todo.parentTodoId

    if (parentId && todoMap.has(parentId)) {
      // Has valid parent: add to parent's children
      const parent = todoMap.get(parentId)!
      parent.children!.push(node)
    } else {
      // No parent or orphan: add to roots
      roots.push(node)
    }
  }

  // Step 3: Sort children arrays and roots by position ascending
  const sortByPosition = (a: TodoItemWithChildren, b: TodoItemWithChildren) => 
    a.position - b.position

  // Sort roots
  roots.sort(sortByPosition)

  // Sort children arrays recursively
  const sortChildren = (nodes: TodoItemWithChildren[]) => {
    nodes.sort(sortByPosition)
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        sortChildren(node.children)
      }
    }
  }

  sortChildren(roots)

  return roots
}
