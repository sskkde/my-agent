import type {
  ConnectorAdapter,
  ConnectorCapability,
  ConnectorCallRequest,
} from '../types.js';
import type { ConnectorInstance } from '../../storage/connector-store.js';

const mockEvents = [
  {
    id: 'event-001',
    title: 'Team Standup',
    start: '2024-01-15T09:00:00Z',
    end: '2024-01-15T09:30:00Z',
    attendees: ['user@example.com', 'boss@company.com'],
    location: 'Conference Room A',
    description: 'Daily team standup meeting',
    calendarId: 'primary',
  },
  {
    id: 'event-002',
    title: 'Project Review',
    start: '2024-01-15T14:00:00Z',
    end: '2024-01-15T15:00:00Z',
    attendees: ['user@example.com', 'manager@company.com', 'client@external.com'],
    location: 'Zoom',
    description: 'Quarterly project review with stakeholders',
    calendarId: 'primary',
  },
  {
    id: 'event-003',
    title: 'Lunch with Sarah',
    start: '2024-01-16T12:00:00Z',
    end: '2024-01-16T13:00:00Z',
    attendees: ['user@example.com', 'sarah@friend.com'],
    location: 'Downtown Cafe',
    description: 'Catch up over lunch',
    calendarId: 'personal',
  },
];

export interface CalendarSearchParams {
  start: string;
  end: string;
  calendarId?: string;
}

export interface CalendarFindAvailabilityParams {
  start: string;
  end: string;
  attendees?: string[];
  durationMinutes?: number;
}

export interface CalendarCreateEventParams {
  title: string;
  start: string;
  end: string;
  attendees?: string[];
  location?: string;
  description?: string;
  calendarId?: string;
}

export class CalendarConnectorAdapter implements ConnectorAdapter {
  private createdEvents: Array<(typeof mockEvents)[0]> = [];

  async execute(
    _instance: ConnectorInstance,
    request: ConnectorCallRequest
  ): Promise<unknown> {
    const { operation, params } = request;

    switch (operation) {
      case 'search_events':
        return this.searchEvents(params as unknown as CalendarSearchParams);
      case 'find_availability':
        return this.findAvailability(params as unknown as CalendarFindAvailabilityParams);
      case 'create_event':
        return this.createEvent(params as unknown as CalendarCreateEventParams);
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return [
      {
        capabilityId: 'calendar.search_events',
        name: 'Search Events',
        description: 'Search calendar events within a date range',
        category: 'search',
        riskLevel: 'low',
        inputSchema: {
          start: { type: 'string', required: true, description: 'Start date/time (ISO 8601)' },
          end: { type: 'string', required: true, description: 'End date/time (ISO 8601)' },
          calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
        },
        requiresAuth: true,
        supportedOperations: ['search_events'],
      },
      {
        capabilityId: 'calendar.find_availability',
        name: 'Find Availability',
        description: 'Find available time slots for attendees',
        category: 'read',
        riskLevel: 'low',
        inputSchema: {
          start: { type: 'string', required: true, description: 'Start of search window' },
          end: { type: 'string', required: true, description: 'End of search window' },
          attendees: { type: 'array', description: 'List of attendee emails' },
          durationMinutes: { type: 'number', description: 'Required duration in minutes' },
        },
        requiresAuth: true,
        supportedOperations: ['find_availability'],
      },
      {
        capabilityId: 'calendar.create_event',
        name: 'Create Event',
        description: 'Create a new calendar event',
        category: 'write',
        riskLevel: 'medium',
        inputSchema: {
          title: { type: 'string', required: true, description: 'Event title' },
          start: { type: 'string', required: true, description: 'Start time (ISO 8601)' },
          end: { type: 'string', required: true, description: 'End time (ISO 8601)' },
          attendees: { type: 'array', description: 'List of attendee emails' },
          location: { type: 'string', description: 'Event location' },
          description: { type: 'string', description: 'Event description' },
          calendarId: { type: 'string', description: 'Calendar ID' },
        },
        requiresAuth: true,
        supportedOperations: ['create_event'],
      },
    ];
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Calendar mock connector is healthy' };
  }

  private searchEvents(params: CalendarSearchParams): {
    events: typeof mockEvents;
    totalResults: number;
  } {
    const { start, end, calendarId } = params;
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    const allEvents = [...mockEvents, ...this.createdEvents];

    let results = allEvents.filter((event) => {
      const eventStart = new Date(event.start).getTime();
      const eventEnd = new Date(event.end).getTime();
      return eventStart >= startTime && eventEnd <= endTime;
    });

    if (calendarId) {
      results = results.filter((event) => event.calendarId === calendarId);
    }

    return {
      events: results,
      totalResults: results.length,
    };
  }

  private findAvailability(params: CalendarFindAvailabilityParams): {
    availableSlots: Array<{ start: string; end: string }>;
  } {
    const { start, end, durationMinutes = 60 } = params;
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    const allEvents = [...mockEvents, ...this.createdEvents];

    const busySlots = allEvents
      .filter(
        (event) =>
          new Date(event.end).getTime() > startTime &&
          new Date(event.start).getTime() < endTime
      )
      .map((event) => ({
        start: new Date(event.start).getTime(),
        end: new Date(event.end).getTime(),
      }))
      .sort((a, b) => a.start - b.start);

    const availableSlots: Array<{ start: string; end: string }> = [];
    let currentTime = startTime;
    const slotDurationMs = durationMinutes * 60 * 1000;

    for (const busy of busySlots) {
      if (currentTime + slotDurationMs <= busy.start) {
        availableSlots.push({
          start: new Date(currentTime).toISOString(),
          end: new Date(Math.min(currentTime + slotDurationMs, busy.start)).toISOString(),
        });
      }
      currentTime = Math.max(currentTime, busy.end);
    }

    if (currentTime + slotDurationMs <= endTime) {
      availableSlots.push({
        start: new Date(currentTime).toISOString(),
        end: new Date(currentTime + slotDurationMs).toISOString(),
      });
    }

    return { availableSlots };
  }

  private createEvent(params: CalendarCreateEventParams): (typeof mockEvents)[0] {
    const { title, start, end, attendees, location, description, calendarId } = params;

    const newEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title,
      start,
      end,
      attendees: attendees || [],
      location: location || '',
      description: description || '',
      calendarId: calendarId || 'primary',
    };

    this.createdEvents.push(newEvent);

    return newEvent;
  }
}

export function createCalendarConnectorAdapter(): CalendarConnectorAdapter {
  return new CalendarConnectorAdapter();
}
