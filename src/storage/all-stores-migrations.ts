import type { Migration } from './migrations.js';

/**
 * Consolidated migrations for ALL stores in the agent platform.
 * This file contains the complete schema for:
 * - Event Store
 * - RuntimeAction Store
 * - Transcript Store
 * - Summary Store
 * - Plan Store
 * - PlannerRun Store
 * - KernelRun Store
 * - ToolExecution Store
 * - BackgroundRun Store
 * - WorkflowRun Store
 * - Approval Store
 * - PermissionGrant Store
 * - Trigger Store
 * - WaitCondition Store
 * - Artifact Store
 * - ToolResult Store
 * - Connector Store
 * - Long-term Memory Store
 */

// ============================================================================
// STORE 1: Event Store (version 1)
// ============================================================================
export const eventsTableMigration: Migration = {
  version: 1,
  name: 'create_events_table',
  up: `
    CREATE TABLE events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      source_module TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT,
      correlation_id TEXT,
      causation_id TEXT,
      idempotency_key TEXT,
      planner_run_id TEXT,
      plan_id TEXT,
      run_id TEXT,
      workflow_run_id TEXT,
      workflow_step_run_id TEXT,
      background_run_id TEXT,
      subagent_run_id TEXT,
      tool_call_id TEXT,
      approval_id TEXT,
      wait_condition_id TEXT,
      artifact_id TEXT,
      memory_id TEXT,
      payload TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'low',
      retention_class TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_session_created ON events(session_id, created_at);
    CREATE INDEX idx_events_user_created ON events(user_id, created_at);
    CREATE INDEX idx_events_correlation ON events(correlation_id);
    CREATE INDEX idx_events_causation ON events(causation_id);
    CREATE INDEX idx_events_planner_run ON events(planner_run_id);
    CREATE INDEX idx_events_plan ON events(plan_id);
    CREATE INDEX idx_events_run ON events(run_id);
    CREATE INDEX idx_events_workflow_run ON events(workflow_run_id);
    CREATE INDEX idx_events_workflow_step ON events(workflow_step_run_id);
    CREATE INDEX idx_events_background_run ON events(background_run_id);
    CREATE INDEX idx_events_subagent_run ON events(subagent_run_id);
    CREATE INDEX idx_events_tool_call ON events(tool_call_id);
    CREATE INDEX idx_events_approval ON events(approval_id);
    CREATE INDEX idx_events_event_type ON events(event_type, created_at);
    CREATE INDEX idx_events_source_module ON events(source_module, created_at)
  `,
  down: `
    DROP INDEX IF EXISTS idx_events_session_created;
    DROP INDEX IF EXISTS idx_events_user_created;
    DROP INDEX IF EXISTS idx_events_correlation;
    DROP INDEX IF EXISTS idx_events_causation;
    DROP INDEX IF EXISTS idx_events_planner_run;
    DROP INDEX IF EXISTS idx_events_plan;
    DROP INDEX IF EXISTS idx_events_run;
    DROP INDEX IF EXISTS idx_events_workflow_run;
    DROP INDEX IF EXISTS idx_events_workflow_step;
    DROP INDEX IF EXISTS idx_events_background_run;
    DROP INDEX IF EXISTS idx_events_subagent_run;
    DROP INDEX IF EXISTS idx_events_tool_call;
    DROP INDEX IF EXISTS idx_events_approval;
    DROP INDEX IF EXISTS idx_events_event_type;
    DROP INDEX IF EXISTS idx_events_source_module;
    DROP TABLE IF EXISTS events
  `
};

// ============================================================================
// STORE 2: RuntimeAction Store (version 2)
// ============================================================================
export const runtimeActionsTableMigration: Migration = {
  version: 2,
  name: 'create_runtime_actions_table',
  up: `
    CREATE TABLE runtime_actions (
      action_id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      source_module TEXT NOT NULL,
      source_action TEXT,
      target_runtime TEXT NOT NULL,
      target_action TEXT NOT NULL,
      payload TEXT NOT NULL,
      correlation_id TEXT,
      causation_id TEXT,
      session_id TEXT,
      user_id TEXT,
      planner_run_id TEXT,
      plan_id TEXT,
      run_id TEXT,
      workflow_run_id TEXT,
      workflow_step_run_id TEXT,
      background_run_id TEXT,
      subagent_run_id TEXT,
      tool_call_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      status_message TEXT,
      result TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_runtime_actions_idempotency ON runtime_actions(idempotency_key);
    CREATE INDEX idx_runtime_actions_source ON runtime_actions(source_module, created_at);
    CREATE INDEX idx_runtime_actions_target ON runtime_actions(target_runtime, created_at);
    CREATE INDEX idx_runtime_actions_status ON runtime_actions(status);
    CREATE INDEX idx_runtime_actions_correlation ON runtime_actions(correlation_id);
    CREATE INDEX idx_runtime_actions_session ON runtime_actions(session_id);
    CREATE INDEX idx_runtime_actions_user ON runtime_actions(user_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_runtime_actions_idempotency;
    DROP INDEX IF EXISTS idx_runtime_actions_source;
    DROP INDEX IF EXISTS idx_runtime_actions_target;
    DROP INDEX IF EXISTS idx_runtime_actions_status;
    DROP INDEX IF EXISTS idx_runtime_actions_correlation;
    DROP INDEX IF EXISTS idx_runtime_actions_session;
    DROP INDEX IF EXISTS idx_runtime_actions_user;
    DROP TABLE IF EXISTS runtime_actions
  `
};

// ============================================================================
// STORE 3: Transcript Store (version 3)
// ============================================================================
export const transcriptsTableMigration: Migration = {
  version: 3,
  name: 'create_transcripts_table',
  up: `
    CREATE TABLE transcripts (
      turnId TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      userId TEXT NOT NULL,
      inboundEventId TEXT,
      userMessageSummary TEXT,
      contentRefs TEXT,
      visibleMessages TEXT NOT NULL,
      artifactRefs TEXT,
      foregroundDecisionId TEXT,
      plannerRunIds TEXT,
      runtimeActionIds TEXT,
      toolCallSummaries TEXT,
      approvalSummaries TEXT,
      startEventId TEXT,
      endEventId TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      createdAt TEXT NOT NULL
    );
    CREATE INDEX idx_transcripts_session ON transcripts(sessionId, createdAt);
    CREATE INDEX idx_transcripts_user ON transcripts(userId, createdAt);
    CREATE INDEX idx_transcripts_artifact_refs ON transcripts(artifactRefs) WHERE artifactRefs IS NOT NULL;
    CREATE INDEX idx_transcripts_planner_runs ON transcripts(plannerRunIds) WHERE plannerRunIds IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_transcripts_session;
    DROP INDEX IF EXISTS idx_transcripts_user;
    DROP INDEX IF EXISTS idx_transcripts_artifact_refs;
    DROP INDEX IF EXISTS idx_transcripts_planner_runs;
    DROP TABLE IF EXISTS transcripts
  `
};

