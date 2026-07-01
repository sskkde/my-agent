/**
 * TodoWorkPlanCard - Displays todo list in the Work Plan section
 *
 * A simplified, read-only view of session todos for the work plan overview.
 * Shows todo items with status indicators, priority badges, and hierarchical structure.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react'
import * as client from '../../api/client'
import type { TodoItemWithChildren } from '../../api/client'
import { buildTodoTree } from '../todos/todo-tree'

// =============================================================================
// Example Todo Items (shown when no real todos exist)
// =============================================================================

interface ExampleTodoItem {
  id: string
  content: string
  status: 'pending' | 'completed'
  priority: 'high' | 'medium' | 'low'
  dueDate: string
}

const EXAMPLE_TODOS: ExampleTodoItem[] = [
  { id: 'ex-1', content: '审阅暖纸主题 CSS 草稿', status: 'completed', priority: 'medium', dueDate: '今天 09:30' },
  { id: 'ex-2', content: '回复客户邮件', status: 'completed', priority: 'medium', dueDate: '今天 10:15' },
  { id: 'ex-3', content: '完成右侧栏交互原型', status: 'pending', priority: 'high', dueDate: '截止 15:00' },
  { id: 'ex-4', content: '整理本周设计规范文档', status: 'pending', priority: 'medium', dueDate: '今天内' },
  { id: 'ex-5', content: '收集竞品截图参考', status: 'pending', priority: 'low', dueDate: '今天内' },
]

function getTimeGroup(dueDate: string): string {
  if (dueDate.startsWith('今天')) return '今天'
  if (dueDate.startsWith('明天')) return '明天'
  return '未来'
}

function groupByTime(items: ExampleTodoItem[]): Array<{ title: string; items: ExampleTodoItem[] }> {
  const groups: Record<string, ExampleTodoItem[]> = { 今天: [], 明天: [], 未来: [] }
  for (const item of items) {
    const group = getTimeGroup(item.dueDate)
    groups[group].push(item)
  }
  return [
    { title: '今天', items: groups['今天'] },
    { title: '明天', items: groups['明天'] },
    { title: '未来', items: groups['未来'] },
  ].filter(g => g.items.length > 0)
}

// =============================================================================
// Status & Priority Mappings
// =============================================================================

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '✕',
}

const PRIORITY_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

// =============================================================================
// TodoWorkPlanCard Props
// =============================================================================

export interface TodoWorkPlanCardProps {
  sessionId?: string | null
  className?: string
  testId?: string
}

// =============================================================================
// TodoWorkPlanCard Component
// =============================================================================

/**
 * TodoWorkPlanCard - Read-only todo list for work plan section
 *
 * Features:
 * - Fetches todos for the current session
 * - Displays hierarchical todo tree (max 3 levels)
 * - Shows status icons and priority badges
 * - Compact, read-only design for overview purposes
 * - "View all" link to open full todos tab
 */
