# Generic HTTP Connector

The Generic HTTP Connector allows you to integrate any HTTP-based API into the agent platform without writing custom connector code. Define your API endpoints using configuration, and the connector handles authentication, request formatting, and response parsing.

## Features

- **Multi-Authentication Support**: Bearer token, API key, Basic auth, and OAuth2
- **OpenAPI Import**: Automatically generate operations from OpenAPI 3.x specifications
- **Template Variables**: Use `{{variable}}` placeholders in paths, headers, and bodies
- **Response Mapping**: Extract specific fields from JSON responses using JSONPath
- **Configurable Timeouts**: Set custom timeouts per connector instance
- **Automatic Retries**: Built-in retry logic for transient failures
- **Health Checking**: Sync and async health validation

## Quick Start

### Basic Configuration

```json
{
  "baseURL": "https://api.example.com",
  "auth": {
    "type": "bearer",
    "credentials": {
      "token": "your-api-token"
    }
  },
  "requestTemplates": [
    {
      "operationId": "get_user",
      "method": "GET",
      "path": "/users/{{user_id}}",
      "description": "Get user by ID",
      "category": "read",
      "riskLevel": "low"
    },
    {
      "operationId": "create_user",
      "method": "POST",
      "path": "/users",
      "bodyTemplate": {
        "name": "{{name}}",
        "email": "{{email}}"
      },
      "description": "Create a new user",
      "category": "write",
      "riskLevel": "medium"
    }
  ]
}
```

## Authentication Methods

### Bearer Token

```json
{
  "auth": {
    "type": "bearer",
    "credentials": {
      "token": "your-bearer-token"
    }
  }
}
```

Sends: `Authorization: Bearer your-bearer-token`

### API Key

```json
{
  "auth": {
    "type": "api_key",
    "credentials": {
      "api_key": "your-api-key"
    }
  }
}
```

Sends: `X-API-Key: your-api-key`

### Basic Authentication

```json
{
  "auth": {
    "type": "basic",
    "credentials": {
      "username": "your-username",
      "password": "your-password"
    }
  }
}
```

Sends: `Authorization: Basic base64(username:password)`

### OAuth2

```json
{
  "auth": {
    "type": "oauth2",
    "credentials": {
      "access_token": "your-access-token"
    }
  }
}
```

Sends: `Authorization: Bearer your-access-token`

## Request Templates

### Template Structure