// ============================================================================
// STORE 4: Summary Store (version 4)
// ============================================================================
export const summariesTableMigration: Migration = {
  version: 4,
  name: 'create_summaries_table',
  up: `
    CREATE TABLE summaries (
      summary_id TEXT PRIMARY KEY,
      summary_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      run_id TEXT,
      related_refs TEXT,
      source_refs TEXT NOT NULL,
      summary TEXT NOT NULL,
      structured_state TEXT,
      status TEXT NOT NULL,
      retrieval TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX idx_summaries_user_type_updated ON summaries(user_id, summary_type, updated_at);
    CREATE INDEX idx_summaries_session_type_updated ON summaries(session_id, summary_type, updated_at);
    CREATE INDEX idx_summaries_plan_id ON summaries(json_extract(related_refs, '$.planId')) WHERE related_refs IS NOT NULL;
    CREATE INDEX idx_summaries_planner_run_id ON summaries(json_extract(related_refs, '$.plannerRunId')) WHERE related_refs IS NOT NULL;
    CREATE INDEX idx_summaries_workflow_run_id ON summaries(json_extract(related_refs, '$.workflowRunId')) WHERE related_refs IS NOT NULL;
    CREATE INDEX idx_summaries_status ON summaries(status);
    CREATE INDEX idx_summaries_run_id ON summaries(run_id) WHERE run_id IS NOT NULL;
    CREATE INDEX idx_summaries_session_id ON summaries(session_id) WHERE session_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_summaries_user_type_updated;
    DROP INDEX IF EXISTS idx_summaries_session_type_updated;
    DROP INDEX IF EXISTS idx_summaries_plan_id;
    DROP INDEX IF EXISTS idx_summaries_planner_run_id;
    DROP INDEX IF EXISTS idx_summaries_workflow_run_id;
    DROP INDEX IF EXISTS idx_summaries_status;
    DROP INDEX IF EXISTS idx_summaries_run_id;
    DROP INDEX IF EXISTS idx_summaries_session_id;
    DROP TABLE IF EXISTS summaries
  `
};

// ============================================================================
// STORE 5: Plan Store (version 5)
// ============================================================================
export const plansTableMigration: Migration = {
  version: 5,
  name: 'create_plans_table',
  up: `
    CREATE TABLE plans (
      plan_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      objective TEXT NOT NULL,
      objective_hash TEXT,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      planner_run_ids TEXT,
      steps TEXT NOT NULL,
      constraints TEXT,
      assumptions TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_plans_user_updated ON plans(user_id, updated_at);
    CREATE INDEX idx_plans_session_updated ON plans(session_id, updated_at);
    CREATE INDEX idx_plans_status ON plans(status);
    CREATE INDEX idx_plans_objective_hash ON plans(objective_hash) WHERE objective_hash IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_plans_user_updated;
    DROP INDEX IF EXISTS idx_plans_session_updated;
    DROP INDEX IF EXISTS idx_plans_status;
    DROP INDEX IF EXISTS idx_plans_objective_hash;
    DROP TABLE IF EXISTS plans
  `
};

// ============================================================================
// STORE 5b: Plan Patches (version 6)
// ============================================================================
export const planPatchesTableMigration: Migration = {
  version: 6,
  name: 'create_plan_patches_table',
  up: `
    CREATE TABLE plan_patches (
      patch_id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL,
      from_version INTEGER NOT NULL,
      to_version INTEGER NOT NULL,
      patch TEXT NOT NULL,
      source_planner_run_id TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_plan_patches_plan_id ON plan_patches(plan_id);
    CREATE INDEX idx_plan_patches_versions ON plan_patches(plan_id, from_version, to_version)
  `,
  down: `
    DROP INDEX IF EXISTS idx_plan_patches_plan_id;
    DROP INDEX IF EXISTS idx_plan_patches_versions;
    DROP TABLE IF EXISTS plan_patches
  `
};

// ============================================================================
// STORE 6: PlannerRun Store (version 7)
// ============================================================================
export const plannerRunsTableMigration: Migration = {
  version: 7,
  name: 'create_planner_runs_table',
  up: `
    CREATE TABLE planner_runs (
      planner_run_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL,
      checkpoint TEXT,
      background_run_id TEXT,
      workflow_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_planner_runs_user_status ON planner_runs(user_id, status);
    CREATE INDEX idx_planner_runs_session_status ON planner_runs(session_id, status);
    CREATE INDEX idx_planner_runs_plan_id ON planner_runs(plan_id);
    CREATE INDEX idx_planner_runs_background_run ON planner_runs(background_run_id) WHERE background_run_id IS NOT NULL;
    CREATE INDEX idx_planner_runs_workflow_run ON planner_runs(workflow_run_id) WHERE workflow_run_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_planner_runs_user_status;
    DROP INDEX IF EXISTS idx_planner_runs_session_status;
    DROP INDEX IF EXISTS idx_planner_runs_plan_id;
    DROP INDEX IF EXISTS idx_planner_runs_background_run;
    DROP INDEX IF EXISTS idx_planner_runs_workflow_run;
    DROP TABLE IF EXISTS planner_runs
  `
};

// ============================================================================
// STORE 7: KernelRun Store (version 8)
// ============================================================================
export const kernelRunsTableMigration: Migration = {
  version: 8,
  name: 'create_kernel_runs_table',
  up: `
    CREATE TABLE kernel_runs (
      run_id TEXT PRIMARY KEY,
      session_id TEXT,
      agent_id TEXT NOT NULL,
      invocation_source TEXT NOT NULL,
      status TEXT NOT NULL,
      checkpoint_data TEXT,
      final_result TEXT,
      metrics TEXT,
      event_start INTEGER,
      event_end INTEGER,
      parent_run_id TEXT,
      root_run_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_kernel_runs_session_created ON kernel_runs(session_id, created_at);
    CREATE INDEX idx_kernel_runs_agent_id ON kernel_runs(agent_id);
    CREATE INDEX idx_kernel_runs_status ON kernel_runs(status);
    CREATE INDEX idx_kernel_runs_parent_run ON kernel_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
    CREATE INDEX idx_kernel_runs_root_run ON kernel_runs(root_run_id) WHERE root_run_id IS NOT NULL;
    CREATE INDEX idx_kernel_runs_invocation ON kernel_runs(invocation_source)
  `,
  down: `
    DROP INDEX IF EXISTS idx_kernel_runs_session_created;
    DROP INDEX IF EXISTS idx_kernel_runs_agent_id;
    DROP INDEX IF EXISTS idx_kernel_runs_status;
    DROP INDEX IF EXISTS idx_kernel_runs_parent_run;
    DROP INDEX IF EXISTS idx_kernel_runs_root_run;
    DROP INDEX IF EXISTS idx_kernel_runs_invocation;
    DROP TABLE IF EXISTS kernel_runs
  `
};

// ============================================================================
// STORE 8: ToolExecution Store (version 9)
// ============================================================================
export const toolExecutionsTableMigration: Migration = {
  version: 9,
  name: 'create_tool_executions_table',
  up: `
    CREATE TABLE tool_executions (
      tool_call_id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      kernel_run_id TEXT,
      status TEXT NOT NULL,
      params TEXT,
      result_preview TEXT,
      result_ref TEXT,
      structured_content TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'low',
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      terminal_state_reached INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_tool_executions_tool_name ON tool_executions(tool_name, started_at);
    CREATE INDEX idx_tool_executions_session ON tool_executions(session_id);
    CREATE INDEX idx_tool_executions_sensitivity ON tool_executions(sensitivity);
    CREATE INDEX idx_tool_executions_kernel_pending ON tool_executions(kernel_run_id, terminal_state_reached) WHERE terminal_state_reached = 0;
    CREATE INDEX idx_tool_executions_status ON tool_executions(status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_tool_executions_tool_name;
    DROP INDEX IF EXISTS idx_tool_executions_session;
    DROP INDEX IF EXISTS idx_tool_executions_sensitivity;
    DROP INDEX IF EXISTS idx_tool_executions_kernel_pending;
    DROP INDEX IF EXISTS idx_tool_executions_status;
    DROP TABLE IF EXISTS tool_executions
  `
};

