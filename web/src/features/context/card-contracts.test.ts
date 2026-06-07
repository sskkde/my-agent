/**
 * Tests for Context Desk Card Contracts
 *
 * These tests verify the type definitions compile correctly and
 * document the read-only policy for each card type.
 */

import { describe, it, expect } from 'vitest'
import type {
  ApprovalCardData,
  ApprovalCardProps,
  MemoryCardData,
  MemoryCardProps,
  RunsCardData,
  RunsCardProps,
  ToolActivityCardData,
  ToolActivityCardProps,
  EmptyStateMetadata,
  CardRefreshConfig,
  BaseCardProps,
} from './card-contracts'
import { ready, empty } from './card-state'

describe('card-contracts', () => {
  describe('ApprovalCardData', () => {
    it('defines required fields for approval display', () => {
      const data: ApprovalCardData = {
        approvals: [
          {
            id: 'approval-1',
            userId: 'user-1',
            sessionId: 'session-1',
            status: 'pending',
            actionType: 'file_read',
            requestedBy: 'agent',
            requestedAt: '2024-01-01T00:00:00Z',
          },
        ],
        total: 1,
        sessionId: 'session-1',
      }
      expect(data.approvals).toHaveLength(1)
      expect(data.total).toBe(1)
    })
  })

  describe('ApprovalCardProps', () => {
    it('requires state with CardState<ApprovalCardData>', () => {
      const props: ApprovalCardProps = {
        state: ready({
          approvals: [],
          total: 0,
          sessionId: null,
        }),
        sessionId: null,
        maxItems: 10,
      }
      expect(props.state.status).toBe('ready')
    })

    it('supports empty state', () => {
      const props: ApprovalCardProps = {
        state: empty('No approvals'),
      }
      expect(props.state.status).toBe('empty')
    })
  })

  describe('MemoryCardData', () => {
    it('defines required fields for memory display', () => {
      const data: MemoryCardData = {
        memories: [
          {
            memoryId: 'mem-1',
            userId: 'user-1',
            type: 'preference',
            content: 'test',
            sensitivity: 'low',
            lifecycle: { status: 'active', createdAt: '' },
            createdAt: '',
          },
        ],
        total: 1,
      }
      expect(data.memories).toHaveLength(1)
    })
  })

  describe('RunsCardData', () => {
    it('includes streaming flag for SSE support', () => {
      const data: RunsCardData = {
        runs: [],
        total: 0,
        sessionId: null,
        streaming: false,
      }
      expect(data.streaming).toBe(false)
    })
  })

  describe('ToolActivityCardData', () => {
    it('requires sessionId', () => {
      const data: ToolActivityCardData = {
        events: [],
        total: 0,
        sessionId: 'session-1',
        streaming: false,
      }
      expect(data.sessionId).toBe('session-1')
    })
  })

  describe('EmptyStateMetadata', () => {
    it('defines reason variants', () => {
      const metadata: EmptyStateMetadata = {
        reason: 'no_data',
        message: 'No data available',
        hint: 'Try refreshing',
      }
      expect(metadata.reason).toBe('no_data')
    })

    it('supports all reason types', () => {
      const reasons: EmptyStateMetadata['reason'][] = [
        'no_data',
        'api_unavailable',
        'no_session',
        'filter_empty',
      ]
      expect(reasons).toHaveLength(4)
    })
  })

  describe('CardRefreshConfig', () => {
    it('defines refresh options', () => {
      const config: CardRefreshConfig = {
        interval: 5000,
        streaming: true,
        retryOnError: true,
        maxRetries: 3,
      }
      expect(config.interval).toBe(5000)
      expect(config.streaming).toBe(true)
    })
  })

  describe('BaseCardProps', () => {
    it('provides common props for all cards', () => {
      const props: BaseCardProps = {
        className: 'custom-card',
        'data-testid': 'test-card',
        refresh: {
          interval: 10000,
        },
      }
      expect(props.className).toBe('custom-card')
      expect(props['data-testid']).toBe('test-card')
    })
  })

  describe('Read-Only Policy Documentation', () => {
    it('documents that approval cards are read-only', () => {
      // READ-ONLY: ApprovalCardProps does not include approve/reject callbacks
      // Users must navigate to ApprovalsTab for actions
      const props: ApprovalCardProps = {
        state: empty('No approvals'),
      }
      // Type check passes - no action callbacks present
      expect(props).toBeDefined()
    })

    it('documents that memory cards are read-only', () => {
      // READ-ONLY: MemoryCardProps does not include delete/edit callbacks
      // Memory API is global, actions would be in MemoryTab
      const props: MemoryCardProps = {
        state: empty('No memories'),
      }
      expect(props).toBeDefined()
    })

    it('documents that runs cards are read-only', () => {
      // READ-ONLY: RunsCardProps does not include pause/resume/cancel callbacks
      // Users must navigate to ObservabilityTab for control actions
      const props: RunsCardProps = {
        state: empty('No runs'),
      }
      expect(props).toBeDefined()
    })

    it('documents that tool activity cards are read-only', () => {
      // READ-ONLY: ToolActivityCardProps is a log view only
      // No actions available - it's a display-only timeline
      const props: ToolActivityCardProps = {
        state: empty('No tool activity'),
        sessionId: 'session-1',
      }
      expect(props).toBeDefined()
    })
  })
})
