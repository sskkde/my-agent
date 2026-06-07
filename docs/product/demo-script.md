# Phase 6 Automation Product — Demo Script

This script demonstrates the complete Phase 6 automation capabilities including RBAC, API Keys, Triggers, DLQ, Connectors, Memory Budget, and Metrics.

## Prerequisites

- Server running: `npm run start:api` (port 3003)
- Web UI running: `cd web && npm run dev` (port 3002)
- Database migrated: `npm run db:migrate`
- At least one LLM provider configured (or mock mode enabled)

## Demo Setup

```bash
# Terminal 1: Start API server
npm run start:api

# Terminal 2: Start Web UI
cd web && npm run dev

# Open browser to http://localhost:3002
```

---

## Demo Flow

### Step 1: Create PlannerRun via Chat

**Goal**: Demonstrate complex task planning

1. Navigate to **Sessions** tab
2. Click "New Session" or select existing session
3. Send a complex task message:
   ```
   Help me set up a daily report that fetches GitHub issues, summarizes them, and posts to Slack.
   ```
4. Observe the PlannerRun created with multiple steps
5. Verify steps appear in the session transcript

**What to show**:

- The planner breaks down the complex request into actionable steps
- Each step has a clear description and assigned agent

---

### Step 2: Save PlannerRun as Workflow

**Goal**: Convert a one-time plan into a reusable workflow

1. Navigate to **Workflows** tab
2. Find the PlannerRun from Step 1
3. Click "Save as Workflow"
4. Name the workflow: `Daily GitHub Report`
5. Review the workflow steps in the editor
6. Click "Save"

**What to show**:

- Planner steps become workflow steps
- Steps can be reordered or modified
- Workflow is now persistent and reusable

---

### Step 3: Run Workflow Manually

**Goal**: Execute a saved workflow

1. In **Workflows** tab, find `Daily GitHub Report`
2. Click "Run Now"
3. Switch to **Monitor** tab to see the run progress
4. Observe step execution in real-time

**What to show**:

- Workflow runs as a WorkflowRun
- Each step executes in order
- Status updates in real-time

---

### Step 4: Create Schedule Trigger

**Goal**: Automate workflow execution on a schedule

1. Navigate to **Triggers** tab (NEW in Phase 4)
2. Click "Create Schedule Trigger"
3. Configure:
   - Name: `Daily Report Schedule`
   - Workflow: `Daily GitHub Report`
   - Schedule: `0 9 * * *` (every day at 9 AM)
4. Click "Create"
5. Verify trigger appears in the list with status "Active"

**What to show**:

- Cron-based scheduling
- Trigger status toggle (can pause/resume)
- Trigger configuration is persisted

---

### Step 5: Connector Event Trigger

**Goal**: Trigger workflow from external event

1. In **Triggers** tab, click "Create Connector Trigger"
2. Configure:
   - Name: `GitHub New Issue Trigger`
   - Connector: `github-mock`
   - Event: `issue.created`
   - Workflow: `Daily GitHub Report`
3. Click "Create"

**What to show**:

- External systems can trigger workflows
- Multiple trigger types supported (schedule, webhook, connector)
- Event-driven automation

---

### Step 6: Approval Path

**Goal**: Demonstrate approval workflow for connector writes

1. Start a workflow that includes a connector write step
2. When the step requires external write (e.g., post to Slack), approval is requested
3. Navigate to **Approvals** tab
4. Review the pending approval request
5. Click "Approve" or "Reject"
6. Return to **Monitor** to see the workflow continue

**What to show**:

- Sensitive operations require explicit approval
- Approval requests show full context (tool, parameters)
- User has full control over external writes

---

### Step 7: Observability Console

**Goal**: Inspect run execution details

1. Navigate to **Observability** tab (NEW in Phase 4)
2. Filter runs by status (All, Running, Completed, Failed)
3. Click on a completed run to expand the timeline
4. Observe:
   - Chronological list of events
   - Step start/complete times
   - Tool invocations
   - Agent decisions

**What to show**:

- Full visibility into run execution
- Timeline view for understanding sequence
- Status filtering for quick navigation

---

### Step 8: Replay Preview

**Goal**: Inspect past run details without side effects

1. In **Observability** tab, find a completed run
2. Click "Replay Preview" button
3. Review the execution details:
   - Step inputs and outputs
   - Tool parameters used
   - Agent reasoning at each step
4. Close preview — no changes made to system

**What to show**:

- Read-only inspection of past runs
- No side effects (guaranteed safe)
- Useful for debugging and auditing

---

### Step 9: Memory Review

**Goal**: Verify extracted memories from run

1. Navigate to **Memory** tab
2. Filter by session or run ID
3. Review extracted memories:
   - Key decisions made
   - Important facts discovered
   - User preferences noted
4. Verify memory tombstones if any were deleted

**What to show**:

- Long-term memory extraction
- Memory search and retrieval
- Soft-delete with audit trail

---

### Step 10: DLQ Check

**Goal**: Verify dead letter queue is empty after successful flow

