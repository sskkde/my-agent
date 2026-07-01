import { render, screen } from '@testing-library/react'
import ChatContextPanel from './ChatContextPanel'

describe('ChatContextPanel', () => {
  it('renders work plan and desk sections with actions', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()

    expect(screen.getAllByTitle('筛选').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('添加任务')).toBeInTheDocument()
    expect(screen.getByText('放到书桌')).toBeInTheDocument()
  })

  it('renders example task list when no sessionId', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTestId('todo-plan-list')).toBeInTheDocument()
    expect(screen.getByText('审阅暖纸主题 CSS 草稿')).toBeInTheDocument()
  })

  it('renders 6 example desk items', () => {
    render(<ChatContextPanel />)
    const items = screen.getAllByTestId('chat-desk-item')
    expect(items).toHaveLength(6)
    expect(screen.getByText('暖纸主题设计规范.md')).toBeInTheDocument()
    expect(screen.getByText('theme-warm-paper.css')).toBeInTheDocument()
    expect(screen.getByText('配色方案参考')).toBeInTheDocument()
  })
})
