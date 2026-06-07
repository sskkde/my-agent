import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AdminPage from './AdminPage'
import type { TabId } from '../../navigation/navigation-config'

// Mock the tab components
vi.mock('../settings/SettingsTab', () => ({
  default: () => <div data-testid="settings-tab">Settings Content</div>,
}))

vi.mock('./AdminTab', () => ({
  default: () => <div data-testid="admin-tab">Admin Content</div>,
}))

describe('AdminPage', () => {
  const mockOnTabChange = vi.fn()

  beforeEach(() => {
    mockOnTabChange.mockClear()
  })

  it('renders with container-page-admin test ID', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('container-page-admin')).toBeInTheDocument()
  })

  it('renders header with Admin title', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('renders secondary nav with admin tabs', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('secondary-nav-settings')).toBeInTheDocument()
    expect(screen.getByTestId('secondary-nav-admin')).toBeInTheDocument()
  })

  it('renders the selected tab component based on activeTab', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('settings-tab')).toBeInTheDocument()
  })

  it('changes displayed tab when activeTab prop changes', () => {
    const { rerender } = render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('settings-tab')).toBeInTheDocument()

    rerender(<AdminPage activeTab="admin" onTabChange={mockOnTabChange} />)

    expect(screen.getByTestId('admin-tab')).toBeInTheDocument()
  })

  it('calls onTabChange when secondary nav tab is clicked', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    fireEvent.click(screen.getByTestId('secondary-nav-admin'))
    expect(mockOnTabChange).toHaveBeenCalledWith('admin')
  })

  it('marks the active tab in secondary nav', () => {
    render(<AdminPage activeTab="admin" onTabChange={mockOnTabChange} />)

    const activeTab = screen.getByTestId('secondary-nav-admin')
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
  })

  it('renders both admin tabs in secondary nav', () => {
    render(<AdminPage activeTab="settings" onTabChange={mockOnTabChange} />)

    // Verify both admin tabs are present
    const adminTabs = ['settings', 'admin']

    adminTabs.forEach((tabId) => {
      expect(screen.getByTestId(`secondary-nav-${tabId}`)).toBeInTheDocument()
    })
  })
})
