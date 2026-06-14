import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'
import type { Todo } from '../../todo/types.js'
import { MAX_TODO_DEPTH } from '../../todo/types.js'

export interface TodolistParams {
  sessionId?: string
  format?: 'tree' | 'markdown' | 'flat'
}

export interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentId?: string
  children?: TodoItem[]
}

export interface TodolistResult {
  todos: TodoItem[]
  hierarchicalOutput: string
  totalCount: number
  activeCount: number
  maxDepth: number
}

interface TodoStore {
  findById(id: string): Todo | null
  findBySession(sessionId: string): Todo[]
}

function mapTodoToItem(todo: Todo): TodoItem {
  return {
    id: todo.todoId,
    content: todo.content,
    status: todo.status as TodoItem['status'],
    priority: todo.priority as TodoItem['priority'],
    parentId: todo.parentTodoId ?? undefined,
  }
}

function buildHierarchy(todos: TodoItem[]): TodoItem[] {
  const byId = new Map<string, TodoItem>()
  const roots: TodoItem[] = []

  // First pass: create all items
  for (const todo of todos) {
    byId.set(todo.id, { ...todo, children: [] })
  }

  // Second pass: build hierarchy
  for (const todo of todos) {
    const item = byId.get(todo.id)!
    if (todo.parentId) {
      const parent = byId.get(todo.parentId)
      if (parent) {
        parent.children!.push(item)
      } else {
        // Parent not found, treat as root
        roots.push(item)
      }
    } else {
      roots.push(item)
    }
  }

  return roots
}

function calculateMaxDepth(items: TodoItem[], depth: number = 0): number {
  if (items.length === 0) return depth
  let max = depth
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const childDepth = calculateMaxDepth(item.children, depth + 1)
      max = Math.max(max, childDepth)
    }
  }
  return max
}

function formatTree(items: TodoItem[], indent: string = '', maxLevel: number = MAX_TODO_DEPTH): string {
  const lines: string[] = []
  for (const item of items) {
    const statusIcon = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '►' : '○'
    const priorityIcon = item.priority === 'high' ? '!' : item.priority === 'medium' ? '-' : ' '
    lines.push(`${indent}${statusIcon} [${priorityIcon}] ${item.content}`)
    if (item.children && item.children.length > 0 && indent.split('  ').length - 1 < maxLevel) {
      lines.push(formatTree(item.children, indent + '  ', maxLevel))
    }
  }
  return lines.join('\n')
}

function formatMarkdown(items: TodoItem[], level: number = 1, maxLevel: number = MAX_TODO_DEPTH): string {
  if (items.length === 0) {
    return '- No todos'
  }
  const lines: string[] = []
  for (const item of items) {
    const checkbox = item.status === 'completed' ? '[x]' : '[ ]'
    const priority = item.priority === 'high' ? ' **(high)**' : item.priority === 'low' ? ' *(low)*' : ''
    lines.push(`${'  '.repeat(level - 1)}- ${checkbox} ${item.content}${priority}`)
    if (item.children && item.children.length > 0 && level < maxLevel) {
      lines.push(formatMarkdown(item.children, level + 1, maxLevel))
    }
  }
  return lines.join('\n')
}

function formatFlat(items: TodoItem[]): string {
  const lines: string[] = []
  for (const item of items) {
    const status = item.status.charAt(0).toUpperCase() + item.status.slice(1).replace('_', ' ')
    const priority = item.priority.toUpperCase()
    lines.push(`[${status}] [${priority}] ${item.content} (id: ${item.id})`)
  }
  return lines.join('\n')
}

export function createTodolistTool(todoStore?: TodoStore): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as TodolistParams

    // Get sessionId from params or default
    const sessionId = typedParams.sessionId

    if (!sessionId) {
      return {
        success: true,
        data: {
          todos: [],
          hierarchicalOutput: 'No session specified.',
          totalCount: 0,
          activeCount: 0,
          maxDepth: 0,
        } as TodolistResult,
        resultPreview: 'No session specified. Todo list is empty.',
      }
    }

    // Get todos from store
    const storeTodos = todoStore ? todoStore.findBySession(sessionId) : []
    const todos = storeTodos.map(mapTodoToItem)

    // Build hierarchical structure
    const hierarchical = buildHierarchy(todos)

    // Calculate stats
    const totalCount = todos.length
    const activeCount = todos.filter(t => t.status === 'pending' || t.status === 'in_progress').length
    const maxDepth = Math.min(calculateMaxDepth(hierarchical), MAX_TODO_DEPTH)

    // Format output
    const format = typedParams.format || 'tree'
    let hierarchicalOutput: string

    switch (format) {
      case 'markdown':
        hierarchicalOutput = formatMarkdown(hierarchical)
        break
      case 'flat':
        hierarchicalOutput = formatFlat(todos)
        break
      case 'tree':
      default:
        hierarchicalOutput = hierarchical.length > 0 ? formatTree(hierarchical) : 'No todos found.'
        break
    }

    const result: TodolistResult = {
      todos,
      hierarchicalOutput,
      totalCount,
      activeCount,
      maxDepth,
    }

    return {
      success: true,
      data: result,
      resultPreview: `Todo list: ${totalCount} total, ${activeCount} active. Depth: ${maxDepth} levels.`,
      structuredContent: result as unknown as Record<string, unknown>,
    }
  }

  return {
    name: 'todolist',
    description: 'List todos for a session with hierarchical tree output. Supports tree, markdown, and flat formats. Maximum depth of 3 levels.',
    category: 'read',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to list todos for' },
        format: {
          type: 'string',
          enum: ['tree', 'markdown', 'flat'],
          description: 'Output format (default: tree)',
        },
      },
      required: [],
    },
    handler,
  }
}
