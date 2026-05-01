import React, { useRef, useEffect } from 'react';
import type { ConsoleTimelineEvent } from '../../api/types';
import { TimelineEventCard } from './TimelineEventCard';

export interface TimelineListProps {
  events: ConsoleTimelineEvent[];
  loading: boolean;
  error?: string;
}

export const TimelineList: React.FC<TimelineListProps> = ({
  events,
  loading,
  error,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  if (loading) {
    return (
      <div className="timeline-list timeline-list--loading" data-testid="timeline-loading">
        <div className="timeline-loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="timeline-list timeline-list--error" data-testid="timeline-error">
        <div className="timeline-error">{error}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="timeline-list timeline-list--empty" data-testid="timeline-empty-state">
        <div className="timeline-empty-state">
          <div className="timeline-empty-icon">📋</div>
          <p>暂无事件</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-list">
      {events.map((event) => (
        <TimelineEventCard key={event.eventId} event={event} />
      ))}
      <div ref={scrollRef} />
    </div>
  );
};