// ============================================================================
// STORE 9: BackgroundRun Store (version 10)
// ============================================================================
export const backgroundRunsTableMigration: Migration = {
  version: 10,
  name: 'create_background_runs_table',
  up: `
    CREATE TABLE background_runs (
      background_run_id TEXT PRIMARY KEY,
      subagent_run_id TEXT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      agent_type TEXT NOT NULL,
      status TEXT NOT NULL,
      launch_source TEXT NOT NULL,
      checkpoint_data TEXT,
      recovery_point TEXT,
      result_data TEXT,
      error_message TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      expires_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_background_runs_user_status ON background_runs(user_id, status);
    CREATE INDEX idx_background_runs_session_status ON background_runs(session_id, status);
    CREATE INDEX idx_background_runs_subagent ON background_runs(subagent_run_id) WHERE subagent_run_id IS NOT NULL;
    CREATE INDEX idx_background_runs_launch_source ON background_runs(launch_source);
    CREATE INDEX idx_background_runs_expires ON background_runs(expires_at) WHERE expires_at IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_background_runs_user_status;
    DROP INDEX IF EXISTS idx_background_runs_session_status;
    DROP INDEX IF EXISTS idx_background_runs_subagent;
    DROP INDEX IF EXISTS idx_background_runs_launch_source;
    DROP INDEX IF EXISTS idx_background_runs_expires;
    DROP TABLE IF EXISTS background_runs
  `
};

// ============================================================================
// STORE 10: WorkflowRun Store (version 11)
// ============================================================================
export const workflowRunsTableMigration: Migration = {
  version: 11,
  name: 'create_workflow_runs_table',
  up: `
    CREATE TABLE workflow_runs (
      workflow_run_id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_version TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      trigger_event_id TEXT,
      status TEXT NOT NULL,
      current_step_ids TEXT,
      input_data TEXT,
      output_data TEXT,
      context_data TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);
    CREATE INDEX idx_workflow_runs_owner_status ON workflow_runs(owner_user_id, status);
    CREATE INDEX idx_workflow_runs_trigger ON workflow_runs(trigger_event_id) WHERE trigger_event_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_workflow_runs_workflow;
    DROP INDEX IF EXISTS idx_workflow_runs_owner_status;
    DROP INDEX IF EXISTS idx_workflow_runs_trigger;
    DROP TABLE IF EXISTS workflow_runs
  `
};

// ============================================================================
// STORE 10b: WorkflowStepRun Store (version 12)
// ============================================================================
export const workflowStepRunsTableMigration: Migration = {
  version: 12,
  name: 'create_workflow_step_runs_table',
  up: `
    CREATE TABLE workflow_step_runs (
      step_run_id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL,
      kernel_run_id TEXT,
      subagent_run_id TEXT,
      tool_call_id TEXT,
      approval_id TEXT,
      input_data TEXT,
      output_data TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_step_runs_workflow_status ON workflow_step_runs(workflow_run_id, status);
    CREATE INDEX idx_workflow_step_runs_step_id ON workflow_step_runs(step_id);
    CREATE INDEX idx_workflow_step_runs_kernel ON workflow_step_runs(kernel_run_id) WHERE kernel_run_id IS NOT NULL;
    CREATE INDEX idx_workflow_step_runs_subagent ON workflow_step_runs(subagent_run_id) WHERE subagent_run_id IS NOT NULL;
    CREATE INDEX idx_workflow_step_runs_tool ON workflow_step_runs(tool_call_id) WHERE tool_call_id IS NOT NULL;
    CREATE INDEX idx_workflow_step_runs_approval ON workflow_step_runs(approval_id) WHERE approval_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_workflow_step_runs_workflow_status;
    DROP INDEX IF EXISTS idx_workflow_step_runs_step_id;
    DROP INDEX IF EXISTS idx_workflow_step_runs_kernel;
    DROP INDEX IF EXISTS idx_workflow_step_runs_subagent;
    DROP INDEX IF EXISTS idx_workflow_step_runs_tool;
    DROP INDEX IF EXISTS idx_workflow_step_runs_approval;
    DROP TABLE IF EXISTS workflow_step_runs
  `
};

// ============================================================================
// STORE 11: Approval Store (version 13)
// ============================================================================
export const approvalRequestsTableMigration: Migration = {
  version: 13,
  name: 'create_approval_requests_table',
  up: `
    CREATE TABLE approval_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT,
      scope TEXT,
      action_type TEXT NOT NULL,
      resource TEXT,
      justification TEXT,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT,
      responded_at TEXT,
      response_by TEXT,
      response_reason TEXT,
      idempotency_key TEXT,
      metadata TEXT,
      source_context TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_approval_requests_user_status ON approval_requests(user_id, status);
    CREATE INDEX idx_approval_requests_session_status ON approval_requests(session_id, status);
    CREATE INDEX idx_approval_requests_expires ON approval_requests(expires_at) WHERE expires_at IS NOT NULL;
    CREATE INDEX idx_approval_requests_source_context ON approval_requests(source_context) WHERE source_context IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_approval_requests_user_status;
    DROP INDEX IF EXISTS idx_approval_requests_session_status;
    DROP INDEX IF EXISTS idx_approval_requests_expires;
    DROP INDEX IF EXISTS idx_approval_requests_source_context;
    DROP TABLE IF EXISTS approval_requests
  `
};

// ============================================================================
// STORE 12: PermissionGrant Store (version 14)
// ============================================================================
export const permissionGrantsTableMigration: Migration = {
  version: 14,
  name: 'create_permission_grants_table',
  up: `
    CREATE TABLE permission_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_pattern TEXT,
      conditions TEXT,
      risk_level_max TEXT,
      expires_at TEXT,
      source_context TEXT,
      revoked_at TEXT,
      revoked_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_permission_grants_user ON permission_grants(user_id);
    CREATE INDEX idx_permission_grants_scope ON permission_grants(scope);
    CREATE INDEX idx_permission_grants_expires ON permission_grants(expires_at) WHERE expires_at IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_permission_grants_user;
    DROP INDEX IF EXISTS idx_permission_grants_scope;
    DROP INDEX IF EXISTS idx_permission_grants_expires;
    DROP TABLE IF EXISTS permission_grants
  `
};

// ============================================================================
// STORE 13: Trigger Store (version 15)
// ============================================================================
export const triggerRegistrationsTableMigration: Migration = {
  version: 15,
  name: 'create_trigger_registrations_table',
  up: `
    CREATE TABLE trigger_registrations (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL,
      condition_type TEXT NOT NULL,
      condition_pattern TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      max_triggers INTEGER,
      trigger_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_trigger_registrations_target ON trigger_registrations(target_type, target_ref);
    CREATE INDEX idx_trigger_registrations_status ON trigger_registrations(status);
    CREATE INDEX idx_trigger_registrations_expires ON trigger_registrations(expires_at) WHERE expires_at IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_trigger_registrations_target;
    DROP INDEX IF EXISTS idx_trigger_registrations_status;
    DROP INDEX IF EXISTS idx_trigger_registrations_expires;
    DROP TABLE IF EXISTS trigger_registrations
  `
};

// ============================================================================
// STORE 14: WaitCondition Store (version 16)
// ============================================================================
export const waitConditionsTableMigration: Migration = {
  version: 16,
  name: 'create_wait_conditions_table',
  up: `
    CREATE TABLE wait_conditions (
      id TEXT PRIMARY KEY,
      wait_type TEXT NOT NULL,
      condition_pattern TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      timeout_at TEXT,
      satisfied_at TEXT,
      satisfied_by TEXT,
      result_data TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_wait_conditions_target ON wait_conditions(target_type, target_ref);
    CREATE INDEX idx_wait_conditions_status ON wait_conditions(status);
    CREATE INDEX idx_wait_conditions_timeout ON wait_conditions(timeout_at) WHERE timeout_at IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_wait_conditions_target;
    DROP INDEX IF EXISTS idx_wait_conditions_status;
    DROP INDEX IF EXISTS idx_wait_conditions_timeout;
    DROP TABLE IF EXISTS wait_conditions
  `
};

