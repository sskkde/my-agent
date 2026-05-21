# Google Calendar Connector

The Google Calendar connector enables integration with Google Calendar API for managing calendar events.

## Overview

This connector provides read and write access to Google Calendar, allowing agents to:
- List events within a date range
- Get specific event details
- Create new events
- Update existing events
- Delete events

## Authentication

### OAuth2 Configuration

Google Calendar requires OAuth2 authentication. The connector supports the following OAuth2 flow:

1. **Authorization URL**: `https://accounts.google.com/o/oauth2/v2/auth`
2. **Token URL**: `https://oauth2.googleapis.com/token`

### Required Scopes

The connector uses least-privilege scopes for Google Calendar only:

| Scope | Description | Required For |
|-------|-------------|--------------|
| `https://www.googleapis.com/auth/calendar.events.readonly` | Read calendar events | `list_events`, `get_event` |
| `https://www.googleapis.com/auth/calendar.events` | Read and write events | All operations |

### Token Storage

OAuth2 tokens are encrypted at rest using AES-256-GCM before storage:
- Access tokens are stored in `authStateRef` field
- Encryption uses `APP_SECRET_KEY` environment variable
- Tokens are never returned in API responses

## Capabilities

### calendar.list_events

List calendar events within a date range.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID (default: `primary`) |
| `timeMin` | string | No | Lower bound for events (ISO 8601) |
| `timeMax` | string | No | Upper bound for events (ISO 8601) |
| `maxResults` | number | No | Maximum number of events to return |
| `singleEvents` | boolean | No | Expand recurring events |
| `orderBy` | string | No | Sort order: `startTime` or `updated` |
| `pageToken` | string | No | Token for pagination |
| `q` | string | No | Search query |

**Example:**
```typescript
const result = await connector.execute(instance, {
  operation: 'list_events',
  params: {
    calendarId: 'primary',
    timeMin: '2024-01-01T00:00:00Z',
    timeMax: '2024-01-31T23:59:59Z',
    maxResults: 50
  }
});
```

### calendar.get_event

Get a specific calendar event by ID.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID (default: `primary`) |
| `eventId` | string | Yes | Event ID to retrieve |

**Example:**
```typescript
const event = await connector.execute(instance, {
  operation: 'get_event',
  params: {
    eventId: 'event-123'
  }
});
```

### calendar.create_event

Create a new calendar event.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID (default: `primary`) |
| `summary` | string | Yes | Event title |
| `start` | object | Yes | Start time (`{ dateTime: string }` or `{ date: string }`) |
| `end` | object | Yes | End time (`{ dateTime: string }` or `{ date: string }`) |
| `description` | string | No | Event description |
| `location` | string | No | Event location |
| `attendees` | array | No | List of attendees `[{ email: string }]` |
| `reminders` | object | No | Reminder settings |

**Example:**
```typescript
const event = await connector.execute(instance, {
  operation: 'create_event',
  params: {
    summary: 'Team Meeting',
    start: { dateTime: '2024-02-01T10:00:00Z' },
    end: { dateTime: '2024-02-01T11:00:00Z' },
    description: 'Weekly team sync',
    location: 'Conference Room A',
    attendees: [
      { email: 'colleague@example.com' }
    ]
  }
});
```

### calendar.update_event

Update an existing calendar event.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID (default: `primary`) |
| `eventId` | string | Yes | Event ID to update |
| `summary` | string | No | Updated title |
| `description` | string | No | Updated description |
| `location` | string | No | Updated location |
| `start` | object | No | Updated start time |
| `end` | object | No | Updated end time |
| `attendees` | array | No | Updated attendee list |
| `status` | string | No | Event status: `confirmed`, `tentative`, `cancelled` |

**Example:**
```typescript
const event = await connector.execute(instance, {
  operation: 'update_event',
  params: {
    eventId: 'event-123',
    summary: 'Updated Meeting Title',
    location: 'Zoom'
  }
});
```

### calendar.delete_event

Delete a calendar event.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID (default: `primary`) |
| `eventId` | string | Yes | Event ID to delete |

**Example:**
```typescript
await connector.execute(instance, {
  operation: 'delete_event',
  params: {
    eventId: 'event-123'
  }
});
```

## Rate Limits

Google Calendar API has the following rate limits:
- **Per minute**: 1,500,000 requests per project
- **Per user**: 1,500,000 requests per user per minute

### Rate Limit Handling

The connector automatically handles rate limit errors:
- Detects HTTP 429 responses
- Implements exponential backoff retry
- Default retry configuration: 3 retries with 1s base delay

