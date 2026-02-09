import { XMLParser } from "fast-xml-parser";
import type { Client } from "pg";
import type { Env } from "../types";
import { withDbClient } from "../db";

type Tenant = { tenant_type: "user" | "org"; tenant_id: string };

type FeedSource = { name: string; url: string };

type FeedItem = {
  source: string;
  source_url: string;
  title: string;
  url: string;
  published_at: string | null;
};

const FEEDS: FeedSource[] = [
  // Keep this list small + reliable. Add more sources as we learn what matters.
  { name: "Unreal Engine (official feed)", url: "https://www.unrealengine.com/en-US/rss" },
  { name: "AI and Games (Substack)", url: "https://www.aiandgames.com/feed" },
  // arXiv query: "game" + "agent" in cs.AI (Atom)
  { name: "arXiv cs.AI (game agent)", url: "https://export.arxiv.org/api/query?search_query=cat:cs.AI+AND+all:game+AND+all:agent&start=0&max_results=10" },
];

function dayKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  return "";
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    const s = safeString(v);
    if (s) return s;
  }
  return "";
}

function toIsoOrNull(v: string): string | null {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function normalizeUrl(v: unknown): string {
  const s = safeString(v);
  if (!s) return "";
  // Avoid obvious tracking params (keep it simple).
  try {
    const u = new URL(s);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return s;
  }
}

function trimToSingleXmlRoot(xml: string): string {
  // Some feeds append bot-challenge JS after the XML root, producing invalid XML.
  // Keep only the first complete <feed>...</feed> or <rss>...</rss>.
  const feedEnd = xml.lastIndexOf("</feed>");
  const rssEnd = xml.lastIndexOf("</rss>");
  const end = Math.max(feedEnd >= 0 ? feedEnd + "</feed>".length : -1, rssEnd >= 0 ? rssEnd + "</rss>".length : -1);
  if (end > 0) return xml.slice(0, end);
  return xml;
}

function parseRssOrAtom(xml: string, source: FeedSource): FeedItem[] {
  const trimmed = trimToSingleXmlRoot(xml);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Many feeds include HTML entities; keep as-is.
    processEntities: true,
  });

  const root = parser.parse(trimmed) as any;
  const items: FeedItem[] = [];

  // RSS 2.0
  const channel = root?.rss?.channel;
  const rssItems = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : [];
  for (const it of rssItems) {
    const title = firstNonEmpty(it?.title, it?.["dc:title"]);
    const link = normalizeUrl(firstNonEmpty(it?.link, it?.guid?.["#text"], it?.guid));
    const pub = firstNonEmpty(it?.pubDate, it?.["dc:date"]);
    if (!title || !link) continue;
    items.push({
      source: source.name,
      source_url: source.url,
      title,
      url: link,
      published_at: pub ? toIsoOrNull(pub) : null,
    });
  }

  // Atom
  const feed = root?.feed;
  const entries = feed?.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : [];
  for (const e of entries) {
    const title = firstNonEmpty(e?.title?.["#text"], e?.title);
    const linkObj = e?.link;
    let link = "";
    if (typeof linkObj === "string") link = linkObj;
    else if (Array.isArray(linkObj)) {
      // Prefer alternate/html links.
      const alt =
        linkObj.find((l) => l?.["@_rel"] === "alternate" && (l?.["@_type"]?.includes("html") || !l?.["@_type"])) ??
        linkObj[0];
      link = alt?.["@_href"] ?? "";
    } else if (linkObj && typeof linkObj === "object") {
      link = linkObj?.["@_href"] ?? "";
    }
    link = normalizeUrl(link);
    const pub = firstNonEmpty(e?.published, e?.updated);
    if (!title || !link) continue;
    items.push({
      source: source.name,
      source_url: source.url,
      title,
      url: link,
      published_at: pub ? toIsoOrNull(pub) : null,
    });
  }

  return items;
}