// ============================================================================
// STORE 15: Artifact Store (version 17)
// ============================================================================
export const artifactsTableMigration: Migration = {
  version: 17,
  name: 'create_artifacts_table',
  up: `
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL UNIQUE,
      artifact_type TEXT NOT NULL CHECK(artifact_type IN ('document', 'draft', 'image', 'report', 'spreadsheet', 'code', 'workflow')),
      name TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      content_summary TEXT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'archived', 'deleted')),
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_artifacts_artifact_id ON artifacts(artifact_id);
    CREATE INDEX idx_artifacts_user_updated ON artifacts(user_id, updated_at DESC);
    CREATE INDEX idx_artifacts_session ON artifacts(session_id);
    CREATE INDEX idx_artifacts_type ON artifacts(artifact_type);
    CREATE INDEX idx_artifacts_status ON artifacts(status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_artifacts_status;
    DROP INDEX IF EXISTS idx_artifacts_type;
    DROP INDEX IF EXISTS idx_artifacts_session;
    DROP INDEX IF EXISTS idx_artifacts_user_updated;
    DROP INDEX IF EXISTS idx_artifacts_artifact_id;
    DROP TABLE IF EXISTS artifacts
  `
};

// ============================================================================
// STORE 16: ToolResult Store (version 18)
// ============================================================================
export const toolResultsTableMigration: Migration = {
  version: 18,
  name: 'create_tool_results_table',
  up: `
    CREATE TABLE tool_results (
      id TEXT PRIMARY KEY,
      result_ref TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      preview TEXT,
      raw_blob_ref TEXT,
      structured_content TEXT,
      sensitivity TEXT NOT NULL CHECK(sensitivity IN ('low', 'medium', 'high', 'restricted')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_tool_results_tool_call_id ON tool_results(tool_call_id);
    CREATE INDEX idx_tool_results_session_id ON tool_results(session_id);
    CREATE INDEX idx_tool_results_tool_name_created ON tool_results(tool_name, created_at);
    CREATE INDEX idx_tool_results_sensitivity ON tool_results(sensitivity)
  `,
  down: `
    DROP INDEX IF EXISTS idx_tool_results_sensitivity;
    DROP INDEX IF EXISTS idx_tool_results_tool_name_created;
    DROP INDEX IF EXISTS idx_tool_results_session_id;
    DROP INDEX IF EXISTS idx_tool_results_tool_call_id;
    DROP TABLE IF EXISTS tool_results
  `
};

// ============================================================================
// STORE 17: Connector Store (version 19-21)
// ============================================================================
export const connectorDefinitionsTableMigration: Migration = {
  version: 19,
  name: 'create_connector_definitions_table',
  up: `
    CREATE TABLE connector_definitions (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      connector_type TEXT NOT NULL CHECK(connector_type IN ('api', 'messaging', 'storage', 'database', 'custom')),
      version TEXT NOT NULL,
      description TEXT,
      capabilities TEXT NOT NULL,
      config_schema TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_connector_defs_type ON connector_definitions(connector_type);
    CREATE INDEX idx_connector_defs_status ON connector_definitions(status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_connector_defs_status;
    DROP INDEX IF EXISTS idx_connector_defs_type;
    DROP TABLE IF EXISTS connector_definitions
  `
};

export const connectorInstancesTableMigration: Migration = {
  version: 20,
  name: 'create_connector_instances_table',
  up: `
    CREATE TABLE connector_instances (
      id TEXT PRIMARY KEY,
      connector_instance_id TEXT NOT NULL UNIQUE,
      connector_definition_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      auth_state_ref TEXT NOT NULL,
      config TEXT,
      status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'deprecated', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_connector_instances_user_def ON connector_instances(user_id, connector_definition_id);
    CREATE INDEX idx_connector_instances_status ON connector_instances(status);
    CREATE INDEX idx_connector_instances_def_id ON connector_instances(connector_definition_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_connector_instances_def_id;
    DROP INDEX IF EXISTS idx_connector_instances_status;
    DROP INDEX IF EXISTS idx_connector_instances_user_def;
    DROP TABLE IF EXISTS connector_instances
  `
};

export const connectorEventsTableMigration: Migration = {
  version: 21,
  name: 'create_connector_events_table',
  up: `
    CREATE TABLE connector_events (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      connector_instance_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_connector_events_instance ON connector_events(connector_instance_id);
    CREATE INDEX idx_connector_events_processed ON connector_events(processed);
    CREATE INDEX idx_connector_events_type ON connector_events(event_type)
  `,
  down: `
    DROP INDEX IF EXISTS idx_connector_events_type;
    DROP INDEX IF EXISTS idx_connector_events_processed;
    DROP INDEX IF EXISTS idx_connector_events_instance;
    DROP TABLE IF EXISTS connector_events
  `
};

// ============================================================================
// STORE 18: Workflow Draft Store (version 22)
// ============================================================================
export const workflowDraftsTableMigration: Migration = {
  version: 22,
  name: 'create_workflow_drafts_table',
  up: `
    CREATE TABLE workflow_drafts (
      draft_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'validating', 'invalid')),
      validation_issues TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_drafts_owner ON workflow_drafts(owner_user_id);
    CREATE INDEX idx_workflow_drafts_status ON workflow_drafts(status);
    CREATE INDEX idx_workflow_drafts_updated ON workflow_drafts(updated_at DESC)
  `,
  down: `
    DROP INDEX IF EXISTS idx_workflow_drafts_updated;
    DROP INDEX IF EXISTS idx_workflow_drafts_status;
    DROP INDEX IF EXISTS idx_workflow_drafts_owner;
    DROP TABLE IF EXISTS workflow_drafts
  `
};

// ============================================================================
// STORE 19: Workflow Definition Store (version 23)
// ============================================================================
export const workflowDefinitionsTableMigration: Migration = {
  version: 23,
  name: 'create_workflow_definitions_table',
  up: `
    CREATE TABLE workflow_definitions (
      workflow_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version INTEGER NOT NULL,
      steps TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('published', 'deprecated')),
      published_from_draft_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_defs_owner ON workflow_definitions(owner_user_id);
    CREATE INDEX idx_workflow_defs_status ON workflow_definitions(status);
    CREATE INDEX idx_workflow_defs_name_version ON workflow_definitions(name, version);
    CREATE INDEX idx_workflow_defs_draft ON workflow_definitions(published_from_draft_id);
    CREATE INDEX idx_workflow_defs_updated ON workflow_definitions(updated_at DESC)
  `,
  down: `
    DROP INDEX IF EXISTS idx_workflow_defs_updated;
    DROP INDEX IF EXISTS idx_workflow_defs_draft;
    DROP INDEX IF EXISTS idx_workflow_defs_name_version;
    DROP INDEX IF EXISTS idx_workflow_defs_status;
    DROP INDEX IF EXISTS idx_workflow_defs_owner;
    DROP TABLE IF EXISTS workflow_definitions
  `
};

// ============================================================================
// ALL MIGRATIONS ARRAY
// ============================================================================

