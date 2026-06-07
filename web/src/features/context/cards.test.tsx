/**
 * Tests for ApprovalCard component
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ApprovalCard from './ApprovalCard'
import type { ApprovalCardData } from './card-contracts'
import { loading, ready, empty, error } from './card-state'
import type { ApprovalInfo } from '../../api/types'

describe('ApprovalCard', () => {
  const mockApprovals: ApprovalInfo[] = [
    {
      id: 'approval-1',
      userId: 'user-1',
      sessionId: 'session-1',
      status: 'pending',
      actionType: 'file_write',
      resource: '/path/to/file.txt',
      requestedBy: 'agent-1',
      requestedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'approval-2',
      userId: 'user-1',
      sessionId: 'session-1',
      status: 'approved',
      actionType: 'shell_exec',
      resource: 'npm test',
      requestedBy: 'agent-1',
      requestedAt: '2024-01-01T00:00:00Z',
    },
  ]

  describe('loading state', () => {
    it('renders loading state', () => {
      render(<ApprovalCard state={loading()} />)
      
      expect(screen.getByTestId('context-card-approvals')).toBeInTheDocument()
      expect(screen.getByText('加载中...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders error state', () => {
      const errorState = error('Failed to load approvals', 'APPROVALS_ERROR', true)
      render(<ApprovalCard state={errorState} />)
      
      expect(screen.getByText('Failed to load approvals')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('renders empty state', () => {
      const emptyState = empty('暂无审批请求', '当前会话没有待处理的审批')
      render(<ApprovalCard state={emptyState} />)
      
      expect(screen.getByText('暂无审批请求')).toBeInTheDocument()
      expect(screen.getByText('当前会话没有待处理的审批')).toBeInTheDocument()
    })
  })

  describe('ready state', () => {
    it('renders approval list', () => {
      const readyState = ready<ApprovalCardData>({
        approvals: mockApprovals,
        total: 2,
        sessionId: 'session-1',
      })
      
      render(<ApprovalCard state={readyState} />)
      
      expect(screen.getByText('file_write')).toBeInTheDocument()
      expect(screen.getByText('shell_exec')).toBeInTheDocument()
      expect(screen.getByText('pending')).toBeInTheDocument()
      expect(screen.getByText('approved')).toBeInTheDocument()
    })

    it('respects maxItems prop', () => {
      const readyState = ready<ApprovalCardData>({
        approvals: mockApprovals,
        total: 2,
        sessionId: 'session-1',
      })
      
      render(<ApprovalCard state={readyState} maxItems={1} />)
      
      expect(screen.getByText('file_write')).toBeInTheDocument()
      expect(screen.queryByText('shell_exec')).not.toBeInTheDocument()
      expect(screen.getByText(/还有 1 项/)).toBeInTheDocument()
    })

    it('displays resource information', () => {
      const readyState = ready<ApprovalCardData>({
        approvals: mockApprovals,
        total: 2,
        sessionId: 'session-1',
      })
      
      render(<ApprovalCard state={readyState} />)
      
      expect(screen.getByText('/path/to/file.txt')).toBeInTheDocument()
      expect(screen.getByText('npm test')).toBeInTheDocument()
    })

    it('renders without resource if not provided', () => {
      const approvalWithoutResource: ApprovalInfo = {
        id: 'approval-3',
        userId: 'user-1',
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'api_call',
        requestedBy: 'agent-1',
        requestedAt: '2024-01-01T00:00:00Z',
      }
      
      const readyState = ready<ApprovalCardData>({
        approvals: [approvalWithoutResource],
        total: 1,
        sessionId: 'session-1',
      })
      
      render(<ApprovalCard state={readyState} />)
      
      expect(screen.getByText('api_call')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct test ID', () => {
      render(<ApprovalCard state={loading()} />)
      expect(screen.getByTestId('context-card-approvals')).toBeInTheDocument()
    })
  })
})
