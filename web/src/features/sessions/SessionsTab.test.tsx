import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SessionsTab from './SessionsTab'
import * as client from '../../api/client'
import type { ConsoleSessionInfo } from '../../api/types'
import { mockViewport, resetMatchMedia } from '../../test/setup'

vi.mock('../../api/client', () => ({
  getSessions: vi.fn(),
  updateSession: vi.fn(),
}))

describe('SessionsTab', () => {
  const mockSessions: ConsoleSessionInfo[] = [
    {
      sessionId: 'session-1',
      userId: 'user-1',
      title: 'Test Session 1',
      status: 'active',
      messageCount: 10,
      lastActivityAt: '2024-01-15T10:00:00Z',
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    },
    {
      sessionId: 'session-2',
      userId: 'user-1',
      title: 'Test Session 2',
      status: 'archived',
      messageCount: 5,
      lastActivityAt: '2024-01-14T15:00:00Z',
      createdAt: '2024-01-14T14:00:00Z',
      updatedAt: '2024-01-14T15:00:00Z',
    },
    {
      sessionId: 'session-3',
      userId: 'user-1',
      title: 'Test Session 3',
      status: 'closed',
      messageCount: 3,
      lastActivityAt: '2024-01-13T08:00:00Z',
      createdAt: '2024-01-13T07:00:00Z',
      updatedAt: '2024-01-13T08:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with data-testid="sessions-panel"', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-panel')).toBeInTheDocument()
    })
  })

  it('displays status filter dropdown with data-testid', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-filter-status')).toBeInTheDocument()
    })
  })

  it('displays sessions table with data-testid', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-table')).toBeInTheDocument()
    })
  })

  it('displays session rows with correct data-testid', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
      expect(screen.getByTestId('session-row-session-2')).toBeInTheDocument()
      expect(screen.getByTestId('session-row-session-3')).toBeInTheDocument()
    })
  })

  it('displays archive buttons with correct data-testid', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      const activeRow = screen.getByTestId('session-row-session-1')
      expect(activeRow).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const archiveBtn = row?.querySelector('[data-testid="session-archive-button-session-1"]')
    expect(archiveBtn).toBeInTheDocument()
    expect(archiveBtn).toHaveTextContent('归档')
  })

  it('displays close buttons with correct data-testid', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const closeBtn = row?.querySelector('[data-testid="session-close-button-session-1"]')
    expect(closeBtn).toBeInTheDocument()
    expect(closeBtn).toHaveTextContent('关闭')
  })

  it('calls PATCH when archive button is clicked', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], status: 'archived' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const archiveBtn = row?.querySelector('[data-testid="session-archive-button-session-1"]')
    expect(archiveBtn).toBeInTheDocument()
    fireEvent.click(archiveBtn!)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'archived',
      })
    })
  })

  it('calls PATCH when close button is clicked', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], status: 'closed' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const closeBtn = row?.querySelector('[data-testid="session-close-button-session-1"]')
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn!)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'closed',
      })
    })
  })

  it('updates row state after archive action', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], status: 'archived' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    // Check for active status badge (with class)
    const row = container.querySelector('[data-testid="session-row-session-1"]')
    expect(row?.textContent).toContain('活跃')

    const archiveBtn = row?.querySelector('[data-testid="session-archive-button-session-1"]')
    expect(archiveBtn).toBeInTheDocument()
    fireEvent.click(archiveBtn!)

    await waitFor(() => {
      expect(row?.textContent).toContain('已归档')
    })
  })

  it('allows inline editing of title on click', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], title: 'Updated Title' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const titleElement = row?.querySelector('.session-title')
    expect(titleElement).toBeInTheDocument()
    fireEvent.click(titleElement!)

    await waitFor(() => {
      const updatedRow = container.querySelector('[data-testid="session-row-session-1"]')
      const input = updatedRow?.querySelector('.title-input')
      expect(input).toBeInTheDocument()
    })
  })

  it('saves title on blur', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], title: 'Updated Title' },
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('session-row-session-1')
    const titleElement = within(row).getByText('Test Session 1')
    fireEvent.click(titleElement)

    const input = await within(row).findByRole('textbox')
    fireEvent.blur(input)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalled()
    })
  })

  it('saves title on Enter key', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], title: 'Updated Title' },
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = screen.getByTestId('session-row-session-1')
    const titleElement = within(row).getByText('Test Session 1')
    fireEvent.click(titleElement)

    const input = await within(row).findByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalled()
    })
  })

  it('cancels edit on Escape key', async () => {
    mockViewport(1200)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-1')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    const titleSpan = row?.querySelector('.session-title')
    fireEvent.click(titleSpan!)

    let escapeFired = false
    await waitFor(
      () => {
        const updatedRow = container.querySelector('[data-testid="session-row-session-1"]')
        const input = updatedRow?.querySelector('.title-input')
        if (input && !escapeFired) {
          fireEvent.keyDown(input, { key: 'Escape' })
          escapeFired = true
        }
        expect(escapeFired).toBe(true)
      },
      { timeout: 1000 },
    )

    const rowElement = screen.getByTestId('session-row-session-1')
    expect(within(rowElement).getByText('Test Session 1')).toBeInTheDocument()
  })

  it('displays empty state when no sessions found', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByText('暂无符合条件的会话')).toBeInTheDocument()
    })
  })

  it('filters sessions by status', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 3,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-table')).toBeInTheDocument()
    })

    const filterSelect = screen.getByTestId('sessions-filter-status')
    fireEvent.change(filterSelect, { target: { value: 'active' } })

    await waitFor(() => {
      expect(client.getSessions).toHaveBeenCalledWith('active', 10, 0)
    })
  })

  it('displays pagination when there are more than 10 sessions', async () => {
    const manySessions: ConsoleSessionInfo[] = Array.from({ length: 25 }, (_, i) => ({
      sessionId: `session-${i + 1}`,
      userId: 'user-1',
      title: `Session ${i + 1}`,
      status: 'active',
      messageCount: i,
      lastActivityAt: '2024-01-15T10:00:00Z',
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    }))

    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: manySessions.slice(0, 10),
      total: 25,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      const pagination = document.querySelector('.sessions-pagination')
      expect(pagination).toBeInTheDocument()
      expect(pagination?.textContent).toContain('第 1 / 3 页')
      expect(pagination?.textContent).toContain('共 25 条')
    })
  })

  it('displays loading state', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    render(<SessionsTab />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('displays error state on API failure', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('displays correct session data in table', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-table')).toBeInTheDocument()
    })

    const row = container.querySelector('[data-testid="session-row-session-1"]')
    expect(row).toBeInTheDocument()
    expect(row?.textContent).toContain('Test Session 1')
    expect(row?.textContent).toContain('10')
    expect(row?.textContent).toContain('活跃')
  })

  it('hides archive button for archived sessions', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[1]],
      total: 1,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-2')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('session-archive-button-session-2')).not.toBeInTheDocument()
  })

  it('hides close button for closed sessions', async () => {
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[2]],
      total: 1,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-row-session-3')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('session-close-button-session-3')).not.toBeInTheDocument()
  })
})

