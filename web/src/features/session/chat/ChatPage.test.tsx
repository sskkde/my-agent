import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import ChatPage from './ChatPage'
import { AuthProvider } from '../../../context/AuthContext'
import * as client from '../../../api/client'
import { SELECTED_SESSION_KEY } from '../session-constants'
import type { ConsoleTimelineEvent, ProcessingStatusPayload, TokenStreamPayload } from '../../../api/types'

const REASONING_FIXTURE_12345 = 'REASONING_FIXTURE_12345'
const PREFS_KEY = 'agent-platform.console.commandPrefs'

vi.mock('../../../api/client')

describe('ChatPage', () => {
  beforeEach(() => {
    localStorage.clear()
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
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, _onEvent, _onError, _onStatus, _onToken, onOpen) => {
        onOpen?.()
        return () => {}
      },
    )
    vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })
    vi.mocked(client.getModels).mockResolvedValue({
      providers: [
        {
          providerId: 'openai',
          providerType: 'openai',
          displayName: 'OpenAI',
          enabled: true,
          configured: true,
          apiKeyLast4: '1234',
          baseUrl: 'https://api.openai.com',
          selectedModel: 'gpt-4.1',
          source: 'env',
          lastTestStatus: 'ok',
          lastTestedAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      selectedModel: 'gpt-4.1',
      selectedProviderId: 'openai',
      reasoningDepth: 'off',
    })
    vi.mocked(client.setSessionModel).mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'test-user-id',
        messageCount: 0,
        lastActivityAt: '2024-01-01T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    vi.mocked(client.setSessionReasoningDepth).mockResolvedValue({
      session: {
        sessionId: 'session-1',
        userId: 'test-user-id',
        messageCount: 0,
        lastActivityAt: '2024-01-01T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    vi.mocked(client.cancelActiveSessionRun).mockResolvedValue({
      status: 'cancelled',
      runId: 'run-1',
      coordinatorStatus: 'cancelled',
    })
    vi.mocked(client.getAgentConfig).mockResolvedValue({
      agentId: 'foreground.default',
      global: {
        providerId: '',
        model: '',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: [],
        allowedSkillIds: [],
      },
      userOverride: null,
      effective: {
        providerId: '',
        model: '',
        systemPrompt: '',
        routingPrompt: '',
        allowedToolIds: [],
        allowedSkillIds: [],
        routingTimeoutMs: 60000,
        repairAttempts: 1,
      },
    })
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
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, _onEvent, _onError, onStatus, _onToken, onOpen) => {
        statusCallback = onStatus
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(client.subscribeSessionTimeline).toHaveBeenCalledWith(
        'session-1',
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      ),
    )

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
      expect(screen.getByTestId('chat-ctx-pct')).toHaveTextContent('30/100')
    })
  })

  it('calls cancelActiveSessionRun when the stop button is clicked during an active turn', async () => {
    let statusCallback: ((status: ProcessingStatusPayload) => void) | undefined
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, _onEvent, _onError, onStatus, _onToken, onOpen) => {
        statusCallback = onStatus
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(client.subscribeSessionTimeline).toHaveBeenCalledWith(
        'session-1',
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      ),
    )

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
      expect(screen.getByTestId('chat-stop-button')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('chat-stop-button'))

    await waitFor(() => {
      expect(client.cancelActiveSessionRun).toHaveBeenCalledWith('session-1')
    })
  })

  it('shows 无 as the default model when no session is selected', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    expect(screen.getByTestId('chat-status-bar')).toHaveTextContent('无')
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

  it('renders the user message optimistically before the server confirms it', async () => {
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

    await screen.findByTestId('chat-shell')

    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: ' optimistic test message ' } })
    fireEvent.click(screen.getByTestId('chat-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('chat-message-user')).toHaveTextContent('optimistic test message')
    })

    await waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith('session-1', 'optimistic test message', undefined)
    })
  })

  it('navigates to /chat/:sessionId when creating a new session', async () => {
    function LocationDisplay() {
      const location = useLocation()
      return <div data-testid="location-path">{location.pathname}</div>
    }

    vi.mocked(client.createSession).mockResolvedValue({
      session: {
        sessionId: 'new-session-id',
        userId: 'test-user-id',
        messageCount: 0,
        lastActivityAt: '2024-01-01T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ChatPage />
          <LocationDisplay />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    fireEvent.click(screen.getByTestId('chat-new-button'))

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/chat/new-session-id')
    })
  })

  it('navigates to /chat welcome page after archiving the current session', async () => {
    function LocationDisplay() {
      const location = useLocation()
      return <div data-testid="location-path">{location.pathname}</div>
    }

    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
          <LocationDisplay />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')

    const archiveBtn = screen
      .getByTestId('chat-session-session-1')
      .querySelector('.chat-session-item__archive') as HTMLButtonElement
    fireEvent.click(archiveBtn)

    await waitFor(() => {
      expect(client.updateSession).toHaveBeenCalledWith('session-1', { status: 'archived' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/chat')
    })

    expect(localStorage.getItem(SELECTED_SESSION_KEY)).toBeNull()
  })

  it('creates a session and sends the first message from the welcome page composer', async () => {
    function LocationDisplay() {
      const location = useLocation()
      return <div data-testid="location-path">{location.pathname}</div>
    }

    vi.mocked(client.createSession).mockResolvedValue({
      session: {
        sessionId: 'welcome-session-id',
        userId: 'test-user-id',
        messageCount: 0,
        lastActivityAt: '2024-01-01T00:00:00Z',
        activePlannerRunIds: [],
        activeBackgroundRunIds: [],
      },
    })
    vi.mocked(client.sendMessage).mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-1',
      envelopeId: 'env-1',
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <ChatPage />
          <LocationDisplay />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')

    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'welcome page first message' } })
    fireEvent.click(screen.getByTestId('chat-send-button'))

    await waitFor(() => {
      expect(client.createSession).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith('welcome-session-id', 'welcome page first message', undefined)
    })

    await waitFor(() => {
      expect(screen.getByTestId('location-path')).toHaveTextContent('/chat/welcome-session-id')
    })
  })

  it('does not render a blank user bubble for file-only sends', async () => {
    const file = new File(['attachment'], 'notes.txt', { type: 'text/plain' })
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
      expect(client.sendMessage).toHaveBeenCalledWith('session-1', '', ['file-1'])
    })

    expect(screen.queryByTestId('chat-message-user')).not.toBeInTheDocument()
  })

  it('merges server timeline events found by post-send polling', { timeout: 10000 }, async () => {
    vi.mocked(client.sendMessage).mockResolvedValue({
      accepted: true,
      status: 'accepted',
      correlationId: 'corr-1',
      envelopeId: 'env-1',
    })

    let timelineCallCount = 0
    vi.mocked(client.getSessionTimeline).mockImplementation(async () => {
      timelineCallCount += 1
      if (timelineCallCount === 1) {
        return { events: [], total: 0 }
      }
      await new Promise((resolve) => setTimeout(resolve, 1100))
      return {
        events: [
          {
            eventId: 'server-user-1',
            eventType: 'user_message',
            sessionId: 'session-1',
            content: 'poll test',
            actor: 'user',
            timestamp: '2024-01-01T00:00:01Z',
          },
          {
            eventId: 'server-assistant-1',
            eventType: 'assistant_message',
            sessionId: 'session-1',
            content: 'reply from poll',
            actor: 'assistant',
            timestamp: '2024-01-01T00:00:02Z',
          },
        ],
        total: 2,
      }
    })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')

    const input = screen.getByTestId('chat-input')
    fireEvent.change(input, { target: { value: 'poll test' } })
    fireEvent.click(screen.getByTestId('chat-send-button'))

    await waitFor(() => {
      expect(screen.getByTestId('chat-message-user')).toHaveTextContent('poll test')
    })

    await waitFor(
      () => {
        const assistantMessages = screen.getAllByTestId('chat-message-assistant')
        const replyMessage = assistantMessages.find((el) => el.textContent?.includes('reply from poll'))
        expect(replyMessage).toBeDefined()
      },
      { timeout: 6000 },
    )
  })

  it('opens the model selector and lists available providers', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    await waitFor(() => expect(screen.getByTestId('chat-model-selector-trigger')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('chat-model-selector-trigger'))

    await waitFor(() => {
      expect(client.getModels).toHaveBeenCalledWith('session-1')
    })
    expect(screen.getByTestId('chat-model-provider-openai')).toBeInTheDocument()
    expect(screen.getByTestId('chat-model-option-openai-0')).toHaveTextContent('gpt-4.1')
  })

  it('switches the session model when an option is selected', async () => {
    vi.mocked(client.getModels).mockResolvedValue({
      providers: [
        {
          providerId: 'openai',
          providerType: 'openai',
          displayName: 'OpenAI',
          enabled: true,
          configured: true,
          apiKeyLast4: '1234',
          baseUrl: 'https://api.openai.com',
          selectedModel: 'gpt-4.1',
          source: 'env',
          lastTestStatus: 'ok',
          lastTestedAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        {
          providerId: 'ollama',
          providerType: 'ollama',
          displayName: 'Ollama',
          enabled: true,
          configured: true,
          apiKeyLast4: null,
          baseUrl: 'http://localhost:11434',
          selectedModel: 'llama2',
          source: 'user',
          lastTestStatus: null,
          lastTestedAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ],
      selectedModel: 'gpt-4.1',
      selectedProviderId: 'openai',
    })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    await waitFor(() => expect(screen.getByTestId('chat-model-selector-trigger')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('chat-model-selector-trigger'))
    await waitFor(() => expect(screen.getByTestId('chat-model-option-ollama-0')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('chat-model-option-ollama-0'))

    await waitFor(() => {
      expect(client.setSessionModel).toHaveBeenCalledWith('session-1', { providerId: 'ollama', model: 'llama2' })
    })
    await waitFor(() => {
      expect(screen.getByTestId('chat-status-bar')).toHaveTextContent('llama2')
    })
  })

  it('disables the model selector when no session is selected', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    expect(screen.getByTestId('chat-model-selector-trigger')).toBeDisabled()
  })

  it('shows an error when loading models fails', async () => {
    vi.mocked(client.getModels).mockRejectedValue(new Error('network error'))

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    await waitFor(() => expect(screen.getByTestId('chat-model-selector-trigger')).not.toBeDisabled())
    fireEvent.click(screen.getByTestId('chat-model-selector-trigger'))

    await waitFor(() => {
      expect(screen.getByTestId('chat-model-error')).toBeInTheDocument()
    })
  })
})

describe('ChatPage streaming draft finalization', () => {
  it('clears streaming draft when final assistant_message lacks attemptId', async () => {
    let onEvent: ((event: ConsoleTimelineEvent, source?: 'live' | 'historical') => void) | undefined
    let onToken: ((token: TokenStreamPayload) => void) | undefined

    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, eventCb, _onError, _onStatus, tokenCb, onOpen) => {
        onEvent = eventCb
        onToken = tokenCb
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-1',
        sequence: 1,
        delta: 'First answer',
        timestamp: '2024-01-01T00:00:01Z',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('First answer')).toBeInTheDocument()
    })

    act(() => {
      onEvent?.({
        eventId: 'final-1',
        eventType: 'assistant_message',
        sessionId: 'session-1',
        timestamp: '2024-01-01T00:00:02Z',
        content: 'First answer complete',
        // intentionally no attemptId — regression for ChatPage clearOldestIfUnmatched
        metadata: { turnId: 'run-1' },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('First answer complete')).toBeInTheDocument()
      expect(screen.queryByText('First answer')).not.toBeInTheDocument()
    })
  })

  it('does not clear streaming draft when historical snapshot replays without matching metadata', async () => {
    let onEvent: ((event: ConsoleTimelineEvent, source?: 'live' | 'historical') => void) | undefined
    let onToken: ((token: TokenStreamPayload) => void) | undefined

    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, eventCb, _onError, _onStatus, tokenCb, onOpen) => {
        onEvent = eventCb
        onToken = tokenCb
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())
    await waitFor(() => expect(onToken).toBeDefined())

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-historical-test',
        sequence: 1,
        delta: 'Streaming answer',
        timestamp: '2024-01-01T00:00:01Z',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Streaming answer')).toBeInTheDocument()
    })

    act(() => {
      onEvent?.(
        {
          eventId: 'snapshot-final-1',
          eventType: 'assistant_message',
          sessionId: 'session-1',
          timestamp: '2024-01-01T00:00:02Z',
          content: 'Snapshot answer',
          metadata: {},
          actor: 'assistant',
        },
        'historical',
      )
    })

    await waitFor(() => {
      expect(screen.getByText('Streaming answer')).toBeInTheDocument()
    })
  })

  it('clears streaming draft when live final assistant_message matches the attemptId', async () => {
    let onEvent: ((event: ConsoleTimelineEvent, source?: 'live' | 'historical') => void) | undefined
    let onToken: ((token: TokenStreamPayload) => void) | undefined

    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, eventCb, _onError, _onStatus, tokenCb, onOpen) => {
        onEvent = eventCb
        onToken = tokenCb
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())
    await waitFor(() => expect(onToken).toBeDefined())

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-live-test',
        sequence: 1,
        delta: 'Streaming answer',
        timestamp: '2024-01-01T00:00:01Z',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Streaming answer')).toBeInTheDocument()
    })

    act(() => {
      onEvent?.({
        eventId: 'live-final-1',
        eventType: 'assistant_message',
        sessionId: 'session-1',
        timestamp: '2024-01-01T00:00:02Z',
        content: 'Final answer',
        metadata: { attemptId: 'run-live-test' },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('Final answer')).toBeInTheDocument()
      expect(screen.queryByText('Streaming answer')).not.toBeInTheDocument()
    })
  })
})

