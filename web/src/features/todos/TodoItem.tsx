import React, { useState } from 'react'
import type { TodoItemWithChildren } from '../../api/client'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

const STATUS_CLASSES: Record<string, string> = {
  pending: 'status-pending',
  in_progress: 'status-in-progress',
  completed: 'status-completed',
  cancelled: 'status-cancelled',
}

const PRIORITY_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

interface TodoItemProps {
  todo: TodoItemWithChildren
  depth: number
  onStatusToggle: (todoId: string) => void
  onComplete: (todoId: string) => void
  onEdit: (todoId: string, content: string) => void
  onDelete: (todoId: string) => void
  onAddChild: (parentTodoId: string) => void
  onPriorityChange: (todoId: string, priority: 'high' | 'medium' | 'low') => void
  renderChildren: (todo: TodoItemWithChildren, depth: number) => React.ReactNode
}

const TodoItem: React.FC<TodoItemProps> = ({
  todo,
  depth,
  onStatusToggle,
  onComplete,
  onEdit,
  onDelete,
  onAddChild,
  onPriorityChange,
  renderChildren,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(todo.content)
  const [showPrioritySelect, setShowPrioritySelect] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleSaveEdit = () => {
    if (editContent.trim()) {
      onEdit(todo.todoId, editContent)
      setIsEditing(false)
    }
  }

  const handleCancelEdit = () => {
    setEditContent(todo.content)
    setIsEditing(false)
  }

  const handleConfirmDelete = () => {
    onDelete(todo.todoId)
    setShowDeleteConfirm(false)
  }

  const maxDepthReached = depth >= 3

  return (
    <div className="todo-item" style={{ marginLeft: `${depth * 16}px` }}>
      <div data-testid={`todo-row-${todo.todoId}`} className="todo-row">
        <div className="todo-main">
          <button
            data-testid={`todo-status-toggle-${todo.todoId}`}
            className={`todo-status-btn ${STATUS_CLASSES[todo.status]}`}
            onClick={() => onStatusToggle(todo.todoId)}
          >
            <span data-testid={`todo-status-${todo.todoId}`} className={STATUS_CLASSES[todo.status]}>
              {STATUS_LABELS[todo.status]}
            </span>
          </button>

          <span
            data-testid={`todo-priority-${todo.todoId}`}
            className={`todo-priority priority-${todo.priority}`}
          >
            {PRIORITY_LABELS[todo.priority]}
          </span>

          <button
            data-testid={`todo-priority-select-${todo.todoId}`}
            className="todo-priority-select-btn"
            onClick={() => setShowPrioritySelect(!showPrioritySelect)}
          >
            更改优先级
          </button>

          {showPrioritySelect && (
            <div className="priority-dropdown">
              {(['high', 'medium', 'low'] as const).map((p) => (
                <button key={p} onClick={() => {
                  onPriorityChange(todo.todoId, p)
                  setShowPrioritySelect(false)
                }}>
                  {PRIORITY_LABELS[p]}
                </button>
              ))}
            </div>
          )}

          {isEditing ? (
            <div data-testid={`todo-edit-form-${todo.todoId}`} className="todo-edit-form">
              <input
                data-testid={`todo-edit-content-input-${todo.todoId}`}
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <button data-testid={`todo-save-btn-${todo.todoId}`} onClick={handleSaveEdit}>
                保存
              </button>
              <button onClick={handleCancelEdit}>取消</button>
            </div>
          ) : (
            <span className="todo-content">{todo.content}</span>
          )}
        </div>

        <div className="todo-actions">
          {!isEditing && (
            <>
              {todo.status === 'in_progress' && (
                <button
                  data-testid={`todo-complete-btn-${todo.todoId}`}
                  onClick={() => onComplete(todo.todoId)}
                >
                  完成
                </button>
              )}
              <button
                data-testid={`todo-edit-btn-${todo.todoId}`}
                onClick={() => setIsEditing(true)}
              >
                编辑
              </button>
              <button
                data-testid={`todo-delete-btn-${todo.todoId}`}
                onClick={() => setShowDeleteConfirm(true)}
              >
                删除
              </button>
              {!maxDepthReached && (
                <button
                  data-testid={`todo-add-child-${todo.todoId}`}
                  onClick={() => onAddChild(todo.todoId)}
                >
                  添加子任务
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="delete-confirm-modal">
          <p>确定要删除这个任务吗？</p>
          <button data-testid="confirm-delete-btn" onClick={handleConfirmDelete}>
            确认删除
          </button>
          <button onClick={() => setShowDeleteConfirm(false)}>取消</button>
        </div>
      )}

      {todo.children && todo.children.length > 0 && !maxDepthReached && (
        <div className="todo-children">
          {todo.children.map((child) => renderChildren(child, depth + 1))}
        </div>
      )}
    </div>
  )
}

export default TodoItem
