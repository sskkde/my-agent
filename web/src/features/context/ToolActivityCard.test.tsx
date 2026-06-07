/**
 * Tests for ToolActivityCard component
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import ToolActivityCard from './ToolActivityCard'
import type { ToolActivityCardData } from './card-contracts'
import { loading, ready, empty, error } from './card-state'
import type { ConsoleTimelineEvent } from '../../api/types'

describe('ToolActivityCard', () => {
  const mockEvents: ConsoleTimelineEvent[] = [
    {
      eventId: 'event-1',
      eventType: 'tool_call',
      sessionId: 'session-1',
      timestamp: '2024-01-01T00:00:00Z',
      content: 'Calling file_read',
      metadata: { toolName: 'file_read' },
    },
    {
      eventId: 'event-2',
      eventType: 'tool_result',
      sessionId: 'session-1',
      timestamp: '2024-01-01T00:00:01Z',
      content: 'File content loaded',
      metadata: { toolName: 'file_read' },
    },
    {
      eventId: 'event-3',
      eventType: 'tool_call',
      sessionId: 'session-1',
      timestamp: '2024-01-01T00:00:02Z',
      content: 'Calling shell_exec',
      metadata: { toolName: 'shell_exec' },
    },
  ]

  describe('loading state', () => {
    it('renders loading state', () => {
      render(<ToolActivityCard state={loading()} sessionId="session-1" />)
      
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
      expect(screen.getByText('加载中...')).toBeInTheDocument()
    })
  })

  describe('error state', () => {
    it('renders error state', () => {
      const errorState = error('Failed to load tool activity', 'TOOL_ERROR', true)
      render(<ToolActivityCard state={errorState} sessionId="session-1" />)
      
      expect(screen.getByText('Failed to load tool activity')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('renders empty state', () => {
      const emptyState = empty('暂无工具活动', '当前会话没有工具调用记录')
      render(<ToolActivityCard state={emptyState} sessionId="session-1" />)
      
      expect(screen.getByText('暂无工具活动')).toBeInTheDocument()
      expect(screen.getByText('当前会话没有工具调用记录')).toBeInTheDocument()
    })
  })

  describe('ready state', () => {
    it('renders tool events list', () => {
      const readyState = ready<ToolActivityCardData>({
        events: mockEvents,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<ToolActivityCard state={readyState} sessionId="session-1" />)
      
      expect(screen.getAllByText('调用').length).toBeGreaterThan(0)
      expect(screen.getByText('结果')).toBeInTheDocument()
      expect(screen.getAllByText('file_read').length).toBeGreaterThan(0)
      expect(screen.getByText('shell_exec')).toBeInTheDocument()
    })

    it('respects maxItems prop', () => {
      const readyState = ready<ToolActivityCardData>({
        events: mockEvents,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<ToolActivityCard state={readyState} sessionId="session-1" maxItems={2} />)
      
      // file_read appears twice (once for call, once for result)
      expect(screen.getAllByText('file_read').length).toBeGreaterThan(0)
      expect(screen.queryByText('shell_exec')).not.toBeInTheDocument()
      expect(screen.getByText(/还有 1 项/)).toBeInTheDocument()
    })

    it('displays event content', () => {
      const readyState = ready<ToolActivityCardData>({
        events: mockEvents,
        total: 3,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<ToolActivityCard state={readyState} sessionId="session-1" />)
      
      expect(screen.getByText('Calling file_read')).toBeInTheDocument()
      expect(screen.getByText('File content loaded')).toBeInTheDocument()
    })

    it('displays eventType when toolName is missing', () => {
      const eventWithoutToolName: ConsoleTimelineEvent = {
        eventId: 'event-4',
        eventType: 'tool_call',
        sessionId: 'session-1',
        timestamp: '2024-01-01T00:00:03Z',
        content: 'Tool call without name',
      }
      
      const readyState = ready<ToolActivityCardData>({
        events: [eventWithoutToolName],
        total: 1,
        sessionId: 'session-1',
        streaming: false,
      })
      
      render(<ToolActivityCard state={readyState} sessionId="session-1" />)
      
      expect(screen.getByText('tool_call')).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('has correct test ID', () => {
      render(<ToolActivityCard state={loading()} sessionId="session-1" />)
      expect(screen.getByTestId('context-card-tools')).toBeInTheDocument()
    })
  })
})
