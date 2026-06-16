import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TodosTab from './TodosTab'
import * as client from '../../api/client'

vi.mock('../../api/client')

// =============================================================================
// Test session ID for session-scoped API calls
// =============================================================================

const TEST_SESSION_ID = 'ses_todos_test'

// =============================================================================
// Sample test data for depth-3 nested todos (FLAT representation)
// The API returns flat todos with parentTodoId; the component builds the tree
// =============================================================================

const createFlatTodoList = () => {
  // Return flat list of todos with parentTodoId - no children arrays
  return [
    // Grandchildren (depth 3)
    {
      todoId: 'todo-gc1',
      sessionId: TEST_SESSION_ID,
      parentTodoId: 'todo-c1',
      position: 0,
      status: 'pending' as const,
      priority: 'medium' as const,
      content: 'Grandchild task 1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      todoId: 'todo-gc2',
      sessionId: TEST_SESSION_ID,
      parentTodoId: 'todo-c1',
      position: 1,
      status: 'completed' as const,
      priority: 'low' as const,
      content: 'Grandchild task 2',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    // Children (depth 2)
    {
      todoId: 'todo-c1',
      sessionId: TEST_SESSION_ID,
      parentTodoId: 'todo-p1',
      position: 0,
      status: 'in_progress' as const,
      priority: 'high' as const,
      content: 'Child task 1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      todoId: 'todo-c2',
      sessionId: TEST_SESSION_ID,
      parentTodoId: 'todo-p1',
      position: 1,
      status: 'pending' as const,
      priority: 'medium' as const,
      content: 'Child task 2',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    // Parents (depth 1)
    {
      todoId: 'todo-p1',
      sessionId: TEST_SESSION_ID,
      parentTodoId: null,
      position: 0,
      status: 'pending' as const,
      priority: 'high' as const,
      content: 'Parent task 1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      todoId: 'todo-p2',
      sessionId: TEST_SESSION_ID,
      parentTodoId: null,
      position: 1,
      status: 'completed' as const,
      priority: 'low' as const,
      content: 'Parent task 2',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
  ]
}

describe('TodosTab', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ===========================================================================
  // Basic rendering tests
  // ===========================================================================

  it('renders todos panel with header', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({
      todos: [],
      total: 0,
    })

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByTestId('todos-panel')).toBeInTheDocument()
    })
  })

  it('shows loading state while fetching todos', async () => {
    vi.mocked(client.listTodos).mockImplementation(() => new Promise(() => {}))

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('shows error state when API fails', async () => {
    vi.mocked(client.listTodos).mockRejectedValue(new Error('Failed to load todos'))

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument()
    })
  })

  it('shows empty state when no todos exist', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({
      todos: [],
      total: 0,
    })

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText(/暂无待办事项/)).toBeInTheDocument()
    })
  })

  // ===========================================================================
  // Todo list rendering tests
  // ===========================================================================

  it('renders flat todo list with items', async () => {
    const todos = [
      {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Test todo 1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        todoId: 'todo-2',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 1,
        status: 'in_progress' as const,
        priority: 'medium' as const,
        content: 'Test todo 2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]

    vi.mocked(client.listTodos).mockResolvedValue({
      todos,
      total: 2,
    })

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('todo-row-todo-2')).toBeInTheDocument()
  })

  it('renders nested todos up to depth 3 (parent, child, grandchild)', async () => {
    const todos = createFlatTodoList()

    vi.mocked(client.listTodos).mockResolvedValue({
      todos,
      total: 6,
    })

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    // Wait for parent level
    await waitFor(() => {
      expect(screen.getByTestId('todo-row-todo-p1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('todo-row-todo-p2')).toBeInTheDocument()

    // Check child level exists
    await waitFor(() => {
      expect(screen.getByTestId('todo-row-todo-c1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('todo-row-todo-c2')).toBeInTheDocument()

    // Check grandchild level exists
    await waitFor(() => {
      expect(screen.getByTestId('todo-row-todo-gc1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('todo-row-todo-gc2')).toBeInTheDocument()
  })

  it('does not render todos deeper than depth 3', async () => {
    const todos = [
      {
        todoId: 'todo-p1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Parent task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        todoId: 'todo-c1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: 'todo-p1',
        position: 0,
        status: 'in_progress' as const,
        priority: 'high' as const,
        content: 'Child task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        todoId: 'todo-gc1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: 'todo-c1',
        position: 0,
        status: 'pending' as const,
        priority: 'medium' as const,
        content: 'Grandchild task',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
      {
        todoId: 'todo-ggc1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: 'todo-gc1',
        position: 0,
        status: 'pending' as const,
        priority: 'low' as const,
        content: 'Great grandchild (should not render)',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    ]

    vi.mocked(client.listTodos).mockResolvedValue({
      todos,
      total: 4,
    })

    render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

    // Parent, child, grandchild should render
    await waitFor(() => {
      expect(screen.getByTestId('todo-row-todo-p1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('todo-row-todo-c1')).toBeInTheDocument()
    expect(screen.getByTestId('todo-row-todo-gc1')).toBeInTheDocument()

    // Great grandchild should NOT render (max depth 3)
    expect(screen.queryByTestId('todo-row-todo-ggc1')).not.toBeInTheDocument()
  })

  // ===========================================================================
  // Status badge tests
  // ===========================================================================

  describe('Status badges', () => {
    it('displays pending status badge', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'pending' as const,
          priority: 'high' as const,
          content: 'Pending todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        const statusBadge = screen.getByTestId('todo-status-todo-1')
        expect(statusBadge).toBeInTheDocument()
        expect(statusBadge).toHaveTextContent('待处理')
      })
    })

    it('displays in_progress status badge', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'in_progress' as const,
          priority: 'high' as const,
          content: 'In progress todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        const statusBadge = screen.getByTestId('todo-status-todo-1')
        expect(statusBadge).toBeInTheDocument()
        expect(statusBadge).toHaveTextContent('进行中')
      })
    })

    it('displays completed status badge', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'completed' as const,
          priority: 'high' as const,
          content: 'Completed todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        const statusBadge = screen.getByTestId('todo-status-todo-1')
        expect(statusBadge).toBeInTheDocument()
        expect(statusBadge).toHaveTextContent('已完成')
      })
    })

    it('displays cancelled status badge', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'cancelled' as const,
          priority: 'high' as const,
          content: 'Cancelled todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        const statusBadge = screen.getByTestId('todo-status-todo-1')
        expect(statusBadge).toBeInTheDocument()
        expect(statusBadge).toHaveTextContent('已取消')
      })
    })

    it('applies correct CSS class for each status', async () => {
      const todos = [
        {
          todoId: 'todo-pending',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'pending' as const,
          priority: 'high' as const,
          content: 'Pending',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          todoId: 'todo-in-progress',
          sessionId: TEST_SESSION_ID,
          
          position: 1,
          status: 'in_progress' as const,
          priority: 'medium' as const,
          content: 'In Progress',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          todoId: 'todo-completed',
          sessionId: TEST_SESSION_ID,
          
          position: 2,
          status: 'completed' as const,
          priority: 'low' as const,
          content: 'Completed',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          todoId: 'todo-cancelled',
          sessionId: TEST_SESSION_ID,
          
          position: 3,
          status: 'cancelled' as const,
          priority: 'low' as const,
          content: 'Cancelled',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 4 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-status-todo-pending')).toHaveClass('status-pending')
      })
      expect(screen.getByTestId('todo-status-todo-in-progress')).toHaveClass('status-in-progress')
      expect(screen.getByTestId('todo-status-todo-completed')).toHaveClass('status-completed')
      expect(screen.getByTestId('todo-status-todo-cancelled')).toHaveClass('status-cancelled')
    })
  })

  // ===========================================================================
  // Priority display tests
  // ===========================================================================

  describe('Priority display', () => {
    it('displays high priority indicator', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'pending' as const,
          priority: 'high' as const,
          content: 'High priority todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-priority-todo-1')).toBeInTheDocument()
        expect(screen.getByTestId('todo-priority-todo-1')).toHaveTextContent('高')
      })
    })

    it('displays medium priority indicator', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'pending' as const,
          priority: 'medium' as const,
          content: 'Medium priority todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-priority-todo-1')).toBeInTheDocument()
        expect(screen.getByTestId('todo-priority-todo-1')).toHaveTextContent('中')
      })
    })

    it('displays low priority indicator', async () => {
      const todos = [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          
          position: 0,
          status: 'pending' as const,
          priority: 'low' as const,
          content: 'Low priority todo',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(client.listTodos).mockResolvedValue({ todos, total: 1 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-priority-todo-1')).toBeInTheDocument()
        expect(screen.getByTestId('todo-priority-todo-1')).toHaveTextContent('低')
      })
    })
  })

  // ===========================================================================
  // Create todo tests
  // ===========================================================================

  describe('Create todo', () => {
    it('shows create todo button', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-btn')).toBeInTheDocument()
      })
    })

    it('opens create todo form when button clicked', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('todo-create-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })
    })

    it('creates a new todo via API', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
      vi.mocked(client.createSessionTodo).mockResolvedValue({
        todo: {
          todoId: 'new-todo-1',
          sessionId: TEST_SESSION_ID,
          parentTodoId: null,
          position: 0,
          status: 'pending',
          priority: 'medium',
          content: 'New todo item',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('todo-create-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })

      // Fill in the form
      const contentInput = screen.getByTestId('todo-content-input')
      fireEvent.change(contentInput, { target: { value: 'New todo item' } })

      // Submit
      fireEvent.click(screen.getByTestId('todo-submit-btn'))

      await waitFor(() => {
        expect(client.createSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, {
          content: 'New todo item',
          priority: 'medium',
          parentTodoId: undefined,
        })
      })
    })

    it('creates a child todo with parent reference', async () => {
      const parentTodo = {
        todoId: 'parent-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Parent todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [parentTodo], total: 1 })
      vi.mocked(client.createSessionTodo).mockResolvedValue({
        todo: {
          todoId: 'child-1',
          sessionId: TEST_SESSION_ID,
          parentTodoId: 'parent-1',
          position: 0,
          status: 'pending',
          priority: 'medium',
          content: 'Child todo item',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-parent-1')).toBeInTheDocument()
      })

      // Click add child button on parent
      fireEvent.click(screen.getByTestId('todo-add-child-parent-1'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })

      // Fill in the form
      const contentInput = screen.getByTestId('todo-content-input')
      fireEvent.change(contentInput, { target: { value: 'Child todo item' } })

      // Submit
      fireEvent.click(screen.getByTestId('todo-submit-btn'))

      await waitFor(() => {
        expect(client.createSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, {
          content: 'Child todo item',
          priority: 'medium',
          parentTodoId: 'parent-1',
        })
      })
    })
  })

  // ===========================================================================
  // Update todo tests
  // ===========================================================================

  describe('Update todo', () => {
    it('updates todo status to in_progress', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Test todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [todo], total: 1 })
      vi.mocked(client.updateSessionTodo).mockResolvedValue({
        todo: {
          ...todo,
          status: 'in_progress',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      // Click status toggle button
      fireEvent.click(screen.getByTestId('todo-status-toggle-todo-1'))

      await waitFor(() => {
        expect(client.updateSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'todo-1', { status: 'in_progress' })
      })
    })

    it('updates todo status to completed', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'in_progress' as const,
        priority: 'high' as const,
        content: 'Test todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [todo], total: 1 })
      vi.mocked(client.updateSessionTodo).mockResolvedValue({
        todo: {
          ...todo,
          status: 'completed',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      // Click complete button
      fireEvent.click(screen.getByTestId('todo-complete-btn-todo-1'))

      await waitFor(() => {
        expect(client.updateSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'todo-1', { status: 'completed' })
      })
    })

    it('updates todo content via edit', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Original content',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [todo], total: 1 })
      vi.mocked(client.updateSessionTodo).mockResolvedValue({
        todo: {
          ...todo,
          content: 'Updated content',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      // Click edit button
      fireEvent.click(screen.getByTestId('todo-edit-btn-todo-1'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-edit-form-todo-1')).toBeInTheDocument()
      })

      // Update content
      const contentInput = screen.getByTestId('todo-edit-content-input-todo-1')
      fireEvent.change(contentInput, { target: { value: 'Updated content' } })

      // Save
      fireEvent.click(screen.getByTestId('todo-save-btn-todo-1'))

      await waitFor(() => {
        expect(client.updateSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'todo-1', { content: 'Updated content' })
      })
    })

    it('updates todo priority', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'medium' as const,
        content: 'Test todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [todo], total: 1 })
      vi.mocked(client.updateSessionTodo).mockResolvedValue({
        todo: {
          ...todo,
          priority: 'high',
          updatedAt: '2024-01-02T00:00:00Z',
        },
      })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      // Open priority dropdown
      fireEvent.click(screen.getByTestId('todo-priority-select-todo-1'))

      // Select high priority
      fireEvent.click(screen.getByText('高'))

      await waitFor(() => {
        expect(client.updateSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'todo-1', { priority: 'high' })
      })
    })
  })

  // ===========================================================================
  // Delete todo tests
  // ===========================================================================

  describe('Delete todo', () => {
    it('deletes a todo', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Test todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValueOnce({ todos: [todo], total: 1 })
      vi.mocked(client.listTodos).mockResolvedValueOnce({ todos: [], total: 0 })
      vi.mocked(client.deleteSessionTodo).mockResolvedValue({ success: true })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      // Click delete button
      fireEvent.click(screen.getByTestId('todo-delete-btn-todo-1'))

      // Confirm deletion
      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-btn')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('confirm-delete-btn'))

      await waitFor(() => {
        expect(client.deleteSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'todo-1')
      })
    })

    it('cascades delete to children when parent deleted', async () => {
      const child = {
        todoId: 'child-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: 'parent-1',
        position: 0,
        status: 'pending' as const,
        priority: 'medium' as const,
        content: 'Child todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const parent = {
        todoId: 'parent-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Parent todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValueOnce({ todos: [parent, child], total: 2 })
      vi.mocked(client.listTodos).mockResolvedValueOnce({ todos: [], total: 0 })
      vi.mocked(client.deleteSessionTodo).mockResolvedValue({ success: true })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-parent-1')).toBeInTheDocument()
      })
      expect(screen.getByTestId('todo-row-child-1')).toBeInTheDocument()

      // Delete parent
      fireEvent.click(screen.getByTestId('todo-delete-btn-parent-1'))

      await waitFor(() => {
        expect(screen.getByTestId('confirm-delete-btn')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByTestId('confirm-delete-btn'))

      await waitFor(() => {
        expect(client.deleteSessionTodo).toHaveBeenCalledWith(TEST_SESSION_ID, 'parent-1')
      })
    })
  })

  // ===========================================================================
  // Tab navigation tests
  // ===========================================================================

  describe('Tab navigation', () => {
    it('renders within tab panel structure', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todos-panel')).toBeInTheDocument()
      })
    })

    it('provides navigation to session console', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todos-panel')).toBeInTheDocument()
      })

      // Check for quick action button if present
      const openSessionBtn = screen.queryByTestId('todos-open-session')
      if (openSessionBtn) {
        fireEvent.click(openSessionBtn)
        expect(mockOnTabChange).toHaveBeenCalledWith('session-console')
      }
    })
  })

  // ===========================================================================
  // Error handling tests
  // ===========================================================================

  describe('Error handling', () => {
    it('shows error toast when create fails', async () => {
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
      vi.mocked(client.createSessionTodo).mockRejectedValue(new Error('Create failed'))

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-btn')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('todo-create-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })

      const contentInput = screen.getByTestId('todo-content-input')
      fireEvent.change(contentInput, { target: { value: 'New todo' } })

      fireEvent.click(screen.getByTestId('todo-submit-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })
    })

    it('shows error toast when update fails', async () => {
      const todo = {
        todoId: 'todo-1',
        sessionId: TEST_SESSION_ID,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Test todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [todo], total: 1 })
      vi.mocked(client.updateSessionTodo).mockRejectedValue(new Error('Update failed'))

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('todo-status-toggle-todo-1'))

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })
    })

    it('shows retry button on API error', async () => {
      vi.mocked(client.listTodos).mockRejectedValue(new Error('API error'))

      render(<TodosTab onTabChange={mockOnTabChange} sessionId={TEST_SESSION_ID} />)

      await waitFor(() => {
        expect(screen.getByTestId('error-message')).toBeInTheDocument()
      })

      // Check for retry button
      const retryBtn = screen.getByTestId('error-retry-btn')
      expect(retryBtn).toBeInTheDocument()

      // Click retry
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
      fireEvent.click(retryBtn)

      await waitFor(() => {
        expect(screen.getByTestId('todos-panel')).toBeInTheDocument()
      })
    })
  })

  // ===========================================================================
  // Session switching tests
  // ===========================================================================

  describe('Session switching', () => {
    it('calls listTodos with new session when sessionId changes', async () => {
      const oldSessionId = 'ses_old'
      const newSessionId = 'ses_new'

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      const { rerender } = render(
        <TodosTab onTabChange={mockOnTabChange} sessionId={oldSessionId} />
      )

      await waitFor(() => {
        expect(client.listTodos).toHaveBeenCalledWith(oldSessionId)
      })

      vi.clearAllMocks()
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      rerender(<TodosTab onTabChange={mockOnTabChange} sessionId={newSessionId} />)

      await waitFor(() => {
        expect(client.listTodos).toHaveBeenCalledWith(newSessionId)
      })
    })

    it('prevents stale response from overwriting active session UI', async () => {
      const oldSessionId = 'ses_old'
      const newSessionId = 'ses_new'

      const oldTodo = {
        todoId: 'todo-old',
        sessionId: oldSessionId,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'Old session todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const newTodo = {
        todoId: 'todo-new',
        sessionId: newSessionId,
        parentTodoId: null,
        position: 0,
        status: 'pending' as const,
        priority: 'high' as const,
        content: 'New session todo',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      // Create promises we can control
      let resolveOldPromise: (value: any) => void
      let resolveNewPromise: (value: any) => void

      const oldPromise = new Promise((resolve) => {
        resolveOldPromise = resolve
      })

      const newPromise = new Promise((resolve) => {
        resolveNewPromise = resolve
      })

      // First render with old session
      vi.mocked(client.listTodos).mockReturnValueOnce(oldPromise as any)

      const { rerender } = render(
        <TodosTab onTabChange={mockOnTabChange} sessionId={oldSessionId} />
      )

      // Switch to new session
      vi.mocked(client.listTodos).mockReturnValueOnce(newPromise as any)
      rerender(<TodosTab onTabChange={mockOnTabChange} sessionId={newSessionId} />)

      // Resolve new session first (it should update UI)
      await act(async () => {
        resolveNewPromise!({ todos: [newTodo], total: 1 })
      })

      await waitFor(() => {
        expect(screen.getByTestId('todo-row-todo-new')).toBeInTheDocument()
      })

      // Now resolve old session (it should NOT update UI due to stale guard)
      await act(async () => {
        resolveOldPromise!({ todos: [oldTodo], total: 1 })
        // Wait a bit for any potential state update
        await new Promise((resolve) => setTimeout(resolve, 100))
      })

      // UI should still show new session todo, not old session todo
      expect(screen.queryByTestId('todo-row-todo-old')).not.toBeInTheDocument()
      expect(screen.getByTestId('todo-row-todo-new')).toBeInTheDocument()
    })

    it('resets create form state when session changes', async () => {
      const oldSessionId = 'ses_old'
      const newSessionId = 'ses_new'

      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      const { rerender } = render(
        <TodosTab onTabChange={mockOnTabChange} sessionId={oldSessionId} />
      )

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-btn')).toBeInTheDocument()
      })

      // Open create form
      fireEvent.click(screen.getByTestId('todo-create-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })

      // Type content
      const contentInput = screen.getByTestId('todo-content-input')
      fireEvent.change(contentInput, { target: { value: 'Test content' } })
      expect(contentInput).toHaveValue('Test content')

      // Switch session
      vi.clearAllMocks()
      vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

      rerender(<TodosTab onTabChange={mockOnTabChange} sessionId={newSessionId} />)

      await waitFor(() => {
        expect(client.listTodos).toHaveBeenCalledWith(newSessionId)
      })

      // Form should be reset (closed)
      expect(screen.queryByTestId('todo-create-form')).not.toBeInTheDocument()

      // Open form again and verify content is reset
      fireEvent.click(screen.getByTestId('todo-create-btn'))

      await waitFor(() => {
        expect(screen.getByTestId('todo-create-form')).toBeInTheDocument()
      })

      const newContentInput = screen.getByTestId('todo-content-input')
      expect(newContentInput).toHaveValue('')
    })
  })
})