// ============================================================================
// STORE 20: Observability - Trace Contexts (version 24)
// ============================================================================
export const traceContextsTableMigration: Migration = {
  version: 24,
  name: 'create_trace_contexts_table',
  up: `
    CREATE TABLE trace_contexts (
      trace_id TEXT PRIMARY KEY,
      root_span_id TEXT NOT NULL,
      correlation_id TEXT,
      user_id TEXT,
      session_id TEXT,
      started_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'failed', 'cancelled'))
    );
    CREATE INDEX idx_trace_contexts_correlation ON trace_contexts(correlation_id);
    CREATE INDEX idx_trace_contexts_user ON trace_contexts(user_id);
    CREATE INDEX idx_trace_contexts_session ON trace_contexts(session_id);
    CREATE INDEX idx_trace_contexts_status ON trace_contexts(status);
    CREATE INDEX idx_trace_contexts_started ON trace_contexts(started_at DESC)
  `,
  down: `
    DROP INDEX IF EXISTS idx_trace_contexts_started;
    DROP INDEX IF EXISTS idx_trace_contexts_status;
    DROP INDEX IF EXISTS idx_trace_contexts_session;
    DROP INDEX IF EXISTS idx_trace_contexts_user;
    DROP INDEX IF EXISTS idx_trace_contexts_correlation;
    DROP TABLE IF EXISTS trace_contexts
  `
};

export const traceSpansTableMigration: Migration = {
  version: 25,
  name: 'create_trace_spans_table',
  up: `
    CREATE TABLE trace_spans (
      span_id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_span_id TEXT,
      span_type TEXT NOT NULL CHECK(span_type IN ('dispatch', 'tool_execution', 'kernel_run', 'planner_run', 'workflow_run', 'background_run', 'trigger', 'connector_call', 'permission_check')),
      module TEXT NOT NULL CHECK(module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
      operation TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('started', 'completed', 'failed', 'cancelled')),
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_ms INTEGER,
      error TEXT,
      metadata TEXT
    );
    CREATE INDEX idx_trace_spans_trace ON trace_spans(trace_id);
    CREATE INDEX idx_trace_spans_parent ON trace_spans(parent_span_id);
    CREATE INDEX idx_trace_spans_module ON trace_spans(module);
    CREATE INDEX idx_trace_spans_type ON trace_spans(span_type);
    CREATE INDEX idx_trace_spans_status ON trace_spans(status);
    CREATE INDEX idx_trace_spans_start_time ON trace_spans(start_time DESC)
  `,
  down: `
    DROP INDEX IF EXISTS idx_trace_spans_start_time;
    DROP INDEX IF EXISTS idx_trace_spans_status;
    DROP INDEX IF EXISTS idx_trace_spans_type;
    DROP INDEX IF EXISTS idx_trace_spans_module;
    DROP INDEX IF EXISTS idx_trace_spans_parent;
    DROP INDEX IF EXISTS idx_trace_spans_trace;
    DROP TABLE IF EXISTS trace_spans
  `
};

export const metricsTableMigration: Migration = {
  version: 26,
  name: 'create_metrics_table',
  up: `
    CREATE TABLE metrics (
      metric_id TEXT PRIMARY KEY,
      trace_id TEXT,
      span_id TEXT,
      module TEXT NOT NULL CHECK(module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory')),
      metric_type TEXT NOT NULL CHECK(metric_type IN ('counter', 'gauge', 'histogram', 'timer')),
      name TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT,
      timestamp TEXT NOT NULL,
      labels TEXT
    );
    CREATE INDEX idx_metrics_trace ON metrics(trace_id);
    CREATE INDEX idx_metrics_span ON metrics(span_id);
    CREATE INDEX idx_metrics_module ON metrics(module);
    CREATE INDEX idx_metrics_type ON metrics(metric_type);
    CREATE INDEX idx_metrics_name ON metrics(name);
    CREATE INDEX idx_metrics_timestamp ON metrics(timestamp DESC);
    CREATE INDEX idx_metrics_module_name ON metrics(module, name, timestamp DESC)
  `,
  down: `
    DROP INDEX IF EXISTS idx_metrics_module_name;
    DROP INDEX IF EXISTS idx_metrics_timestamp;
    DROP INDEX IF EXISTS idx_metrics_name;
    DROP INDEX IF EXISTS idx_metrics_type;
    DROP INDEX IF EXISTS idx_metrics_module;
    DROP INDEX IF EXISTS idx_metrics_span;
    DROP INDEX IF EXISTS idx_metrics_trace;
    DROP TABLE IF EXISTS metrics
  `
};

// ============================================================================
// STORE 21: Audit Store (version 27)
// ============================================================================
export const auditRecordsTableMigration: Migration = {
  version: 27,
  name: 'create_audit_records_table',
  up: `
    CREATE TABLE audit_records (
      audit_id TEXT PRIMARY KEY,
      audit_type TEXT NOT NULL CHECK(audit_type IN ('user_input', 'assistant_output', 'tool_call', 'external_write', 'permission_decision', 'approval_request', 'approval_response', 'workflow_change', 'workflow_run', 'subagent_run', 'connector_access', 'memory_write', 'memory_delete', 'summary_write', 'dispatch')),
      timestamp TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT,
      source_module TEXT NOT NULL CHECK(source_module IN ('gateway', 'dispatcher', 'kernel', 'tool', 'workflow', 'subagent', 'trigger', 'connector', 'permission', 'memory', 'system')),
      source_action TEXT NOT NULL,
      action_summary TEXT NOT NULL,
      target_type TEXT,
      target_ref TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed', 'blocked')),
      payload TEXT NOT NULL,
      input_hash TEXT,
      correlation_id TEXT,
      causation_id TEXT,
      approval_id TEXT,
      tool_call_id TEXT,
      permission_decision_id TEXT,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
      sensitivity TEXT NOT NULL CHECK(sensitivity IN ('low', 'medium', 'high', 'restricted'))
    );
    CREATE INDEX idx_audit_records_user_timestamp ON audit_records(user_id, timestamp DESC);
    CREATE INDEX idx_audit_records_session_timestamp ON audit_records(session_id, timestamp DESC);
    CREATE INDEX idx_audit_records_type_timestamp ON audit_records(audit_type, timestamp DESC);
    CREATE INDEX idx_audit_records_module_timestamp ON audit_records(source_module, timestamp DESC);
    CREATE INDEX idx_audit_records_correlation ON audit_records(correlation_id);
    CREATE INDEX idx_audit_records_approval ON audit_records(approval_id) WHERE approval_id IS NOT NULL;
    CREATE INDEX idx_audit_records_tool_call ON audit_records(tool_call_id) WHERE tool_call_id IS NOT NULL;
    CREATE INDEX idx_audit_records_permission ON audit_records(permission_decision_id) WHERE permission_decision_id IS NOT NULL;
    CREATE INDEX idx_audit_records_status ON audit_records(status);
    CREATE INDEX idx_audit_records_risk_level ON audit_records(risk_level);
    CREATE INDEX idx_audit_records_sensitivity ON audit_records(sensitivity)
  `,
  down: `
    DROP INDEX IF EXISTS idx_audit_records_user_timestamp;
    DROP INDEX IF EXISTS idx_audit_records_session_timestamp;
    DROP INDEX IF EXISTS idx_audit_records_type_timestamp;
    DROP INDEX IF EXISTS idx_audit_records_module_timestamp;
    DROP INDEX IF EXISTS idx_audit_records_correlation;
    DROP INDEX IF EXISTS idx_audit_records_approval;
    DROP INDEX IF EXISTS idx_audit_records_tool_call;
    DROP INDEX IF EXISTS idx_audit_records_permission;
    DROP INDEX IF EXISTS idx_audit_records_status;
    DROP INDEX IF EXISTS idx_audit_records_risk_level;
    DROP INDEX IF EXISTS idx_audit_records_sensitivity;
    DROP TABLE IF EXISTS audit_records
  `
};

