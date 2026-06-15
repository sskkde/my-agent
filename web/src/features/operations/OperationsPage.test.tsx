import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import OperationsPage from './OperationsPage'

// Mock the tab components
vi.mock('../monitor/AgentMonitorTab', () => ({
  default: () => <div data-testid="agent-monitor-tab">Agent Monitor Content</div>,
}))

vi.mock('../skills/SkillsTab', () => ({
  default: () => <div data-testid="skills-tab">Skills Content</div>,
}))

vi.mock('../agents/AgentsTab', () => ({
  default: () => <div data-testid="agents-tab">Agents Content</div>,
}))

vi.mock('../connectors/ConnectorsTab', () => ({
  default: () => <div data-testid="connectors-tab">Connectors Content</div>,
}))

vi.mock('../dlq/DLQTab', () => ({
  default: () => <div data-testid="dlq-tab">DLQ Content</div>,
}))

describe('OperationsPage', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    mockOnTabChange.mockClear()
  })

  it('renders with container-page-operations test ID', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('container-page-operations')).toBeInTheDocument()
  })

  it('renders the selected tab component based on activeTab', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('agent-monitor-tab')).toBeInTheDocument()
  })

  it('changes displayed tab when activeTab prop changes', () => {
    const { rerender } = render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('agent-monitor-tab')).toBeInTheDocument()

    rerender(<OperationsPage activeTab="skills" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('skills-tab')).toBeInTheDocument()
  })
})
