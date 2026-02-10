import type { PageIndexDoc, PageIndexNode, YesNo } from "./types";
import type { PageIndexLlm } from "./llm";
import {
  countTokens,
  createCleanStructureForDescription,
  formatStructure,
  generateDocDescription,
  generateNodeSummary,
  structureToList,
  writeNodeId,
} from "./utils";

type MdHeaderNode = { node_title: string; line_num: number };

type MdNodeFlat = {
  title: string;
  line_num: number;
  level: number;
  text: string;
  text_token_count?: number;
};

export async function getNodeSummary(
  llm: PageIndexLlm,
  node: { text?: string },
  opts: { summary_token_threshold: number; model: string }
): Promise<string> {
  const nodeText = String(node.text || "");
  const numTokens = countTokens(nodeText, opts.model);
  if (numTokens < opts.summary_token_threshold) return nodeText;
  return await generateNodeSummary(llm, opts.model, { text: nodeText });
}

export async function generateSummariesForStructureMd(
  llm: PageIndexLlm,
  structure: any,
  opts: { summary_token_threshold: number; model: string }
): Promise<any> {
  const nodes = structureToList(structure);
  const tasks = nodes.map((n) => getNodeSummary(llm, n, opts));
  const summaries = await Promise.all(tasks);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const summary = summaries[i];
    const kids = (node as any).nodes;
    if (!kids || (Array.isArray(kids) && kids.length === 0)) (node as any).summary = summary;
    else (node as any).prefix_summary = summary;
  }
  return structure;
}

