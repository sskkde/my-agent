/**
 * Tests for ContextDeskPanel component
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ContextDeskPanel from './ContextDeskPanel'
import type {
  ApprovalCardData,
  MemoryCardData,
  RunsCardData,
  ToolActivityCardData,
} from './card-contracts'
import { loading, ready, empty, error } from './card-state'


describe('ContextDeskPanel', () => {
  const mockApprovalState = ready<ApprovalCardData>({
    approvals: [],
    total: 0,
    sessionId: 'session-1',
  })

  const mockMemoryState = ready<MemoryCardData>({
    memories: [],
    total: 0,
  })

  const mockRunsState = ready<RunsCardData>({
    runs: [],
    total: 0,
    sessionId: 'session-1',
    streaming: false,
  })

  const mockToolActivityState = ready<ToolActivityCardData>({
    events: [],
    total: 0,
    sessionId: 'session-1',
    streaming: false,
  })

  describe('rendering', () => {
    it('renders all three workspace sections', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
      expect(screen.getByTestId('workspace-plan')).toBeInTheDocument()
      expect(screen.getByTestId('workspace-desk')).toBeInTheDocument()
      expect(screen.getByTestId('activity-summary')).toBeInTheDocument()
    })

    it('renders all four activity cards in activity overview section', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByTestId('context-card-approvals')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
    })

    it('renders with custom className', () => {
      const { container } = render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
          className="custom-class"
        />
      )
      
      expect(container.querySelector('.workspace-panel.custom-class')).toBeInTheDocument()
    })
  })

  describe('workspace sections', () => {
    it('renders work plan section with placeholder', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByText('工作计划')).toBeInTheDocument()
      expect(screen.getByText('当前无活动计划')).toBeInTheDocument()
    })

    it('renders desk section with placeholder', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByText('书桌')).toBeInTheDocument()
      expect(screen.getByText('文件与资源')).toBeInTheDocument()
    })

    it('renders activity overview section with summary', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByText('活动概览')).toBeInTheDocument()
      expect(screen.getByTestId('activity-summary')).toBeInTheDocument()
    })
  })

  describe('activity summary', () => {
    it('shows correct counts for running tasks and pending approvals', () => {
      const runsWithActive = ready<RunsCardData>({
        runs: [
          { runId: 'run-1', status: 'running', objective: 'Test run', createdAt: '2024-01-01T00:00:00Z' },
          { runId: 'run-2', status: 'completed', objective: 'Done', createdAt: '2024-01-01T00:00:00Z' },
        ],
        total: 2,
        sessionId: 'session-1',
        streaming: false,
      })

      const approvalsWithPending = ready<ApprovalCardData>({
        approvals: [
          { id: 'approval-1', userId: 'user-1', sessionId: 'session-1', status: 'pending', actionType: 'test', requestedBy: 'agent', requestedAt: '2024-01-01T00:00:00Z' },
          { id: 'approval-2', userId: 'user-1', sessionId: 'session-1', status: 'approved', actionType: 'test2', requestedBy: 'agent', requestedAt: '2024-01-01T00:00:00Z' },
        ],
        total: 2,
        sessionId: 'session-1',
      })
      
      render(
        <ContextDeskPanel
          approvalState={approvalsWithPending}
          memoryState={mockMemoryState}
          runsState={runsWithActive}
          toolActivityState={mockToolActivityState}
        />
      )
      
      const metrics = screen.getByTestId('activity-summary')
      expect(metrics).toHaveTextContent('1')  // 1 running
      expect(metrics).toHaveTextContent('运行中')
      expect(metrics).toHaveTextContent('1')  // 1 pending approval
      expect(metrics).toHaveTextContent('待审批')
      expect(metrics).toHaveTextContent('2')  // 2 total runs
      expect(metrics).toHaveTextContent('总运行')
    })
  })

  describe('error isolation', () => {
    it('isolates card errors and prevents cascading failures', () => {
      const errorState = error('Card failed', 'CARD_ERROR', true)
      
      expect(() => {
        render(
          <ContextDeskPanel
            approvalState={errorState}
            memoryState={mockMemoryState}
            runsState={mockRunsState}
            toolActivityState={mockToolActivityState}
          />
        )
      }).not.toThrow()
      
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
    })

    it('renders error boundary fallback when card throws', () => {
      const errorState = error('Card failed', 'CARD_ERROR', true)
      
      render(
        <ContextDeskPanel
          approvalState={errorState}
          memoryState={errorState}
          runsState={errorState}
          toolActivityState={errorState}
        />
      )
      
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })
  })

  describe('mixed states', () => {
    it('handles mixed loading, ready, empty, and error states', () => {
      const loadingState = loading()
      const readyState = ready<ApprovalCardData>({
        approvals: [{
          id: 'approval-1',
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending',
          actionType: 'test_action',
          requestedBy: 'agent-1',
          requestedAt: '2024-01-01T00:00:00Z',
        }],
        total: 1,
        sessionId: 'session-1',
      })
      const emptyState = empty('暂无运行记录', '没有后台任务正在运行')
      const errorState = error('Failed to load', 'ERROR', true)
      
      render(
        <ContextDeskPanel
          approvalState={readyState}
          memoryState={loadingState}
          runsState={emptyState}
          toolActivityState={errorState}
        />
      )
      
      expect(screen.getByText('test_action')).toBeInTheDocument()
      expect(screen.getByText('加载中...')).toBeInTheDocument()
      expect(screen.getByText('暂无运行记录')).toBeInTheDocument()
      expect(screen.getByText('Failed to load')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct test ID', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByTestId('context-desk-panel')).toBeInTheDocument()
    })

    it('each activity card has correct test ID', () => {
      render(
        <ContextDeskPanel
          approvalState={mockApprovalState}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
        />
      )
      
      expect(screen.getByTestId('context-card-approvals')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-memory')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-runs')).toBeInTheDocument()
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
    })
  })

  describe('props', () => {
    it('passes maxItems to cards', () => {
      const readyApproval = ready<ApprovalCardData>({
        approvals: Array(10).fill(null).map((_, i) => ({
          id: `approval-${i}`,
          userId: 'user-1',
          sessionId: 'session-1',
          status: 'pending',
          actionType: `action-${i}`,
          requestedBy: 'agent-1',
          requestedAt: '2024-01-01T00:00:00Z',
        })),
        total: 10,
        sessionId: 'session-1',
      })
      
      render(
        <ContextDeskPanel
          approvalState={readyApproval}
          memoryState={mockMemoryState}
          runsState={mockRunsState}
          toolActivityState={mockToolActivityState}
          maxItems={3}
        />
      )
      
      expect(screen.getByText(/还有 \d+ 项/)).toBeInTheDocument()
    })
  })
})
