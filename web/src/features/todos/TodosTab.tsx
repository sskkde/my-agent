import React, { useEffect, useState, useCallback } from 'react'
import * as client from '../../api/client'
import type { TodoItemWithChildren } from '../../api/client'
import type { TabId } from '../../components/TabNav'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import TodoTree from './TodoTree'

interface TodosTabProps {
  onTabChange: (tab: TabId) => void
}

const TodosTab: React.FC<TodosTabProps> = ({ onTabChange }) => {
  const [todos, setTodos] = useState<TodoItemWithChildren[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newContent, setNewContent] = useState('')
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium')
  const [parentTodoId, setParentTodoId] = useState<string | undefined>(undefined)

  const fetchTodos = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await client.getTodos()
      setTodos(response.todos)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load todos'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTodos()
  }, [fetchTodos])

  const handleCreateTodo = async () => {
    if (!newContent.trim()) return
    try {
      await client.createTodo({
        content: newContent,
        priority: newPriority,
        parentTodoId,
      })
      setShowCreateForm(false)
      setNewContent('')
      setNewPriority('medium')
      setParentTodoId(undefined)
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create todo'))
    }
  }

  const handleStatusToggle = async (todoId: string) => {
    const todo = findTodo(todos, todoId)
    if (!todo) return
    const nextStatus = todo.status === 'pending' ? 'in_progress' : todo.status === 'in_progress' ? 'completed' : 'pending'
    try {
      await client.updateTodo(todoId, { status: nextStatus })
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update todo'))
    }
  }

  const handleComplete = async (todoId: string) => {
    try {
      await client.updateTodo(todoId, { status: 'completed' })
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to complete todo'))
    }
  }

  const handleEdit = async (todoId: string, content: string) => {
    try {
      await client.updateTodo(todoId, { content })
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update todo'))
    }
  }

  const handleDelete = async (todoId: string) => {
    try {
      await client.deleteTodo(todoId)
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to delete todo'))
    }
  }

  const handleAddChild = (parentTodoId: string) => {
    setParentTodoId(parentTodoId)
    setShowCreateForm(true)
  }

  const handlePriorityChange = async (todoId: string, priority: 'high' | 'medium' | 'low') => {
    try {
      await client.updateTodo(todoId, { priority })
      await fetchTodos()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update todo'))
    }
  }

  if (loading) {
    return <LoadingSpinner label="加载待办事项..." />
  }

  if (error) {
    return (
      <ErrorMessage
        error={error}
        retry={{
          label: '重试',
          onClick: fetchTodos,
          testId: 'error-retry-btn',
        }}
      />
    )
  }

  return (
    <div data-testid="todos-panel" className="todos-panel">
      <div className="todos-header">
        <h3>待办事项</h3>
        <button
          data-testid="todo-create-btn"
          onClick={() => {
            setParentTodoId(undefined)
            setShowCreateForm(true)
          }}
        >
          新建待办
        </button>
      </div>

      {showCreateForm && (
        <div data-testid="todo-create-form" className="todo-create-form">
          <input
            data-testid="todo-content-input"
            type="text"
            placeholder="待办内容"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as 'high' | 'medium' | 'low')}
          >
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <button data-testid="todo-submit-btn" onClick={handleCreateTodo}>
            提交
          </button>
          <button onClick={() => setShowCreateForm(false)}>取消</button>
        </div>
      )}

      {todos.length === 0 ? (
        <p className="empty-state">暂无待办事项</p>
      ) : (
        <TodoTree
          todos={todos}
          onStatusToggle={handleStatusToggle}
          onComplete={handleComplete}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
          onPriorityChange={handlePriorityChange}
        />
      )}

      <button
        data-testid="todos-open-session"
        onClick={() => onTabChange('session-console')}
      >
        打开会话控制台
      </button>
    </div>
  )
}

function findTodo(todos: TodoItemWithChildren[], todoId: string): TodoItemWithChildren | null {
  for (const todo of todos) {
    if (todo.todoId === todoId) return todo
    if (todo.children) {
      const found = findTodo(todo.children, todoId)
      if (found) return found
    }
  }
  return null
}

export default TodosTab
