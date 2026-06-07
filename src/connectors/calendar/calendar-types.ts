export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: {
    dateTime?: string
    date?: string
  }
  end: {
    dateTime?: string
    date?: string
  }
  attendees?: CalendarAttendee[]
  organizer?: CalendarOrganizer
  status?: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  created?: string
  updated?: string
  recurrence?: string[]
  reminders?: {
    useDefault: boolean
    overrides?: Array<{
      method: 'email' | 'popup'
      minutes: number
    }>
  }
}

export interface CalendarAttendee {
  email: string
  displayName?: string
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted'
  optional?: boolean
}

export interface CalendarOrganizer {
  email: string
  displayName?: string
  self?: boolean
}

export interface CalendarListEventsResponse {
  kind: 'calendar#events'
  items: CalendarEvent[]
  nextPageToken?: string
  summary?: string
  timeZone?: string
  accessRole?: string
  updated?: string
}

export interface CalendarGetEventResponse extends CalendarEvent {}

export interface ListEventsParams {
  calendarId?: string // default: 'primary'
  timeMin?: string // ISO 8601
  timeMax?: string // ISO 8601
  maxResults?: number
  singleEvents?: boolean
  orderBy?: 'startTime' | 'updated'
  pageToken?: string
  q?: string // search query
}

export interface GetEventParams {
  calendarId?: string // default: 'primary'
  eventId: string
}

export interface CreateEventParams {
  calendarId?: string // default: 'primary'
  summary: string
  description?: string
  location?: string
  start: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: Array<{ email: string; displayName?: string }>
  reminders?: {
    useDefault?: boolean
    overrides?: Array<{
      method: 'email' | 'popup'
      minutes: number
    }>
  }
}

export interface UpdateEventParams {
  calendarId?: string // default: 'primary'
  eventId: string
  summary?: string
  description?: string
  location?: string
  start?: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  end?: {
    dateTime?: string
    date?: string
    timeZone?: string
  }
  attendees?: Array<{ email: string; displayName?: string }>
  status?: 'confirmed' | 'tentative' | 'cancelled'
}

export interface DeleteEventParams {
  calendarId?: string // default: 'primary'
  eventId: string
}

export interface CalendarAuthConfig {
  accessToken: string // OAuth2 access token (encrypted at rest)
}

export type CalendarErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR'

export interface CalendarError {
  code: CalendarErrorCode
  message: string
  recoverable: boolean
  details?: {
    statusCode?: number
    rateLimitRemaining?: number
    rateLimitResetAt?: string
  }
}

export interface CalendarTransport {
  listEvents(params: ListEventsParams): Promise<CalendarListEventsResponse>
  getEvent(params: GetEventParams): Promise<CalendarEvent | null>
  createEvent(params: CreateEventParams): Promise<CalendarEvent>
  updateEvent(params: UpdateEventParams): Promise<CalendarEvent>
  deleteEvent(params: DeleteEventParams): Promise<void>
  validateAuth(): Promise<boolean>
}
