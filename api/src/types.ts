export interface Env {
  HYPERDRIVE?: Hyperdrive;
  MEMORY_BUCKET?: R2Bucket;
  ENVIRONMENT: string;
  // Fallback for local execution/testing without a Hyperdrive binding.
  DATABASE_URL?: string;

  // Optional: enable the Project Memory Agent (RAG) with Anthropic.
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_VERSION?: string;

  // Clerk session JWT verification (JWKS).
  // Example: https://clerk.your-domain.com/.well-known/jwks.json
  CLERK_JWKS_URL?: string;

  // Used by OAuth /authorize to redirect to the web consent page.
  WEBSITE_URL?: string;

  // Temporary escape hatch for local testing only.
  // If true, allows X-Tenant-* headers when Authorization is missing.
  ALLOW_INSECURE_TENANT_HEADERS?: string;
}

export interface Memory {
  id: string;
  project_id: string;
  category: string; // "pattern" | "decision" | "bug" | "architecture" | "asset" | "lesson"
  title: string;
  content: string;
  tags: string[];
  context: Record<string, unknown>;
  confidence: number; // 0-1, how reliable this memory is
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  engine: string; // "unity" | "unreal" | "godot" | "custom"
  description: string;
  created_at: string;
  updated_at: string;
}

export interface EvolutionEvent {
  id: string;
  type: "repair" | "optimize" | "innovate";
  parent_id: string | null;
  description: string;
  changes: Record<string, unknown>;
  result: "success" | "failure" | "partial";
  created_at: string;
}