// ============================================================================
// STORE 22: Sessions Store (version 28)
// ============================================================================
export const sessionsTableMigration: Migration = {
  version: 28,
  name: 'create_sessions_table',
  up: `
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'archived', 'closed')),
      message_count INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX idx_sessions_user_activity ON sessions(user_id, last_activity_at);
    CREATE INDEX idx_sessions_status ON sessions(status)
  `,
  down: `
    DROP INDEX IF EXISTS idx_sessions_user_activity;
    DROP INDEX IF EXISTS idx_sessions_status;
    DROP TABLE IF EXISTS sessions
  `
};

// ============================================================================
// STORE 23: Users Store (version 29)
// ============================================================================
export const usersTableMigration: Migration = {
  version: 29,
  name: 'create_users_table',
  up: `
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `,
  down: `
    DROP TABLE IF EXISTS users
  `
};

// ============================================================================
// STORE 24: Auth Tokens Store (version 30)
// ============================================================================
export const authTokensTableMigration: Migration = {
  version: 30,
  name: 'create_auth_tokens_table',
  up: `
    CREATE TABLE auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
    CREATE INDEX idx_auth_tokens_expires ON auth_tokens(expires_at)
  `,
  down: `
    DROP INDEX IF EXISTS idx_auth_tokens_expires;
    DROP INDEX IF EXISTS idx_auth_tokens_user;
    DROP TABLE IF EXISTS auth_tokens
  `
};

// ============================================================================
// STORE 25: Provider Configs Store (version 31)
// ============================================================================
export const providerConfigsTableMigration: Migration = {
  version: 31,
  name: 'create_provider_configs_table',
  up: `
    CREATE TABLE provider_configs (
      provider_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','custom')),
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url TEXT,
      selected_model TEXT,
      encrypted_api_key TEXT,
      api_key_last4 TEXT,
      source TEXT NOT NULL DEFAULT 'database',
      last_test_status TEXT,
      last_tested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_provider_configs_user;
    DROP TABLE IF EXISTS provider_configs
  `
};

// ============================================================================
// STORE 26: Sessions Model Selection (version 32)
// ============================================================================
export const sessionsModelSelectionMigration: Migration = {
  version: 32,
  name: 'add_session_model_selection',
  up: `
    ALTER TABLE sessions ADD COLUMN selected_model TEXT;
    ALTER TABLE sessions ADD COLUMN selected_provider_id TEXT
  `,
  down: `
    -- SQLite doesn't support dropping columns, would need table recreation
    -- This is a no-op for rollback
  `
};

// ============================================================================
// STORE 27: Custom Provider Type (version 33)
// ============================================================================
export const customProviderTypeMigration: Migration = {
  version: 33,
  name: 'add_custom_provider_type',
  up: `
    CREATE TABLE provider_configs_new (
      provider_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','custom')),
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url TEXT,
      selected_model TEXT,
      encrypted_api_key TEXT,
      api_key_last4 TEXT,
      source TEXT NOT NULL DEFAULT 'database',
      last_test_status TEXT,
      last_tested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_configs_new (
      provider_id, user_id, provider_type, display_name, enabled,
      base_url, selected_model, encrypted_api_key, api_key_last4,
      source, last_test_status, last_tested_at, created_at, updated_at
    ) SELECT
      provider_id, user_id, provider_type, display_name, enabled,
      base_url, selected_model, encrypted_api_key, api_key_last4,
      source, last_test_status, last_tested_at, created_at, updated_at
    FROM provider_configs;
    DROP INDEX IF EXISTS idx_provider_configs_user;
    DROP TABLE provider_configs;
    ALTER TABLE provider_configs_new RENAME TO provider_configs;
    CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)
  `,
  down: `
    CREATE TABLE provider_configs_old (
      provider_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama')),
      display_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url TEXT,
      selected_model TEXT,
      encrypted_api_key TEXT,
      api_key_last4 TEXT,
      source TEXT NOT NULL DEFAULT 'database',
      last_test_status TEXT,
      last_tested_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_configs_old (
      provider_id, user_id, provider_type, display_name, enabled,
      base_url, selected_model, encrypted_api_key, api_key_last4,
      source, last_test_status, last_tested_at, created_at, updated_at
    ) SELECT
      provider_id, user_id, provider_type, display_name, enabled,
      base_url, selected_model, encrypted_api_key, api_key_last4,
      source, last_test_status, last_tested_at, created_at, updated_at
    FROM provider_configs
    WHERE provider_type IN ('openai','openrouter','ollama');
    DROP INDEX IF EXISTS idx_provider_configs_user;
    DROP TABLE provider_configs;
    ALTER TABLE provider_configs_old RENAME TO provider_configs;
    CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)
  `
};

// ============================================================================
// STORE 28: Agent Config Store (version 34)
// ============================================================================
export const agentConfigsTableMigration: Migration = {
  version: 34,
  name: 'create_agent_configs_table',
  up: `
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
      allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
      routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_agent_configs_global ON agent_configs(agent_id, scope) WHERE scope = 'global';
    CREATE UNIQUE INDEX idx_agent_configs_user ON agent_configs(agent_id, scope, user_id) WHERE scope = 'user';
    CREATE INDEX idx_agent_configs_agent_id ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user_id ON agent_configs(user_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_agent_configs_user;
    DROP INDEX IF EXISTS idx_agent_configs_global;
    DROP INDEX IF EXISTS idx_agent_configs_agent_id;
    DROP INDEX IF EXISTS idx_agent_configs_user_id;
    DROP TABLE IF EXISTS agent_configs
  `
};

// ============================================================================
// STORE 29: Agent Config Runtime Defaults (version 35)
// ============================================================================
export const agentConfigRuntimeDefaultsMigration: Migration = {
  version: 35,
  name: 'update_agent_config_runtime_defaults',
  up: `
    ALTER TABLE agent_configs RENAME TO agent_configs_old;
    DROP INDEX IF EXISTS idx_agent_configs_global;
    DROP INDEX IF EXISTS idx_agent_configs_user;
    DROP INDEX IF EXISTS idx_agent_configs_agent_id;
    DROP INDEX IF EXISTS idx_agent_configs_user_id;
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
      allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
      routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    ) SELECT
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    FROM agent_configs_old;
    UPDATE agent_configs
    SET routing_timeout_ms = 60000,
        repair_attempts = 1,
        updated_at = datetime('now')
    WHERE agent_config_id = 'agent-global-foreground-default'
      AND agent_id = 'foreground.default'
      AND scope = 'global'
      AND user_id = ''
      AND display_name = 'Foreground Agent'
      AND enabled = 1
      AND system_prompt = 'You are the foreground agent. You handle user-facing interactions and coordinate with the planner and subagents as needed.'
      AND routing_prompt IS NULL
      AND provider_id IS NULL
      AND model IS NULL
      AND allowed_tool_ids = '[]'
      AND allowed_skill_ids = '[]'
      AND routing_timeout_ms = 10000
      AND repair_attempts = 1;
    DROP TABLE agent_configs_old;
    CREATE UNIQUE INDEX idx_agent_configs_global ON agent_configs(agent_id, scope) WHERE scope = 'global';
    CREATE UNIQUE INDEX idx_agent_configs_user ON agent_configs(agent_id, scope, user_id) WHERE scope = 'user';
    CREATE INDEX idx_agent_configs_agent_id ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user_id ON agent_configs(user_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_agent_configs_global;
    DROP INDEX IF EXISTS idx_agent_configs_user;
    DROP INDEX IF EXISTS idx_agent_configs_agent_id;
    DROP INDEX IF EXISTS idx_agent_configs_user_id;
    ALTER TABLE agent_configs RENAME TO agent_configs_new;
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT NOT NULL DEFAULT '[]',
      allowed_skill_ids TEXT NOT NULL DEFAULT '[]',
      routing_timeout_ms INTEGER NOT NULL DEFAULT 10000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    ) SELECT
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      created_at, updated_at
    FROM agent_configs_new;
    DROP TABLE agent_configs_new;
    CREATE UNIQUE INDEX idx_agent_configs_global ON agent_configs(agent_id, scope) WHERE scope = 'global';
    CREATE UNIQUE INDEX idx_agent_configs_user ON agent_configs(agent_id, scope, user_id) WHERE scope = 'user';
    CREATE INDEX idx_agent_configs_agent_id ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user_id ON agent_configs(user_id)
  `
};

