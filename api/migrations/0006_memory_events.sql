-- Memory audit events
--
-- Goal:
-- - Make memory updates first-class and auditable (who/what/when/why).
-- - Keep a durable trail for lifecycle changes, edits, and relationships.
--
-- Notes:
-- - We intentionally do NOT add a foreign key on memory_id so history can outlive
--   a hard delete (and because memory lifecycle already supports soft curation).

CREATE TABLE IF NOT EXISTS memory_events (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id UUID,
  memory_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,

  CONSTRAINT memory_events_tenant_type_chk CHECK (tenant_type IN ('user', 'org'))
);

CREATE INDEX IF NOT EXISTS idx_memory_events_tenant_memory_created
  ON memory_events(tenant_type, tenant_id, memory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_events_tenant_project_created
  ON memory_events(tenant_type, tenant_id, project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_events_tenant_created
  ON memory_events(tenant_type, tenant_id, created_at DESC);