const TodoWorkPlanCard: React.FC<TodoWorkPlanCardProps> = ({
  sessionId,
  className = '',
  testId = 'todo-work-plan-card',
}) => {
  const [todos, setTodos] = useState<TodoItemWithChildren[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Track current sessionId for stale response guard
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const fetchTodos = useCallback(async () => {
    if (!sessionId) {
      setTodos([])
      return
    }

    const currentSessionId = sessionId
    setLoading(true)
    setError(null)

    try {
      const response = await client.listTodos(currentSessionId)
      // Guard: only update if sessionId hasn't changed during the fetch
      if (currentSessionId === sessionIdRef.current) {
        setTodos(buildTodoTree(response.todos))
      }
    } catch (err) {
      if (currentSessionId === sessionIdRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to load todos'))
      }
    } finally {
      if (currentSessionId === sessionIdRef.current) {
        setLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  // Render a single example todo item
  const renderExampleItem = (item: ExampleTodoItem): React.ReactNode => {
    const completed = item.status === 'completed'
    return (
      <div key={item.id} className="todo-plan-item">
        <div className={`todo-plan-item__checkbox${completed ? ' todo-plan-item__checkbox--completed' : ''}`}>
          {completed && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
        <div className="todo-plan-item__content">
          <div className={`todo-plan-item__text${completed ? ' todo-plan-item__text--completed' : ''}`}>
            {item.content}
          </div>
          <div className="todo-plan-item__meta">
            <span className={`todo-plan-item__priority todo-plan-item__priority--${item.priority}`} />
            <span>{item.dueDate}</span>
          </div>
        </div>
      </div>
    )
  }

  // Render a single todo item (read-only)
  const renderTodoItem = (todo: TodoItemWithChildren, depth: number = 0): React.ReactNode => {
    if (depth > 2) return null // Max 3 levels

    return (
      <div
        key={todo.todoId}
        className="todo-plan-item"
        style={{ paddingLeft: `${depth * 16}px` }}
        data-testid={`todo-plan-item-${todo.todoId}`}
      >
        <div className="todo-plan-item__row">
          <span className={`todo-plan-item__status todo-plan-item__status--${todo.status}`}>
            {STATUS_ICONS[todo.status]}
          </span>
          <span className={`todo-plan-item__priority todo-plan-item__priority--${todo.priority}`}>
            {PRIORITY_LABELS[todo.priority]}
          </span>
          <span className={`todo-plan-item__content todo-plan-item__content--${todo.status}`}>
            {todo.content}
          </span>
        </div>
        {todo.children && todo.children.length > 0 && (
          <div className="todo-plan-item__children">
            {todo.children.map((child) => renderTodoItem(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  // Calculate stats
  const totalTodos = todos.length
  const completedTodos = countTodosByStatus(todos, 'completed')
  const inProgressTodos = countTodosByStatus(todos, 'in_progress')
  const pendingTodos = countTodosByStatus(todos, 'pending')

  return (
    <div className={`todo-work-plan-card ${className}`} data-testid={testId}>
      {loading ? (
        <div className="todo-plan-loading">
          <span className="todo-plan-loading__spinner">⏳</span>
          <span>加载中...</span>
        </div>
      ) : error ? (
        <div className="todo-plan-error">
          <span className="todo-plan-error__icon">⚠️</span>
          <span>加载失败</span>
          <button className="todo-plan-error__retry" onClick={fetchTodos}>
            重试
          </button>
        </div>
      ) : todos.length === 0 ? (
        <div className="todo-plan-list" data-testid="todo-plan-list">
          {(() => {
            const groups = groupByTime(EXAMPLE_TODOS)
            return groups.map(group => (
              <div key={group.title} className="todo-plan-group">
                <div className="todo-plan-group__title">{group.title}</div>
                {group.items.map(item => renderExampleItem(item))}
              </div>
            ))
          })()}
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="todo-plan-stats">
            <span className="todo-plan-stats__item todo-plan-stats__item--total">
              总计: {totalTodos}
            </span>
            <span className="todo-plan-stats__item todo-plan-stats__item--progress">
              进行中: {inProgressTodos}
            </span>
            <span className="todo-plan-stats__item todo-plan-stats__item--pending">
              待处理: {pendingTodos}
            </span>
            <span className="todo-plan-stats__item todo-plan-stats__item--completed">
              已完成: {completedTodos}
            </span>
          </div>

          {/* Todo list */}
          <div className="todo-plan-list" data-testid="todo-plan-list">
            {todos.map((todo) => renderTodoItem(todo))}
          </div>

          {/* Progress bar */}
          {totalTodos > 0 && (
            <div className="todo-plan-progress">
              <div className="todo-plan-progress__bar">
                <div
                  className="todo-plan-progress__fill"
                  style={{ width: `${(completedTodos / totalTodos) * 100}%` }}
                />
              </div>
              <span className="todo-plan-progress__label">
                {Math.round((completedTodos / totalTodos) * 100)}% 完成
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// =============================================================================
// Helper Functions
// =============================================================================

function countTodosByStatus(todos: TodoItemWithChildren[], status: string): number {
  let count = 0
  for (const todo of todos) {
    if (todo.status === status) count++
    if (todo.children) {
      count += countTodosByStatus(todo.children, status)
    }
  }
  return count
}

export default TodoWorkPlanCard
