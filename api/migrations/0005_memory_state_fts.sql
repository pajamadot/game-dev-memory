-- Memory lifecycle + retrieval improvements
--
-- Goals:
-- - Allow quarantining/superseding memories without deleting (reduce error propagation).
-- - Improve retrieval with Postgres full-text search (GIN).

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active';

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS quality TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memories_state_chk'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_state_chk CHECK (state IN ('active', 'superseded', 'quarantined'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memories_quality_chk'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_quality_chk CHECK (quality IN ('unknown', 'good', 'bad'));
  END IF;
END $$;

-- Common filters: tenant + project + state + updated_at
CREATE INDEX IF NOT EXISTS idx_memories_tenant_project_state_updated
  ON memories(tenant_type, tenant_id, project_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_tenant_state_updated
  ON memories(tenant_type, tenant_id, state, updated_at DESC);

-- Full-text search index for memory retrieval (technical logs/config -> use 'simple' config).
CREATE INDEX IF NOT EXISTS idx_memories_fts
  ON memories
  USING GIN (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, '')));

