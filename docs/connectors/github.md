# GitHub Connector

GitHub connector provides integration with GitHub API for managing issues, pull requests, and repository interactions.

## Overview

The GitHub connector enables your agent to:

- List and view issues in repositories
- List and view pull requests
- Create comments on issues (with approval workflow)

## Authentication

### Personal Access Token (PAT)

The GitHub connector supports Personal Access Token (PAT) authentication.

#### Creating a PAT

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give your token a descriptive name
4. Select the following scopes:
   - `repo` - Full control of private repositories (for private repos)
   - `public_repo` - Access public repositories (for public repos only)
   - `read:org` - Read org and team membership (optional)
5. Click "Generate token"
6. Copy the token immediately (you won't see it again)

#### Security

All tokens are encrypted at rest using AES-256-GCM encryption. The token is never exposed in API responses, logs, or audit records.

### OAuth2 (Future Support)

OAuth2 authentication is planned for future releases, allowing users to authorize via GitHub OAuth flow.

## Configuration

### Environment Variables

| Variable                          | Description                     | Default  |
| --------------------------------- | ------------------------------- | -------- |
| `GITHUB_CONNECTOR_TIMEOUT_MS`     | Request timeout in milliseconds | `30000`  |
| `GITHUB_CONNECTOR_MAX_TIMEOUT_MS` | Maximum allowed timeout         | `120000` |
| `MOCK_MODE`                       | Use mock transport for testing  | `false`  |

### Connector Instance Configuration

```typescript
{
  connectorInstanceId: 'github-main',
  connectorDefinitionId: 'github-connector',
  userId: 'user-123',
  name: 'My GitHub Connector',
  authStateRef: '<encrypted-pat>',  // Encrypted PAT
  config: {
    defaultOwner: 'myorg',
    defaultRepo: 'myrepo'
  },
  status: 'active'
}
```

## Capabilities

### github.list_issues

List issues in a GitHub repository.

**Category**: read  
**Risk Level**: low  
**Requires Auth**: yes

**Input Schema**:

```typescript
{
  owner: string;        // Repository owner
  repo: string;         // Repository name
  state?: 'open' | 'closed' | 'all';  // Issue state filter
  labels?: string[];    // Filter by labels
  sort?: 'created' | 'updated' | 'comments';  // Sort field
  direction?: 'asc' | 'desc';  // Sort direction
  page?: number;        // Page number
  perPage?: number;     // Results per page (default: 30)
}
```

**Output**:

```typescript
{
  issues: Array<{
    id: number
    number: number
    title: string
    body: string | null
    state: 'open' | 'closed'
    user: { login: string; avatarUrl: string }
    labels: Array<{ name: string; color: string }>
    comments: number
    createdAt: string
    updatedAt: string
    htmlUrl: string
  }>
  total: number
}
```

**Example**:

```typescript
const result = await connector.execute(instance, {
  operation: 'list_issues',
  params: {
    owner: 'octocat',
    repo: 'Hello-World',
    state: 'open',
    labels: ['bug'],
  },
})
```

### github.get_issue

Get a specific issue by number.

**Category**: read  
**Risk Level**: low  
**Requires Auth**: yes

**Input Schema**:

```typescript
{
  owner: string // Repository owner
  repo: string // Repository name
  issueNumber: number // Issue number
}
```

**Output**: Issue object or `null` if not found.

**Example**:

```typescript
const issue = await connector.execute(instance, {
  operation: 'get_issue',
  params: {
    owner: 'octocat',
    repo: 'Hello-World',
    issueNumber: 42,
  },
})
```

### github.list_pull_requests

List pull requests in a GitHub repository.

**Category**: read  
**Risk Level**: low  
**Requires Auth**: yes

**Input Schema**:

```typescript
{
  owner: string;        // Repository owner
  repo: string;         // Repository name
  state?: 'open' | 'closed' | 'all';  // PR state filter
  head?: string;        // Filter by head branch
  base?: string;        // Filter by base branch
  sort?: 'created' | 'updated' | 'popularity';  // Sort field
  direction?: 'asc' | 'desc';  // Sort direction
  page?: number;
  perPage?: number;
}
```

**Output**:

```typescript
{
  pullRequests: Array<{
    id: number
    number: number
    title: string
    body: string | null
    state: 'open' | 'closed'
    user: { login: string }
    draft: boolean
    merged: boolean
    head: { ref: string; sha: string }
    base: { ref: string; sha: string }
    additions: number
    deletions: number
    changedFiles: number
    createdAt: string
    updatedAt: string
    htmlUrl: string
  }>
  total: number
}
```

### github.get_pull_request

Get a specific pull request by number.

**Category**: read  
**Risk Level**: low  
**Requires Auth**: yes

**Input Schema**:

```typescript
{
  owner: string
  repo: string
  prNumber: number
}
```

**Output**: Pull request object or `null` if not found.

### github.create_issue_comment

Create a comment on a GitHub issue. This is a **write operation** that requires approval.

**Category**: write  
**Risk Level**: medium  
**Requires Auth**: yes  
**Requires Approval**: yes

**Input Schema**:

```typescript
{
  owner: string
  repo: string
  issueNumber: number
  body: string // Comment body (markdown supported)
}
```

**Output**:

```typescript
{
  requiresApproval: true
  approvalId: string // Use this to track approval status
}
```

After approval is granted, the comment is created:

```typescript
{
  id: number
  nodeId: string
  body: string
  user: {
    login: string
  }
  createdAt: string
  htmlUrl: string
}
```

## Rate Limits

GitHub API has the following rate limits:

| Authentication      | Rate Limit           |
| ------------------- | -------------------- |
| Unauthenticated     | 60 requests/hour     |
| Authenticated (PAT) | 5,000 requests/hour  |
| GitHub App          | 15,000 requests/hour |

### Rate Limit Handling

The connector handles rate limits (HTTP 429) with:

1. **Error Detection**: Rate limit responses are detected and mapped to `RATE_LIMITED` error code
2. **Recovery Information**: Error includes `rateLimitResetAt` timestamp
3. **Recoverable Flag**: Rate limit errors are marked as `recoverable: true`
4. **Retry Strategy**: Caller can implement exponential backoff retry

**Rate Limit Error Example**:

```typescript
{
  code: 'RATE_LIMITED',
  message: 'Rate limit exceeded',
  recoverable: true,
  details: {
    statusCode: 429,
    rateLimitRemaining: 0,
    rateLimitResetAt: '2024-01-15T10:30:00Z'
  }
}
```

## Error Handling

All errors are mapped to the `GitHubError` type with consistent error codes:

| Code               | Description                       | Recoverable |
| ------------------ | --------------------------------- | ----------- |
| `AUTH_INVALID`     | Invalid or missing authentication | No          |
| `AUTH_EXPIRED`     | Authentication token has expired  | Yes         |
| `RATE_LIMITED`     | Rate limit exceeded               | Yes         |
| `NOT_FOUND`        | Resource not found                | No          |
| `FORBIDDEN`        | Permission denied                 | No          |
| `VALIDATION_ERROR` | Invalid input parameters          | No          |
| `NETWORK_ERROR`    | Network connectivity issue        | Yes         |
| `UNKNOWN_ERROR`    | Unexpected error                  | No          |

**Error Structure**:

```typescript
interface GitHubError {
  code: GitHubErrorCode
  message: string
  recoverable: boolean
  details?: {
    statusCode?: number
    rateLimitRemaining?: number
    rateLimitResetAt?: string
  }
}
```

## Mock Mode

For testing without real GitHub API access, enable mock mode:

```bash
MOCK_MODE=true
```

Or when creating the connector:

```typescript
const adapter = createGitHubConnectorAdapter({
  approvalStore,
  useMock: true,
})
```

### Mock Transport Behavior

- Returns deterministic test data
- Simulates authentication validation
- Does not make real HTTP requests
- Provides consistent responses for testing

### Mock Data

The mock transport provides:

- 3 test issues (open and closed)
- 3 test pull requests (open, closed, merged)
- Comment creation simulation

## Approval Workflow

Write operations require approval before execution:

### 1. Request Approval

```typescript
const result = await connector.execute(instance, {
  operation: 'create_issue_comment',
  params: {
    owner: 'myorg',
    repo: 'myrepo',
    issueNumber: 123,
    body: 'This is a comment',
  },
  userId: 'user-123',
  sessionId: 'session-456',
})

// result: { requiresApproval: true, approvalId: 'github-approval-...' }
```

### 2. Track Approval

```typescript
const approval = approvalStore.getById(approvalId)
// approval.status: 'pending' | 'approved' | 'rejected'
```

### 3. Execute After Approval

```typescript
// After approval is granted
approvalStore.update(approvalId, {
  status: 'approved',
  respondedAt: new Date().toISOString(),
  responseBy: 'admin',
})

// Execute the comment
const comment = await adapter.executeApprovedComment(approvalId)
```

## Timeout Configuration

| Setting         | Default    | Maximum     |
| --------------- | ---------- | ----------- |
| Request timeout | 30 seconds | 120 seconds |

Configure per-request:

```typescript
const result = await connector.execute(instance, {
  operation: 'list_issues',
  params: { owner: 'myorg', repo: 'myrepo' },
  timeoutMs: 60000, // 60 seconds
})
```

## Security

### Token Encryption

- PATs are encrypted using AES-256-GCM before storage
- Encryption key derived from `APP_SECRET_KEY` environment variable
- Tokens are never logged or exposed in API responses

### Least Privilege

Required scopes for each capability:

| Capability                    | Minimum Scopes                            |
| ----------------------------- | ----------------------------------------- |
| `github.list_issues`          | `public_repo` (public) / `repo` (private) |
| `github.get_issue`            | `public_repo` / `repo`                    |
| `github.list_pull_requests`   | `public_repo` / `repo`                    |
| `github.get_pull_request`     | `public_repo` / `repo`                    |
| `github.create_issue_comment` | `repo`                                    |

### Audit Trail

All connector calls generate audit records:

- Operation type and parameters
- User and session context
- Timestamp and resource identifier
- Approval status for write operations

### Sensitive Data Redaction

The connector ensures:

- PATs never appear in logs
- PATs never appear in API responses
- PATs never appear in audit records
- Error messages do not expose sensitive data

## Examples

### List Open Issues

```typescript
const adapter = createGitHubConnectorAdapter({
  approvalStore,
  transport: mockTransport,
})

const encryptedPat = GitHubConnectorAdapter.encryptPat(process.env.GITHUB_PAT)

const result = await adapter.execute(instance, {
  requestId: 'req-001',
  connectorInstanceId: 'github-main',
  capabilityId: 'github.list_issues',
  operation: 'list_issues',
  params: {
    owner: 'facebook',
    repo: 'react',
    state: 'open',
    sort: 'updated',
    direction: 'desc',
    perPage: 10,
  },
  userId: 'user-123',
})

console.log(`Found ${result.total} issues`)
result.issues.forEach((issue) => {
  console.log(`#${issue.number}: ${issue.title}`)
})
```

### Create Comment with Approval

```typescript
// Step 1: Request comment creation
const approvalResult = await adapter.execute(instance, {
  operation: 'create_issue_comment',
  params: {
    owner: 'myorg',
    repo: 'myrepo',
    issueNumber: 42,
    body: '## Summary\n\nThis issue has been resolved in PR #123.',
  },
  userId: 'user-123',
  sessionId: 'session-001',
})

// Step 2: Get approval
const approvalId = approvalResult.approvalId

// Step 3: Admin approves
approvalStore.update(approvalId, {
  status: 'approved',
  responseBy: 'admin',
  respondedAt: new Date().toISOString(),
})

// Step 4: Execute the approved action
const comment = await adapter.executeApprovedComment(approvalId)
console.log(`Comment created: ${comment.htmlUrl}`)
```

## Health Check

```typescript
const health = adapter.checkHealth(instance)
// { healthy: true, message: 'GitHub connector is healthy' }
```

## Capability Discovery

```typescript
const capabilities = adapter.discoverCapabilities(instance)

capabilities.forEach((cap) => {
  console.log(`${cap.capabilityId}: ${cap.name}`)
  console.log(`  Category: ${cap.category}`)
  console.log(`  Risk Level: ${cap.riskLevel}`)
  console.log(`  Requires Auth: ${cap.requiresAuth}`)
})
```