```typescript
const error = {
  code: 'RATE_LIMITED',
  message: 'Rate limit exceeded',
  recoverable: true,
  details: {
    statusCode: 429,
    rateLimitResetAt: '2024-01-15T10:00:00Z'
  }
};
```

## Timeout Configuration

The connector supports configurable timeouts:

| Setting | Default | Description |
|---------|---------|-------------|
| `timeout` | 30000ms | Request timeout |
| `retries` | 3 | Number of retries on transient errors |
| `retryDelay` | 1000ms | Base delay for exponential backoff |

### Per-Request Timeout

You can override timeout per request:

```typescript
const request = {
  requestId: 'req-001',
  connectorInstanceId: 'instance-001',
  operation: 'list_events',
  params: { timeMin: '2024-01-01T00:00:00Z' },
  userId: 'user-001',
  timeoutMs: 60000  // 60 second override
};
```

## Error Handling

The connector uses a structured error taxonomy:

| Code | Description | Recoverable | HTTP Status |
|------|-------------|-------------|-------------|
| `AUTH_INVALID` | Invalid or expired OAuth token | No | 401 |
| `AUTH_EXPIRED` | Token has expired | Yes | 401 |
| `FORBIDDEN` | Access denied to resource | No | 403 |
| `NOT_FOUND` | Event or calendar not found | No | 404 |
| `RATE_LIMITED` | Rate limit exceeded | Yes | 429 |
| `VALIDATION_ERROR` | Invalid request parameters | No | 400 |
| `NETWORK_ERROR` | Network connectivity issue | Yes | - |
| `UNKNOWN_ERROR` | Unexpected error | No | - |

### Error Response Structure

```typescript
interface CalendarError {
  code: CalendarErrorCode;
  message: string;
  recoverable: boolean;
  details?: {
    statusCode?: number;
    rateLimitRemaining?: number;
    rateLimitResetAt?: string;
  };
}
```

## Mock Mode

For development and testing, the connector supports mock mode:

### Enable Mock Mode

```bash
# Environment variable
CALENDAR_MOCK_MODE=true

# Or in code
const adapter = createCalendarConnectorAdapter({ useMock: true });
```

### Mock Behavior

The mock transport provides:
- Pre-configured sample events
- Simulated authentication
- No real HTTP calls
- Consistent response structure

### Mock Data

Default mock events include:
- Team Standup (event-001)
- Project Review (event-002)
- Lunch with Sarah (event-003)

## Security

### Credential Encryption

OAuth tokens are encrypted using AES-256-GCM:
- Encryption key derived from `APP_SECRET_KEY`
- Format: `aes-256-gcm:iv:authTag:encrypted`
- Tokens never appear in logs or API responses

### Audit Events

All connector operations emit audit events:
- `connector_call_executed` - Successful operation
- `connector_call_failed` - Failed operation
- `connector_instance_created` - Instance creation

### Token Redaction

Sensitive data is redacted from:
- Log output
- API error responses
- Audit payloads

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_SECRET_KEY` | Yes | Key for encrypting OAuth tokens |
| `CALENDAR_MOCK_MODE` | No | Enable mock mode (`true`/`false`) |

### Instance Configuration

```typescript
const instance = {
  connectorInstanceId: 'my-calendar',
  connectorDefinitionId: 'definition-id',
  userId: 'user-123',
  name: 'My Google Calendar',
  authStateRef: encryptedToken,  // Encrypted OAuth token
  config: {
    defaultCalendarId: 'primary'
  },
  status: 'active'
};
```

## Examples

### List Today's Events

```typescript
const today = new Date();
const timeMin = new Date(today.setHours(0, 0, 0, 0)).toISOString();
const timeMax = new Date(today.setHours(23, 59, 59, 999)).toISOString();

const result = await connector.execute(instance, {
  operation: 'list_events',
  params: {
    timeMin,
    timeMax,
    orderBy: 'startTime',
    singleEvents: true
  }
});

console.log(`Found ${result.items.length} events today`);
```

### Create a Recurring Meeting

```typescript
const event = await connector.execute(instance, {
  operation: 'create_event',
  params: {
    summary: 'Weekly Team Sync',
    start: { dateTime: '2024-02-05T10:00:00Z' },
    end: { dateTime: '2024-02-05T11:00:00Z' },
    recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    attendees: [
      { email: 'team@example.com' }
    ]
  }
});
```

### Search Events

```typescript
const result = await connector.execute(instance, {
  operation: 'list_events',
  params: {
    timeMin: '2024-01-01T00:00:00Z',
    timeMax: '2024-12-31T23:59:59Z',
    q: 'important meeting'
  }
});
```
