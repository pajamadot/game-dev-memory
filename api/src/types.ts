export interface Env {
  DB: D1Database;
  MEMORY_KV: KVNamespace;
  ENVIRONMENT: string;
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
