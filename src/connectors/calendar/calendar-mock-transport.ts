import type {
  CalendarTransport,
  CalendarEvent,
  CalendarListEventsResponse,
  ListEventsParams,
  GetEventParams,
  CreateEventParams,
  UpdateEventParams,
  DeleteEventParams,
} from './calendar-types.js'

const mockEvents: CalendarEvent[] = [
  {
    id: 'event-001',
    summary: 'Team Standup',
    description: 'Daily team standup meeting',
    location: 'Conference Room A',
    start: { dateTime: '2024-01-15T09:00:00Z' },
    end: { dateTime: '2024-01-15T09:30:00Z' },
    attendees: [
      { email: 'user@example.com', responseStatus: 'accepted' },
      { email: 'boss@company.com', responseStatus: 'accepted' },
    ],
    organizer: { email: 'user@example.com', displayName: 'User', self: true },
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=event-001',
    created: '2024-01-01T08:00:00Z',
    updated: '2024-01-15T09:00:00Z',
  },
  {
    id: 'event-002',
    summary: 'Project Review',
    description: 'Quarterly project review with stakeholders',
    location: 'Zoom',
    start: { dateTime: '2024-01-15T14:00:00Z' },
    end: { dateTime: '2024-01-15T15:00:00Z' },
    attendees: [
      { email: 'user@example.com', responseStatus: 'accepted' },
      { email: 'manager@company.com', responseStatus: 'tentative' },
      { email: 'client@external.com', responseStatus: 'needsAction' },
    ],
    organizer: { email: 'manager@company.com', displayName: 'Manager' },
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=event-002',
    created: '2024-01-02T10:00:00Z',
    updated: '2024-01-15T14:00:00Z',
  },
  {
    id: 'event-003',
    summary: 'Lunch with Sarah',
    description: 'Catch up over lunch',
    location: 'Downtown Cafe',
    start: { dateTime: '2024-01-16T12:00:00Z' },
    end: { dateTime: '2024-01-16T13:00:00Z' },
    attendees: [
      { email: 'user@example.com', responseStatus: 'accepted' },
      { email: 'sarah@friend.com', responseStatus: 'accepted' },
    ],
    organizer: { email: 'user@example.com', displayName: 'User', self: true },
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=event-003',
    created: '2024-01-03T11:00:00Z',
    updated: '2024-01-16T12:00:00Z',
  },
]

export class CalendarMockTransport implements CalendarTransport {
  private validToken: string | null = null
  private createdEvents: CalendarEvent[] = []
  private nextId = 100

  setValidToken(token: string | null): void {
    this.validToken = token
  }

  async validateAuth(): Promise<boolean> {
    return this.validToken !== null
  }

  async listEvents(params: ListEventsParams): Promise<CalendarListEventsResponse> {
    this.checkAuth()

    const allEvents = [...mockEvents, ...this.createdEvents]
    let filtered = allEvents.filter((e) => e.status !== 'cancelled')

    if (params.timeMin) {
      const minTime = new Date(params.timeMin).getTime()
      filtered = filtered.filter((e) => {
        const eventStart = e.start.dateTime ? new Date(e.start.dateTime).getTime() : 0
        return eventStart >= minTime
      })
    }

    if (params.timeMax) {
      const maxTime = new Date(params.timeMax).getTime()
      filtered = filtered.filter((e) => {
        const eventEnd = e.end.dateTime ? new Date(e.end.dateTime).getTime() : Infinity
        return eventEnd <= maxTime
      })
    }

    if (params.q) {
      const query = params.q.toLowerCase()
      filtered = filtered.filter(
        (e) =>
          e.summary.toLowerCase().includes(query) || (e.description && e.description.toLowerCase().includes(query)),
      )
    }

    if (params.maxResults) {
      filtered = filtered.slice(0, params.maxResults)
    }

    return {
      kind: 'calendar#events',
      items: filtered,
      summary: 'primary',
      timeZone: 'UTC',
      updated: new Date().toISOString(),
    }
  }

  async getEvent(params: GetEventParams): Promise<CalendarEvent | null> {
    this.checkAuth()

    const allEvents = [...mockEvents, ...this.createdEvents]
    const event = allEvents.find((e) => e.id === params.eventId)
    return event ?? null
  }

  async createEvent(params: CreateEventParams): Promise<CalendarEvent> {
    this.checkAuth()

    const event: CalendarEvent = {
      id: `mock-event-${this.nextId++}`,
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.start,
      end: params.end,
      attendees: params.attendees?.map((a) => ({
        email: a.email,
        displayName: a.displayName,
        responseStatus: 'needsAction' as const,
      })),
      organizer: { email: 'user@example.com', displayName: 'User', self: true },
      status: 'confirmed',
      htmlLink: `https://calendar.google.com/event?eid=mock-event-${this.nextId - 1}`,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    }

    this.createdEvents.push(event)
    return event
  }

  async updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
    this.checkAuth()

    const allEvents = [...mockEvents, ...this.createdEvents]
    const existing = allEvents.find((e) => e.id === params.eventId)

    if (!existing) {
      throw new Error(`Event not found: ${params.eventId}`)
    }

    const updated: CalendarEvent = {
      ...existing,
      ...(params.summary !== undefined && { summary: params.summary }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.location !== undefined && { location: params.location }),
      ...(params.start !== undefined && { start: params.start }),
      ...(params.end !== undefined && { end: params.end }),
      ...(params.attendees !== undefined && {
        attendees: params.attendees.map((a) => ({
          email: a.email,
          displayName: a.displayName,
          responseStatus: 'needsAction' as const,
        })),
      }),
      ...(params.status !== undefined && { status: params.status }),
      updated: new Date().toISOString(),
    }

    const idx = this.createdEvents.findIndex((e) => e.id === params.eventId)
    if (idx >= 0) {
      this.createdEvents[idx] = updated
    }

    return updated
  }

  async deleteEvent(params: DeleteEventParams): Promise<void> {
    this.checkAuth()

    const idx = this.createdEvents.findIndex((e) => e.id === params.eventId)
    if (idx >= 0) {
      this.createdEvents.splice(idx, 1)
    }
  }

  private checkAuth(): void {
    if (this.validToken === null) {
      const error = new Error('Authentication required')
      ;(error as unknown as Record<string, unknown>).code = 'AUTH_INVALID'
      throw error
    }
  }
}

export function createCalendarMockTransport(): CalendarMockTransport {
  return new CalendarMockTransport()
}
