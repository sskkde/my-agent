# Permission Model

This document describes the permission and approval system in the Agent Platform.

## Overview

The Agent Platform implements a permission model that governs tool execution and external system access. The model is designed to balance automation efficiency with user control over sensitive operations.

## Core Concepts

### Approval Flow

When an agent attempts to execute a tool that requires approval, the following flow occurs:

1. **Tool Request**: Agent proposes tool execution with parameters
2. **Permission Check**: System evaluates if approval is required
3. **Approval Request**: If required, request is queued for user review
4. **User Decision**: User responds with one of three choices
5. **Execution**: Based on decision, tool executes or agent is notified

#### Tri-State Approval Choices

Users can respond to approval requests with three distinct choices:

| Response | Behavior | Grant Created | Use Case |
|----------|----------|---------------|----------|
| `reject` | Denies the request, no execution | None | Unsafe or unwanted operation |
| `approve_once` | Approves this specific request | 60-minute precise grant | One-time operation |
| `approve_always` | Approves and creates long-lived grant | 24-hour grant | Repeated safe operations |

**MVP Implementation Note**: The `approve_once` response is implemented as a short-TTL (60-minute) precise grant, not a strict one-shot consumed grant. This allows for reasonable retry behavior while maintaining security. Future versions may implement strict one-shot semantics.

#### Session Modal Integration

When a session has pending approval requests, the session window displays an approval modal in the `SessionConsoleTab`. This provides immediate visibility and quick response capability without navigating to the dedicated Approvals tab.

#### Backward Compatibility

The API maintains backward compatibility with the legacy two-state approval system:

- Legacy `decision` field: `approved` | `rejected`
- Canonical `responseType` field: `reject` | `approve_once` | `approve_always`

The system normalizes legacy values:
- `approved` → `approve_once` (creates 60-minute grant)
- `rejected` → `reject` (no grant)

### Permission Types

| Type        | Description        | Example                            |
| ----------- | ------------------ | ---------------------------------- |
| **Read**    | No approval needed | `file.read`, `memory.retrieve`     |
| **Write**   | Requires approval  | `file.write`, `connector.write`    |
| **Execute** | Requires approval  | `shell.exec`, `http.request`       |
| **Delete**  | Requires approval  | `memory.delete`, `workflow.delete` |

## Connector Write Permissions

Connector write operations always require explicit user approval. This is a security measure to prevent unintended modifications to external systems.

### Flow for Connector Writes

```
1. Agent proposes: connector.write(connectorId: "github", action: "create_issue", params: {...})
2. System queues approval request
3. User reviews request in ApprovalsTab
4. User approves → Connector executes write
5. User rejects → Agent receives rejection, may propose alternative
```

### Why Connector Writes Require Approval

- External systems may have irreversible operations
- User should verify intent before execution
- Prevents accidental data modification
- Maintains audit trail of all external writes

## Replay Preview Permissions

Replay preview is a read-only operation that does not require any permissions.

### Safety Guarantees

When viewing a replay preview, the system guarantees:

- **No tool execution**: Tools are not invoked
- **No store writes**: Database remains unchanged
- **No HTTP requests**: No external calls are made
- **No trigger fires**: Event triggers are not activated

This allows users to safely inspect past runs without side effects.

## API Authentication

### Auth Tokens

API access is authenticated via Bearer tokens:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3003/api/sessions
```

### Token Scopes

Tokens can have different scopes:

| Scope   | Access                    |
| ------- | ------------------------- |
| `read`  | Read-only API access      |
| `write` | Full read/write access    |
| `admin` | Administrative operations |

### Scope-Based Access

Agent configuration follows scope-based access control:

- **Global Scope**: Default settings for all users
- **User Scope**: Per-user overrides

Configuration precedence:

```
session_override > agent_config > user_provider_defaults > env_providers
```

## Permission Configuration

### Agent-Level Permissions

Permissions can be configured per agent:

```json
{
  "allowedToolIds": ["file.read", "memory.retrieve", "search"],
  "allowedSkillIds": ["code-review"]
}
```

Tools not in `allowedToolIds` are blocked from execution.

### Workflow Step Permissions

Workflow steps can specify required permissions:

```json
{
  "steps": [
    {
      "id": "fetch-data",
      "tool": "http.request",
      "requiresApproval": true
    }
  ]
}
```

## Audit Trail

All permission decisions are logged for audit purposes:

- Approval requests are recorded with timestamp, agent, tool, and parameters
- Approval/rejection decisions are recorded with user and timestamp
- Tool executions (approved) are recorded with outcome

### Audit Record Types

| Type                 | Description                  |
| -------------------- | ---------------------------- |
| `approval.requested` | Approval request created     |
| `approval.approved`  | User approved request        |
| `approval.rejected`  | User rejected request        |
| `tool.executed`      | Tool executed after approval |
| `memory.deleted`     | Memory soft-deleted          |

## Security Best Practices

### For Users

1. Review all approval requests before accepting
2. Use read-only tokens for inspection tasks
3. Regularly audit approval history
4. Limit `allowedToolIds` for production agents

### For Developers

1. Always mark write operations as requiring approval
2. Never bypass the permission system
3. Log all permission decisions
4. Validate tool parameters before execution

## Phase 4 Specifics

### New Permission Considerations

- **DLQ Access**: Read-only for users, retry requires admin scope
- **Connector Config**: Instance configuration changes require approval
- **Observability Console**: Read-only, no permissions needed
- **Trigger Management**: Create/delete triggers requires write scope

### Replay Preview Safety Contract

The architecture contract test `replay-preview-safety-contract.test.ts` verifies:

```typescript
// Forbidden operations in replay preview mode:
assert(toolCalls === 0, 'No tool calls allowed')
assert(storeWrites === 0, 'No store writes allowed')
assert(httpRequests === 0, 'No HTTP requests allowed')
assert(triggerFires === 0, 'No triggers fired')
```
