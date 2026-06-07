# Agent Platform User Guide

> Version: 1.1 (Phase 6)
> Last Updated: 2026-05-15

## Quick Start

### System Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Network access to the Agent Platform server

### First Time Setup

1. Open your browser and navigate to the platform URL (typically `http://localhost:3002` for local development)
2. The login screen appears if authentication is enabled
3. Enter your credentials or use the default setup flow

### Starting Your First Conversation

1. Navigate to the **Sessions** tab in the left sidebar
2. Click **New Session** to create a new conversation
3. Type your message in the input field at the bottom
4. Press Enter or click Send to submit

The AI assistant will process your request and respond. Complex requests may trigger a planning workflow that breaks down the task into steps.

---

## Core Features

### Chat Sessions

Sessions are the primary way to interact with the AI assistant. Each session maintains its own conversation history and context.

**Key capabilities:**

- Create unlimited sessions for different topics or projects
- Session history is preserved across browser sessions
- Real-time message streaming via Server-Sent Events
- Context is maintained within each session

**Tips:**

- Use descriptive session names for easier navigation
- Create separate sessions for unrelated topics to avoid context mixing

### Runs

Runs represent background task executions. When you submit a complex request, the platform may create a PlannerRun or WorkflowRun.

**Types of runs:**

- **PlannerRun** — Created when the AI plans a multi-step task
- **WorkflowRun** — Created when a saved workflow is executed

**Monitoring runs:**

1. Go to the **Monitor** tab
2. View all active and completed runs
3. Click on a run to see detailed progress

### Approvals

Some operations require your explicit approval before execution. This is a safety mechanism for sensitive actions.

**Approval workflow:**

1. When an approval is needed, you'll see a notification
2. Navigate to the **Approvals** tab
3. Review the requested action and its parameters
4. Click **Approve** to allow or **Reject** to deny

**Common approval scenarios:**

- Writing to external systems (Slack, GitHub, etc.)
- Executing potentially destructive operations
- Accessing sensitive data

### Workflows

Workflows are reusable multi-step processes. You can save a successful PlannerRun as a workflow for future use.

**Creating a workflow:**

1. After a successful PlannerRun, navigate to **Workflows**
2. Find the run and click **Save as Workflow**
3. Give it a descriptive name
4. Review and adjust steps if needed

**Running a workflow:**

1. Go to **Workflows** tab
2. Find your saved workflow
3. Click **Run Now**
4. Monitor execution in the **Monitor** tab

### Triggers

Triggers automate workflow execution based on schedules or external events.

**Trigger types:**

- **Schedule Trigger** — Run workflows on a cron schedule
- **Webhook Trigger** — Run workflows when an HTTP request is received
- **Connector Trigger** — Run workflows based on external system events

#### Creating a Schedule Trigger

1. Navigate to **Triggers** tab
2. Click **Create Trigger** button
3. Select **Schedule** trigger type
4. Configure the trigger:
   - **Name**: Descriptive name (e.g., "Daily Report Schedule")
   - **Workflow**: Select from published workflows
   - **Cron Schedule**: Use standard 5-field cron format
     - `0 9 * * *` — Every day at 9:00 AM
     - `*/15 * * * *` — Every 15 minutes
     - `0 9 * * 1-5` — Weekdays at 9:00 AM
   - **Max Runs**: Optional limit on total executions
5. Click **Create**

The platform validates your cron expression and shows a preview of the next execution time.

#### Creating a Webhook Trigger

1. Navigate to **Triggers** tab
2. Click **Create Trigger** button
3. Select **Webhook** trigger type
4. Configure:
   - **Name**: Descriptive name
   - **Workflow**: Select from published workflows
5. Click **Create**

After creation, you'll receive:

- **Webhook URL**: Unique endpoint URL
- **HMAC Secret**: Secret for request signature verification

Use these to configure external systems to trigger your workflow.

#### Managing Triggers

- **Toggle**: Enable/disable trigger without deleting
- **Edit**: Modify schedule or associated workflow
- **Delete**: Permanently remove trigger
- **View History**: See all executions from this trigger

### Memory

The platform maintains long-term memory of important information extracted from conversations.

**What's stored:**

- Key decisions made during conversations
- Important facts and preferences you've shared
- Task outcomes and learnings

**Managing memory:**

1. Go to **Memory** tab
2. Browse or search stored memories
3. Delete outdated or incorrect entries

Memory helps the assistant provide more contextual and personalized responses over time.

### Memory Budget

Memory budgets control resource consumption to ensure fair platform usage.

**Budget types:**

- **Token Budget** — LLM token consumption per period
- **Request Budget** — API request count per period
- **Storage Budget** — Memory storage size limit

**Budget periods:**

- **Daily** — Resets at midnight UTC
- **Monthly** — Resets on the 1st of each month
- **Per Session** — Session lifetime (never resets)

#### Monitoring Budget Usage

1. Navigate to **Settings** tab
2. View **Budget Status** section
3. See current usage and limits:
   - Tokens used vs. limit
   - Requests made vs. limit
   - Storage used vs. limit
   - Percent utilization
   - Reset time

#### When Budget is Exceeded

If you exceed your budget:

1. You'll see a `BUDGET_EXCEEDED` error
2. The request will not be processed
3. Budget resets automatically at the end of the period

**Tips for budget management:**

- Monitor usage regularly in Settings
- Use shorter conversations for simple tasks
- Close unused sessions to free storage
- Contact your admin for budget adjustments

