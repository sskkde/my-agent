import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import AdminPage from './AdminPage'

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
})
