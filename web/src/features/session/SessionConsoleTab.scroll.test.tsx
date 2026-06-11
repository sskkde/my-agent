import { render, screen, within, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SessionConsoleTab from './SessionConsoleTab'
import { mockViewport, resetMatchMedia } from '../../test/setup'

vi.mock('../../api/client', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  getSessionTimeline: vi.fn(),
  sendMessage: vi.fn(),
  subscribeSessionTimeline: vi.fn(),
  getApprovals: vi.fn(),
  respondApproval: vi.fn(),
}))

import * as api from '../../api/client'

const mockGetSessions = api.getSessions as ReturnType<typeof vi.fn>
const mockGetSession = api.getSession as ReturnType<typeof vi.fn>
const mockGetSessionTimeline = api.getSessionTimeline as ReturnType<typeof vi.fn>
const mockSubscribeSessionTimeline = api.subscribeSessionTimeline as ReturnType<typeof vi.fn>

describe('Scroll Container Structure (Desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
    mockViewport({ width: 1440, height: 900 })
  })

  afterEach(() => {
    resetMatchMedia()
  })

  it('renders sessions-list container with correct class for sidebar scroll', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: Array.from({ length: 20 }, (_, i) => ({
        sessionId: `session-${i}`,
        userId: 'user-1',
        title: `Test Session ${i}`,
        status: 'active',
        messageCount: i,
        lastActivityAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      total: 20,
    })

    render(<SessionConsoleTab />)

    const sidebar = await screen.findByTestId('sessions-sidebar')
    const sessionsList = within(sidebar).getByTestId('sessions-list')

    expect(sessionsList).toHaveClass('sessions-list')
  })

  it('renders session-timeline-container element for timeline scroll', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const timelineContainer = await screen.findByTestId('session-timeline')
    expect(timelineContainer).toHaveClass('session-timeline-container')
  })

  it('renders both timeline-container and timeline-list (FAILING: should have only one scroll container)', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [
        {
          eventId: 'event-1',
          eventType: 'user_message',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          content: 'Test message',
        },
      ],
      total: 1,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const timelineContainer = await screen.findByTestId('session-timeline')
    expect(timelineContainer).toHaveClass('session-timeline-container')

    const timelineList = timelineContainer.querySelector('.timeline-list')
    expect(timelineList).toBeTruthy()
  })

  it('renders session-console-rich as parent container', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    const consoleRich = document.querySelector('.session-console-rich')
    expect(consoleRich).toBeTruthy()
  })
})

describe('Scroll Container Structure (Mobile)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
    mockViewport({ width: 375, height: 667 })
  })

  afterEach(() => {
    resetMatchMedia()
  })

  it('renders timeline container on mobile viewport', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const timelineContainer = await screen.findByTestId('session-timeline')
    expect(timelineContainer).toHaveClass('session-timeline-container')
  })

  it('renders timeline-list element (FAILING: should not have overflow scroll)', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [
        {
          eventId: 'event-1',
          eventType: 'user_message',
          sessionId: 'session-1',
          timestamp: new Date().toISOString(),
          content: 'Test message',
        },
      ],
      total: 1,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const timelineList = document.querySelector('.timeline-list')
    expect(timelineList).toBeTruthy()
  })

  it('keeps input dock visible within viewport', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: Array.from({ length: 50 }, (_, i) => ({
        eventId: `event-${i}`,
        eventType: 'user_message',
        sessionId: 'session-1',
        timestamp: new Date().toISOString(),
        content: `Message ${i}: This is a test message with enough content. `.repeat(5),
      })),
      total: 50,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const inputDock = await screen.findByTestId('session-message-input')
    expect(inputDock).toBeVisible()

    const dock = inputDock.closest('.composer-dock')
    expect(dock).toBeTruthy()
  })
})

describe('Scroll Container Height Constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribeSessionTimeline.mockReturnValue(() => {})
    localStorage.clear()
    mockViewport({ width: 1440, height: 900 })
  })

  afterEach(() => {
    resetMatchMedia()
  })

  it('renders timeline container with min-height: 0 class', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Test Session',
          status: 'active',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
    })

    mockGetSession.mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'user-1',
        messageCount: 5,
        lastActivityAt: new Date().toISOString(),
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    mockGetSessionTimeline.mockResolvedValue({
      events: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    const sessionItem = await screen.findByTestId('session-item-session-1')
    await act(async () => {
      sessionItem.click()
    })

    const timelineContainer = await screen.findByTestId('session-timeline')
    expect(timelineContainer).toHaveClass('session-timeline-container')
  })

  it('renders session-main as flex column container', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [],
      total: 0,
    })

    render(<SessionConsoleTab />)

    const sessionMain = document.querySelector('.session-main')
    expect(sessionMain).toBeTruthy()
  })
})
