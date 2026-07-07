import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import ChatPage from './ChatPage'
import { AuthProvider } from '../../../context/AuthContext'
import * as client from '../../../api/client'
import type { ProcessingStatusPayload } from '../../../api/types'

vi.mock('../../../api/client')

describe('ChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(client.getMe).mockResolvedValue({
      user: {
        userId: 'test-user-id',
        username: 'testuser',
        createdAt: '2024-01-01T00:00:00Z',
      },
    })
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false })
    vi.mocked(client.getSessions).mockResolvedValue({
      sessions: [
        {
          sessionId: 'session-1',
          userId: 'test-user-id',
          title: 'Session session-1',
          status: 'active',
          messageCount: 0,
          lastActivityAt: '2024-01-01T00:00:00Z',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
    })
    vi.mocked(client.getSession).mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'test-user-id',
        messageCount: 0,
        lastActivityAt: '2024-01-01T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    vi.mocked(client.getSessionTimeline).mockResolvedValue({ events: [], total: 0 })
    vi.mocked(client.subscribeSessionTimeline).mockImplementation((_sessionId, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
      onOpen?.()
      return () => {}
    })
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })
  })

  it('renders chat shell', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
  })

  it('renders processing status from the session SSE stream', async () => {
    let statusCallback: ((status: ProcessingStatusPayload) => void) | undefined
    vi.mocked(client.subscribeSessionTimeline).mockImplementation((_sessionId, _onEvent, _onError, onStatus, _onToken, onOpen) => {
      statusCallback = onStatus
      onOpen?.()
      return () => {}
    })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalledWith(
      'session-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ))

    const status: ProcessingStatusPayload = {
      sessionId: 'session-1',
      attemptId: 'attempt-1',
      stage: 'model_call',
      stageLabel: '模型调用',
      providerId: 'openai',
      model: 'gpt-4.1',
      contextUsage: {
        inputTokens: 20,
        outputTokens: 10,
        totalTokens: 30,
        maxContextTokens: 100,
      },
      activeTools: [],
      timestamp: '2024-01-01T00:00:00Z',
    }

    act(() => {
      statusCallback?.(status)
    })

    await waitFor(() => {
      expect(screen.getByTestId('chat-status-bar')).toHaveTextContent('gpt-4.1')
      expect(screen.getByTestId('chat-status-bar')).toHaveTextContent('模型调用')
      expect(screen.getByTestId('chat-ctx-pct')).toHaveTextContent('30%')
    })
  })

  it('uploads selected files before sending from the chat composer', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    vi.mocked(client.uploadSessionFile).mockResolvedValue({
      fileId: 'file-1',
      userId: 'test-user-id',
      sessionId: 'session-1',
      originalFilename: 'notes.txt',
      sanitizedName: 'notes.txt',
      mimeType: 'text/plain',
      extension: '.txt',
      sizeBytes: file.size,
      previewStatus: 'pending',
      status: 'ready',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    })
    vi.mocked(client.sendMessage).mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-1',
      envelopeId: 'env-1',
    })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-file-input')
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })
    await screen.findByText('notes.txt')
    fireEvent.click(screen.getByTestId('chat-send-button'))

    await waitFor(() => {
      expect(client.uploadSessionFile).toHaveBeenCalledWith('session-1', file)
      expect(client.sendMessage).toHaveBeenCalledWith('session-1', '', ['file-1'])
    })
  })
})
