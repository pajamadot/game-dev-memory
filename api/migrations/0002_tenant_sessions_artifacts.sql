-- Multi-tenant + sessions + artifacts (R2) + chunk metadata

-- 1) Tenant columns on existing tables

ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_type TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by TEXT;

UPDATE projects
SET
  tenant_type = COALESCE(tenant_type, 'user'),
  tenant_id = COALESCE(tenant_id, 'legacy')
WHERE tenant_type IS NULL OR tenant_id IS NULL;

ALTER TABLE projects ALTER COLUMN tenant_type SET NOT NULL;
ALTER TABLE projects ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_tenant_type_chk'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_tenant_type_chk CHECK (tenant_type IN ('user', 'org'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_tenant_updated ON projects(tenant_type, tenant_id, updated_at DESC);

-- Sessions represent the boundary for "auto evolve".
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,

  CONSTRAINT sessions_tenant_type_chk CHECK (tenant_type IN ('user', 'org'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_project_started ON sessions(tenant_type, tenant_id, project_id, started_at DESC);

-- Add tenant columns + session linkage to memories.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS tenant_type TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS updated_by TEXT;

-- Prefer inheriting tenant from project for existing rows.
UPDATE memories m
SET
  tenant_type = COALESCE(m.tenant_type, p.tenant_type),
  tenant_id = COALESCE(m.tenant_id, p.tenant_id)
FROM projects p
WHERE m.project_id = p.id AND (m.tenant_type IS NULL OR m.tenant_id IS NULL);

UPDATE memories
SET
  tenant_type = COALESCE(tenant_type, 'user'),
  tenant_id = COALESCE(tenant_id, 'legacy')
WHERE tenant_type IS NULL OR tenant_id IS NULL;

ALTER TABLE memories ALTER COLUMN tenant_type SET NOT NULL;
ALTER TABLE memories ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'memories_tenant_type_chk'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_tenant_type_chk CHECK (tenant_type IN ('user', 'org'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memories_tenant_project_updated ON memories(tenant_type, tenant_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_tenant_category ON memories(tenant_type, tenant_id, category);

-- Tenant columns on evolution events
ALTER TABLE evolution_events ADD COLUMN IF NOT EXISTS tenant_type TEXT;
ALTER TABLE evolution_events ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE evolution_events ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE evolution_events ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE evolution_events ADD COLUMN IF NOT EXISTS created_by TEXT;

UPDATE evolution_events
SET
  tenant_type = COALESCE(tenant_type, 'user'),
  tenant_id = COALESCE(tenant_id, 'legacy')
WHERE tenant_type IS NULL OR tenant_id IS NULL;

ALTER TABLE evolution_events ALTER COLUMN tenant_type SET NOT NULL;
ALTER TABLE evolution_events ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evolution_events_tenant_type_chk'
  ) THEN
    ALTER TABLE evolution_events
      ADD CONSTRAINT evolution_events_tenant_type_chk CHECK (tenant_type IN ('user', 'org'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_tenant_created ON evolution_events(tenant_type, tenant_id, created_at DESC);

-- 2) Artifacts + chunk metadata

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  storage_mode TEXT NOT NULL DEFAULT 'single',
  r2_bucket TEXT NOT NULL DEFAULT 'memory',
  r2_key TEXT,
  r2_prefix TEXT,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,

  CONSTRAINT artifacts_tenant_type_chk CHECK (tenant_type IN ('user', 'org')),
  CONSTRAINT artifacts_storage_mode_chk CHECK (storage_mode IN ('single', 'chunked'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_tenant_project_created ON artifacts(tenant_type, tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);

CREATE TABLE IF NOT EXISTS artifact_chunks (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  byte_start BIGINT NOT NULL DEFAULT 0,
  byte_end BIGINT NOT NULL DEFAULT 0,
  r2_key TEXT,
  text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT artifact_chunks_unique_idx UNIQUE (artifact_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_artifact_chunks_artifact_idx ON artifact_chunks(artifact_id, chunk_index);

-- 3) Generic links (evidence / relationships)

CREATE TABLE IF NOT EXISTS entity_links (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id UUID NOT NULL,
  to_type TEXT NOT NULL,
  to_id UUID NOT NULL,
  relation TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,

  CONSTRAINT entity_links_tenant_type_chk CHECK (tenant_type IN ('user', 'org'))
);

CREATE INDEX IF NOT EXISTS idx_entity_links_tenant_from ON entity_links(tenant_type, tenant_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_tenant_to ON entity_links(tenant_type, tenant_id, to_type, to_id);

