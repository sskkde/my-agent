import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OperationsPage from './OperationsPage'
import type { TabId } from '../../navigation/navigation-config'

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

  it('renders header with Operations title', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    expect(screen.getByText('Operations')).toBeInTheDocument()
  })

  it('renders secondary nav with operations tabs', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('secondary-nav-agent-monitor')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-skills')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-agents')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-connectors')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-dlq')).toBeInTheDocument()
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

  it('calls onTabChange when secondary nav tab is clicked', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    fireEvent.click(screen.getByTestId('secondary-nav-connectors'))
    expect(mockOnTabChange).toHaveBeenCalledWith('connectors')
  })

  it('marks the active tab in secondary nav', () => {
    render(<OperationsPage activeTab="skills" onTabChange={mockOnTabChange} />)

    const activeTab = screen.getByTestId('secondary-nav-skills')
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
  })

  it('renders all 5 operations tabs in secondary nav', () => {
    render(<OperationsPage activeTab="agent-monitor" onTabChange={mockOnTabChange} />)

    // Verify all operations tabs are present
    const operationsTabs = ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq']

    operationsTabs.forEach((tabId) => {
      expect(screen.getByTestId(`secondary-nav-${tabId}`)).toBeInTheDocument()
    })
  })
})
