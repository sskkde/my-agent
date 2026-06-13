import type { ConnectorAdapter, ConnectorCapability, ConnectorCallRequest } from '../types.js'
import type { ConnectorInstance } from '../../storage/connector-store.js'
import type {
  CalendarTransport,
  CalendarEvent,
  CalendarListEventsResponse,
  ListEventsParams,
  GetEventParams,
  CreateEventParams,
  UpdateEventParams,
  DeleteEventParams,
  CalendarError,
} from './calendar-types.js'
import { BaseHttpTransport, TransportError } from '../base-http-transport.js'
import type { HttpTransportConfig } from '../base-http-transport-types.js'
import { CalendarMockTransport } from './calendar-mock-transport.js'

const GOOGLE_CALENDAR_BASE_URL = 'https://www.googleapis.com/calendar/v3'
const GOOGLE_CALENDAR_TIMEOUT_MS = 5000

const CALENDAR_CAPABILITIES: ConnectorCapability[] = [
  {
    capabilityId: 'calendar.list_events',
    name: 'List Events',
    description: 'List calendar events within a date range',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
      timeMin: { type: 'string', description: 'Lower bound (ISO 8601)' },
      timeMax: { type: 'string', description: 'Upper bound (ISO 8601)' },
      maxResults: { type: 'number', description: 'Max number of events' },
      q: { type: 'string', description: 'Search query' },
    },
    requiresAuth: true,
    supportedOperations: ['list_events'],
  },
  {
    capabilityId: 'calendar.get_event',
    name: 'Get Event',
    description: 'Get a specific calendar event by ID',
    category: 'read',
    riskLevel: 'low',
    inputSchema: {
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
      eventId: { type: 'string', description: 'Event ID' },
    },
    requiresAuth: true,
    supportedOperations: ['get_event'],
  },
  {
    capabilityId: 'calendar.create_event',
    name: 'Create Event',
    description: 'Create a new calendar event',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
      summary: { type: 'string', description: 'Event title' },
      start: { type: 'object', description: 'Start time' },
      end: { type: 'object', description: 'End time' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
      attendees: { type: 'array', description: 'Attendee list' },
    },
    requiresAuth: true,
    supportedOperations: ['create_event'],
  },
  {
    capabilityId: 'calendar.update_event',
    name: 'Update Event',
    description: 'Update an existing calendar event',
    category: 'write',
    riskLevel: 'medium',
    inputSchema: {
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
      eventId: { type: 'string', description: 'Event ID' },
      summary: { type: 'string', description: 'Updated title' },
      description: { type: 'string', description: 'Updated description' },
      location: { type: 'string', description: 'Updated location' },
      start: { type: 'object', description: 'Updated start time' },
      end: { type: 'object', description: 'Updated end time' },
    },
    requiresAuth: true,
    supportedOperations: ['update_event'],
  },
  {
    capabilityId: 'calendar.delete_event',
    name: 'Delete Event',
    description: 'Delete a calendar event',
    category: 'delete',
    riskLevel: 'high',
    inputSchema: {
      calendarId: { type: 'string', description: 'Calendar ID (default: primary)' },
      eventId: { type: 'string', description: 'Event ID' },
    },
    requiresAuth: true,
    supportedOperations: ['delete_event'],
  },
]

export interface CalendarConnectorConfig {
  transport?: CalendarTransport
  useMock?: boolean
}

export class CalendarConnectorAdapter implements ConnectorAdapter {
  private transport: CalendarTransport

  constructor(config: CalendarConnectorConfig = {}) {
    if (config.transport) {
      this.transport = config.transport
    } else if (config.useMock || process.env.CALENDAR_MOCK_MODE === 'true') {
      this.transport = new CalendarMockTransport()
    } else {
      this.transport = new CalendarRealTransport()
    }
  }

  async execute(_instance: ConnectorInstance, request: ConnectorCallRequest): Promise<unknown> {
    const { operation, params } = request

    switch (operation) {
      case 'list_events':
        return this.listEvents(params as unknown as ListEventsParams)

      case 'get_event':
        return this.getEvent(params as unknown as GetEventParams)

      case 'create_event':
        return this.createEvent(params as unknown as CreateEventParams)

      case 'update_event':
        return this.updateEvent(params as unknown as UpdateEventParams)

      case 'delete_event':
        return this.deleteEvent(params as unknown as DeleteEventParams)

      default:
        throw new Error(`Unknown operation: ${operation}`)
    }
  }

  discoverCapabilities(_instance: ConnectorInstance): ConnectorCapability[] {
    return CALENDAR_CAPABILITIES
  }

  checkHealth(_instance: ConnectorInstance): { healthy: boolean; message?: string } {
    return { healthy: true, message: 'Calendar connector is healthy' }
  }

  private async listEvents(params: ListEventsParams): Promise<CalendarListEventsResponse> {
    return this.transport.listEvents(params)
  }

  private async getEvent(params: GetEventParams): Promise<CalendarEvent | null> {
    return this.transport.getEvent(params)
  }

  private async createEvent(params: CreateEventParams): Promise<CalendarEvent> {
    return this.transport.createEvent(params)
  }

