# Google Contacts Connector

The Google Contacts connector enables integration with Google's People API for managing contacts.

## Overview

This connector provides read and write access to Google Contacts through the People API. It supports listing, searching, retrieving, and creating contacts with OAuth2 authentication.

## Authentication

### OAuth2 Configuration

The connector uses OAuth2 for authentication with Google's People API.

**Required OAuth2 Scope:**

```
https://www.googleapis.com/auth/contacts
```

This is the only scope required - the connector follows the principle of least privilege and does not request additional Google service permissions.

### Token Storage

OAuth2 access tokens are stored encrypted using AES-256-GCM in the `authStateRef` field. Tokens are never stored in plaintext.

```typescript
// Token encryption example
const encrypted = ContactsConnectorAdapter.encryptAccessToken(accessToken)
// Format: "aes-256-gcm:<iv>:<authTag>:<encrypted>"
```

## Capabilities

| Capability                 | Category | Risk Level | Description                                     |
| -------------------------- | -------- | ---------- | ----------------------------------------------- |
| `contacts.list_contacts`   | read     | low        | List all contacts with pagination               |
| `contacts.get_contact`     | read     | low        | Retrieve a specific contact by resource name    |
| `contacts.search_contacts` | read     | low        | Search contacts by name, email, or other fields |
| `contacts.create_contact`  | write    | medium     | Create a new contact                            |

### List Contacts

```typescript
const result = await connector.executeCall({
  requestId: 'req-001',
  connectorInstanceId: 'instance-001',
  capabilityId: 'contacts.list_contacts',
  operation: 'list_contacts',
  params: {
    pageSize: 50,
    pageToken: undefined, // Optional: for pagination
    personFields: 'names,emailAddresses,phoneNumbers,organizations',
  },
  userId: 'user-001',
})
```

**Response:**

```typescript
{
  contacts: Contact[];
  nextPageToken?: string;
  totalSize: number;
  syncToken?: string;
}
```

### Get Contact

```typescript
const result = await connector.executeCall({
  requestId: 'req-002',
  connectorInstanceId: 'instance-001',
  capabilityId: 'contacts.get_contact',
  operation: 'get_contact',
  params: {
    resourceName: 'people/123456789',
    personFields: 'names,emailAddresses,phoneNumbers',
  },
  userId: 'user-001',
})
```

### Search Contacts

```typescript
const result = await connector.executeCall({
  requestId: 'req-003',
  connectorInstanceId: 'instance-001',
  capabilityId: 'contacts.search_contacts',
  operation: 'search_contacts',
  params: {
    query: 'john doe',
    pageSize: 10,
    readMask: 'names,emailAddresses,phoneNumbers',
  },
  userId: 'user-001',
})
```

### Create Contact

```typescript
const result = await connector.executeCall({
  requestId: 'req-004',
  connectorInstanceId: 'instance-001',
  capabilityId: 'contacts.create_contact',
  operation: 'create_contact',
  params: {
    contact: {
      names: [{ givenName: 'John', familyName: 'Doe' }],
      emailAddresses: [{ value: 'john.doe@example.com', type: 'work' }],
      phoneNumbers: [{ value: '+1-555-0100', type: 'mobile' }],
      organizations: [{ name: 'Acme Corp', title: 'Engineer' }],
    },
  },
  userId: 'user-001',
})
```

## Configuration

### Environment Variables

| Variable             | Description                    | Default |
| -------------------- | ------------------------------ | ------- |
| `CONTACTS_MOCK_MODE` | Use mock transport for testing | `false` |

### Mock Mode

For development and testing, enable mock mode to avoid making real HTTP calls:

```bash
export CONTACTS_MOCK_MODE=true
```

Or configure programmatically:

```typescript
const adapter = createContactsConnectorAdapter({ useMock: true })
```

## Error Handling

### Error Codes

| Code               | Description                       | Recoverable |
| ------------------ | --------------------------------- | ----------- |
| `AUTH_INVALID`     | Invalid or missing authentication | No          |
| `AUTH_EXPIRED`     | OAuth token has expired           | No          |
| `RATE_LIMITED`     | API rate limit exceeded           | Yes         |
| `NOT_FOUND`        | Contact not found                 | No          |
| `FORBIDDEN`        | Insufficient permissions          | No          |
| `VALIDATION_ERROR` | Invalid request parameters        | No          |
| `NETWORK_ERROR`    | Network/timeout error             | Yes         |
| `UNKNOWN_ERROR`    | Unexpected error                  | No          |

### Rate Limiting

The connector handles HTTP 429 (rate limit) responses automatically:

- Retries with exponential backoff (default: 3 retries)
- Returns `retryAfterMs` in response metadata when available
- Rate limit errors are marked as `recoverable: true`

### Timeout Configuration

Default timeout is 30 seconds. Configure via transport options:

```typescript
const transport = new GooglePeopleApiTransport(accessToken)
// BaseHttpTransport uses 30000ms default
```

## Security

### Token Redaction

OAuth tokens are redacted from all logs and API responses:

- Tokens stored encrypted in database
- Tokens never appear in error messages
- JSON serialization excludes plaintext tokens
- Audit logs contain only encrypted references

### Least Privilege

The connector requests only the `contacts` scope:

```
https://www.googleapis.com/auth/contacts
```

Additional scopes are NOT requested:

- No Gmail access
- No Drive access
- No Calendar access
- No other Google service access

## API Reference

### Base URL

```
https://people.googleapis.com/v1
```

### Default Person Fields

```typescript
const DEFAULT_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,addresses,photos,urls,biographies'
```

## Testing

### Unit Tests

```bash
npm test -- tests/integration/connectors/contacts-ga.test.ts
```

### GA Certification

The connector passes all GA (General Availability) certification requirements:

1. Auth mode documented (OAuth2)
2. Secret encrypted (AES-256-GCM)
3. Least privilege scopes (contacts only)
4. Rate limit handling (429 with retry)
5. Timeout handling (configurable)
6. Error taxonomy (structured codes)
7. Mock mode (development/testing)
8. Real HTTP mode (BaseHttpTransport)
9. Audit events (all calls logged)
10. Token redaction (never exposed)

## Troubleshooting

### Authentication Issues

**Problem:** `AUTH_INVALID` error on all requests

**Solution:** Verify OAuth token is valid and not expired. Re-authenticate if necessary.

### Rate Limiting

**Problem:** Frequent `RATE_LIMITED` errors

**Solution:** Implement request batching or add client-side rate limiting. Google People API has quotas per project.

### Missing Fields

**Problem:** Contact data missing expected fields

**Solution:** Ensure `personFields` or `readMask` includes the required fields:

```typescript
personFields: 'names,emailAddresses,phoneNumbers,organizations,addresses'
```

## Migration Notes

When upgrading from previous versions:

1. OAuth tokens must be re-encrypted if encryption key changed
2. Check for deprecated API endpoints
3. Verify `personFields` includes all required fields
