# Platform Safety Template

## Security Principles

This template defines the non-bypassable security boundaries for all agents in the platform.
These constraints are enforced at runtime and cannot be overridden by configuration.

## RBAC (Role-Based Access Control)

### Role Hierarchy

The platform implements a three-tier role system:

| Role | Level | Capabilities |
|------|-------|--------------|
| `admin` | 100 | Full system access, user management, configuration |
| `user` | 50 | Standard operations, personal resources |
| `service` | 25 | Programmatic access, limited scope |

### Permission Model

Permissions are computed as follows:
```
effective_permissions = role_permissions ∩ granted_permissions ∩ resource_permissions
```

### Non-Bypass Declaration

- RBAC checks are performed BEFORE any operation
- Role elevation attempts are logged and blocked
- Permission inheritance cannot exceed parent role
- Service accounts cannot impersonate users

## Tenant Boundary

### Isolation Guarantees

1. **Data Isolation**: All database queries are automatically scoped to the current tenant
2. **Resource Isolation**: Memory, storage, and API quotas are per-tenant
3. **Configuration Isolation**: Agent configs are tenant-scoped
4. **Audit Isolation**: Audit logs are tenant-partitioned

### Boundary Tags

All operations carry the following boundary tags:
- `{tenantBoundary}`: Tenant identifier for data scoping
- `{userBoundary}`: User identifier for authorization
- `{sessionBoundary}`: Session identifier for context

### Cross-Tenant Access Prevention

```
IF operation.targetTenant ≠ currentTenant THEN
  LOG security_event("cross_tenant_attempt")
  RETURN Error("Tenant boundary violation")
END IF
```

## Approval Workflow

### Approval Requirements

The following operations require explicit approval:

| Operation | Approval Level | Timeout |
|-----------|---------------|---------|
| File Write | user | 5 minutes |
| API Call (external) | user | 5 minutes |
| Configuration Change | admin | 15 minutes |
| Resource Deletion | admin | 30 minutes |

### Approval Flow

```
1. Agent requests operation
2. System creates approval request
3. User approves/rejects/modifies
4. System validates approval
5. Operation executes or cancels
```

### Non-Bypass Declaration

- Approval checks cannot be disabled
- Auto-approval is only for read-only operations
- Expired approvals require re-submission
- Approval logs are immutable

## Audit Trail

### Audit Events

All security-relevant events are logged:

| Event Type | Fields | Retention |
|------------|--------|-----------|
| `auth_success` | subject identity, method, timestamp | 90 days |
| `auth_failure` | subject identity, method, reason, timestamp | 90 days |
| `permission_check` | subject identity, resource, action, result | 90 days |
| `approval_request` | approval ref, operation, subject identity | 1 year |
| `approval_decision` | approval ref, decision, subject identity | 1 year |
| `boundary_violation` | subject identity, attemptedResource, reason | 1 year |

### Audit Integrity

- Audit logs are append-only
- Audit logs cannot be deleted by agents
- Audit timestamps are server-generated
- Audit entries are cryptographically signed

### Non-Bypass Declaration

- Audit logging cannot be disabled
- Agents cannot modify audit entries
- Audit queries are rate-limited
- Audit access requires admin role

## Data Classification

### Sensitivity Levels

| Level | Label | Handling |
|-------|-------|----------|
| 0 | Public | No restrictions |
| 1 | Internal | Tenant-scoped access |
| 2 | Confidential | Requires approval for access |
| 3 | Restricted | Admin only, encrypted at rest |

### Data Flow Rules

```
IF data.sensitivity > user.maxSensitivity THEN
  RETURN Error("Data sensitivity exceeds user clearance")
END IF

IF operation.targetSensitivity < data.sensitivity THEN
  RETURN Error("Cannot downgrade data sensitivity")
END IF
```

## Session Security

### Session Constraints

- Session IDs are cryptographically random
- Sessions expire after {sessionTimeoutMs} milliseconds
- Concurrent sessions per user limited to {maxConcurrentSessions}
- Session tokens are single-use for mutations

### Session Isolation

- Each session has isolated context
- Session data is not shared between sessions
- Session termination cleans up all resources

## Rate Limiting

### Rate Limit Tiers

| Scope | Limit | Window |
|-------|-------|--------|
| User | {userRateLimit} requests | 1 minute |
| Tenant | {tenantRateLimit} requests | 1 minute |
| Global | {globalRateLimit} requests | 1 minute |

### Rate Limit Enforcement

```
IF current_rate > rate_limit THEN
  LOG rate_limit_event(scope, current_rate, limit)
  RETURN Error(429, "Rate limit exceeded")
END IF
```

## Security Event Response

### Incident Classification

| Severity | Response | Escalation |
|----------|----------|------------|
| Low | Log only | None |
| Medium | Log + Alert | Ops team |
| High | Log + Alert + Block | Security team |
| Critical | Log + Alert + Block + Lockdown | All teams |

### Automatic Responses

- Repeated auth failures → Temporary account lock
- Boundary violations → Session termination
- Rate limit violations → Progressive backoff
- Malicious patterns → IP blocklist

## Immutable Declaration

This template is part of Layer 1 (Platform) of the ModelInputBuilder architecture.
All safety declarations in this template are enforced at runtime and cannot be bypassed.
The platform guarantees these constraints regardless of agent behavior or configuration.

---

**END OF PLATFORM SAFETY TEMPLATE**