| Field          | Type   | Required | Description                                             |
| -------------- | ------ | -------- | ------------------------------------------------------- |
| `operationId`  | string | Yes      | Unique identifier for the operation                     |
| `method`       | string | Yes      | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`    |
| `path`         | string | Yes      | URL path with `{{variable}}` placeholders               |
| `headers`      | object | No       | Additional headers with `{{variable}}` placeholders     |
| `bodyTemplate` | object | No       | JSON body template with `{{variable}}` placeholders     |
| `description`  | string | No       | Human-readable description                              |
| `category`     | string | No       | Operation category: `read`, `write`, `execute`, `admin` |
| `riskLevel`    | string | No       | Risk level: `low`, `medium`, `high`, `restricted`       |

### Variable Substitution

Variables in `{{variable}}` format are replaced with values from the request parameters:

```json
{
  "operationId": "get_user_post",
  "method": "GET",
  "path": "/users/{{user_id}}/posts/{{post_id}}",
  "headers": {
    "X-Request-ID": "{{request_id}}"
  }
}
```

When called with `{ "user_id": "123", "post_id": "456", "request_id": "abc" }`:

- Path becomes: `/users/123/posts/456`
- Header `X-Request-ID` becomes: `abc`

### Query Parameters

Parameters not used in path or headers are automatically added as query parameters:

```json
{
  "operationId": "search_users",
  "method": "GET",
  "path": "/users"
}
```

Calling with `{ "q": "john", "limit": 10 }` produces: `/users?q=john&limit=10`

## Response Mapping

Extract specific fields from JSON responses using JSONPath:

```json
{
  "responseMappings": {
    "list_users": {
      "jsonPath": "data.items"
    }
  }
}
```

For response `{ "data": { "items": [...] } }`, returns the items array directly.

## OpenAPI Import

Import operations from an OpenAPI 3.x specification:

### From Inline Spec

```json
{
  "baseURL": "https://api.example.com",
  "openApiImport": {
    "specObject": {
      "openapi": "3.0.0",
      "info": { "title": "My API", "version": "1.0.0" },
      "servers": [{ "url": "https://api.example.com" }],
      "paths": {
        "/users": {
          "get": {
            "operationId": "listUsers",
            "summary": "List all users"
          }
        }
      }
    }
  }
}
```

### From URL

```json
{
  "openApiImport": {
    "specUrl": "https://api.example.com/openapi.json"
  }
}
```

### Override Base Path

```json
{
  "openApiImport": {
    "specObject": { ... },
    "basePathOverride": "https://custom.api.example.com"
  }
}
```

### Merge with Manual Templates

OpenAPI imported operations are merged with manually defined `requestTemplates`:

```json
{
  "baseURL": "https://api.example.com",
  "requestTemplates": [
    { "operationId": "custom_op", "method": "GET", "path": "/custom" }
  ],
  "openApiImport": {
    "specObject": { ... }
  }
}
```

## Configuration Options

| Field              | Type   | Default   | Description                     |
| ------------------ | ------ | --------- | ------------------------------- |
| `baseURL`          | string | Required  | Base URL for all requests       |
| `defaultHeaders`   | object | `{}`      | Headers applied to all requests |
| `auth`             | object | None      | Authentication configuration    |
| `requestTemplates` | array  | Required  | Operation definitions           |
| `responseMappings` | object | `{}`      | JSONPath extraction rules       |
| `openApiImport`    | object | None      | OpenAPI import configuration    |
| `timeout`          | number | 30000     | Request timeout in milliseconds |
| `retries`          | number | 3         | Number of retry attempts        |
| `retryDelay`       | number | 1000      | Base delay between retries (ms) |
| `healthCheckPath`  | string | `/health` | Health check endpoint           |

## Error Handling

The connector returns structured errors:

| Code              | Description                     | Recoverable           |
| ----------------- | ------------------------------- | --------------------- |
| `AUTH_ERROR`      | Authentication failed (401/403) | No                    |
| `TRANSPORT_ERROR` | Network/server error            | Depends on error type |

### HTTP Status Code Mapping

| Status   | Error Type   | Retryable |
| -------- | ------------ | --------- |
| 401, 403 | `auth`       | No        |
| 429      | `rate_limit` | Yes       |
| 500-503  | `server`     | Yes       |
| Timeout  | `timeout`    | Yes       |
| Network  | `network`    | Yes       |

## Security

### Secret Storage

API keys and tokens are encrypted at rest using AES-256-GCM. Credentials are stored in `authStateRef` and never logged in plaintext.

### Least Privilege

The Generic HTTP connector does not use OAuth scopes. Instead:

- Define per-operation `riskLevel` to control access
- Use `category` to classify operations (read/write/execute/admin)
- Configure approval requirements in connector policy

### Redaction

Sensitive headers are automatically redacted in logs:

- `Authorization`
- `X-API-Key`
- `Cookie`

## Mock Mode

For testing, enable mock mode via environment variable:

```bash
GENERIC_HTTP_MOCK_MODE=true
```

Mock responses by HTTP method:

| Method | Mock Response                                             |
| ------ | --------------------------------------------------------- |
| GET    | `{ "status": "ok", "data": [], "mock": true }`            |
| POST   | `{ "status": "created", "id": "mock-001", "mock": true }` |
| PUT    | `{ "status": "updated", "mock": true }`                   |
| PATCH  | `{ "status": "patched", "mock": true }`                   |
| DELETE | `{ "status": "deleted", "mock": true }`                   |

## Capabilities

Each `requestTemplate` becomes a discoverable capability:

```typescript
{
  capabilityId: "generic_http.get_user",
  name: "Get user by ID",
  description: "GET /users/{{user_id}}",
  category: "read",
  riskLevel: "low",
  inputSchema: {
    type: "object",
    properties: {
      user_id: { type: "string", in: "path" }
    },
    required: ["user_id"]
  },
  requiresAuth: true,
  supportedOperations: ["get_user"]
}
```

## API Endpoints

### Create Instance

```bash
POST /api/v1/connectors/instances
{
  "connectorDefinitionId": "generic-http",
  "name": "My API Connector",
  "config": { ... },
  "authStateRef": "encrypted:..."
}
```

### Execute Operation

```bash
POST /api/v1/connectors/instances/{instanceId}/execute
{
  "operation": "get_user",
  "params": {
    "user_id": "123"
  }
}
```

## Examples

### GitHub API

```json
{
  "baseURL": "https://api.github.com",
  "auth": {
    "type": "bearer",
    "credentials": { "token": "{{github_token}}" }
  },
  "defaultHeaders": {
    "Accept": "application/vnd.github.v3+json"
  },
  "requestTemplates": [
    {
      "operationId": "list_repos",
      "method": "GET",
      "path": "/user/repos",
      "description": "List user repositories",
      "category": "read",
      "riskLevel": "low"
    },
    {
      "operationId": "create_issue",
      "method": "POST",
      "path": "/repos/{{owner}}/{{repo}}/issues",
      "bodyTemplate": {
        "title": "{{title}}",
        "body": "{{body}}"
      },
      "description": "Create an issue",
      "category": "write",
      "riskLevel": "medium"
    }
  ]
}
```

### Slack API

```json
{
  "baseURL": "https://slack.com/api",
  "auth": {
    "type": "bearer",
    "credentials": { "token": "{{slack_bot_token}}" }
  },
  "requestTemplates": [
    {
      "operationId": "post_message",
      "method": "POST",
      "path": "/chat.postMessage",
      "bodyTemplate": {
        "channel": "{{channel}}",
        "text": "{{text}}"
      },
      "description": "Post a message to a channel",
      "category": "write",
      "riskLevel": "medium"
    }
  ],
  "responseMappings": {
    "post_message": { "jsonPath": "message" }
  }
}
```

### Stripe API

```json
{
  "baseURL": "https://api.stripe.com/v1",
  "auth": {
    "type": "bearer",
    "credentials": { "token": "{{stripe_secret_key}}" }
  },
  "requestTemplates": [
    {
      "operationId": "create_customer",
      "method": "POST",
      "path": "/customers",
      "bodyTemplate": {
        "email": "{{email}}",
        "name": "{{name}}"
      },
      "description": "Create a Stripe customer",
      "category": "write",
      "riskLevel": "medium"
    },
    {
      "operationId": "get_customer",
      "method": "GET",
      "path": "/customers/{{customer_id}}",
      "description": "Get customer by ID",
      "category": "read",
      "riskLevel": "low"
    }
  ]
}
```
