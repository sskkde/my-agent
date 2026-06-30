import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserHandoffPanel } from './BrowserHandoffPanel'
import type { BrowserStreamEvent } from '../api/types'

const mockGetBrowserStatus = vi.fn()
const mockAcquireTakeover = vi.fn()
const mockReleaseTakeover = vi.fn()
const mockSendInput = vi.fn()
const mockUnsubscribe = vi.fn()
let frameCallback: ((event: BrowserStreamEvent) => void) | null = null
let errorCallback: ((error: Error) => void) | null = null

const mockSubscribeToFrames = vi.fn((sessionId: string, onEvent: (event: BrowserStreamEvent) => void, onError?: (error: Error) => void) => {
  frameCallback = onEvent
  errorCallback = onError ?? null
  return mockUnsubscribe
})

vi.mock('../api/client', () => ({
  getBrowserStatus: (...args: unknown[]) => mockGetBrowserStatus(...args),
  acquireTakeover: (...args: unknown[]) => mockAcquireTakeover(...args),
  releaseTakeover: (...args: unknown[]) => mockReleaseTakeover(...args),
  sendInput: (...args: unknown[]) => mockSendInput(...args),
  subscribeToFrames: (...args: unknown[]) => mockSubscribeToFrames(...args),
}))

const makeStatus = (state: 'idle' | 'agent_controlled' | 'user_controlled' | 'handoff_requested') => ({
  sessionId: 'session-1',
  state,
  url: null,
  lastActivityAt: null,
  viewport: { width: 1280, height: 720 },
})

