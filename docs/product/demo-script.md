# Phase 4 Automation Product Beta — Demo Script

This script demonstrates the complete Phase 4 automation capabilities.

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
