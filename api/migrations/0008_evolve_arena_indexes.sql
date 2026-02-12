-- Speed up arena policy lookups used by /api/evolve/memory-arena/latest
-- and agent-side auto-tuning (latest winner per project/tenant).

CREATE INDEX IF NOT EXISTS idx_evolution_events_arena_project_latest
  ON evolution_events(tenant_type, tenant_id, project_id, created_at DESC)
  WHERE type = 'optimize' AND description = 'memory_arena_run';

CREATE INDEX IF NOT EXISTS idx_evolution_events_arena_tenant_latest
  ON evolution_events(tenant_type, tenant_id, created_at DESC)
  WHERE type = 'optimize' AND description = 'memory_arena_run';

