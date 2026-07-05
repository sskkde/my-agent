import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TodoWorkPlanCard from './TodoWorkPlanCard'
import * as client from '../../api/client'

vi.mock('../../api/client')

const TEST_SESSION_ID = 'ses_plan_test'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TodoWorkPlanCard', () => {
  it('fetches todos with ownerAgentId=planner by default', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(client.listTodos).toHaveBeenCalledWith(TEST_SESSION_ID, 'planner')
    })
  })

  it('renders empty state when planner has no todos', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无工作计划')).toBeInTheDocument()
    })
    expect(screen.queryByText('审阅暖纸主题 CSS 草稿')).not.toBeInTheDocument()
  })

  it('renders todo tree when planner has todos', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({
      todos: [
        {
          todoId: 'todo-1',
          sessionId: TEST_SESSION_ID,
          content: '分析需求文档',
          status: 'in_progress',
          priority: 'high',
          parentTodoId: null,
          position: 0,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
    })

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByTestId('todo-plan-item-todo-1')).toBeInTheDocument()
    })
    expect(screen.getByText('分析需求文档')).toBeInTheDocument()
  })

  it('does not call listTodos when sessionId is null', async () => {
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })

    render(<TodoWorkPlanCard sessionId={null} />)

    expect(client.listTodos).not.toHaveBeenCalled()
  })

  it('renders loading state while fetching', async () => {
    vi.mocked(client.listTodos).mockImplementation(() => new Promise(() => {}))

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('renders error state with retry button when fetch fails', async () => {
    vi.mocked(client.listTodos).mockRejectedValue(new Error('Failed to load todos'))

    render(<TodoWorkPlanCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('重试')).toBeInTheDocument()
  })
})
