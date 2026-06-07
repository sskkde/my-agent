/**
 * Tests for Context Desk Data Adapters
 *
 * READ-ONLY POLICY TEST:
 * These tests verify that adapters only fetch data and do not perform mutations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchApprovalCardData,
  fetchMemoryCardData,
  fetchRunsCardData,
  fetchToolActivityCardData,
  createEmptyMetadata,
} from './data-adapters'
import * as apiClient from '../../api/client'
import type { ConsoleTimelineEvent } from '../../api/types'
import { isReady, isEmpty, isError } from './card-state'

// Mock API client
vi.mock('../../api/client', () => ({
  getApprovals: vi.fn(),
  getMemories: vi.fn(),
  getRuns: vi.fn(),
  getSessionTimeline: vi.fn(),
}))

describe('data-adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchApprovalCardData', () => {
    it('returns ready state with approvals', async () => {
      const mockApprovals = [
        {
          id: 'approval-1',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending' as const,
          actionType: 'file_read',
          requestedBy: 'agent',
          requestedAt: '2024-01-01T00:00:00Z',
        },
      ]
      vi.mocked(apiClient.getApprovals).mockResolvedValue({
        approvals: mockApprovals,
        total: 1,
      })

      const state = await fetchApprovalCardData()

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.approvals).toHaveLength(1)
        expect(state.data.total).toBe(1)
      }
    })

    it('filters by sessionId', async () => {
      const mockApprovals = [
        {
          id: 'approval-1',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending' as const,
          actionType: 'file_read',
          requestedBy: 'agent',
          requestedAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'approval-2',
          userId: 'user-1',
          sessionId: 'session-2',
          status: 'pending' as const,
          actionType: 'file_write',
          requestedBy: 'agent',
          requestedAt: '2024-01-01T00:00:00Z',
        },
      ]
      vi.mocked(apiClient.getApprovals).mockResolvedValue({
        approvals: mockApprovals,
        total: 2,
      })

      const state = await fetchApprovalCardData({ sessionId: 'session-1' })

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.approvals).toHaveLength(1)
        expect(state.data.approvals[0].sessionId).toBe('session-1')
      }
    })

    it('returns empty state when no approvals', async () => {
      vi.mocked(apiClient.getApprovals).mockResolvedValue({
        approvals: [],
        total: 0,
      })

      const state = await fetchApprovalCardData()

      expect(isEmpty(state)).toBe(true)
    })

    it('returns error state on API failure', async () => {
      vi.mocked(apiClient.getApprovals).mockRejectedValue(new Error('Network error'))

      const state = await fetchApprovalCardData()

      expect(isError(state)).toBe(true)
      if (isError(state)) {
        expect(state.message).toBe('Network error')
        expect(state.code).toBe('APPROVALS_FETCH_ERROR')
        expect(state.retryable).toBe(true)
      }
    })

    it('respects maxItems limit', async () => {
      const mockApprovals = [
        { id: '1', userId: 'u1', sessionId: 's1', status: 'pending' as const, actionType: 't1', requestedBy: 'a', requestedAt: '' },
        { id: '2', userId: 'u2', sessionId: 's2', status: 'pending' as const, actionType: 't2', requestedBy: 'a', requestedAt: '' },
        { id: '3', userId: 'u3', sessionId: 's3', status: 'pending' as const, actionType: 't3', requestedBy: 'a', requestedAt: '' },
      ]
      vi.mocked(apiClient.getApprovals).mockResolvedValue({
        approvals: mockApprovals,
        total: 3,
      })

      const state = await fetchApprovalCardData({ maxItems: 2 })

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.approvals).toHaveLength(2)
        expect(state.data.total).toBe(3) // Total still shows full count
      }
    })
  })

  describe('fetchMemoryCardData', () => {
    it('returns ready state with memories', async () => {
      const mockMemories = [
        {
          memoryId: 'mem-1',
          userId: 'user-1',
          type: 'preference',
          content: 'User prefers dark mode',
          sensitivity: 'low',
          lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z' },
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      vi.mocked(apiClient.getMemories).mockResolvedValue({
        memories: mockMemories,
        total: 1,
      })

      const state = await fetchMemoryCardData()

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.memories).toHaveLength(1)
        expect(state.data.total).toBe(1)
      }
    })

    it('passes query and type to API', async () => {
      vi.mocked(apiClient.getMemories).mockResolvedValue({
        memories: [],
        total: 0,
      })

      await fetchMemoryCardData({ query: 'test', type: 'preference' })

      expect(apiClient.getMemories).toHaveBeenCalledWith({
        query: 'test',
        type: 'preference',
        limit: undefined,
      })
    })

    it('returns empty state when no memories', async () => {
      vi.mocked(apiClient.getMemories).mockResolvedValue({
        memories: [],
        total: 0,
      })

      const state = await fetchMemoryCardData()

      expect(isEmpty(state)).toBe(true)
    })
  })

  describe('fetchRunsCardData', () => {
    it('returns ready state with runs', async () => {
      const mockRuns = [
        {
          runId: 'run-1',
          status: 'running' as const,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]
      vi.mocked(apiClient.getRuns).mockResolvedValue({
        runs: mockRuns,
        total: 1,
      })

      const state = await fetchRunsCardData()

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.runs).toHaveLength(1)
        expect(state.data.streaming).toBe(false)
      }
    })

    it('returns empty state when no runs', async () => {
      vi.mocked(apiClient.getRuns).mockResolvedValue({
        runs: [],
        total: 0,
      })

      const state = await fetchRunsCardData()

      expect(isEmpty(state)).toBe(true)
    })

    it('filters by status', async () => {
      const mockRuns = [
        { runId: 'run-1', status: 'running' as const, createdAt: '' },
        { runId: 'run-2', status: 'completed' as const, createdAt: '' },
      ]
      vi.mocked(apiClient.getRuns).mockResolvedValue({
        runs: mockRuns,
        total: 2,
      })

      const state = await fetchRunsCardData({ status: 'running' })

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.runs).toHaveLength(1)
        expect(state.data.runs[0].status).toBe('running')
      }
    })
  })

  describe('fetchToolActivityCardData', () => {
    it('returns empty state when no sessionId', async () => {
      const state = await fetchToolActivityCardData({ sessionId: '' })

      expect(isEmpty(state)).toBe(true)
      if (isEmpty(state)) {
        expect(state.message).toBe('无会话信息')
      }
    })

    it('returns ready state with tool events', async () => {
      const mockEvents: ConsoleTimelineEvent[] = [
        {
          eventId: 'event-1',
          eventType: 'tool_call',
          sessionId: 'session-1',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          eventId: 'event-2',
          eventType: 'tool_result',
          sessionId: 'session-1',
          timestamp: '2024-01-01T00:01:00Z',
        },
        {
          eventId: 'event-3',
          eventType: 'user_message',
          sessionId: 'session-1',
          timestamp: '2024-01-01T00:02:00Z',
        },
      ]
      vi.mocked(apiClient.getSessionTimeline).mockResolvedValue({
        events: mockEvents,
        total: 3,
      })

      const state = await fetchToolActivityCardData({ sessionId: 'session-1' })

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.events).toHaveLength(2) // Only tool_call and tool_result
        expect(state.data.total).toBe(2)
        expect(state.data.sessionId).toBe('session-1')
      }
    })

    it('filters only tool_call and tool_result events', async () => {
      const mockEvents: ConsoleTimelineEvent[] = [
        { eventId: '1', eventType: 'tool_call', sessionId: 's1', timestamp: '' },
        { eventId: '2', eventType: 'tool_result', sessionId: 's1', timestamp: '' },
        { eventId: '3', eventType: 'user_message', sessionId: 's1', timestamp: '' },
        { eventId: '4', eventType: 'assistant_message', sessionId: 's1', timestamp: '' },
      ]
      vi.mocked(apiClient.getSessionTimeline).mockResolvedValue({
        events: mockEvents,
        total: 4,
      })

      const state = await fetchToolActivityCardData({ sessionId: 's1' })

      expect(isReady(state)).toBe(true)
      if (isReady(state)) {
        expect(state.data.events).toHaveLength(2)
        expect(state.data.events.map((e) => e.eventType)).toEqual(['tool_call', 'tool_result'])
      }
    })

    it('returns empty state when no tool events', async () => {
      const mockEvents: ConsoleTimelineEvent[] = [
        { eventId: '1', eventType: 'user_message', sessionId: 's1', timestamp: '' },
      ]
      vi.mocked(apiClient.getSessionTimeline).mockResolvedValue({
        events: mockEvents,
        total: 1,
      })

      const state = await fetchToolActivityCardData({ sessionId: 's1' })

      expect(isEmpty(state)).toBe(true)
    })
  })

  describe('createEmptyMetadata', () => {
    it('creates metadata for approvals card', () => {
      const metadata = createEmptyMetadata('approvals', 'no_data')
      expect(metadata.reason).toBe('no_data')
      expect(metadata.message).toBe('暂无审批请求')
    })

    it('creates metadata for memory card', () => {
      const metadata = createEmptyMetadata('memory', 'no_data')
      expect(metadata.reason).toBe('no_data')
      expect(metadata.message).toBe('暂无记忆条目')
    })

    it('creates metadata for runs card', () => {
      const metadata = createEmptyMetadata('runs', 'no_data')
      expect(metadata.reason).toBe('no_data')
      expect(metadata.message).toBe('暂无运行记录')
    })

    it('creates metadata for tool-activity card', () => {
      const metadata = createEmptyMetadata('tool-activity', 'no_data')
      expect(metadata.reason).toBe('no_data')
      expect(metadata.message).toBe('暂无工具活动')
    })
  })
})