describe('ChatPage reasoning visibility (T9)', () => {
  const thinkingSummaryEvent: ConsoleTimelineEvent = {
    eventId: 'thinking-1',
    eventType: 'thinking_summary',
    sessionId: 'session-1',
    timestamp: '2024-01-01T00:00:02Z',
    content: REASONING_FIXTURE_12345,
    actor: 'assistant',
  }

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(client.getSessionTimeline).mockResolvedValue({ events: [thinkingSummaryEvent], total: 1 })
  })

  it('hides persisted thinking_summary when reasoningVisible is false', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-message-list')

    expect(screen.queryByTestId('chat-reasoning-block')).not.toBeInTheDocument()
    expect(screen.queryByText(REASONING_FIXTURE_12345)).not.toBeInTheDocument()
  })

  it('shows persisted thinking_summary when reasoningVisible is true', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ reasoningVisible: true }))

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-reasoning-block')
    expect(screen.getByTestId('chat-reasoning-block')).toBeInTheDocument()
  })

  it('renders server-driven thinking_summary live events and keeps reasoning out of assistant draft content', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ reasoningVisible: true }))
    vi.mocked(client.getSessionTimeline).mockResolvedValue({ events: [], total: 0 })
    let onToken: ((token: TokenStreamPayload) => void) | undefined
    let onEvent: ((event: ConsoleTimelineEvent) => void) | undefined

    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (sessionId, eventCb, _onError, _onStatus, tokenCb, onOpen) => {
        onToken = tokenCb
        onEvent = (event) => eventCb(event, 'live')
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-1',
        sequence: 1,
        delta: 'Hello ',
        channel: 'assistant',
        timestamp: '2024-01-01T00:00:01Z',
      })
    })

    act(() => {
      onEvent?.({
        eventId: 'turn-run-1-thinking-live',
        eventType: 'thinking_summary',
        sessionId: 'session-1',
        timestamp: '2024-01-01T00:00:02Z',
        content: REASONING_FIXTURE_12345,
        metadata: { turnId: 'run-1', attemptId: 'run-1', live: true },
        actor: 'assistant',
      })
    })

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-1',
        sequence: 3,
        delta: 'world',
        channel: 'assistant',
        timestamp: '2024-01-01T00:00:03Z',
      })
    })

    await waitFor(() => {
      const assistantMessage = screen.getByTestId('chat-message-assistant')
      expect(assistantMessage.textContent).toContain('Hello world')
      expect(assistantMessage.textContent).not.toContain(REASONING_FIXTURE_12345)
    })

    const reasoningBlock = screen.getByTestId('chat-reasoning-block')
    expect(reasoningBlock).toBeInTheDocument()
    fireEvent.click(reasoningBlock.querySelector('button')!)
    await waitFor(() => {
      expect(screen.getByText(REASONING_FIXTURE_12345)).toBeInTheDocument()
    })
  })

  it('renders parent lifecycle events as one task card and excludes child text/reasoning from chat messages', async () => {
    let onEvent: ((event: ConsoleTimelineEvent, source?: 'live' | 'historical') => void) | undefined
    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (_sessionId, eventCb, _onError, _onStatus, _onToken, onOpen) => {
        onEvent = eventCb
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())

    const lifecycle = (eventId: string, eventType: ConsoleTimelineEvent['eventType'], metadata: Record<string, unknown>, content: string) => ({
      eventId,
      eventType,
      sessionId: 'session-1',
      timestamp: '2024-01-01T00:00:03Z',
      content,
      metadata,
      actor: 'subagent',
    } satisfies ConsoleTimelineEvent)

    act(() => {
      onEvent?.(
        lifecycle('child-started', 'run_started', {
          taskId: 'child-live',
          childSessionId: 'child-live',
          runId: 'run-live',
          agentProfile: 'planner',
          launchMode: 'foreground',
          status: 'running',
        }, 'CHILD_REASONING_SHOULD_NOT_APPEAR'),
      )
    })
    const taskCard = await screen.findByTestId('bg-task-card')
    expect(taskCard).toHaveAttribute('data-task-id', 'child-live')

    act(() => {
      onEvent?.(
        lifecycle('child-progress', 'run_progress', {
          taskId: 'child-live',
          childSessionId: 'child-live',
          runId: 'run-live',
          agentProfile: 'planner',
          launchMode: 'foreground',
          status: 'running',
          progress: 55,
        }, 'CHILD_TEXT_SHOULD_NOT_APPEAR'),
      )
    })
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '55'))
    expect(screen.getByTestId('bg-task-card')).toBe(taskCard)

    act(() => {
      onEvent?.(
        lifecycle('child-completed', 'run_completed', {
          taskId: 'child-live',
          childSessionId: 'child-live',
          runId: 'run-live',
          agentProfile: 'planner',
          launchMode: 'foreground',
          status: 'completed',
          progress: 100,
          safeMessage: '子任务已完成',
        }, 'CHILD_FINAL_TEXT_SHOULD_NOT_APPEAR'),
      )
    })
    await waitFor(() => expect(screen.getByText('子任务已完成')).toBeInTheDocument())
    expect(screen.getByTestId('bg-task-card')).toBe(taskCard)

    expect(screen.getAllByTestId('bg-task-card')).toHaveLength(1)
    expect(screen.queryByText('CHILD_REASONING_SHOULD_NOT_APPEAR')).not.toBeInTheDocument()
    expect(screen.queryByText('CHILD_TEXT_SHOULD_NOT_APPEAR')).not.toBeInTheDocument()
    expect(screen.queryByText('CHILD_FINAL_TEXT_SHOULD_NOT_APPEAR')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-reasoning-block')).not.toBeInTheDocument()
  })

  it('hides thinking_summary events when reasoningVisible is false', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ reasoningVisible: false }))
    vi.mocked(client.getSessionTimeline).mockResolvedValue({ events: [], total: 0 })
    let onToken: ((token: TokenStreamPayload) => void) | undefined
    let onEvent: ((event: ConsoleTimelineEvent) => void) | undefined

    vi.mocked(client.subscribeSessionTimeline).mockImplementation(
      (sessionId, eventCb, _onError, _onStatus, tokenCb, onOpen) => {
        onToken = tokenCb
        onEvent = (event) => eventCb(event, 'live')
        onOpen?.()
        return () => {}
      },
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage initialSessionId="session-1" />
        </AuthProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(client.subscribeSessionTimeline).toHaveBeenCalled())

    act(() => {
      onToken?.({
        sessionId: 'session-1',
        attemptId: 'run-1',
        sequence: 1,
        delta: 'assistant text',
        timestamp: '2024-01-01T00:00:01Z',
      })
    })

    act(() => {
      onEvent?.({
        eventId: 'turn-run-1-thinking-live',
        eventType: 'thinking_summary',
        sessionId: 'session-1',
        timestamp: '2024-01-01T00:00:02Z',
        content: REASONING_FIXTURE_12345,
        metadata: { turnId: 'run-1', attemptId: 'run-1', live: true },
        actor: 'assistant',
      })
    })

    await waitFor(() => {
      expect(screen.getByText('assistant text')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('chat-reasoning-block')).not.toBeInTheDocument()
    expect(screen.queryByText(REASONING_FIXTURE_12345)).not.toBeInTheDocument()
  })
})
