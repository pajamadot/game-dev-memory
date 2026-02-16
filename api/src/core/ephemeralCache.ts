export type CacheFetchResult<V> = {
  value: V;
  hit: boolean;
};

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
  touchedAt: number;
};

export class EphemeralTtlCache<K, V> {
  private readonly maxEntries: number;
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(maxEntries = 256) {
    this.maxEntries = Math.max(32, Math.min(10_000, Math.trunc(maxEntries || 256)));
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    entry.touchedAt = now;
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number, now = Date.now()): void {
    const ttl = clampTtlMs(ttlMs);
    const expiresAt = now + ttl;
    this.store.set(key, { value, expiresAt, touchedAt: now });
    this.prune(now);
  }

  async getOrCompute(
    key: K,
    opts: { ttlMs: number; now?: number },
    compute: () => Promise<V>
  ): Promise<CacheFetchResult<V>> {
    const now = opts.now ?? Date.now();
    const cached = this.get(key, now);
    if (cached !== undefined) return { value: cached, hit: true };

    const value = await compute();
    this.set(key, value, opts.ttlMs, now);
    return { value, hit: false };
  }

  private prune(now = Date.now()): void {
    if (this.store.size === 0) return;

    // Expire first to reduce memory pressure before LRU pruning.
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    if (this.store.size <= this.maxEntries) return;

    const overflow = this.store.size - this.maxEntries;
    if (overflow <= 0) return;

    const oldest = [...this.store.entries()]
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
      .slice(0, overflow);
    for (const [key] of oldest) this.store.delete(key);
  }
}

function clampTtlMs(v: number): number {
  const n = Number.isFinite(v) ? Math.trunc(v) : 0;
  if (n <= 0) return 10_000;
  return Math.max(1_000, Math.min(5 * 60 * 1000, n));
}

export function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (input: unknown): unknown => {
    if (input === null || input === undefined) return input;
    if (typeof input !== "object") return input;
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) return input.map((x) => walk(x));
    if (seen.has(input as object)) return "[Circular]";
    seen.add(input as object);
    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = walk(obj[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}