  private async updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
    return this.transport.updateEvent(params)
  }

  private async deleteEvent(params: DeleteEventParams): Promise<void> {
    return this.transport.deleteEvent(params)
  }
}

export class CalendarRealTransport implements CalendarTransport {
  private http: BaseHttpTransport

  constructor(accessToken?: string) {
    const config: HttpTransportConfig = {
      baseURL: GOOGLE_CALENDAR_BASE_URL,
      timeout: GOOGLE_CALENDAR_TIMEOUT_MS,
      retries: 0,
      headers: {
        Accept: 'application/json',
      },
      auth: accessToken ? { type: 'oauth2', credentials: accessToken } : undefined,
    }
    this.http = new BaseHttpTransport(config)
  }

  async listEvents(params: ListEventsParams): Promise<CalendarListEventsResponse> {
    const calendarId = params.calendarId ?? 'primary'
    const queryParams: Record<string, string> = {}

    if (params.timeMin) queryParams.timeMin = params.timeMin
    if (params.timeMax) queryParams.timeMax = params.timeMax
    if (params.maxResults) queryParams.maxResults = String(params.maxResults)
    if (params.singleEvents !== undefined) queryParams.singleEvents = String(params.singleEvents)
    if (params.orderBy) queryParams.orderBy = params.orderBy
    if (params.pageToken) queryParams.pageToken = params.pageToken
    if (params.q) queryParams.q = params.q

    try {
      const response = await this.http.get<CalendarListEventsResponse>(`/calendars/${calendarId}/events`, queryParams)
      return response.body!
    } catch (err) {
      throw this.classifyError(err)
    }
  }

  async getEvent(params: GetEventParams): Promise<CalendarEvent | null> {
    const calendarId = params.calendarId ?? 'primary'

    try {
      const response = await this.http.get<CalendarEvent>(`/calendars/${calendarId}/events/${params.eventId}`)
      return response.body ?? null
    } catch (err) {
      if (err instanceof TransportError && err.statusCode === 404) {
        return null
      }
      throw this.classifyError(err)
    }
  }

  async createEvent(params: CreateEventParams): Promise<CalendarEvent> {
    const calendarId = params.calendarId ?? 'primary'
    const body = this.buildEventBody(params)

    try {
      const response = await this.http.post<CalendarEvent>(`/calendars/${calendarId}/events`, body)
      return response.body!
    } catch (err) {
      throw this.classifyError(err)
    }
  }

  async updateEvent(params: UpdateEventParams): Promise<CalendarEvent> {
    const calendarId = params.calendarId ?? 'primary'
    const body = this.buildUpdateBody(params)

    try {
      const response = await this.http.put<CalendarEvent>(`/calendars/${calendarId}/events/${params.eventId}`, body)
      return response.body!
    } catch (err) {
      throw this.classifyError(err)
    }
  }

  async deleteEvent(params: DeleteEventParams): Promise<void> {
    const calendarId = params.calendarId ?? 'primary'

    try {
      await this.http.delete(`/calendars/${calendarId}/events/${params.eventId}`)
    } catch (err) {
      throw this.classifyError(err)
    }
  }

  async validateAuth(): Promise<boolean> {
    try {
      await this.http.get<unknown>('/users/me/calendarList', { maxResults: '1' })
      return true
    } catch {
      return false
    }
  }

  private buildEventBody(params: CreateEventParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      summary: params.summary,
      start: params.start,
      end: params.end,
    }

    if (params.description) body.description = params.description
    if (params.location) body.location = params.location
    if (params.attendees) body.attendees = params.attendees
    if (params.reminders) body.reminders = params.reminders

    return body
  }

  private buildUpdateBody(params: UpdateEventParams): Record<string, unknown> {
    const body: Record<string, unknown> = {}

    if (params.summary !== undefined) body.summary = params.summary
    if (params.description !== undefined) body.description = params.description
    if (params.location !== undefined) body.location = params.location
    if (params.start !== undefined) body.start = params.start
    if (params.end !== undefined) body.end = params.end
    if (params.attendees !== undefined) body.attendees = params.attendees
    if (params.status !== undefined) body.status = params.status

    return body
  }

  private classifyError(err: unknown): CalendarError {
    if (err instanceof TransportError) {
      if (err.type === 'auth') {
        return {
          code: err.statusCode === 401 ? 'AUTH_INVALID' : 'FORBIDDEN',
          message: err.message,
          recoverable: false,
          details: { statusCode: err.statusCode },
        }
      }
      if (err.type === 'rate_limit') {
        return {
          code: 'RATE_LIMITED',
          message: err.message,
          recoverable: true,
          details: { statusCode: err.statusCode },
        }
      }
      if (err.statusCode === 404) {
        return {
          code: 'NOT_FOUND',
          message: err.message,
          recoverable: false,
          details: { statusCode: 404 },
        }
      }
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
      recoverable: false,
    }
  }
}

export function createCalendarConnectorAdapter(config?: CalendarConnectorConfig): CalendarConnectorAdapter {
  return new CalendarConnectorAdapter(config)
}
