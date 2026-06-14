import React from 'react'
import type { TodoItemWithChildren } from '../../api/client'
import TodoItem from './TodoItem'

const MAX_DEPTH = 3

interface TodoTreeProps {
  todos: TodoItemWithChildren[]
  onStatusToggle: (todoId: string) => void
  onComplete: (todoId: string) => void
  onEdit: (todoId: string, content: string) => void
  onDelete: (todoId: string) => void
  onAddChild: (parentTodoId: string) => void
  onPriorityChange: (todoId: string, priority: 'high' | 'medium' | 'low') => void
}

const TodoTree: React.FC<TodoTreeProps> = ({
  todos,
  onStatusToggle,
  onComplete,
  onEdit,
  onDelete,
  onAddChild,
  onPriorityChange,
}) => {
  const renderChildren = (todo: TodoItemWithChildren, depth: number): React.ReactNode => {
    if (depth >= MAX_DEPTH) {
      return null
    }

    return (
      <TodoItem
        key={todo.todoId}
        todo={todo}
        depth={depth}
        onStatusToggle={onStatusToggle}
        onComplete={onComplete}
        onEdit={onEdit}
        onDelete={onDelete}
        onAddChild={onAddChild}
        onPriorityChange={onPriorityChange}
        renderChildren={renderChildren}
      />
    )
  }

  return (
    <div className="todo-tree" data-testid="todo-tree">
      {todos.map((todo) => renderChildren(todo, 0))}
    </div>
  )
}

export default TodoTree
