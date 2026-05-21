-- Migration: add_tenant_id
-- Version: 18
-- Created: 2026-05-21
-- PostgreSQL Conversion

-- Up migration
-- Add tenant_id column to all tables created by inline migrations (v1-v50) and SQL migration files (001-015)
-- Tables organizations and user_organizations already have tenant_id from migration 016/017

-- Inline migration tables (v1-v50)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='tenant_id') THEN
    ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='runtime_actions' AND column_name='tenant_id') THEN
    ALTER TABLE runtime_actions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_runtime_actions_tenant ON runtime_actions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transcripts' AND column_name='tenant_id') THEN
    ALTER TABLE transcripts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_transcripts_tenant ON transcripts(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='summaries' AND column_name='tenant_id') THEN
    ALTER TABLE summaries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_summaries_tenant ON summaries(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plans' AND column_name='tenant_id') THEN
    ALTER TABLE plans ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_plans_tenant ON plans(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='plan_patches' AND column_name='tenant_id') THEN
    ALTER TABLE plan_patches ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_plan_patches_tenant ON plan_patches(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='planner_runs' AND column_name='tenant_id') THEN
    ALTER TABLE planner_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_planner_runs_tenant ON planner_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='kernel_runs' AND column_name='tenant_id') THEN
    ALTER TABLE kernel_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_kernel_runs_tenant ON kernel_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_executions' AND column_name='tenant_id') THEN
    ALTER TABLE tool_executions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tool_executions_tenant ON tool_executions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='background_runs' AND column_name='tenant_id') THEN
    ALTER TABLE background_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_background_runs_tenant ON background_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_runs' AND column_name='tenant_id') THEN
    ALTER TABLE workflow_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant ON workflow_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_step_runs' AND column_name='tenant_id') THEN
    ALTER TABLE workflow_step_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_workflow_step_runs_tenant ON workflow_step_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='approval_requests' AND column_name='tenant_id') THEN
    ALTER TABLE approval_requests ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant ON approval_requests(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='permission_grants' AND column_name='tenant_id') THEN
    ALTER TABLE permission_grants ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_permission_grants_tenant ON permission_grants(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trigger_registrations' AND column_name='tenant_id') THEN
    ALTER TABLE trigger_registrations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trigger_registrations_tenant ON trigger_registrations(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='wait_conditions' AND column_name='tenant_id') THEN
    ALTER TABLE wait_conditions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wait_conditions_tenant ON wait_conditions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='tenant_id') THEN
    ALTER TABLE artifacts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_artifacts_tenant ON artifacts(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_results' AND column_name='tenant_id') THEN
    ALTER TABLE tool_results ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tool_results_tenant ON tool_results(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tool_result_blobs' AND column_name='tenant_id') THEN
    ALTER TABLE tool_result_blobs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tool_result_blobs_tenant ON tool_result_blobs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connector_definitions' AND column_name='tenant_id') THEN
    ALTER TABLE connector_definitions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_connector_definitions_tenant ON connector_definitions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connector_instances' AND column_name='tenant_id') THEN
    ALTER TABLE connector_instances ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_connector_instances_tenant ON connector_instances(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connector_events' AND column_name='tenant_id') THEN
    ALTER TABLE connector_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_connector_events_tenant ON connector_events(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='connector_policies' AND column_name='tenant_id') THEN
    ALTER TABLE connector_policies ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_connector_policies_tenant ON connector_policies(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_drafts' AND column_name='tenant_id') THEN
    ALTER TABLE workflow_drafts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_workflow_drafts_tenant ON workflow_drafts(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workflow_definitions' AND column_name='tenant_id') THEN
    ALTER TABLE workflow_definitions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant ON workflow_definitions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trace_contexts' AND column_name='tenant_id') THEN
    ALTER TABLE trace_contexts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trace_contexts_tenant ON trace_contexts(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trace_spans' AND column_name='tenant_id') THEN
    ALTER TABLE trace_spans ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trace_spans_tenant ON trace_spans(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='metrics' AND column_name='tenant_id') THEN
    ALTER TABLE metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_metrics_tenant ON metrics(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_records' AND column_name='tenant_id') THEN
    ALTER TABLE audit_records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_audit_records_tenant ON audit_records(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='tenant_id') THEN
    ALTER TABLE sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tenant_id') THEN
    ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auth_tokens' AND column_name='tenant_id') THEN
    ALTER TABLE auth_tokens ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_auth_tokens_tenant ON auth_tokens(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='provider_configs' AND column_name='tenant_id') THEN
    ALTER TABLE provider_configs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_provider_configs_tenant ON provider_configs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='agent_configs' AND column_name='tenant_id') THEN
    ALTER TABLE agent_configs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON agent_configs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='long_term_memories' AND column_name='tenant_id') THEN
    ALTER TABLE long_term_memories ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_long_term_memories_tenant ON long_term_memories(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memory_extraction_runs' AND column_name='tenant_id') THEN
    ALTER TABLE memory_extraction_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_memory_extraction_runs_tenant ON memory_extraction_runs(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memory_tombstones' AND column_name='tenant_id') THEN
    ALTER TABLE memory_tombstones ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_memory_tombstones_tenant ON memory_tombstones(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='webhook_triggers' AND column_name='tenant_id') THEN
    ALTER TABLE webhook_triggers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_webhook_triggers_tenant ON webhook_triggers(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='webhook_deliveries' AND column_name='tenant_id') THEN
    ALTER TABLE webhook_deliveries ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='schedule_triggers' AND column_name='tenant_id') THEN
    ALTER TABLE schedule_triggers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_schedule_triggers_tenant ON schedule_triggers(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dead_letter' AND column_name='tenant_id') THEN
    ALTER TABLE dead_letter ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_dead_letter_tenant ON dead_letter(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='api_keys' AND column_name='tenant_id') THEN
    ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alert_rules' AND column_name='tenant_id') THEN
    ALTER TABLE alert_rules ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alert_states' AND column_name='tenant_id') THEN
    ALTER TABLE alert_states ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_alert_states_tenant ON alert_states(tenant_id);

-- SQL migration file tables (001-015) not already covered above

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_servers' AND column_name='tenant_id') THEN
    ALTER TABLE mcp_servers ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON mcp_servers(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcp_sessions' AND column_name='tenant_id') THEN
    ALTER TABLE mcp_sessions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_tenant ON mcp_sessions(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='retention_config' AND column_name='tenant_id') THEN
    ALTER TABLE retention_config ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_retention_config_tenant ON retention_config(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memory_lifecycle' AND column_name='tenant_id') THEN
    ALTER TABLE memory_lifecycle ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_tenant ON memory_lifecycle(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_retention' AND column_name='tenant_id') THEN
    ALTER TABLE audit_retention ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_audit_retention_tenant ON audit_retention(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recovery_checkpoints' AND column_name='tenant_id') THEN
    ALTER TABLE recovery_checkpoints ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_recovery_checkpoints_tenant ON recovery_checkpoints(tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trigger_subscriptions' AND column_name='tenant_id') THEN
    ALTER TABLE trigger_subscriptions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'org_default';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_trigger_subscriptions_tenant ON trigger_subscriptions(tenant_id);

-- Down migration
-- PostgreSQL supports DROP COLUMN; however, dropping tenant_id from all tables is destructive and not recommended for rollback.
-- If needed, execute individual ALTER TABLE ... DROP COLUMN statements per table.
