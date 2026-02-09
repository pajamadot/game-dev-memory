-- Identity + API tokens + OAuth codes (for MCP)

-- Users are sourced from Clerk but recorded in our DB for auditing and API token ownership.
CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY,
  clerk_user_id TEXT NOT NULL UNIQUE,
  primary_email TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_users_clerk_user_id ON app_users(clerk_user_id);

-- Orgs are sourced from Clerk organizations.
CREATE TABLE IF NOT EXISTS app_orgs (
  id UUID PRIMARY KEY,
  clerk_org_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_orgs_clerk_org_id ON app_orgs(clerk_org_id);

-- Membership mirrors Clerk org membership but remains best-effort (Clerk is still the source of truth).
CREATE TABLE IF NOT EXISTS app_org_memberships (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES app_orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  clerk_membership_id TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT app_org_memberships_unique UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_org_memberships_org ON app_org_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_app_org_memberships_user ON app_org_memberships(user_id);

-- API tokens (API keys) used by agents and external services. Never store the plaintext token in DB.
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT api_tokens_tenant_type_chk CHECK (tenant_type IN ('user', 'org'))
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_tenant ON api_tokens(tenant_type, tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_tokens_created_by ON api_tokens(created_by);

-- OAuth clients (optional; for now we can accept unknown clients, but this is here for future tightening).
CREATE TABLE IF NOT EXISTS oauth_clients (
  id UUID PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_client_id ON oauth_clients(client_id);

-- Short-lived OAuth authorization codes for PKCE exchange -> API token.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  tenant_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,

  CONSTRAINT oauth_authorization_codes_tenant_type_chk CHECK (tenant_type IN ('user', 'org')),
  CONSTRAINT oauth_authorization_codes_pkce_chk CHECK (code_challenge_method IN ('S256'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_authorization_codes(code);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_authorization_codes(expires_at);

