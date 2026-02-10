import type { PageIndexConfig, PageIndexDoc, PageIndexNode, YesNo } from "./types";
import type { LoggerLike, PageIndexLlm } from "./llm";

export function countTokens(text: string, _model?: string): number {
  // Upstream uses tiktoken (model-specific). For portability (Workers/Node),
  // we use a cheap approximation. Callers can swap this out at a higher layer
  // if they need exact counts.
  if (!text) return 0;
  return Math.max(0, Math.ceil(String(text).length / 4));
}

export function getJsonContent(response: string): string {
  const s = String(response || "");
  const startIdx = s.indexOf("```json");
  let out = s;
  if (startIdx !== -1) out = s.slice(startIdx + "```json".length);
  const endIdx = out.lastIndexOf("```");
  if (endIdx !== -1) out = out.slice(0, endIdx);
  return out.trim();
}

export function extractJson(content: string): any {
  const raw = String(content || "");

  let jsonText = raw.trim();
  const startIdx = raw.indexOf("```json");
  if (startIdx !== -1) {
    const after = raw.slice(startIdx + "```json".length);
    const endIdx = after.lastIndexOf("```");
    jsonText = (endIdx !== -1 ? after.slice(0, endIdx) : after).trim();
  }

  // Python-to-JSON cleanup, plus whitespace normalization similar to upstream.
  jsonText = jsonText.replace(/\bNone\b/g, "null");
  jsonText = jsonText.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(jsonText);
  if (parsed !== null) return parsed;

  // Second pass: remove trailing commas before closers.
  const cleaned = jsonText.replace(/,(\s*[}\]])/g, "$1");
  parsed = tryParse(cleaned);
  if (parsed !== null) return parsed;

  return {};
}

export function writeNodeId(data: any, nodeId = 0): number {
  // Mirrors upstream behavior: assigns node_id to dict nodes and traverses keys containing "nodes".
  if (data && typeof data === "object" && !Array.isArray(data)) {
    (data as any).node_id = String(nodeId).padStart(4, "0");
    nodeId += 1;
    for (const k of Object.keys(data)) {
      if (k.includes("nodes")) nodeId = writeNodeId((data as any)[k], nodeId);
    }
    return nodeId;
  }

  if (Array.isArray(data)) {
    for (const item of data) nodeId = writeNodeId(item, nodeId);
  }
  return nodeId;
}

export function structureToList(structure: any): any[] {
  if (structure && typeof structure === "object" && !Array.isArray(structure)) {
    const nodes: any[] = [structure];
    if ((structure as any).nodes) nodes.push(...structureToList((structure as any).nodes));
    return nodes;
  }
  if (Array.isArray(structure)) {
    const nodes: any[] = [];
    for (const item of structure) nodes.push(...structureToList(item));
    return nodes;
  }
  return [];
}

// Upstream helper: returns a list of nodes with child arrays removed (shallow copy).
export function getNodes(structure: any): any[] {
  if (structure && typeof structure === "object" && !Array.isArray(structure)) {
    const node = { ...(structure as any) };
    delete (node as any).nodes;
    const nodes = [node];
    for (const k of Object.keys(structure)) {
      if (k.includes("nodes")) nodes.push(...getNodes((structure as any)[k]));
    }
    return nodes;
  }
  if (Array.isArray(structure)) {
    const out: any[] = [];
    for (const item of structure) out.push(...getNodes(item));
    return out;
  }
  return [];
}

export function getLeafNodes(structure: any): any[] {
  if (structure && typeof structure === "object" && !Array.isArray(structure)) {
    const kids = (structure as any).nodes;
    if (!kids || (Array.isArray(kids) && kids.length === 0)) {
      const node = { ...(structure as any) };
      delete (node as any).nodes;
      return [node];
    }
    return getLeafNodes(kids);
  }
  if (Array.isArray(structure)) {
    const out: any[] = [];
    for (const item of structure) out.push(...getLeafNodes(item));
    return out;
  }
  return [];
}

export function isLeafNode(data: any, nodeId: string): boolean {
  const find = (d: any): any | null => {
    if (d && typeof d === "object" && !Array.isArray(d)) {
      if (String((d as any).node_id || "") === nodeId) return d;
      for (const k of Object.keys(d)) {
        if (k.includes("nodes")) {
          const r = find((d as any)[k]);
          if (r) return r;
        }
      }
      return null;
    }
    if (Array.isArray(d)) {
      for (const item of d) {
        const r = find(item);
        if (r) return r;
      }
    }
    return null;
  };

  const node = find(data);
  if (!node) return false;
  const kids = (node as any).nodes;
  return !kids || (Array.isArray(kids) && kids.length === 0);
}

