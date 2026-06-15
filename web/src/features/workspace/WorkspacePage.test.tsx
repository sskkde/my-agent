import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import WorkspacePage from './WorkspacePage'
import type { TabId } from '../../navigation/navigation-config'

// Mock the tab components
vi.mock('../dashboard/DashboardTab', () => ({
  default: () => <div data-testid="dashboard-tab">Dashboard Content</div>,
}))

vi.mock('../sessions/SessionsTab', () => ({
  default: () => <div data-testid="sessions-tab">Sessions Content</div>,
}))

vi.mock('../usage/UsageTab', () => ({
  default: () => <div data-testid="usage-tab">Usage Content</div>,
}))

vi.mock('../workflows/WorkflowsTab', () => ({
  default: () => <div data-testid="workflows-tab">Workflows Content</div>,
}))

vi.mock('../approvals/ApprovalsTab', () => ({
  default: ({ onTabChange }: { onTabChange?: (tab: TabId) => void }) => (
    <div data-testid="approvals-tab">
      Approvals Content
      <button onClick={() => onTabChange?.('agent-monitor')}>Go to Monitor</button>
    </div>
  ),
}))

describe('WorkspacePage', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    mockOnTabChange.mockClear()
  })

  it('renders with container-page-workspace test ID', () => {
    render(<WorkspacePage activeTab="dashboard" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('container-page-workspace')).toBeInTheDocument()
  })

  it('renders the selected tab component based on activeTab', () => {
    render(<WorkspacePage activeTab="dashboard" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('dashboard-tab')).toBeInTheDocument()
  })

  it('changes displayed tab when activeTab prop changes', () => {
    const { rerender } = render(<WorkspacePage activeTab="dashboard" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('dashboard-tab')).toBeInTheDocument()

    rerender(<WorkspacePage activeTab="sessions" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('sessions-tab')).toBeInTheDocument()
  })

  it('passes onTabChange to tab components that need it', () => {
    render(<WorkspacePage activeTab="approvals" onTabChange={mockOnTabChange} />)

    const button = screen.getByText('Go to Monitor')
    fireEvent.click(button)
    expect(mockOnTabChange).toHaveBeenCalledWith('agent-monitor')
  })
})