### Observability

The Observability Console provides visibility into all platform operations.

**Features:**

- Run history with status filtering
- Timeline view of run execution
- Replay Preview for detailed inspection
- Dead Letter Queue (DLQ) for failed operations

**Using Replay Preview:**

1. Navigate to **Observability** tab
2. Find a completed run
3. Click **Replay Preview**
4. Review step details, inputs, outputs, and agent reasoning

Replay Preview is read-only and has no side effects, making it safe for auditing.

#### Dead Letter Queue (DLQ)

The DLQ captures failed operations that couldn't be processed normally.

**What appears in DLQ:**

- Failed workflow step executions
- Connector request failures
- Timeout events
- Processing errors

**Managing DLQ entries:**

1. Navigate to **DLQ** tab (or find DLQ section in Observability)
2. View failed entries with details:
   - Event ID
   - Module that failed
   - Failure reason
   - Timestamp
   - Retry count

**Actions on DLQ entries:**

- **Retry**: Attempt to reprocess the failed event
  - Click the **Retry** button on individual entries
  - Or select multiple entries and use **Retry Selected**
  - Retried entries are removed from DLQ on success

- **Discard**: Permanently remove without retry
  - Click **Discard** on individual entries
  - Or select multiple and use **Discard Selected**
  - Discarded entries are logged for audit

- **View Details**: Expand entry to see:
  - Full error stack trace
  - Original payload
  - Failure metadata

**DLQ best practices:**

- Review DLQ regularly to catch systemic issues
- Retry transient failures (network timeouts, rate limits)
- Discard permanent failures after investigation
- Contact admin if DLQ grows unexpectedly

### Connectors

Connectors enable integration with external systems like GitHub, Slack, Jira, and more.

**Viewing connectors:**

1. Go to **Connectors** tab
2. See all available connector types
3. Click on a connector to see its tools and events

**Connector operations:**

- View available tools (actions the connector can perform)
- View available events (triggers the connector can emit)
- Configure connector instances

---

## Tab Walkthrough

### Sessions Tab

The Sessions tab is your main workspace for conversations.

**What you see:**

- List of all sessions on the left
- Active session conversation in the center
- Message input at the bottom

**Screenshot placeholder:** Sessions tab showing session list and conversation view

**Actions:**

- Click a session to open it
- Click **New Session** to start fresh
- Use the session menu to rename or delete

### Monitor Tab

Track the progress of running tasks.

**What you see:**

- List of runs with status indicators (Running, Completed, Failed)
- Progress bars for active runs
- Execution details on selection

**Screenshot placeholder:** Monitor tab showing active and completed runs

### Approvals Tab

Review and respond to approval requests.

**What you see:**

- Pending approvals at the top
- Approval history below
- Detailed context for each request

**Screenshot placeholder:** Approvals tab with pending request

### Workflows Tab

Manage saved workflows.

**What you see:**

- List of saved workflows
- Run history for each workflow
- Quick actions (Run Now, Edit, Delete)

**Screenshot placeholder:** Workflows tab with saved workflows

### Triggers Tab

Configure automation triggers.

**What you see:**

- List of configured triggers
- Trigger type, status, and schedule
- Create new trigger button

**Screenshot placeholder:** Triggers tab with schedule and webhook triggers

### Memory Tab

Review and manage stored memories.

**What you see:**

- Searchable list of memories
- Memory content and metadata
- Filter by session or run

**Screenshot placeholder:** Memory tab with memory entries

### Observability Tab

Inspect platform operations.

**What you see:**

- Run list with filtering
- Timeline view for selected run
- DLQ entries if any failures occurred

**Screenshot placeholder:** Observability tab showing run timeline

### Connectors Tab

View and configure external integrations.

**What you see:**

- Available connector types
- Connector tools and events
- Instance configurations

**Screenshot placeholder:** Connectors tab with connector list

---

## Keyboard Shortcuts

| Shortcut        | Action                               |
| --------------- | ------------------------------------ |
| `Enter`         | Send message (when input is focused) |
| `Shift + Enter` | New line in message input            |
| `Esc`           | Close modals and drawers             |
| `?`             | Open keyboard shortcuts help         |

---

## FAQ

### How do I reset a session?

Navigate to the Sessions tab, find the session, and use the session menu to delete it. You can then create a new session to start fresh.

### Why is my task taking so long?

Complex tasks that involve planning, external API calls, or multiple steps may take time. Check the Monitor tab to see the current progress and which step is executing.

### How do I cancel a running task?

Go to the Monitor tab, find the running task, and click the Cancel button. Note that cancellation is best-effort and some operations may complete before the cancellation takes effect.

### What happens when I reject an approval?

The operation that requested approval will not execute. The workflow or task may fail or continue with alternative steps depending on how it was designed.

### Can I undo an action?

Most actions cannot be undone. Approval responses, sent messages, and workflow executions are permanent. Use caution when approving sensitive operations.

### How is my data stored?

Data is stored in a SQLite database on the server. Conversations, memories, and configurations are persisted. Ask your administrator about backup policies.

### Why am I seeing errors?

Check the Observability tab for details on failed operations. Common causes include:

- LLM provider issues
- Network connectivity problems
- External service unavailability
- Permission or configuration errors

---

## Getting Help

- **Documentation**: Check the Admin Guide and Troubleshooting Guide for more details
- **Administrator**: Contact your platform administrator for account issues
- **Logs**: Your administrator can access server logs for debugging
