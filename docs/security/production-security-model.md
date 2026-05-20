# Production Security Model

This document describes the comprehensive security model for the Agent Platform in production environments.

## Table of Contents

1. [Authentication Methods](#authentication-methods)
2. [Authorization (RBAC)](#authorization-rbac)
3. [API Security](#api-security)
4. [Data Protection](#data-protection)
5. [Network Security](#network-security)
6. [Audit and Monitoring](#audit-and-monitoring)
7. [Production Guard](#production-guard)

---

## Authentication Methods

The platform supports three authentication methods:

### 1. Cookie Session (Web Users)

Web users authenticate via secure HTTP-only cookies:

- **Session Token**: Randomly generated 256-bit token stored in `agent-platform-session` cookie
- **Storage**: Tokens are SHA-256 hashed before storage in the `auth_tokens` table
- **Expiration**: Default 24 hours, configurable via `SESSION_TTL_HOURS`
- **Cookie Attributes**:
  - `HttpOnly`: Prevents JavaScript access
  - `SameSite=Lax`: Prevents CSRF attacks
  - `Secure`: Added automatically in production (`NODE_ENV=production`)
  - `Path=/`: Available across all routes

**Login Flow**:
1. User submits credentials to `POST /api/v1/auth/login`
2. Server validates credentials against stored password hash
3. Server generates session token and stores hash in database
4. Server sets `agent-platform-session` cookie in response
5. Subsequent requests include cookie for authentication

### 2. API Key (Service-to-Service)

Service accounts and integrations use API keys:

- **Format**: `ak_` prefix followed by 64 hex characters (256 bits)
- **Storage**: SHA-256 hash stored in `api_keys` table
- **Prefix Storage**: First 8 characters stored separately for identification
- **Roles**: `admin`, `user`, `service`
- **Revocation**: Immediate on DELETE request (sets `is_active = 0`)
- **Expiration**: Optional via `expiresAt` field

**Usage**:
```http
Authorization: Bearer ak_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. API_AUTH_TOKEN (Bootstrap Token)

Single bootstrap token for initial setup and administrative operations:

- **Environment Variable**: `API_AUTH_TOKEN`
- **Usage**: Bearer token in Authorization header
- **Purpose**: Initial system setup, emergency access
- **Security**: Should be rotated after initial setup

---

## Authorization (RBAC)

The platform implements a three-tier Role-Based Access Control system:

### Roles

| Role | Description | Scope |
|------|-------------|-------|
| `admin` | Full system access | All resources, all actions |
| `user` | Standard user | Own resources, read-only on shared resources |
| `service` | Service account | Execute workflows, read sessions |

### Permission Model

Permissions are defined as `(Resource, Action)` pairs:

**Actions**: `create`, `read`, `update`, `delete`, `execute`, `manage`

**Resources**: `sessions`, `workflows`, `triggers`, `connectors`, `memory`, `apiKeys`, `users`, `settings`, `observability`, `approval`, `run`, `provider`, `toolResult`

### Role Permissions Matrix

| Resource | admin | user | service |
|----------|-------|------|---------|
| sessions | CRUD+X | CRUD (own) | read |
| workflows | CRUD+X | CRUD (own) | execute |
| triggers | CRUD+X | CRUD (own) | execute |
| connectors | CRUD+X | read | execute |
| memory | CRUD+X | CRUD (own) | - |
| apiKeys | CRUD+X | CRD (own) | - |
| providers | CRUD+X | read | - |
| settings | CRUD+X | read | - |
| observability | CRUD+X | read | - |
| users | CRUD+X | - | - |
| agent-config | manage | update (own) | - |

### Ownership Enforcement

For resources with ownership requirements (sessions, workflows, triggers, memory, apiKeys):
- `admin` and `service` roles bypass ownership checks
- `user` role can only access resources they own

### Route-to-Permission Mapping

All API routes are mapped to required permissions in `src/api/route-policy.ts`:

```typescript
// Example mappings
{ method: 'POST', pathPattern: '/api/v1/sessions', resource: 'sessions', action: 'create' }
{ method: 'GET', pathPattern: '/api/v1/providers', resource: 'provider', action: 'read' }
{ method: 'PATCH', pathPattern: '/api/v1/agents/:agentId/config/global', resource: 'agent-config', action: 'manage' }
```

---

## API Security

### Authentication Exempt Paths

The following paths are exempt from authentication:

```
/api/v1/health
/api/v1/health/ready
/api/v1/docs
/api/v1/docs/json
/api/v1/setup/status
/api/v1/setup/user
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/tools
/api/v1/webhooks/*
/api/v1/metrics
```

All other routes require authentication.

### Rate Limiting

Production rate limits prevent abuse:

- **Global**: 100 requests per minute per IP
- **Auth endpoints**: 5 requests per minute per IP
- **Bypass**: None in production (localhost bypass only in development)
- **Headers**: `Retry-After` on 429 responses
- **Trusted Proxies**: Configure via `TRUST_PROXY` environment variable

### Request Validation

- **Input Validation**: All inputs validated via JSON Schema
- **Type Coercion**: Strict type checking, no automatic coercion
- **Parameter Validation**: Path parameters validated for format

### Error Envelope

All errors return a consistent envelope structure:

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Role 'user' cannot perform 'manage' on 'agent-config'"
  },
  "requestId": "req-abc123"
}
```

---

## Data Protection

### Secret Redaction

Sensitive data is automatically redacted from responses:

- **API Keys**: Only last 4 characters visible (`apiKeyLast4`)
- **Provider Keys**: Never exposed in any response
- **Passwords**: Never returned in any response
- **Session Tokens**: Only hash stored, never returned

### Encryption at Rest

Connector credentials are encrypted using AES-256-GCM:

- **Key**: Derived from `APP_SECRET_KEY` environment variable
- **Algorithm**: AES-256-GCM with random IV
- **Storage**: Encrypted in `connector_instances.credentials` column

### Database Security

- **SQLite WAL Mode**: Write-Ahead Logging for durability
- **Foreign Keys**: Enabled for referential integrity
- **Prepared Statements**: All queries use parameterized statements

---

## Network Security

### CORS Configuration

Production requires explicit origin allowlist:

```bash
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

- **Development**: `origin: true` (reflects any origin)
- **Production**: Must specify allowed origins, `*` is rejected

### Security Headers

All responses include security headers:

```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### SSRF Protection

Web fetch operations are protected against Server-Side Request Forgery:

- **Blocked IPs**: 
  - Loopback: `127.0.0.0/8`, `::1`
  - Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  - Link-local: `169.254.0.0/16`, `fe80::/10`
  - Cloud metadata: `169.254.169.254`
- **Blocked Hostnames**: `localhost`, `localtest.me`, etc.
- **Blocked Protocols**: `file://`, `data:`, `javascript:`

---

## Audit and Monitoring

### Audit Events

Security-relevant operations are logged to the audit store:

| Event | Description |
|-------|-------------|
| `user.login` | User authentication |
| `user.logout` | User session ended |
| `api_key.created` | API key created |
| `api_key.revoked` | API key revoked |
| `provider.created` | Provider configured |
| `provider.deleted` | Provider removed |

### Metrics

Security metrics exposed at `/api/v1/metrics`:

- Request counts by endpoint
- Error rates by type
- Authentication failures
- Rate limit rejections

### Health Checks

- `/api/v1/health`: Basic health status
- `/api/v1/health/ready`: Readiness including database connectivity

---

## Production Guard

The platform includes a production guard that validates configuration before startup:

### Required Configuration

When `NODE_ENV=production`, the following must be configured:

| Variable | Requirement |
|----------|-------------|
| `APP_SECRET_KEY` | Must be at least 32 characters |
| `ALLOWED_ORIGINS` | Must be specified, cannot be `*` |
| `DATABASE_PATH` or `DATABASE_URL` | Must be specified |
| `PUBLIC_BASE_URL` | Must be specified for OAuth |
| `COOKIE_SECURE` | Must be `true` |
| `LOG_LEVEL` | Cannot be `debug` |

### Bootstrap Authentication

At least one authentication method must be enabled:
- `API_AUTH_TOKEN` set, OR
- At least one API key exists

### Failure Behavior

If validation fails:
- Server refuses to start
- Clear error message indicates missing configuration
- Exit code is non-zero

---

## Security Checklist

Pre-deployment security checklist:

- [ ] `APP_SECRET_KEY` is set to a strong random value (32+ characters)
- [ ] `ALLOWED_ORIGINS` specifies exact domains (no `*`)
- [ ] `COOKIE_SECURE=true` in production
- [ ] `TRUST_PROXY` configured if behind reverse proxy
- [ ] Rate limiting is enabled
- [ ] Audit logging is enabled
- [ ] Database is backed up regularly
- [ ] TLS is enabled on the reverse proxy
- [ ] API keys are rotated periodically
- [ ] `API_AUTH_TOKEN` is rotated after initial setup

---

## Incident Response

### Security Incident Playbook

1. **Revoke compromised credentials**:
   ```bash
   curl -X DELETE http://localhost:3003/api/v1/api-keys/{key-id} \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

2. **Force logout all sessions**:
   ```sql
   DELETE FROM auth_tokens WHERE user_id = 'compromised-user-id';
   ```

3. **Rotate secrets**:
   - Generate new `APP_SECRET_KEY`
   - Update `ALLOWED_ORIGINS` if domain changed
   - Rotate `API_AUTH_TOKEN`

4. **Review audit logs**:
   ```bash
   # Check recent authentication events
   SELECT * FROM audit_events 
   WHERE event_type LIKE 'user.%' 
   ORDER BY created_at DESC LIMIT 100;
   ```

---

## References

- [RBAC Engine Implementation](../../src/permissions/rbac-engine.ts)
- [Route Policy Mapping](../../src/api/route-policy.ts)
- [Production Guard](../../src/config/production-guard.ts)
- [Security Gate Tests](../../tests/security/security-gate.test.ts)
- [RBAC Negative Test Matrix](../../tests/security/rbac-negative-matrix.test.ts)