export const agentConfigPromptBindingMigration: Migration = {
  version: 36,
  name: 'prompt_binding_and_allowlist_semantics',
  up: `
    ALTER TABLE agent_configs RENAME TO agent_configs_old;
    DROP INDEX IF EXISTS idx_agent_configs_unique;
    DROP INDEX IF EXISTS idx_agent_configs_agent;
    DROP INDEX IF EXISTS idx_agent_configs_user;
    DROP INDEX IF EXISTS idx_agent_configs_scope;
    CREATE TABLE agent_configs (
      agent_config_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'user')),
      user_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT,
      routing_prompt TEXT,
      provider_id TEXT,
      model TEXT,
      allowed_tool_ids TEXT,
      allowed_skill_ids TEXT,
      routing_timeout_ms INTEGER NOT NULL DEFAULT 60000,
      repair_attempts INTEGER NOT NULL DEFAULT 1,
      prompt_type TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO agent_configs (
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      allowed_tool_ids, allowed_skill_ids, routing_timeout_ms, repair_attempts,
      prompt_type, prompt_version,
      created_at, updated_at
    )
    SELECT
      agent_config_id, agent_id, scope, user_id, display_name, enabled,
      system_prompt, routing_prompt, provider_id, model,
      CASE WHEN allowed_tool_ids = '[]' THEN '["artifact.create","artifact.update","ask_user","status.query","memory.retrieve","transcript.search","plan.patch","docs.search"]' ELSE allowed_tool_ids END,
      CASE WHEN allowed_skill_ids = '[]' THEN '["artifact.create","artifact.update","ask_user","status.query","memory.retrieve","transcript.search","plan.patch","docs.search"]' ELSE allowed_skill_ids END,
      routing_timeout_ms, repair_attempts,
      NULL, NULL,
      created_at, updated_at
    FROM agent_configs_old;
    DROP TABLE agent_configs_old;
    CREATE UNIQUE INDEX idx_agent_configs_unique ON agent_configs(agent_id, scope, user_id);
    CREATE INDEX idx_agent_configs_agent ON agent_configs(agent_id);
    CREATE INDEX idx_agent_configs_user ON agent_configs(user_id);
    CREATE INDEX idx_agent_configs_scope ON agent_configs(scope)
  `,
  down: `
    UPDATE agent_configs
    SET allowed_tool_ids = '[]',
        updated_at = datetime('now')
    WHERE allowed_tool_ids = '["artifact.create","artifact.update","ask_user","status.query","memory.retrieve","transcript.search","plan.patch","docs.search"]';
    UPDATE agent_configs
    SET allowed_skill_ids = '[]',
        updated_at = datetime('now')
    WHERE allowed_skill_ids = '["artifact.create","artifact.update","ask_user","status.query","memory.retrieve","transcript.search","plan.patch","docs.search"]'
  `
};

export const longTermMemoriesTableMigration: Migration = {
  version: 37,
  name: 'create_long_term_memories_table',
  up: `
    CREATE TABLE IF NOT EXISTS long_term_memories (
      memory_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      entities TEXT,
      source_refs TEXT NOT NULL,
      scope TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      lifecycle TEXT NOT NULL,
      retrieval TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_user_status
      ON long_term_memories(user_id, json_extract(lifecycle, '$.status'));

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_type
      ON long_term_memories(memory_type);

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_importance
      ON long_term_memories(importance);

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_updated
      ON long_term_memories(json_extract(lifecycle, '$.updatedAt'))
  `,
  down: `
    DROP INDEX IF EXISTS idx_long_term_memories_user_status;
    DROP INDEX IF EXISTS idx_long_term_memories_type;
    DROP INDEX IF EXISTS idx_long_term_memories_importance;
    DROP INDEX IF EXISTS idx_long_term_memories_updated;
    DROP TABLE IF EXISTS long_term_memories
  `
};

export const longTermMemoriesInvariantsMigration: Migration = {
  version: 38,
  name: 'add_long_term_memories_extraction_invariants',
  up: `
    ALTER TABLE long_term_memories ADD COLUMN fingerprint TEXT;
    ALTER TABLE long_term_memories ADD COLUMN source_window_hash TEXT;
    ALTER TABLE long_term_memories ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_fingerprint
      ON long_term_memories(user_id, fingerprint) WHERE fingerprint IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_long_term_memories_lifecycle_status
      ON long_term_memories(user_id, lifecycle_status);

    CREATE TABLE IF NOT EXISTS memory_extraction_runs (
      run_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      window_hash TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed')),
      started_at TEXT,
      completed_at TEXT,
      result_counts TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_extraction_runs_unique
      ON memory_extraction_runs(user_id, window_hash);

    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_status
      ON memory_extraction_runs(user_id, status);

    CREATE TABLE IF NOT EXISTS memory_tombstones (
      tombstone_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      source_window_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_tombstones_unique
      ON memory_tombstones(user_id, fingerprint, source_window_hash)
  `,
  down: `
    DROP INDEX IF EXISTS idx_memory_tombstones_unique;
    DROP TABLE IF EXISTS memory_tombstones;

    DROP INDEX IF EXISTS idx_memory_extraction_runs_status;
    DROP INDEX IF EXISTS idx_memory_extraction_runs_unique;
    DROP TABLE IF EXISTS memory_extraction_runs;

    DROP INDEX IF EXISTS idx_long_term_memories_lifecycle_status;
    DROP INDEX IF EXISTS idx_long_term_memories_fingerprint;

    ALTER TABLE long_term_memories DROP COLUMN lifecycle_status;
    ALTER TABLE long_term_memories DROP COLUMN source_window_hash;
    ALTER TABLE long_term_memories DROP COLUMN fingerprint
  `
};