1. Navigate to **Observability** tab
2. Look for DLQ indicator (should show 0 pending)
3. If any entries exist, review:
   - Module that failed
   - Failure reason
   - Timestamp
4. Optionally retry or discard failed entries

**What to show**:

- Failed operations are captured, not lost
- Retry mechanism available
- Full audit trail of failures

---

## Demo Cleanup

To reset the demo environment:

```bash
# Reset database
rm -f data/app.db
npm run db:migrate

# Or for E2E database
npm run reset:e2e-db
```

---

## Troubleshooting

### API Not Responding

```bash
# Check if API is running
curl http://localhost:3003/health

# Check logs
npm run start:api
```

### Web UI Not Loading

```bash
# Check if Vite dev server is running
curl http://localhost:3002

# Rebuild if needed
cd web && npm run build
```

### No Triggers Showing

- Ensure triggers were created successfully
- Check database for trigger records
- Verify trigger status is "Active"

### Approval Stuck

- Check Approvals tab for pending requests
- Review agent logs for approval status
- Verify approval response was sent correctly

---

## Key Talking Points

1. **Workflow Automation**: Convert one-time plans into reusable, scheduled workflows
2. **Trigger Flexibility**: Multiple trigger types (schedule, webhook, connector events)
3. **Safety First**: Approval workflow for sensitive operations
4. **Full Visibility**: Observability console for run inspection
5. **Safe Replay**: Preview past runs with zero side effects
6. **Failure Handling**: DLQ captures and preserves failed operations

---

## Phase 5 Product Experience Demo

### Demo Path A: Direct Chat

1. Open Web UI at http://localhost:3002
2. Navigate to **Session Console** tab
3. Type a message and press Enter
4. Observe the response streaming via SSE
5. Try slash commands: `/help`, `/status`, `/cancel`

### Demo Path B: Complex Task + Approval

1. In Session Console, send: "Create a file called test.txt with hello world"
2. Observe the approval card appearing in the chat
3. Click **Approve** to allow the write operation
4. Observe the tool execution result in chat

### Demo Path C: Runs Console

1. Navigate to **Agent Monitor** tab
2. Observe runs grouped by status (Active, Waiting, Terminal)
3. Click on a run to view details
4. For active runs, use the **Cancel** button
5. Observe status transition from Active → Cancelled

### Demo Path D: Timeline / Observability

1. Navigate to **Observability** tab
2. View run list with status filters
3. Click on a run to view timeline events
4. Use **Replay Preview** button for safe read-only replay
5. Observe failure reasons for failed runs

### Demo Path E: Settings

1. Navigate to **Settings** tab
2. View current settings (local mode, retention days)
3. Use **Provider Manager** to add/edit LLM providers
4. Test provider connection with the **Test** button

### Demo Path F: Workflows / Triggers / Connectors

1. Navigate to **Workflows** tab
2. Create a new workflow draft
3. Add steps to the workflow
4. Validate and publish the workflow
5. Navigate to **Triggers** tab to configure schedule/webhook triggers
6. Navigate to **Connectors** tab to view connector instances

### API Auth Token Demo

Enable API token auth and test with curl:

```bash
# Start API with token auth
API_AUTH_TOKEN=local-demo-token npm run start:api

# Health check works without token
curl http://localhost:3003/api/health

# Protected endpoint requires token
curl -H "Authorization: Bearer local-demo-token" http://localhost:3003/api/sessions

# Without token returns 401
curl http://localhost:3003/api/sessions
```

### P5 Verification

```bash
npm run test:p5
```

---

## Phase 6 Demo Paths

### Demo Path G: RBAC — Role-Based Access Control

**Goal**: Demonstrate 3-tier role system

1. Create first user (auto-admin):

   ```bash
   curl -X POST http://localhost:3003/api/v1/setup/user \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}'
   ```

2. Login as admin and create API keys with different roles:

   ```bash
   # Create service role key
   curl -X POST http://localhost:3003/api/v1/api-keys \
     -H "Authorization: Bearer <session-cookie>" \
     -H "Content-Type: application/json" \
     -d '{"name":"CI Service","role":"service"}'

   # Create user role key
   curl -X POST http://localhost:3003/api/v1/api-keys \
     -H "Authorization: Bearer <session-cookie>" \
     -H "Content-Type: application/json" \
     -d '{"name":"Dev User","role":"user"}'
   ```

3. Test RBAC restrictions:

   ```bash
   # User role cannot access settings
   curl -H "Authorization: Bearer ak_user_key" \
     http://localhost:3003/api/v1/agents/foreground.default/config
   # Returns 403 FORBIDDEN

   # Admin role can access settings
   curl -H "Authorization: Bearer ak_admin_key" \
     http://localhost:3003/api/v1/agents/foreground.default/config
   # Returns 200 OK
   ```

**What to show**:

- 3-tier role hierarchy (admin > user > service)
- Permission enforcement on all endpoints
- Clear error messages for denied access

---

### Demo Path H: API Key Management

**Goal**: Create, use, and revoke API keys