async function fetchFeed(source: FeedSource): Promise<FeedItem[]> {
  const res = await fetch(source.url, {
    headers: {
      // Some endpoints reject the default user-agent.
      "user-agent": "game-dev-memory/0.1 (unreal-agents-research; +https://pajamadot.ai)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`Feed fetch failed (${res.status}) for ${source.name}`);
  }

  const xml = await res.text();
  return parseRssOrAtom(xml, source);
}

function renderDigestMarkdown(opts: { date: string; items: FeedItem[]; sources: FeedSource[] }): string {
  const lines: string[] = [];
  lines.push(`# Unreal Agents Daily Digest (${opts.date})`);
  lines.push("");
  lines.push("Automated daily scan for Unreal Engine + AI agent game-dev signals (products, tooling, research).");
  lines.push("");
  lines.push("## Headlines");
  if (opts.items.length === 0) {
    lines.push("");
    lines.push("_No items fetched today._");
  } else {
    lines.push("");
    for (const it of opts.items) {
      const published = it.published_at ? it.published_at.slice(0, 10) : "";
      lines.push(`- [${it.title}](${it.url}) (${it.source}${published ? `, ${published}` : ""})`);
    }
  }
  lines.push("");
  lines.push("## Sources");
  lines.push("");
  for (const s of opts.sources) {
    lines.push(`- ${s.name}: ${s.url}`);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This is heuristic and may include irrelevant items.");
  lines.push("- Use the curated /research/unreal-agents page for stable guidance and workflows.");
  return lines.join("\n");
}

async function listTenants(db: Client): Promise<Tenant[]> {
  const { rows } = await db.query(
    "SELECT DISTINCT tenant_type, tenant_id FROM projects WHERE tenant_type IS NOT NULL AND tenant_id IS NOT NULL"
  );
  return rows
    .map((r: any) => ({
      tenant_type: r.tenant_type as "user" | "org",
      tenant_id: String(r.tenant_id),
    }))
    .filter((t) => t.tenant_type === "user" || t.tenant_type === "org");
}

async function ensureResearchProject(db: Client, tenant: Tenant, actorId: string, nowIso: string): Promise<string> {
  const existing = await db.query(
    "SELECT id FROM projects WHERE tenant_type = $1 AND tenant_id = $2 AND name = $3 ORDER BY updated_at DESC LIMIT 1",
    [tenant.tenant_type, tenant.tenant_id, "Research"]
  );
  const row = existing.rows[0];
  if (row?.id) return String(row.id);

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO projects (
       id, tenant_type, tenant_id, name, engine, description, created_at, updated_at, created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      tenant.tenant_type,
      tenant.tenant_id,
      "Research",
      "unreal",
      "Automated research digests + curated notes.",
      nowIso,
      nowIso,
      actorId,
      actorId,
    ]
  );
  return id;
}

async function upsertDailyDigestMemory(db: Client, opts: {
  tenant: Tenant;
  actorId: string;
  projectId: string;
  date: string;
  markdown: string;
  feedItems: FeedItem[];
  nowIso: string;
}): Promise<{ created: boolean; memory_id: string | null }> {
  const title = `Unreal Agents Daily Digest ${opts.date}`;

  const exists = await db.query(
    `SELECT id
     FROM memories
     WHERE tenant_type = $1 AND tenant_id = $2 AND project_id = $3
       AND category = 'research' AND title = $4
     LIMIT 1`,
    [opts.tenant.tenant_type, opts.tenant.tenant_id, opts.projectId, title]
  );

  if (exists.rowCount && exists.rows[0]?.id) {
    return { created: false, memory_id: String(exists.rows[0].id) };
  }

  const id = crypto.randomUUID();
  const tags = ["research", "unreal-agents", "daily", opts.date];
  const context = {
    kind: "unreal-agents-digest",
    date: opts.date,
    sources: FEEDS.map((f) => ({ name: f.name, url: f.url })),
    item_count: opts.feedItems.length,
    items: opts.feedItems.slice(0, 50),
  };

  await db.query(
    `INSERT INTO memories (
       id, tenant_type, tenant_id, project_id, session_id,
       category, source_type, title, content, tags, context,
       confidence, access_count, created_at, updated_at, created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, NULL, 'research', $5, $6, $7, $8::jsonb, $9::jsonb, $10, 0, $11, $12, $13, $14)`,
    [
      id,
      opts.tenant.tenant_type,
      opts.tenant.tenant_id,
      opts.projectId,
      "cron",
      title,
      opts.markdown,
      JSON.stringify(tags),
      JSON.stringify(context),
      0.6,
      opts.nowIso,
      opts.nowIso,
      opts.actorId,
      opts.actorId,
    ]
  );

  // Optional: record as an evolution event so we can graph "daily innovate".
  await db.query(
    `INSERT INTO evolution_events (
       id, tenant_type, tenant_id, project_id, session_id,
       type, parent_id, description, changes, result, created_at, created_by
     )
     VALUES ($1, $2, $3, $4, NULL, 'innovate', NULL, $5, $6::jsonb, 'success', $7, $8)`,
    [
      crypto.randomUUID(),
      opts.tenant.tenant_type,
      opts.tenant.tenant_id,
      opts.projectId,
      `Daily research digest: Unreal Agents (${opts.date})`,
      JSON.stringify({ kind: "unreal-agents-digest", date: opts.date, item_count: opts.feedItems.length }),
      opts.nowIso,
      opts.actorId,
    ]
  );

  return { created: true, memory_id: id };
}

export async function runUnrealAgentsDailyDigestForTenant(env: Env, tenant: Tenant, actorId: string, date: Date) {
  const nowIso = new Date().toISOString();
  const day = dayKeyUtc(date);

  const feeds = await Promise.allSettled(FEEDS.map((s) => fetchFeed(s)));
  const all: FeedItem[] = [];
  for (const r of feeds) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  // Dedupe by URL.
  const byUrl = new Map<string, FeedItem>();
  for (const it of all) {
    if (!it.url) continue;
    const key = it.url.toLowerCase();
    if (!byUrl.has(key)) byUrl.set(key, it);
  }

  const items = [...byUrl.values()]
    .sort((a, b) => {
      const at = a.published_at ? Date.parse(a.published_at) : 0;
      const bt = b.published_at ? Date.parse(b.published_at) : 0;
      return bt - at;
    })
    .slice(0, 25);

  const markdown = renderDigestMarkdown({ date: day, items, sources: FEEDS });

  return await withDbClient(env, async (db) => {
    const projectId = await ensureResearchProject(db, tenant, actorId, nowIso);
    return await upsertDailyDigestMemory(db, {
      tenant,
      actorId,
      projectId,
      date: day,
      markdown,
      feedItems: items,
      nowIso,
    });
  });
}

export async function runUnrealAgentsDailyDigestForAllTenants(env: Env, date: Date): Promise<{
  tenants: number;
  created: number;
  skipped: number;
  errors: { tenant_type: string; tenant_id: string; error: string }[];
}> {
  const errors: { tenant_type: string; tenant_id: string; error: string }[] = [];
  let created = 0;
  let skipped = 0;

  // Fetch feeds once and reuse across tenants (reduce outbound requests).
  const feeds = await Promise.allSettled(FEEDS.map((s) => fetchFeed(s)));
  const all: FeedItem[] = [];
  for (const r of feeds) {
    if (r.status === "fulfilled") all.push(...r.value);
  }

  const byUrl = new Map<string, FeedItem>();
  for (const it of all) {
    if (!it.url) continue;
    const key = it.url.toLowerCase();
    if (!byUrl.has(key)) byUrl.set(key, it);
  }

  const items = [...byUrl.values()]
    .sort((a, b) => {
      const at = a.published_at ? Date.parse(a.published_at) : 0;
      const bt = b.published_at ? Date.parse(b.published_at) : 0;
      return bt - at;
    })
    .slice(0, 25);

  const nowIso = new Date().toISOString();
  const day = dayKeyUtc(date);
  const markdown = renderDigestMarkdown({ date: day, items, sources: FEEDS });

  return await withDbClient(env, async (db) => {
    const tenants = await listTenants(db);

    for (const tenant of tenants) {
      try {
        const projectId = await ensureResearchProject(db, tenant, "cron", nowIso);
        const res = await upsertDailyDigestMemory(db, {
          tenant,
          actorId: "cron",
          projectId,
          date: day,
          markdown,
          feedItems: items,
          nowIso,
        });
        if (res.created) created++;
        else skipped++;
      } catch (e) {
        errors.push({
          tenant_type: tenant.tenant_type,
          tenant_id: tenant.tenant_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { tenants: tenants.length, created, skipped, errors };
  });
}
