-- Postgres schema for game-dev-memory (Neon)

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'custom',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at);

CREATE TABLE IF NOT EXISTS evolution_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  parent_id UUID REFERENCES evolution_events(id),
  description TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT evolution_events_type_chk CHECK (type IN ('repair', 'optimize', 'innovate')),
  CONSTRAINT evolution_events_result_chk CHECK (result IN ('success', 'failure', 'partial'))
);

CREATE INDEX IF NOT EXISTS idx_events_type ON evolution_events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON evolution_events(created_at);
