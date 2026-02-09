-- Assets (large binary files) stored in R2 with multipart uploads.
-- This complements artifacts: artifacts are great for logs/text chunking;
-- assets are for "real files" (zips, pak files, crash dumps, builds) that should live as a single R2 object.

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'uploading',

  r2_bucket TEXT NOT NULL DEFAULT 'memory',
  r2_key TEXT NOT NULL,

  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size BIGINT NOT NULL DEFAULT 0,
  sha256 TEXT,
  original_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- R2 multipart upload session (present while uploading)
  upload_id TEXT,
  upload_part_size BIGINT,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  updated_by TEXT,

  CONSTRAINT assets_tenant_type_chk CHECK (tenant_type IN ('user', 'org')),
  CONSTRAINT assets_status_chk CHECK (status IN ('uploading', 'ready', 'failed', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_project_created
  ON assets(tenant_type, tenant_id, project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assets_tenant_status
  ON assets(tenant_type, tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_assets_r2_key
  ON assets(r2_key);

-- Tracks uploaded parts (ETags) so uploads can resume and completion does not need the client to resend parts.
CREATE TABLE IF NOT EXISTS asset_upload_parts (
  id UUID PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT NOT NULL,
  byte_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT asset_upload_parts_unique_idx UNIQUE (asset_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_asset_upload_parts_asset_part
  ON asset_upload_parts(asset_id, part_number);