const base64Pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const mockBlob = vi.fn()
const mockCreateObjectURL = vi.fn(() => 'blob:mock-frame-url-1')
const mockRevokeObjectURL = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  frameCallback = null
  errorCallback = null
  mockGetBrowserStatus.mockResolvedValue(makeStatus('idle'))
  globalThis.URL.createObjectURL = mockCreateObjectURL
  globalThis.URL.revokeObjectURL = mockRevokeObjectURL
  globalThis.Blob = mockBlob as unknown as typeof Blob
  mockBlob.mockImplementation((parts: BlobPart[]) => ({ parts } as unknown as Blob))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BrowserHandoffPanel', () => {
  it('shows loading spinner initially', async () => {
    render(<BrowserHandoffPanel sessionId="session-1" />)
    expect(screen.getByTestId('browser-handoff')).toHaveClass('browser-handoff--loading')
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
    await waitFor(() => expect(mockGetBrowserStatus).toHaveBeenCalledWith('session-1'))
  })

  it('shows empty state when idle with no frame', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('idle'))
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => {
      expect(screen.getByTestId('browser-handoff')).toHaveClass('browser-handoff--empty')
    })
    expect(screen.getByText('没有活跃的浏览器会话')).toBeInTheDocument()
  })

  it('fetches and displays browser status on mount', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('agent_controlled'))
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByText('Agent 控制中')).toBeInTheDocument())
    expect(mockGetBrowserStatus).toHaveBeenCalledTimes(1)
    expect(mockGetBrowserStatus).toHaveBeenCalledWith('session-1')
  })

  it('renders frame when subscribeToFrames emits frame event', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('agent_controlled'))
    mockCreateObjectURL.mockReturnValue('blob:mock-frame-url-1')
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })

    await waitFor(() => expect(screen.getByTestId('browser-frame')).toBeInTheDocument())
    expect(screen.getByTestId('browser-frame')).toHaveAttribute('src', 'blob:mock-frame-url-1')
  })

  it('refreshes status when snapshot event is received', async () => {
    mockGetBrowserStatus
      .mockResolvedValueOnce(makeStatus('agent_controlled'))
      .mockResolvedValueOnce(makeStatus('handoff_requested'))
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'snapshot',
      state: 'handoff_requested',
      url: null,
      timestamp: new Date().toISOString(),
    })

    await waitFor(() => expect(mockGetBrowserStatus).toHaveBeenCalledTimes(2))
  })

  it('shows takeover button in agent_controlled state and calls acquireTakeover', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('agent_controlled'))
    mockAcquireTakeover.mockResolvedValue({ sessionId: 'session-1', state: 'user_controlled', previousState: 'agent_controlled' })
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByTestId('takeover-btn')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('takeover-btn'))

    await waitFor(() => expect(mockAcquireTakeover).toHaveBeenCalledWith('session-1'))
    await waitFor(() => expect(screen.getByText('你已接管')).toBeInTheDocument())
  })

  it('shows release button in user_controlled state and calls releaseTakeover', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockReleaseTakeover.mockResolvedValue({ sessionId: 'session-1', state: 'idle', previousState: 'user_controlled' })
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByTestId('release-btn')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('release-btn'))

    await waitFor(() => expect(mockReleaseTakeover).toHaveBeenCalledWith('session-1'))
  })

  it('sends normalized click coordinates when user has lease', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockSendInput.mockResolvedValue({ success: true })
    mockCreateObjectURL.mockReturnValue('blob:mock-frame-url-1')
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })

    const frame = await waitFor(() => screen.getByTestId('browser-frame'))
    const rect = { left: 100, top: 100, width: 200, height: 150 }
    frame.getBoundingClientRect = vi.fn(() => rect as DOMRect)

    fireEvent.click(frame, { clientX: 150, clientY: 125 })

    await waitFor(() =>
      expect(mockSendInput).toHaveBeenCalledWith('session-1', {
        action: 'click',
        payload: { x: 0.25, y: (1 / 6), button: 'left', clickCount: 1 },
      }),
    )
  })

  it('sends scroll input on wheel event when user has lease', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockSendInput.mockResolvedValue({ success: true })
    mockCreateObjectURL.mockReturnValue('blob:mock-frame-url-1')
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })

    const frame = await waitFor(() => screen.getByTestId('browser-frame'))
    await act(async () => {
      fireEvent.wheel(frame, { deltaX: 10, deltaY: 20 })
    })

    await waitFor(() =>
      expect(mockSendInput).toHaveBeenCalledWith('session-1', {
        action: 'scroll',
        payload: { deltaX: 10, deltaY: 20 },
      }),
    )
  })

  it('sends keypress input on keydown when user has lease', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockSendInput.mockResolvedValue({ success: true })
    mockCreateObjectURL.mockReturnValue('blob:mock-frame-url-1')
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })

    const frame = await waitFor(() => screen.getByTestId('browser-frame'))
    await act(async () => {
      fireEvent.keyDown(frame, { key: 'a', ctrlKey: true })
    })

    await waitFor(() =>
      expect(mockSendInput).toHaveBeenCalledWith('session-1', {
        action: 'keypress',
        payload: { key: 'a', modifiers: ['Control'] },
      }),
    )
  })

  it('sends text input when typing and pressing Enter', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockSendInput.mockResolvedValue({ success: true })
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByTestId('text-input')).toBeInTheDocument())

    const input = screen.getByTestId('text-input')
    fireEvent.change(input, { target: { value: 'hello world' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(mockSendInput).toHaveBeenCalledWith('session-1', {
        action: 'type',
        payload: { text: 'hello world' },
      }),
    )
  })

  it('displays error data-testid when API call fails', async () => {
    mockGetBrowserStatus.mockRejectedValue(new Error('Network failure'))
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByTestId('browser-error')).toBeInTheDocument())
    expect(screen.getByTestId('browser-error')).toHaveTextContent('Network failure')
  })

  it('shows handoff requested banner', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('handoff_requested'))
    render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(screen.getByTestId('agent-request-banner')).toBeInTheDocument())
  })

  it('revokes object URL on frame replacement and unmount', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('user_controlled'))
    mockCreateObjectURL
      .mockReturnValueOnce('blob:mock-frame-url-1')
      .mockReturnValueOnce('blob:mock-frame-url-2')
    const { unmount } = render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(frameCallback).not.toBeNull())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })
    await waitFor(() => expect(screen.getByTestId('browser-frame')).toBeInTheDocument())

    frameCallback!({
      type: 'frame',
      data: base64Pixel,
      timestamp: new Date().toISOString(),
      width: 1280,
      height: 720,
    })
    await waitFor(() => expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-frame-url-1'))

    unmount()
    await waitFor(() => expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-frame-url-2'))
  })

  it('unsubscribes from frames on unmount', async () => {
    mockGetBrowserStatus.mockResolvedValue(makeStatus('idle'))
    const { unmount } = render(<BrowserHandoffPanel sessionId="session-1" />)
    await waitFor(() => expect(mockSubscribeToFrames).toHaveBeenCalled())
    unmount()
    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})
