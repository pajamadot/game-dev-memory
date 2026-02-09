/**
 * Gene selection logic for the memory evolver.
 *
 * Scores genes against current signals and selects the best match
 * for the current evolution cycle. Supports memory-graph preferences
 * and drift mode for exploratory evolution.
 */

/**
 * Match a pattern (string or regex) against a list of signals.
 */
function matchPatternToSignals(pattern, signals) {
  if (!pattern || !signals || signals.length === 0) return false;
  const p = String(pattern);
  const sig = signals.map((s) => String(s));

  // Check if pattern is a regex (e.g., /error.*detected/i)
  if (p.length >= 2 && p.startsWith("/") && p.lastIndexOf("/") > 0) {
    const lastSlash = p.lastIndexOf("/");
    const body = p.slice(1, lastSlash);
    const flags = p.slice(lastSlash + 1);
    try {
      const re = new RegExp(body, flags || "i");
      return sig.some((s) => re.test(s));
    } catch {
      // Fall through to substring match
    }
  }

  const needle = p.toLowerCase();
  return sig.some((s) => s.toLowerCase().includes(needle));
}

/**
 * Score a gene based on how many of its signal patterns match.
 */
function scoreGene(gene, signals) {
  if (!gene || gene.type !== "Gene") return 0;
  const patterns = Array.isArray(gene.signals_match) ? gene.signals_match : [];
  let score = 0;
  for (const pat of patterns) {
    if (matchPatternToSignals(pat, signals)) score += 1;
  }
  return score;
}

/**
 * Select the best gene from available genes based on signal matching.
 */
function selectGene(genes, signals, opts = {}) {
  const { bannedGeneIds = new Set(), driftEnabled = false, preferredGeneId = null } = opts;

  const scored = genes
    .map((g) => ({ gene: g, score: scoreGene(g, signals) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { selected: null, alternatives: [] };

  // Prefer memory-graph recommended gene if it matches
  if (preferredGeneId) {
    const preferred = scored.find((x) => x.gene && x.gene.id === preferredGeneId);
    if (preferred && (driftEnabled || !bannedGeneIds.has(preferredGeneId))) {
      const rest = scored.filter((x) => x.gene && x.gene.id !== preferredGeneId);
      const filtered = driftEnabled ? rest : rest.filter((x) => !bannedGeneIds.has(x.gene.id));
      return {
        selected: preferred.gene,
        alternatives: filtered.slice(0, 4).map((x) => x.gene),
      };
    }
  }

  // Filter banned genes (unless drift mode bypasses)
  const filtered = driftEnabled ? scored : scored.filter((x) => !bannedGeneIds.has(x.gene.id));
  if (filtered.length === 0) {
    return { selected: null, alternatives: scored.slice(0, 4).map((x) => x.gene) };
  }

  return {
    selected: filtered[0].gene,
    alternatives: filtered.slice(1, 4).map((x) => x.gene),
  };
}

/**
 * Select the best capsule (validated success pattern) for current signals.
 */
function selectCapsule(capsules, signals) {
  const scored = (capsules || [])
    .map((c) => {
      const triggers = Array.isArray(c.trigger) ? c.trigger : [];
      const score = triggers.reduce((acc, t) => (matchPatternToSignals(t, signals) ? acc + 1 : acc), 0);
      return { capsule: c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].capsule : null;
}

/**
 * Combined selection of gene + capsule with decision logging.
 */
function selectGeneAndCapsule({ genes, capsules, signals, memoryAdvice, driftEnabled }) {
  const bannedGeneIds = memoryAdvice?.bannedGeneIds instanceof Set ? memoryAdvice.bannedGeneIds : new Set();
  const preferredGeneId = memoryAdvice?.preferredGeneId || null;

  const { selected, alternatives } = selectGene(genes, signals, {
    bannedGeneIds,
    preferredGeneId,
    driftEnabled: !!driftEnabled,
  });

  const capsule = selectCapsule(capsules, signals);

  const selector = buildSelectorDecision({
    gene: selected,
    capsule,
    signals,
    alternatives,
    memoryAdvice,
    driftEnabled,
  });

  return {
    selectedGene: selected,
    capsuleCandidates: capsule ? [capsule] : [],
    selector,
  };
}

function buildSelectorDecision({ gene, capsule, signals, alternatives, memoryAdvice, driftEnabled }) {
  const reason = [];
  if (gene) reason.push(`signals match gene ${gene.id}`);
  if (capsule) reason.push(`capsule ${capsule.id} trigger matches`);
  if (!gene) reason.push("no matching gene; new gene may be required");
  if (signals?.length) reason.push(`signals: ${signals.join(", ")}`);
  if (driftEnabled) reason.push("drift_override: true");

  return {
    selected: gene ? gene.id : null,
    reason,
    alternatives: Array.isArray(alternatives) ? alternatives.map((g) => g.id) : [],
  };
}

module.exports = {
  selectGeneAndCapsule,
  selectGene,
  selectCapsule,
  matchPatternToSignals,
};