export function sanitizeFilename(filename: string, replacement = "-"): string {
  // Mirrors upstream behavior: only replace '/'.
  return String(filename || "").replaceAll("/", replacement);
}

export function getLastNode<T>(structure: T[]): T | undefined {
  return Array.isArray(structure) && structure.length ? structure[structure.length - 1] : undefined;
}

export function convertPhysicalIndexToInt(data: any): any {
  const toInt = (v: any): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v !== "string") return null;
    const s = v.trim();
    const m1 = /^<physical_index_(\d+)>$/.exec(s);
    if (m1) return parseInt(m1[1], 10);
    const m2 = /^physical_index_(\d+)$/.exec(s);
    if (m2) return parseInt(m2[1], 10);
    return null;
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && !Array.isArray(item) && "physical_index" in item) {
        const out = toInt((item as any).physical_index);
        if (out !== null) (item as any).physical_index = out;
      }
    }
    return data;
  }

  if (typeof data === "string" || typeof data === "number") return toInt(data);
  return data;
}

export function convertPageToInt(items: any[]): any[] {
  for (const item of items || []) {
    if (item && typeof item === "object" && typeof (item as any).page === "string") {
      const n = parseInt((item as any).page, 10);
      if (Number.isFinite(n)) (item as any).page = n;
    }
  }
  return items;
}

export function listToTree(data: Array<{ structure?: string | null; title?: string; start_index?: any; end_index?: any }>): any[] {
  const getParentStructure = (structure: string | null | undefined): string | null => {
    if (!structure) return null;
    const parts = String(structure).split(".");
    return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  };

  const nodes: Record<string, any> = {};
  const rootNodes: any[] = [];

  for (const item of data || []) {
    const structure = item?.structure ? String(item.structure) : "";
    const node = {
      title: item?.title,
      start_index: (item as any).start_index,
      end_index: (item as any).end_index,
      nodes: [] as any[],
    };
    nodes[structure] = node;

    const parentStructure = getParentStructure(structure);
    if (parentStructure) {
      if (nodes[parentStructure]) nodes[parentStructure].nodes.push(node);
      else rootNodes.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  const cleanNode = (n: any): any => {
    if (!n.nodes || n.nodes.length === 0) {
      delete n.nodes;
      return n;
    }
    for (const child of n.nodes) cleanNode(child);
    return n;
  };

  return rootNodes.map(cleanNode);
}

export function addPrefaceIfNeeded(data: any): any {
  if (!Array.isArray(data) || data.length === 0) return data;
  const first = data[0];
  const firstIdx = first && typeof first === "object" ? (first as any).physical_index : null;
  if (typeof firstIdx === "number" && Number.isFinite(firstIdx) && firstIdx > 1) {
    data.unshift({ structure: "0", title: "Preface", physical_index: 1 });
  }
  return data;
}

export function getTextOfPdfPages(pdfPages: Array<[string, number]>, startPage: number, endPage: number): string {
  let text = "";
  for (let pageNum = startPage - 1; pageNum < endPage; pageNum++) {
    const p = pdfPages[pageNum];
    if (!p) continue;
    text += p[0];
  }
  return text;
}

export function getTextOfPdfPagesWithLabels(pdfPages: Array<[string, number]>, startPage: number, endPage: number): string {
  let text = "";
  for (let pageNum = startPage - 1; pageNum < endPage; pageNum++) {
    const p = pdfPages[pageNum];
    if (!p) continue;
    const idx = pageNum + 1;
    text += `<physical_index_${idx}>\n${p[0]}\n<physical_index_${idx}>\n`;
  }
  return text;
}

export function getFirstStartPageFromText(text: string): number {
  const m = /<start_index_(\d+)>/.exec(String(text || ""));
  return m ? parseInt(m[1], 10) : -1;
}

export function getLastStartPageFromText(text: string): number {
  const src = String(text || "");
  const re = /<start_index_(\d+)>/g;
  let last = -1;
  while (true) {
    const m = re.exec(src);
    if (!m) break;
    last = parseInt(m[1], 10);
  }
  return last;
}

export function cleanStructurePost(data: any): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    delete (data as any).page_number;
    delete (data as any).start_index;
    delete (data as any).end_index;
    if ((data as any).nodes) cleanStructurePost((data as any).nodes);
    return data;
  }
  if (Array.isArray(data)) {
    for (const section of data) cleanStructurePost(section);
  }
  return data;
}

