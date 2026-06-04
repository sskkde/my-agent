import type { Migration } from './migrations.js';

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

export const sessionsTableMigration: Migration = {
  version: 3,
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

export const usersTableMigration: Migration = {
  version: 4,
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

export const authTokensTableMigration: Migration = {
  version: 5,
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

/**
 * Provider configs table migration (Version 6).
 *
 * NOTE: This is the base schema. Runtime metadata fields (family, protocol, priority,
 * headers_json, capabilities_json, models_json, default_model, options_json) were added
 * in Version 60 via migration 019_extend_provider_configs_runtime_metadata.sql.
 * The all-stores migrations already include Version 60 fields.
 */
export const providerConfigsTableMigration: Migration = {
  version: 6,
  name: 'create_provider_configs_table',
  up: `
    CREATE TABLE provider_configs (
      provider_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('openai','openrouter','ollama','deepseek','custom')),
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
      updated_at TEXT NOT NULL,
      family TEXT DEFAULT NULL,
      protocol TEXT DEFAULT NULL,
      priority INTEGER DEFAULT NULL,
      headers_json TEXT DEFAULT NULL,
      capabilities_json TEXT DEFAULT NULL,
      models_json TEXT DEFAULT NULL,
      default_model TEXT DEFAULT NULL,
      options_json TEXT DEFAULT NULL
    );
    CREATE INDEX idx_provider_configs_user ON provider_configs(user_id)
  `,
  down: `
    DROP INDEX IF EXISTS idx_provider_configs_user;
    DROP TABLE IF EXISTS provider_configs
  `
};

export const allMigrations: Migration[] = [
  eventsTableMigration,
  runtimeActionsTableMigration,
  sessionsTableMigration,
  usersTableMigration,
  authTokensTableMigration,
  providerConfigsTableMigration
];
