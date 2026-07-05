import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../../../api/client'
import ChatContextPanel from './ChatContextPanel'

vi.mock('../../../api/client')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
})

describe('ChatContextPanel', () => {
  it('renders work plan and desk sections', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
  })

  it('does not render add-task or filter placeholder buttons in work plan', () => {
    render(<ChatContextPanel />)
    expect(screen.queryByText('添加任务')).not.toBeInTheDocument()
    expect(screen.queryAllByTitle('筛选').filter(el =>
      el.closest('.chat-rs-panel--top')
    )).toHaveLength(0)
  })

  it('renders TodoWorkPlanCard', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTestId('todo-work-plan-card')).toBeInTheDocument()
  })

  it('renders 6 example desk items', () => {
    render(<ChatContextPanel />)
    const items = screen.getAllByTestId('chat-desk-item')
    expect(items).toHaveLength(6)
    expect(screen.getByText('暖纸主题设计规范.md')).toBeInTheDocument()
  })

  it('renders put-to-desk button', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTitle('筛选')).toBeInTheDocument()
    expect(screen.getByText('放到书桌')).toBeInTheDocument()
  })
})