export function removeFields(data: any, fields: string[] = ["text"]): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const out: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (fields.includes(k)) continue;
      out[k] = removeFields(v, fields);
    }
    return out;
  }
  if (Array.isArray(data)) return data.map((x) => removeFields(x, fields));
  return data;
}

export function printToc(tree: any[], indent = 0): void {
  for (const node of tree || []) {
    // eslint-disable-next-line no-console
    console.log(`${"  ".repeat(indent)}${String((node as any).title || "")}`);
    if ((node as any).nodes) printToc((node as any).nodes, indent + 1);
  }
}

export function printJson(data: any, maxLen = 40, indent = 2): void {
  const simplify = (obj: any): any => {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = simplify(v);
      return out;
    }
    if (Array.isArray(obj)) return obj.map(simplify);
    if (typeof obj === "string" && obj.length > maxLen) return `${obj.slice(0, maxLen)}...`;
    return obj;
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(simplify(data), null, indent));
}

export function removeStructureText(data: any): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    delete (data as any).text;
    if ((data as any).nodes) removeStructureText((data as any).nodes);
    return data;
  }
  if (Array.isArray(data)) {
    for (const item of data) removeStructureText(item);
  }
  return data;
}

export function addNodeText(node: any, pdfPages: Array<[string, number]>): void {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const start = (node as any).start_index;
    const end = (node as any).end_index;
    if (typeof start === "number" && typeof end === "number") {
      (node as any).text = getTextOfPdfPages(pdfPages, start, end);
    }
    if ((node as any).nodes) addNodeText((node as any).nodes, pdfPages);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) addNodeText(item, pdfPages);
  }
}

export function addNodeTextWithLabels(node: any, pdfPages: Array<[string, number]>): void {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const start = (node as any).start_index;
    const end = (node as any).end_index;
    if (typeof start === "number" && typeof end === "number") {
      (node as any).text = getTextOfPdfPagesWithLabels(pdfPages, start, end);
    }
    if ((node as any).nodes) addNodeTextWithLabels((node as any).nodes, pdfPages);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) addNodeTextWithLabels(item, pdfPages);
  }
}

export async function generateNodeSummary(llm: PageIndexLlm, model: string, node: { text?: string }): Promise<string> {
  const prompt = `You are given a part of a document, your task is to generate a description of the partial document about what are main points covered in the partial document.\n\nPartial Document Text: ${String(
    node.text || ""
  )}\n\nDirectly return the description, do not include any other text.\n`;

  const res = await llm.complete({ model, prompt });
  return String(res.text || "");
}

export async function generateSummariesForStructure(llm: PageIndexLlm, model: string, structure: any): Promise<any> {
  const nodes = structureToList(structure);
  const tasks = nodes.map((n) => generateNodeSummary(llm, model, n));
  const summaries = await Promise.all(tasks);
  for (let i = 0; i < nodes.length; i++) {
    (nodes[i] as any).summary = summaries[i];
  }
  return structure;
}

export function createCleanStructureForDescription(structure: any): any {
  if (structure && typeof structure === "object" && !Array.isArray(structure)) {
    const cleanNode: any = {};
    for (const k of ["title", "node_id", "summary", "prefix_summary"]) {
      if (k in structure) cleanNode[k] = (structure as any)[k];
    }
    const kids = (structure as any).nodes;
    if (kids && Array.isArray(kids) && kids.length) cleanNode.nodes = createCleanStructureForDescription(kids);
    return cleanNode;
  }
  if (Array.isArray(structure)) return structure.map((n) => createCleanStructureForDescription(n));
  return structure;
}

export async function generateDocDescription(llm: PageIndexLlm, model: string, structure: any): Promise<string> {
  const prompt = `Your are an expert in generating descriptions for a document.\nYou are given a structure of a document. Your task is to generate a one-sentence description for the document, which makes it easy to distinguish the document from other documents.\n\nDocument Structure: ${JSON.stringify(
    structure
  )}\n\nDirectly return the description, do not include any other text.\n`;
  const res = await llm.complete({ model, prompt });
  return String(res.text || "");
}

export function reorderDict(data: any, keyOrder: string[]): any {
  if (!keyOrder || keyOrder.length === 0) return data;
  const out: any = {};
  for (const k of keyOrder) {
    if (k in data) out[k] = data[k];
  }
  return out;
}

