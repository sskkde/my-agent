import { render, screen, waitFor } from '@testing-library/react'
import ChatContextPanel from './ChatContextPanel'

describe('ChatContextPanel', () => {
  it('renders work plan and desk sections', async () => {
    render(<ChatContextPanel sessionId="s1" />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('todo-work-plan-card')).toBeInTheDocument()
    })
  })
})