1. Navigate to **Settings** tab
2. Find **API Keys** section
3. Click **Create API Key**
4. Configure:
   - Name: "Demo Integration"
   - Role: "service"
   - Expiration: Optional
5. Copy the generated key (shown once!)
6. Test the key:
   ```bash
   curl -H "Authorization: Bearer ak_xxx..." \
     http://localhost:3003/api/v1/sessions
   ```
7. List keys to verify creation
8. Revoke the key
9. Verify revoked key returns 401

**What to show**:

- Key creation with role selection
- One-time key display (security best practice)
- Key identification via prefix
- Immediate revocation

---

### Demo Path I: Trigger Creation

**Goal**: Create schedule and webhook triggers

1. **Schedule Trigger**:
   - Navigate to **Triggers** tab
   - Click **Create Trigger**
   - Select **Schedule** type
   - Configure:
     - Name: "Daily Summary"
     - Workflow: Select published workflow
     - Cron: `0 9 * * *` (daily at 9 AM)
   - Verify next execution preview
   - Click **Create**

2. **Webhook Trigger**:
   - Click **Create Trigger**
   - Select **Webhook** type
   - Configure:
     - Name: "GitHub Webhook"
     - Workflow: Select published workflow
   - Click **Create**
   - Note the generated webhook URL and HMAC secret

3. Test webhook trigger:
   ```bash
   curl -X POST http://localhost:3003/api/webhooks/<trigger-id> \
     -H "Content-Type: application/json" \
     -H "X-Hub-Signature-256: sha256=<hmac>" \
     -d '{"action":"opened","issue":{"title":"Test"}}'
   ```

**What to show**:

- Cron validation with preview
- Webhook URL generation
- HMAC signature verification
- Trigger toggle (enable/disable)

---

### Demo Path J: DLQ Management

**Goal**: Handle failed operations

1. Navigate to **DLQ** tab
2. If empty, trigger a failure:
   - Create a workflow with invalid connector
   - Or simulate timeout
3. View failed entries:
   - Event ID
   - Failure reason
   - Timestamp
   - Retry count
4. Select entries and:
   - **Retry**: Attempt reprocessing
   - **Discard**: Remove permanently
5. Expand entry for full details:
   - Error stack trace
   - Original payload
   - Metadata

**What to show**:

- Failed event capture
- Retry mechanism
- Discard with audit trail
- Batch operations

---

### Demo Path K: Connectors

**Goal**: Configure and use external connectors

1. Navigate to **Connectors** tab
2. View available connector types:
   - GitHub
   - Slack
   - Calendar (Google)
   - Contacts (Google)
   - Docs (Notion/Google Docs)
   - Web Search
3. Click on a connector to see:
   - Available tools (actions)
   - Available events (triggers)
4. Create connector instance:
   - Click **Add Instance**
   - Configure authentication
   - Save
5. Test connector:
   - Use connector tool in workflow
   - Verify external system response

**What to show**:

- Multiple connector types
- Tool and event discovery
- OAuth/API key authentication
- Mock mode for development

---

### Demo Path L: Memory Budget

**Goal**: Monitor and manage resource usage

1. Navigate to **Settings** tab
2. Find **Budget Status** section
3. View current usage:
   - Tokens: used/limit
   - Requests: used/limit
   - Storage: used/limit
   - Percent utilization
   - Reset time
4. Trigger budget usage:
   - Have a conversation
   - Run a workflow
5. Refresh to see updated usage
6. Test budget exceeded:
   - Set low limit temporarily
   - Trigger usage
   - Verify BUDGET_EXCEEDED error

**What to show**:

- Real-time budget tracking
- Period-based reset
- Clear exceeded error
- Usage breakdown

---

### Demo Path M: Metrics & Alerting

**Goal**: Monitor platform health

1. **Prometheus Metrics**:

   ```bash
   curl http://localhost:3003/api/v1/metrics
   ```

   View metrics:
   - `agent_platform_request_total`
   - `agent_platform_request_duration_seconds`
   - `agent_platform_active_sessions`
   - `agent_platform_workflow_runs_total`
   - `agent_platform_memory_usage_bytes`

2. **Alert Rules**:
   - Navigate to **Observability** tab
   - Find **Alert Rules** section
   - Create alert:
     - Name: "High Error Rate"
     - Metric: `request_errors_total`
     - Condition: threshold > 100
     - Window: 5 minutes
     - Severity: warning
     - Webhook: optional notification URL

3. **Alert States**:
   - View current alert states
   - Trigger condition to fire alert
   - Verify notification sent
   - Clear condition to resolve alert

**What to show**:

- Prometheus-compatible metrics
- Alert rule creation
- State transitions (idle → firing → resolved)
- Webhook notifications

---

### P6 Verification

```bash
npm run test:p6
```

Or run individual test suites:

```bash
# RBAC tests
npm run test:api -- tests/integration/api/rbac

# API Key tests
npm run test:api -- tests/integration/api/api-key

# Trigger tests
npm run test:api -- tests/integration/api/triggers

# DLQ tests
npm run test:api -- tests/integration/api/dlq

# Alert tests
npm run test:api -- tests/integration/api/alerts
```