export function formatStructure(structure: any, order?: string[]): any {
  if (!order || order.length === 0) return structure;
  if (structure && typeof structure === "object" && !Array.isArray(structure)) {
    if ((structure as any).nodes) (structure as any).nodes = formatStructure((structure as any).nodes, order);
    const kids = (structure as any).nodes;
    if (!kids || (Array.isArray(kids) && kids.length === 0)) delete (structure as any).nodes;
    return reorderDict(structure, order);
  }
  if (Array.isArray(structure)) return structure.map((n) => formatStructure(n, order));
  return structure;
}

const DEFAULT_CONFIG: PageIndexConfig = {
  model: "gpt-4o-2024-11-20",
  toc_check_page_num: 20,
  max_page_num_each_node: 10,
  max_token_num_each_node: 20000,
  if_add_node_id: "yes",
  if_add_node_summary: "yes",
  if_add_doc_description: "no",
  if_add_node_text: "no",
};

function validateConfigKeys(user: Record<string, unknown>) {
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  const unknown = Object.keys(user).filter((k) => !allowed.has(k));
  if (unknown.length) throw new Error(`Unknown config keys: ${unknown.join(", ")}`);
}

export class ConfigLoader {
  private readonly defaults: PageIndexConfig;

  constructor(defaults?: Partial<PageIndexConfig>) {
    this.defaults = { ...DEFAULT_CONFIG, ...(defaults || {}) };
  }

  load(userOpt?: Partial<PageIndexConfig> | null): PageIndexConfig {
    const user: Record<string, unknown> = userOpt ? { ...(userOpt as any) } : {};
    validateConfigKeys(user);
    return { ...this.defaults, ...(userOpt || {}) } as PageIndexConfig;
  }
}

export class JsonLogger {
  public readonly entries: any[] = [];
  constructor(public readonly docName: string) {}

  info(message: any): void {
    this.entries.push(typeof message === "object" ? message : { message });
  }
  error(message: any): void {
    this.entries.push(typeof message === "object" ? message : { message, level: "error" });
  }
}

export function postProcessing(structure: any[], endPhysicalIndex: number): any {
  // First convert page_number to start_index in flat list.
  for (let i = 0; i < structure.length; i++) {
    const item = structure[i];
    (item as any).start_index = (item as any).physical_index;
    if (i < structure.length - 1) {
      const next = structure[i + 1];
      if ((next as any).appear_start === "yes") (item as any).end_index = (next as any).physical_index - 1;
      else (item as any).end_index = (next as any).physical_index;
    } else {
      (item as any).end_index = endPhysicalIndex;
    }
  }

  const tree = listToTree(structure as any);
  if (Array.isArray(tree) && tree.length !== 0) return tree;

  // Upstream fallback: remove fields and return list if tree is empty.
  for (const node of structure) {
    delete (node as any).appear_start;
    delete (node as any).physical_index;
  }
  return structure;
}

export function validateAndTruncatePhysicalIndices(
  tocWithPageNumber: any[],
  pageListLength: number,
  startIndex = 1,
  logger?: LoggerLike | null
): any[] {
  if (!tocWithPageNumber || tocWithPageNumber.length === 0) return tocWithPageNumber;

  const maxAllowedPage = pageListLength + startIndex - 1;
  const truncated: Array<{ title: string; original_index: number }> = [];

  for (const item of tocWithPageNumber) {
    const idx = (item as any).physical_index;
    if (typeof idx === "number" && Number.isFinite(idx) && idx > maxAllowedPage) {
      truncated.push({ title: String((item as any).title || "Unknown"), original_index: idx });
      (item as any).physical_index = null;
      logger?.info?.(`Removed physical_index for '${String((item as any).title || "Unknown")}' (was ${idx}, too far beyond document)`);
    }
  }

  if (truncated.length) logger?.info?.({ truncated });
  return tocWithPageNumber;
}

// Worker-friendly helper: compute token counts for provided page texts.
export function getPageTokensFromTexts(pages: string[], model?: string): Array<[string, number]> {
  return (pages || []).map((t) => [String(t || ""), countTokens(String(t || ""), model)] as [string, number]);
}

// Convenience: compute a depth-based `level` field for search.
export function addDepthLevels(structure: PageIndexNode[], depth = 0): void {
  for (const node of structure || []) {
    node.level = typeof node.level === "number" ? node.level : depth;
    const kids = node.nodes || [];
    if (kids.length) addDepthLevels(kids, depth + 1);
  }
}
