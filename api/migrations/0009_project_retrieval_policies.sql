-- Materialized retrieval policy selected by the evolution arena.
-- This avoids scanning evolution_events on hot agent paths.

CREATE TABLE IF NOT EXISTS project_retrieval_policies (
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  arm_id TEXT NOT NULL,
  memory_mode TEXT NOT NULL,
  retrieval_mode TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'arena',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  PRIMARY KEY (tenant_type, tenant_id, project_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_retrieval_policies_memory_mode_chk'
  ) THEN
    ALTER TABLE project_retrieval_policies
      ADD CONSTRAINT project_retrieval_policies_memory_mode_chk
      CHECK (memory_mode IN ('fast', 'balanced', 'deep'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_retrieval_policies_retrieval_mode_chk'
  ) THEN
    ALTER TABLE project_retrieval_policies
      ADD CONSTRAINT project_retrieval_policies_retrieval_mode_chk
      CHECK (retrieval_mode IN ('memories', 'hybrid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_retrieval_policies_updated_at
  ON project_retrieval_policies(updated_at DESC);