export const memoryExtractionRunsFullSchemaMigration: Migration = {
  version: 39,
  name: 'add_memory_extraction_runs_full_schema',
  up: `
    -- Recreate memory_extraction_runs with new schema (SQLite doesn't support dropping NOT NULL)
    ALTER TABLE memory_extraction_runs RENAME TO memory_extraction_runs_old;
    
    CREATE TABLE memory_extraction_runs (
      run_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      trigger_turn_id TEXT NOT NULL DEFAULT '',
      window_hash TEXT NOT NULL,
      included_turn_ids TEXT NOT NULL DEFAULT '[]',
      session_memory_summary_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      result_counts TEXT,
      failure_code TEXT,
      failure_message TEXT,
      source_refs TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    INSERT INTO memory_extraction_runs (
      run_id, user_id, window_hash, status, started_at, completed_at,
      result_counts, created_at, updated_at
    ) SELECT
      run_id, user_id, window_hash, status, started_at, completed_at,
      result_counts, created_at, updated_at
    FROM memory_extraction_runs_old;
    
    DROP TABLE memory_extraction_runs_old;
    
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_extraction_runs_unique
      ON memory_extraction_runs(user_id, window_hash);
    
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_status
      ON memory_extraction_runs(user_id, status);

    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_session_status
      ON memory_extraction_runs(user_id, session_id, status);

    -- Add missing columns to memory_tombstones
    ALTER TABLE memory_tombstones ADD COLUMN memory_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE memory_tombstones ADD COLUMN reason TEXT NOT NULL DEFAULT '';

    -- Add missing index on long_term_memories
    CREATE INDEX IF NOT EXISTS idx_long_term_memories_source_window
      ON long_term_memories(user_id, source_window_hash) WHERE source_window_hash IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_long_term_memories_source_window;
    
    ALTER TABLE memory_tombstones DROP COLUMN reason;
    ALTER TABLE memory_tombstones DROP COLUMN memory_id;
    
    DROP INDEX IF EXISTS idx_memory_extraction_runs_session_status;
    DROP INDEX IF EXISTS idx_memory_extraction_runs_status;
    DROP INDEX IF EXISTS idx_memory_extraction_runs_unique;
    
    ALTER TABLE memory_extraction_runs RENAME TO memory_extraction_runs_new;
    
    CREATE TABLE memory_extraction_runs (
      run_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      window_hash TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'succeeded', 'failed')),
      started_at TEXT,
      completed_at TEXT,
      result_counts TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    INSERT INTO memory_extraction_runs (
      run_id, user_id, window_hash, status, started_at, completed_at,
      result_counts, created_at, updated_at
    ) SELECT
      run_id, user_id, window_hash, status, started_at, completed_at,
      result_counts, created_at, updated_at
    FROM memory_extraction_runs_new;
    
    DROP TABLE memory_extraction_runs_new;
    
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_extraction_runs_unique
      ON memory_extraction_runs(user_id, window_hash);
    
    CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_status
      ON memory_extraction_runs(user_id, status)
  `
};

// ============================================================================
// STORE 30: Webhook Triggers (version 40)
// ============================================================================
export const webhookTriggersTableMigration: Migration = {
  version: 40,
  name: 'create_webhook_triggers_table',
  up: `
    CREATE TABLE webhook_triggers (
      webhook_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      secret_last4 TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'deleted')),
      trigger_registration_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_webhook_triggers_owner ON webhook_triggers(owner_user_id);
    CREATE INDEX idx_webhook_triggers_status ON webhook_triggers(status);
    CREATE INDEX idx_webhook_triggers_registration ON webhook_triggers(trigger_registration_id) WHERE trigger_registration_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_webhook_triggers_registration;
    DROP INDEX IF EXISTS idx_webhook_triggers_status;
    DROP INDEX IF EXISTS idx_webhook_triggers_owner;
    DROP TABLE IF EXISTS webhook_triggers
  `
};

// ============================================================================
// STORE 31: Webhook Deliveries (version 41) - for idempotency
// ============================================================================
export const webhookDeliveriesTableMigration: Migration = {
  version: 41,
  name: 'create_webhook_deliveries_table',
  up: `
    CREATE TABLE webhook_deliveries (
      delivery_id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_id TEXT,
      received_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('accepted', 'duplicate', 'rejected')),
      CONSTRAINT unique_delivery_per_webhook UNIQUE (webhook_id, delivery_id)
    );
    CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, received_at DESC);
    CREATE INDEX idx_webhook_deliveries_event ON webhook_deliveries(event_id) WHERE event_id IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_webhook_deliveries_event;
    DROP INDEX IF EXISTS idx_webhook_deliveries_webhook;
    DROP TABLE IF EXISTS webhook_deliveries
  `
};

// ============================================================================
// STORE 32: Schedule Triggers (version 42)
// ============================================================================
export const scheduleTriggersTableMigration: Migration = {
  version: 42,
  name: 'create_schedule_triggers_table',
  up: `
    CREATE TABLE schedule_triggers (
      schedule_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule_pattern TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'expired')),
      trigger_registration_id TEXT,
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      max_runs INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_schedule_triggers_owner ON schedule_triggers(owner_user_id);
    CREATE INDEX idx_schedule_triggers_status ON schedule_triggers(status);
    CREATE INDEX idx_schedule_triggers_next_run ON schedule_triggers(next_run_at) WHERE status = 'active' AND next_run_at IS NOT NULL
  `,
  down: `
    DROP INDEX IF EXISTS idx_schedule_triggers_next_run;
    DROP INDEX IF EXISTS idx_schedule_triggers_status;
    DROP INDEX IF EXISTS idx_schedule_triggers_owner;
    DROP TABLE IF EXISTS schedule_triggers
  `
};

export const allStoreMigrations: Migration[] = [
  // Core stores
  eventsTableMigration,                    // v1
  runtimeActionsTableMigration,            // v2
  transcriptsTableMigration,               // v3
  summariesTableMigration,                 // v4

  // Plan-related stores
  plansTableMigration,                     // v5
  planPatchesTableMigration,               // v6
  plannerRunsTableMigration,               // v7

  // Runtime stores
  kernelRunsTableMigration,                // v8
  toolExecutionsTableMigration,            // v9
  backgroundRunsTableMigration,            // v10

  // Workflow stores
  workflowRunsTableMigration,              // v11
  workflowStepRunsTableMigration,          // v12

  // Approval & Permission stores
  approvalRequestsTableMigration,          // v13
  permissionGrantsTableMigration,          // v14

  // Trigger & Wait stores
  triggerRegistrationsTableMigration,      // v15
  waitConditionsTableMigration,            // v16

  // Artifact & Result stores
  artifactsTableMigration,                 // v17
  toolResultsTableMigration,               // v18

  // Connector stores
  connectorDefinitionsTableMigration,      // v19
  connectorInstancesTableMigration,        // v20
  connectorEventsTableMigration,           // v21

  // Workflow Draft & Definition stores
  workflowDraftsTableMigration,            // v22
  workflowDefinitionsTableMigration,       // v23

  // Observability stores
  traceContextsTableMigration,             // v24
  traceSpansTableMigration,                // v25
  metricsTableMigration,                   // v26
  auditRecordsTableMigration,              // v27

  // Console sessions store
  sessionsTableMigration,                  // v28

  // Auth stores
  usersTableMigration,                     // v29
  authTokensTableMigration,                // v30

  // Provider config store
  providerConfigsTableMigration,           // v31

  // Session model selection
  sessionsModelSelectionMigration,         // v32

  // Custom provider type
  customProviderTypeMigration,             // v33

  // Agent Config store
  agentConfigsTableMigration,              // v34
  agentConfigRuntimeDefaultsMigration,     // v35
  agentConfigPromptBindingMigration,       // v36

  // Long-term Memory store
  longTermMemoriesTableMigration,          // v37
  longTermMemoriesInvariantsMigration,     // v38
  memoryExtractionRunsFullSchemaMigration, // v39

  // Webhook and Schedule Trigger stores
  webhookTriggersTableMigration,           // v40
  webhookDeliveriesTableMigration,         // v41
  scheduleTriggersTableMigration,          // v42
];

/**
 * Get the latest migration version number.
 */
export function getLatestMigrationVersion(): number {
  return allStoreMigrations.length > 0 
    ? allStoreMigrations[allStoreMigrations.length - 1]!.version 
    : 0;
}

/**
 * Get migration statistics.
 */
export function getMigrationStats(): { total: number; latestVersion: number } {
  return {
    total: allStoreMigrations.length,
    latestVersion: getLatestMigrationVersion()
  };
}
