/**
 * EverMemOS-inspired structured derivation:
 * - event logs: atomic, factual units from free-form memory content
 * - foresight: near-future intent/deadline/action items
 *
 * This keeps our current schema and derives additional memories as linked records.
 */

export type DerivedEventLog = {
  text: string;
  evidence: string;
  confidence: number;
};

export type DerivedForesight = {
  text: string;
  evidence: string;
  confidence: number;
  start_time: string;
  end_time: string | null;
  due_kind: "absolute" | "relative" | "none";
};

export type DeriveMemoryPlan = {
  event_logs: DerivedEventLog[];
  foresight: DerivedForesight[];
};

export type DeriveMemoryInput = {
  title: string;
  content: string;
  nowIso?: string;
  maxEventLogs?: number;
  maxForesight?: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanText(s: string): string {
  return (s || "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function toSentenceCandidates(text: string): string[] {
  const src = cleanText(text);
  if (!src) return [];

  const lines = src
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/g))
    .map((s) => s.trim())
    .map((s) => s.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean)
    .filter((s) => s.length >= 12);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of lines) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item.slice(0, 320));
  }
  return out;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function normalizeDateTime(d: Date): Date {
  const out = new Date(d.getTime());
  if (!Number.isFinite(out.getTime())) return d;
  if (out.getUTCHours() === 0 && out.getUTCMinutes() === 0 && out.getUTCSeconds() === 0) {
    // Midday default for date-only cues to avoid timezone edge ambiguity.
    out.setUTCHours(12, 0, 0, 0);
  }
  return out;
}

function parseDueDateFromStatement(statement: string, now: Date): { due: Date | null; kind: "absolute" | "relative" | "none" } {
  const s = statement.toLowerCase();

  // ISO-like date: 2026-02-19
  {
    const m = statement.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ t](\d{2}:\d{2}(?::\d{2})?))?\b/i);
    if (m) {
      const iso = m[2] ? `${m[1]}T${m[2]}Z` : `${m[1]}T12:00:00Z`;
      const d = new Date(iso);
      if (Number.isFinite(d.getTime())) return { due: normalizeDateTime(d), kind: "absolute" };
    }
  }

  // Month-name date: March 3, 2026
  {
    const m = statement.match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i
    );
    if (m) {
      const year = m[3] ? parseInt(m[3], 10) : now.getUTCFullYear();
      const dt = new Date(`${m[1]} ${m[2]}, ${year} 12:00:00 UTC`);
      if (Number.isFinite(dt.getTime())) return { due: normalizeDateTime(dt), kind: "absolute" };
    }
  }

  if (/\btoday\b/i.test(s)) return { due: normalizeDateTime(now), kind: "relative" };
  if (/\btomorrow\b/i.test(s)) return { due: normalizeDateTime(addDays(now, 1)), kind: "relative" };
  if (/\bnext week\b/i.test(s)) return { due: normalizeDateTime(addDays(now, 7)), kind: "relative" };
  if (/\bnext month\b/i.test(s)) return { due: normalizeDateTime(addDays(now, 30)), kind: "relative" };

  {
    const m = s.match(/\bin\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) {
        const unit = m[2].toLowerCase();
        const days = unit.startsWith("day") ? n : unit.startsWith("week") ? n * 7 : n * 30;
        return { due: normalizeDateTime(addDays(now, days)), kind: "relative" };
      }
    }
  }

  {
    const m = s.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (m) {
      const target = WEEKDAY_INDEX[m[1].toLowerCase()];
      if (target !== undefined) {
        const d = new Date(now.getTime());
        const current = d.getUTCDay();
        let delta = (target - current + 7) % 7;
        if (delta === 0) delta = 7;
        return { due: normalizeDateTime(addDays(now, delta)), kind: "relative" };
      }
    }
  }

  return { due: null, kind: "none" };
}

function seemsEventFact(statement: string): boolean {
  return /\b(fix|fixed|fail|failed|error|bug|issue|change|changed|update|updated|add|added|remove|removed|deploy|deployed|release|released|migrate|migrated|measure|measured|profile|profiling|optimi[sz]e|refactor|implement|implemented|test|tested|validate|validated)\b/i.test(
    statement
  );
}

function seemsForesight(statement: string): boolean {
  return /\b(deadline|due|by|before|after|next|tomorrow|today|plan|planned|need to|must|should|todo|to-do|follow up|action item|ship|release|upcoming|schedule)\b/i.test(
    statement
  );
}

function estimateConfidence(statement: string, dueKind: "absolute" | "relative" | "none"): number {
  const hasStrongVerb = /\b(must|need to|will|deadline|due|fixed|failed|released|migrated)\b/i.test(statement);
  if (dueKind === "absolute") return hasStrongVerb ? 0.9 : 0.82;
  if (dueKind === "relative") return hasStrongVerb ? 0.82 : 0.72;
  return hasStrongVerb ? 0.76 : 0.62;
}

export function deriveMemoryPlan(input: DeriveMemoryInput): DeriveMemoryPlan {
  const maxEventLogs = clampInt(input.maxEventLogs, 12, 0, 50);
  const maxForesight = clampInt(input.maxForesight, 6, 0, 20);
  const now = new Date(input.nowIso || new Date().toISOString());
  const seed = cleanText(`${input.title || ""}\n${input.content || ""}`);
  const statements = toSentenceCandidates(seed);

  const eventLogs: DerivedEventLog[] = [];
  const foresight: DerivedForesight[] = [];

  const seenEvents = new Set<string>();
  const seenForesight = new Set<string>();

  for (const stmt of statements) {
    if (eventLogs.length < maxEventLogs && seemsEventFact(stmt)) {
      const key = stmt.toLowerCase();
      if (!seenEvents.has(key)) {
        seenEvents.add(key);
        eventLogs.push({
          text: stmt,
          evidence: stmt,
          confidence: estimateConfidence(stmt, "none"),
        });
      }
    }

    if (foresight.length < maxForesight && seemsForesight(stmt)) {
      const due = parseDueDateFromStatement(stmt, now);
      const key = `${stmt.toLowerCase()}|${due.due ? due.due.toISOString() : "none"}`;
      if (!seenForesight.has(key)) {
        seenForesight.add(key);
        foresight.push({
          text: stmt,
          evidence: stmt,
          confidence: estimateConfidence(stmt, due.kind),
          start_time: now.toISOString(),
          end_time: due.due ? due.due.toISOString() : null,
          due_kind: due.kind,
        });
      }
    }

    if (eventLogs.length >= maxEventLogs && foresight.length >= maxForesight) break;
  }

  // Fallback if content is sparse: include first candidate as a weak event log.
  if (eventLogs.length === 0 && statements.length > 0 && maxEventLogs > 0) {
    eventLogs.push({
      text: statements[0],
      evidence: statements[0],
      confidence: 0.55,
    });
  }

  return { event_logs: eventLogs, foresight };
}
