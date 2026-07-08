CREATE TABLE IF NOT EXISTS context_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  segment_d_token_estimate INTEGER NOT NULL,
  segment_d_token_actual INTEGER NOT NULL,
  memory_injected_count INTEGER NOT NULL DEFAULT 0,
  memory_token_estimate INTEGER NOT NULL DEFAULT 0,
  summary_hit_count INTEGER NOT NULL DEFAULT 0,
  summary_token_estimate INTEGER NOT NULL DEFAULT 0,
  transcript_token_estimate INTEGER NOT NULL DEFAULT 0,
  pinned_item_count INTEGER NOT NULL DEFAULT 0,
  ordered_item_count INTEGER NOT NULL DEFAULT 0,
  dropped_context_reasons TEXT,
  flag_phase TEXT,
  flag_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_context_metrics_run_id ON context_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_context_metrics_agent_id ON context_metrics(agent_id, timestamp);
