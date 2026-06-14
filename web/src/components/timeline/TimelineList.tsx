import React, { useRef, useEffect } from 'react'
import './Timeline.css'
import type { ConsoleTimelineEvent } from '../../api/types'
import { TimelineEventCard } from './TimelineEventCard'
import { TimelineWelcomeState } from './TimelineWelcomeState'

export interface TimelineListProps {
  events: ConsoleTimelineEvent[]
  loading: boolean
  error?: string
  onPromptSelect?: (prompt: string) => void
}

export const TimelineList: React.FC<TimelineListProps> = ({ events, loading, error, onPromptSelect }) => {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  if (loading) {
    return (
      <div className="timeline-list timeline-list--loading" data-testid="timeline-loading">
        <div className="timeline-loading">加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="timeline-list timeline-list--error" data-testid="timeline-error">
        <div className="timeline-error">{error}</div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="timeline-list timeline-list--empty" data-testid="timeline-empty-state">
        <TimelineWelcomeState onPromptSelect={onPromptSelect} />
      </div>
    )
  }

  return (
    <div className="timeline-list">
      {events.map((event) => (
        <TimelineEventCard key={event.eventId} event={event} />
      ))}
      <div ref={scrollRef} />
    </div>
  )
}