describe('SessionsTab - Mobile Responsive', () => {
  const mockSessions: ConsoleSessionInfo[] = [
    {
      sessionId: 'session-1',
      userId: 'user-1',
      title: 'Test Session 1',
      status: 'active',
      messageCount: 10,
      lastActivityAt: '2024-01-15T10:00:00Z',
      createdAt: '2024-01-15T09:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
    },
    {
      sessionId: 'session-2',
      userId: 'user-1',
      title: 'Test Session 2',
      status: 'archived',
      messageCount: 5,
      lastActivityAt: '2024-01-14T15:00:00Z',
      createdAt: '2024-01-14T14:00:00Z',
      updatedAt: '2024-01-14T15:00:00Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    resetMatchMedia()
  })

  it('displays mobile card list at phone viewport (390px)', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 2,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-mobile-list')).toBeInTheDocument()
    })

    expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    expect(screen.getByTestId('session-card-session-2')).toBeInTheDocument()
  })

  it('displays mobile card list at phone viewport (480px boundary)', async () => {
    mockViewport(479)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 2,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-mobile-list')).toBeInTheDocument()
    })
  })

  it('preserves desktop table at tablet viewport (768px)', async () => {
    mockViewport(768)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 2,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-table')).toBeInTheDocument()
    })
  })

  it('preserves desktop table at desktop viewport (1200px)', async () => {
    mockViewport(1200)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: mockSessions,
      total: 2,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('sessions-table')).toBeInTheDocument()
    })
  })

  it('mobile cards display all session data fields', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    expect(card).toBeInTheDocument()
    expect(card?.textContent).toContain('Test Session 1')
    expect(card?.textContent).toContain('活跃')
    expect(card?.textContent).toContain('10')
    expect(card?.textContent).toContain('消息数')
    expect(card?.textContent).toContain('最后活动')
  })

  it('mobile cards preserve archive action button', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    const archiveBtn = card?.querySelector('[data-testid="session-archive-button-session-1"]')
    expect(archiveBtn).toBeInTheDocument()
    expect(archiveBtn).toHaveTextContent('归档')
  })

  it('mobile cards preserve close action button', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    const closeBtn = card?.querySelector('[data-testid="session-close-button-session-1"]')
    expect(closeBtn).toBeInTheDocument()
    expect(closeBtn).toHaveTextContent('关闭')
  })

  it('mobile cards hide archive button for archived sessions', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[1]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-2')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-2"]')
    const archiveBtn = card?.querySelector('[data-testid="session-archive-button-session-2"]')
    expect(archiveBtn).not.toBeInTheDocument()
  })

  it('mobile cards support inline title editing on click', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    const titleElement = card?.querySelector('.session-title')
    expect(titleElement).toBeInTheDocument()
    fireEvent.click(titleElement!)

    await waitFor(() => {
      const input = document.querySelector('.title-input')
      expect(input).toBeInTheDocument()
    })
  })

  it('mobile cards trigger archive action when clicked', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], status: 'archived' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    const archiveBtn = card?.querySelector('[data-testid="session-archive-button-session-1"]')
    expect(archiveBtn).toBeInTheDocument()
    fireEvent.click(archiveBtn!)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'archived',
      })
    })
  })

  it('mobile cards trigger close action when clicked', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [mockSessions[0]],
      total: 1,
    })
    ;(client.updateSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session: { ...mockSessions[0], status: 'closed' },
    })

    const { container } = render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByTestId('session-card-session-1')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-testid="session-card-session-1"]')
    const closeBtn = card?.querySelector('[data-testid="session-close-button-session-1"]')
    expect(closeBtn).toBeInTheDocument()
    fireEvent.click(closeBtn!)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'closed',
      })
    })
  })

  it('displays loading state on mobile viewport', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))

    render(<SessionsTab />)

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('displays error state on mobile viewport', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('displays empty state on mobile viewport', async () => {
    mockViewport(390)
    ;(client.getSessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionsTab />)

    await waitFor(() => {
      expect(screen.getByText('暂无符合条件的会话')).toBeInTheDocument()
    })
  })
})