export function extractNodesFromMarkdown(markdownContent: string): { node_list: MdHeaderNode[]; lines: string[] } {
  const headerPattern = /^(#{1,6})\s+(.+)$/;
  const codeBlockPattern = /^```/;
  const nodeList: MdHeaderNode[] = [];

  const src = String(markdownContent || "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const stripped = String(lines[i] || "").trim();

    if (codeBlockPattern.test(stripped)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!stripped) continue;
    if (inCodeBlock) continue;

    const m = headerPattern.exec(stripped);
    if (!m) continue;
    const title = String(m[2] || "").trim();
    if (!title) continue;
    nodeList.push({ node_title: title, line_num: lineNum });
  }

  return { node_list: nodeList, lines };
}

export function extractNodeTextContent(nodeList: MdHeaderNode[], markdownLines: string[]): MdNodeFlat[] {
  const allNodes: MdNodeFlat[] = [];

  for (const node of nodeList) {
    const line = markdownLines[node.line_num - 1] || "";
    const headerMatch = /^(#{1,6})/.exec(line);
    if (!headerMatch) continue;
    allNodes.push({
      title: node.node_title,
      line_num: node.line_num,
      level: headerMatch[1].length,
      text: "",
    });
  }

  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    const startLine = node.line_num - 1;
    const endLine = i + 1 < allNodes.length ? allNodes[i + 1].line_num - 1 : markdownLines.length;
    node.text = markdownLines.slice(startLine, endLine).join("\n").trim();
  }

  return allNodes;
}

function findAllChildren(parentIndex: number, parentLevel: number, nodeList: MdNodeFlat[]): number[] {
  const children: number[] = [];
  for (let i = parentIndex + 1; i < nodeList.length; i++) {
    const curLevel = nodeList[i].level;
    if (curLevel <= parentLevel) break;
    children.push(i);
  }
  return children;
}

export function updateNodeListWithTextTokenCount(nodeList: MdNodeFlat[], opts: { model: string }): MdNodeFlat[] {
  const result = nodeList.map((n) => ({ ...n }));

  for (let i = result.length - 1; i >= 0; i--) {
    const cur = result[i];
    const children = findAllChildren(i, cur.level, result);

    let totalText = cur.text || "";
    for (const childIdx of children) {
      const childText = result[childIdx].text || "";
      if (childText) totalText += `\n${childText}`;
    }

    result[i].text_token_count = countTokens(totalText, opts.model);
  }

  return result;
}

export function treeThinningForIndex(nodeList: MdNodeFlat[], opts: { min_node_token: number; model: string }): MdNodeFlat[] {
  const result = nodeList.map((n) => ({ ...n }));
  const nodesToRemove = new Set<number>();

  for (let i = result.length - 1; i >= 0; i--) {
    if (nodesToRemove.has(i)) continue;
    const cur = result[i];
    const totalTokens = Number(cur.text_token_count || 0);

    if (totalTokens < opts.min_node_token) {
      const children = findAllChildren(i, cur.level, result);
      const childrenTexts: string[] = [];

      for (const childIdx of children) {
        if (nodesToRemove.has(childIdx)) continue;
        const childText = String(result[childIdx].text || "");
        if (childText.trim()) childrenTexts.push(childText);
        nodesToRemove.add(childIdx);
      }

      if (childrenTexts.length) {
        let merged = String(cur.text || "");
        for (const t of childrenTexts) {
          if (merged && !merged.endsWith("\n")) merged += "\n\n";
          merged += t;
        }
        result[i].text = merged;
        result[i].text_token_count = countTokens(merged, opts.model);
      }
    }
  }

  // Remove children from the end to keep indices stable.
  const removeSorted = Array.from(nodesToRemove.values()).sort((a, b) => b - a);
  for (const idx of removeSorted) result.splice(idx, 1);
  return result;
}

export function buildTreeFromNodes(nodeList: MdNodeFlat[]): PageIndexNode[] {
  if (!nodeList || nodeList.length === 0) return [];

  const stack: Array<{ node: any; level: number }> = [];
  const roots: any[] = [];
  let nodeCounter = 1;

  for (const node of nodeList) {
    const currentLevel = node.level;
    const treeNode: any = {
      title: node.title,
      node_id: String(nodeCounter).padStart(4, "0"),
      text: node.text,
      line_num: node.line_num,
      nodes: [],
    };
    nodeCounter += 1;

    while (stack.length && stack[stack.length - 1]!.level >= currentLevel) stack.pop();
    if (!stack.length) roots.push(treeNode);
    else stack[stack.length - 1]!.node.nodes.push(treeNode);

    stack.push({ node: treeNode, level: currentLevel });
  }

  return roots as PageIndexNode[];
}

export function cleanTreeForOutput(treeNodes: PageIndexNode[]): PageIndexNode[] {
  const cleaned: PageIndexNode[] = [];
  for (const node of treeNodes || []) {
    const out: PageIndexNode = {
      title: node.title,
      node_id: node.node_id,
      text: node.text,
      line_num: node.line_num,
    };
    if (node.nodes && node.nodes.length) out.nodes = cleanTreeForOutput(node.nodes);
    cleaned.push(out);
  }
  return cleaned;
}

export async function mdToTree(opts: {
  markdown: string;
  doc_name?: string;
  if_thinning?: boolean;
  min_token_threshold?: number;
  if_add_node_summary?: YesNo;
  summary_token_threshold?: number;
  model: string;
  if_add_doc_description?: YesNo;
  if_add_node_text?: YesNo;
  if_add_node_id?: YesNo;
  llm?: PageIndexLlm;
}): Promise<PageIndexDoc> {
  const markdownContent = String(opts.markdown || "");
  const docName = (opts.doc_name || "Document").trim() || "Document";

  const ifThinning = Boolean(opts.if_thinning);
  const minTokenThreshold = Math.max(0, Math.trunc(opts.min_token_threshold ?? 0));
  const ifAddNodeSummary: YesNo = opts.if_add_node_summary || "no";
  const summaryTokenThreshold = Math.max(1, Math.trunc(opts.summary_token_threshold ?? 200));
  const ifAddDocDescription: YesNo = opts.if_add_doc_description || "no";
  const ifAddNodeText: YesNo = opts.if_add_node_text || "no";
  const ifAddNodeId: YesNo = opts.if_add_node_id || "yes";

  const { node_list, lines } = extractNodesFromMarkdown(markdownContent);
  let nodesWithContent = extractNodeTextContent(node_list, lines);

  if (ifThinning) {
    nodesWithContent = updateNodeListWithTextTokenCount(nodesWithContent, { model: opts.model });
    nodesWithContent = treeThinningForIndex(nodesWithContent, { min_node_token: minTokenThreshold, model: opts.model });
  }

  let treeStructure: any = buildTreeFromNodes(nodesWithContent);

  if (ifAddNodeId === "yes") writeNodeId(treeStructure);

  if (ifAddNodeSummary === "yes") {
    if (!opts.llm) throw new Error("mdToTree: llm is required when if_add_node_summary=yes");

    // Always include text for summary generation.
    treeStructure = formatStructure(treeStructure, ["title", "node_id", "summary", "prefix_summary", "text", "line_num", "nodes"]);
    treeStructure = await generateSummariesForStructureMd(opts.llm, treeStructure, {
      summary_token_threshold: summaryTokenThreshold,
      model: opts.model,
    });

    if (ifAddNodeText === "no") {
      // Remove text after summary generation if not requested.
      treeStructure = formatStructure(treeStructure, ["title", "node_id", "summary", "prefix_summary", "line_num", "nodes"]);
    }

    if (ifAddDocDescription === "yes") {
      const cleanStructure = createCleanStructureForDescription(treeStructure);
      const desc = await generateDocDescription(opts.llm, opts.model, cleanStructure);
      return { doc_name: docName, doc_description: desc, structure: treeStructure };
    }
  } else {
    // No summaries requested.
    if (ifAddNodeText === "yes") {
      treeStructure = formatStructure(treeStructure, ["title", "node_id", "summary", "prefix_summary", "text", "line_num", "nodes"]);
    } else {
      treeStructure = formatStructure(treeStructure, ["title", "node_id", "summary", "prefix_summary", "line_num", "nodes"]);
    }
  }

  return { doc_name: docName, structure: treeStructure };
}

