import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useComposerSubmission } from './useComposerSubmission'
import type { ConsoleTimelineEvent } from '../../../api/types'
import type { AssistantPlaceholder } from '../session-utils'

vi.mock('../../../api/client', () => ({
  sendMessage: vi.fn(),
}))

vi.mock('../../../commands/parser', () => ({
  isCommand: vi.fn((input: string) => input.startsWith('/') && !input.startsWith('//')),
  parseInput: vi.fn(),
}))

vi.mock('../../../commands/executor', () => ({
  executeCommand: vi.fn(),
}))

vi.mock('../../../commands/formatters', () => ({
  createCommandEvent: vi.fn(),
}))

import * as api from '../../../api/client'
import { isCommand, parseInput } from '../../../commands/parser'
import { executeCommand } from '../../../commands/executor'
import { createCommandEvent } from '../../../commands/formatters'

const mockSendMessage = api.sendMessage as ReturnType<typeof vi.fn>
const mockIsCommand = isCommand as ReturnType<typeof vi.fn>
const mockParseInput = parseInput as ReturnType<typeof vi.fn>
const mockExecuteCommand = executeCommand as ReturnType<typeof vi.fn>
const mockCreateCommandEvent = createCommandEvent as ReturnType<typeof vi.fn>

describe('useComposerSubmission', () => {
  let mountedRef: React.MutableRefObject<boolean>
  let selectedSessionIdRef: React.MutableRefObject<string | null>
  let callbacks: {
    createAssistantPlaceholder: ReturnType<typeof vi.fn>
    resolveAssistantPlaceholder: ReturnType<typeof vi.fn>
    updatePendingAssistantPlaceholders: ReturnType<typeof vi.fn>
    clearAssistantActivity: ReturnType<typeof vi.fn>
    clearAssistantActivityForSession: ReturnType<typeof vi.fn>
    fetchTimeline: ReturnType<typeof vi.fn>
    fetchSessions: ReturnType<typeof vi.fn>
    createCommandContext: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mountedRef = { current: true }
    selectedSessionIdRef = { current: 'session-1' }

    callbacks = {
      createAssistantPlaceholder: vi.fn((sessionId: string) => ({
        attemptId: `placeholder-${Date.now()}`,
        placeholder: { sessionId, timestamp: Date.now() } as AssistantPlaceholder,
      })),
      resolveAssistantPlaceholder: vi.fn(),
      updatePendingAssistantPlaceholders: vi.fn((updater: (prev: Map<string, AssistantPlaceholder>) => Map<string, AssistantPlaceholder>) => updater(new Map())),
      clearAssistantActivity: vi.fn(),
      clearAssistantActivityForSession: vi.fn(),
      fetchTimeline: vi.fn().mockResolvedValue(null),
      fetchSessions: vi.fn().mockResolvedValue(undefined),
      createCommandContext: vi.fn().mockReturnValue({ sessionId: 'session-1' }),
    }

    mockIsCommand.mockImplementation((input: string) => input.startsWith('/') && !input.startsWith('//'))
  })

  function renderComposerHook(selectedSessionId: string | null = 'session-1', events: ConsoleTimelineEvent[] = []) {
    return renderHook(() =>
      useComposerSubmission({
        selectedSessionId,
        mountedRef,
        selectedSessionIdRef,
        events,
        callbacks,
      }),
    )
  }

  it('starts with empty draft and not sending', () => {
    const { result } = renderComposerHook()
    expect(result.current.draft).toBe('')
    expect(result.current.sending).toBe(false)
    expect(result.current.sendError).toBeNull()
  })

  it('updates draft via setDraft', () => {
    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello world')
    })

    expect(result.current.draft).toBe('Hello world')
  })

  it('sends normal message and clears draft', async () => {
    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-1' })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello world')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(mockSendMessage).toHaveBeenCalledWith('session-1', 'Hello world')
    expect(result.current.draft).toBe('')
    expect(result.current.sending).toBe(false)
  })

  it('does not send blank message', async () => {
    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('   ')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('does not send when no session is selected', async () => {
    const { result } = renderComposerHook(null)

    act(() => {
      result.current.setDraft('Hello')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('sends // prefix as escaped text', async () => {
    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-1' })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('//help')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(mockSendMessage).toHaveBeenCalledWith('session-1', 'help')
    expect(result.current.draft).toBe('')
  })

  it('executes command without calling sendMessage', async () => {
    mockParseInput.mockReturnValue({
      isCommand: true,
      isEscaped: false,
      parsed: { command: 'help', args: [], rawInput: '/help', isEscaped: false },
    })
    mockExecuteCommand.mockResolvedValue({
      success: true,
      output: { type: 'text', content: 'Help text' },
      commandName: 'help',
    })
    mockCreateCommandEvent.mockReturnValue({
      eventId: 'cmd-1',
      eventType: 'system_status',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      content: 'Help text',
    })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('/help')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
    expect(mockExecuteCommand).toHaveBeenCalled()
    expect(result.current.draft).toBe('')
  })

  it('sets sendError on API failure', async () => {
    mockSendMessage.mockRejectedValue(new Error('Network error'))

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(result.current.sendError).toBe('Network error')
    expect(result.current.sending).toBe(false)
  })

  it('sets sendError on command execution failure', async () => {
    mockParseInput.mockReturnValue({
      isCommand: true,
      isEscaped: false,
      parsed: { command: 'bad', args: [], rawInput: '/bad', isEscaped: false },
    })
    mockExecuteCommand.mockRejectedValue(new Error('Command failed'))

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('/bad')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    expect(result.current.sendError).toBe('Command failed')
  })

  it('creates local message event on send', async () => {
    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-1' })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    const localEvents = result.current.localMessageEvents.get('session-1')
    expect(localEvents).toBeDefined()
    expect(localEvents).toHaveLength(1)
    expect(localEvents![0].eventType).toBe('user_message')
    expect(localEvents![0].content).toBe('Hello')
  })

  it('creates local command event on command execution', async () => {
    mockParseInput.mockReturnValue({
      isCommand: true,
      isEscaped: false,
      parsed: { command: 'help', args: [], rawInput: '/help', isEscaped: false },
    })
    mockExecuteCommand.mockResolvedValue({
      success: true,
      output: { type: 'text', content: 'Help' },
      commandName: 'help',
    })
    mockCreateCommandEvent.mockReturnValue({
      eventId: 'cmd-1',
      eventType: 'system_status',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      content: 'Help',
    })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('/help')
    })

    await act(async () => {
      await result.current.handleSend()
    })

    const cmdEvents = result.current.localCommandEvents.get('session-1')
    expect(cmdEvents).toBeDefined()
    expect(cmdEvents).toHaveLength(1)
  })

  it('handleKeyDown triggers send on Enter without Shift', async () => {
    mockSendMessage.mockResolvedValue({ accepted: true, correlationId: 'corr-1' })

    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello')
    })

    const preventDefault = vi.fn()
    await act(async () => {
      result.current.handleKeyDown({ key: 'Enter', shiftKey: false, preventDefault } as unknown as React.KeyboardEvent)
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(mockSendMessage).toHaveBeenCalledWith('session-1', 'Hello')
  })

  it('handleKeyDown does not send on Enter with Shift', async () => {
    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello')
    })

    const preventDefault = vi.fn()
    act(() => {
      result.current.handleKeyDown({ key: 'Enter', shiftKey: true, preventDefault } as unknown as React.KeyboardEvent)
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('handleKeyDown does not send on non-Enter key', async () => {
    const { result } = renderComposerHook()

    act(() => {
      result.current.setDraft('Hello')
    })

    const preventDefault = vi.fn()
    act(() => {
      result.current.handleKeyDown({ key: 'a', shiftKey: false, preventDefault } as unknown as React.KeyboardEvent)
    })

    expect(mockSendMessage).not.toHaveBeenCalled()
  })

  it('clearPostSendPollTimeout is callable', () => {
    const { result } = renderComposerHook()
    expect(typeof result.current.clearPostSendPollTimeout).toBe('function')
    expect(() => result.current.clearPostSendPollTimeout()).not.toThrow()
  })
})
