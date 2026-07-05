import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../../../api/client'
import ChatContextPanel from './ChatContextPanel'

vi.mock('../../../api/client')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
  vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })
  vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '' })
})

describe('ChatContextPanel', () => {
  it('renders work plan and desk titles', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
  })

  it('renders TodoWorkPlanCard and DeskWorkdirCard', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTestId('todo-work-plan-card')).toBeInTheDocument()
    expect(screen.getByTestId('desk-workdir-card')).toBeInTheDocument()
  })

  it('does not render 放到书桌 button at ChatContextPanel level (it lives inside DeskWorkdirCard)', () => {
    render(<ChatContextPanel />)
    expect(screen.queryByText('放到书桌')).not.toBeInTheDocument()
  })

  it('does not render 筛选 button', () => {
    render(<ChatContextPanel />)
    expect(screen.queryAllByTitle('筛选')).toHaveLength(0)
  })

  it('does not render example desk items', () => {
    render(<ChatContextPanel />)
    expect(screen.queryByText('暖纸主题设计规范.md')).not.toBeInTheDocument()
    expect(screen.queryByText('theme-warm-paper.css')).not.toBeInTheDocument()
  })
})
