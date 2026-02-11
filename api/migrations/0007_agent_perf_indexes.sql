-- Agent and memory retrieval performance indexes.
--
-- Goals:
-- - Speed up chat history fetches for interactive agent sessions.
-- - Speed up session list pages (agent/agent_pro kinds).
-- - Improve retrieval scans that combine tenant/project/state/category ordering.

CREATE INDEX IF NOT EXISTS idx_memories_tenant_session_category_created
  ON memories(tenant_type, tenant_id, session_id, category, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_kind_started
  ON sessions(tenant_type, tenant_id, kind, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_tenant_project_state_category_updated
  ON memories(tenant_type, tenant_id, project_id, state, category, updated_at DESC);

