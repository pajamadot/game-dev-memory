import type { PageIndexConfig, PageIndexDoc, YesNo } from "./types";
import type { LoggerLike, PageIndexLlm } from "./llm";
import {
  ConfigLoader,
  JsonLogger,
  addDepthLevels,
  addNodeText,
  addPrefaceIfNeeded,
  convertPageToInt,
  convertPhysicalIndexToInt,
  createCleanStructureForDescription,
  extractJson,
  generateDocDescription,
  generateSummariesForStructure,
  getJsonContent,
  postProcessing,
  removeStructureText,
  validateAndTruncatePhysicalIndices,
  writeNodeId,
  countTokens,
} from "./utils";

export type PageList = Array<[string, number]>;

type TocDetectResult = { toc_content: string | null; toc_page_list: number[]; page_index_given_in_toc: YesNo };

function yn(v: any): YesNo {
  return String(v || "").trim().toLowerCase() === "yes" ? "yes" : "no";
}

function randomSample<T>(arr: T[], n: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a.slice(0, Math.max(0, Math.min(a.length, n)));
}

async function llmJson(llm: PageIndexLlm, model: string, prompt: string): Promise<any> {
  const res = await llm.complete({ model, prompt });
  return extractJson(res.text || "");
}

async function llmTextWithFinish(
  llm: PageIndexLlm,
  model: string,
  prompt: string,
  chat_history?: any[]
): Promise<{ text: string; finish_reason: "finished" | "max_output_reached" }> {
  const res = await llm.complete({ model, prompt, chat_history });
  const fr = res.finish_reason === "max_output_reached" ? "max_output_reached" : "finished";
  return { text: String(res.text || ""), finish_reason: fr };
}

/////////////////// check title in page /////////////////////////////////////////////////////////
export async function checkTitleAppearance(
  llm: PageIndexLlm,
  item: any,
  pageList: PageList,
  startIndex = 1,
  model?: string
): Promise<{ list_index?: number; answer: YesNo; title: string; page_number: number | null }> {
  const title = String(item?.title || "");
  if (!("physical_index" in item) || item.physical_index === null || item.physical_index === undefined) {
    return { list_index: item?.list_index, answer: "no", title, page_number: null };
  }

  const pageNumber = Number(item.physical_index);
  const pageText = pageList[pageNumber - startIndex]?.[0] ?? "";

  const prompt = `
Your job is to check if the given section appears or starts in the given page_text.

Note: do fuzzy matching, ignore any space inconsistency in the page_text.

The given section title is ${title}.
The given page_text is ${pageText}.

Reply format:
{
  "thinking": <why do you think the section appears or starts in the page_text>
  "answer": "yes or no" (yes if the section appears or starts in the page_text, no otherwise)
}
Directly return the final JSON structure. Do not output anything else.`;

  const response = await llmJson(llm, model || "gpt-4o-2024-11-20", prompt);
  const answer: YesNo = yn(response?.answer);
  return { list_index: item?.list_index, answer, title, page_number: pageNumber };
}

export async function checkTitleAppearanceInStart(
  llm: PageIndexLlm,
  title: string,
  pageText: string,
  model?: string,
  logger?: LoggerLike | null
): Promise<YesNo> {
  const prompt = `
You will be given the current section title and the current page_text.
Your job is to check if the current section starts in the beginning of the given page_text.
If there are other contents before the current section title, then the current section does not start in the beginning of the given page_text.
If the current section title is the first content in the given page_text, then the current section starts in the beginning of the given page_text.

Note: do fuzzy matching, ignore any space inconsistency in the page_text.

The given section title is ${title}.
The given page_text is ${pageText}.

reply format:
{
  "thinking": <why do you think the section appears or starts in the page_text>
  "start_begin": "yes or no" (yes if the section starts in the beginning of the page_text, no otherwise)
}
Directly return the final JSON structure. Do not output anything else.`;

  const response = await llmJson(llm, model || "gpt-4o-2024-11-20", prompt);
  logger?.info?.({ response });
  return yn(response?.start_begin);
}

export async function checkTitleAppearanceInStartConcurrent(
  llm: PageIndexLlm,
  structure: any[],
  pageList: PageList,
  model?: string,
  logger?: LoggerLike | null
): Promise<any[]> {
  for (const item of structure) {
    if (item?.physical_index === null || item?.physical_index === undefined) item.appear_start = "no";
  }

  const tasks: Promise<YesNo>[] = [];
  const validItems: any[] = [];
  for (const item of structure) {
    if (item?.physical_index !== null && item?.physical_index !== undefined) {
      const pageText = pageList[item.physical_index - 1]?.[0] ?? "";
      tasks.push(checkTitleAppearanceInStart(llm, String(item.title || ""), pageText, model, logger));
      validItems.push(item);
    }
  }

  const results = await Promise.allSettled(tasks);
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i];
    const r = results[i];
    if (r.status === "fulfilled") item.appear_start = r.value;
    else item.appear_start = "no";
  }
  return structure;
}

export async function tocDetectorSinglePage(llm: PageIndexLlm, content: string, model: string): Promise<YesNo> {
  const prompt = `
Your job is to detect if there is a table of content provided in the given text.

Given text: ${content}

return the following JSON format:
{
  "thinking": <why do you think there is a table of content in the given text>
  "toc_detected": "<yes or no>"
}

Directly return the final JSON structure. Do not output anything else.
Please note: abstract,summary, notation list, figure list, table list, etc. are not table of contents.`;

  const json = await llmJson(llm, model, prompt);
  return yn(json?.toc_detected);
}

export async function checkIfTocExtractionIsComplete(llm: PageIndexLlm, content: string, toc: string, model: string): Promise<YesNo> {
  const prompt = `
You are given a partial document and a table of contents.
Your job is to check if the table of contents is complete, which it contains all the main sections in the partial document.

Reply format:
{
  "thinking": <why do you think the table of contents is complete or not>
  "completed": "yes" or "no"
}
Directly return the final JSON structure. Do not output anything else.

Document:
${content}
Table of contents:
${toc}`;

  const json = await llmJson(llm, model, prompt);
  return yn(json?.completed);
}

export async function checkIfTocTransformationIsComplete(llm: PageIndexLlm, rawToc: string, toc: string, model: string): Promise<YesNo> {
  const prompt = `
You are given a raw table of contents and a cleaned table of contents.
Your job is to check if the cleaned table of contents is complete.

Reply format:
{
  "thinking": <why do you think the cleaned table of contents is complete or not>
  "completed": "yes" or "no"
}
Directly return the final JSON structure. Do not output anything else.

Raw Table of contents:
${rawToc}
Cleaned Table of contents:
${toc}`;

  const json = await llmJson(llm, model, prompt);
  return yn(json?.completed);
}

export async function extractTocContent(llm: PageIndexLlm, content: string, model: string): Promise<string> {
  let prompt = `
Your job is to extract the full table of contents from the given text, replace ... with :

Given text: ${content}

Directly return the full table of contents content. Do not output anything else.`;

  let { text: response, finish_reason } = await llmTextWithFinish(llm, model, prompt);
  let ifComplete = await checkIfTocTransformationIsComplete(llm, content, response, model);
  if (ifComplete === "yes" && finish_reason === "finished") return response;

  let chatHistory: any[] = [
    { role: "user", content: prompt },
    { role: "assistant", content: response },
  ];
  prompt = `please continue the generation of table of contents , directly output the remaining part of the structure`;

  let attempts = 0;
  while (!(ifComplete === "yes" && finish_reason === "finished")) {
    const next = await llmTextWithFinish(llm, model, prompt, chatHistory);
    response = response + next.text;
    finish_reason = next.finish_reason;
    ifComplete = await checkIfTocTransformationIsComplete(llm, content, response, model);
    attempts += 1;
    if (attempts > 10) throw new Error("Failed to complete table of contents after maximum retries");
    chatHistory = [
      { role: "user", content: prompt },
      { role: "assistant", content: response },
    ];
  }
  return response;
}

export async function detectPageIndex(llm: PageIndexLlm, tocContent: string, model: string): Promise<YesNo> {
  const prompt = `
You will be given a table of contents.

Your job is to detect if there are page numbers/indices given within the table of contents.

Given text: ${tocContent}

Reply format:
{
  "thinking": <why do you think there are page numbers/indices given within the table of contents>
  "page_index_given_in_toc": "<yes or no>"
}
Directly return the final JSON structure. Do not output anything else.`;

  const json = await llmJson(llm, model, prompt);
  return yn(json?.page_index_given_in_toc);
}

export async function tocExtractor(
  llm: PageIndexLlm,
  pageList: PageList,
  tocPageList: number[],
  model: string
): Promise<{ toc_content: string; page_index_given_in_toc: YesNo }> {
  const transformDotsToColon = (text: string): string => {
    let out = text.replace(/\.{5,}/g, ": ");
    out = out.replace(/(?:\. ){5,}\.?/g, ": ");
    return out;
  };

  let tocContent = "";
  for (const pageIndex of tocPageList) tocContent += pageList[pageIndex]?.[0] ?? "";
  tocContent = transformDotsToColon(tocContent);
  const hasPageIndex = await detectPageIndex(llm, tocContent, model);
  return { toc_content: tocContent, page_index_given_in_toc: hasPageIndex };
}

export async function tocIndexExtractor(llm: PageIndexLlm, toc: any, content: string, model: string): Promise<any> {
  const prompt = `
You are given a table of contents in a json format and several pages of a document, your job is to add the physical_index to the table of contents in the json format.

The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

The response should be in the following JSON format:
[
  {
    "structure": <structure index, "x.x.x" or None> (string),
    "title": <title of the section>,
    "physical_index": "<physical_index_X>" (keep the format)
  }
]

Only add the physical_index to the sections that are in the provided pages.
If the section is not in the provided pages, do not add the physical_index to it.
Directly return the final JSON structure. Do not output anything else.

Table of contents:
${String(toc)}
Document pages:
${content}`;

  return await llmJson(llm, model, prompt);
}

export async function tocTransformer(llm: PageIndexLlm, tocContent: string, model: string): Promise<any[]> {
  const initPrompt = `
You are given a table of contents, You job is to transform the whole table of content into a JSON format included table_of_contents.

structure is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

The response should be in the following JSON format:
{
  table_of_contents: [
    {
      "structure": <structure index, "x.x.x" or None> (string),
      "title": <title of the section>,
      "page": <page number or None>
    }
  ]
}
You should transform the full table of contents in one go.
Directly return the final JSON structure, do not output anything else.`;

  let prompt = `${initPrompt}\n Given table of contents\n:${tocContent}`;
  let { text: lastComplete, finish_reason } = await llmTextWithFinish(llm, model, prompt);
  let ifComplete = await checkIfTocTransformationIsComplete(llm, tocContent, lastComplete, model);

  if (ifComplete === "yes" && finish_reason === "finished") {
    const parsed = extractJson(lastComplete);
    return convertPageToInt(parsed.table_of_contents || []);
  }

  lastComplete = getJsonContent(lastComplete);
  let attempts = 0;
  while (!(ifComplete === "yes" && finish_reason === "finished")) {
    const pos = lastComplete.lastIndexOf("}");
    if (pos !== -1) lastComplete = lastComplete.slice(0, pos + 2);

    prompt = `
Your task is to continue the table of contents json structure, directly output the remaining part of the json structure.

The raw table of contents json structure is:
${tocContent}

The incomplete transformed table of contents json structure is:
${lastComplete}

Please continue the json structure, directly output the remaining part of the json structure.`;

    const next = await llmTextWithFinish(llm, model, prompt);
    let newComplete = next.text;
    finish_reason = next.finish_reason;
    if (newComplete.trimStart().startsWith("```json")) newComplete = getJsonContent(newComplete);
    lastComplete = lastComplete + newComplete;
    ifComplete = await checkIfTocTransformationIsComplete(llm, tocContent, lastComplete, model);

    attempts += 1;
    if (attempts > 10) break;
  }

  const parsed = JSON.parse(lastComplete);
  return convertPageToInt(parsed.table_of_contents || []);
}

export async function findTocPages(
  llm: PageIndexLlm,
  startPageIndex: number,
  pageList: PageList,
  opt: PageIndexConfig,
  logger?: LoggerLike | null
): Promise<number[]> {
  let lastPageIsYes = false;
  const tocPageList: number[] = [];
  let i = startPageIndex;

  while (i < pageList.length) {
    if (i >= opt.toc_check_page_num && !lastPageIsYes) break;
    const detected = await tocDetectorSinglePage(llm, pageList[i]?.[0] ?? "", opt.model);
    if (detected === "yes") {
      logger?.info?.(`Page ${i} has toc`);
      tocPageList.push(i);
      lastPageIsYes = true;
    } else if (detected === "no" && lastPageIsYes) {
      logger?.info?.(`Found the last page with toc: ${i - 1}`);
      break;
    }
    i += 1;
  }

  if (!tocPageList.length) logger?.info?.("No toc found");
  return tocPageList;
}

// Upstream helper (mostly legacy): recursively remove `page_number` fields.
export function removePageNumber(data: any): any {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    delete (data as any).page_number;
    for (const k of Object.keys(data)) {
      if (k.includes("nodes")) removePageNumber((data as any)[k]);
    }
    return data;
  }
  if (Array.isArray(data)) {
    for (const item of data) removePageNumber(item);
  }
  return data;
}

export function extractMatchingPagePairs(tocPage: any[], tocPhysicalIndex: any[], startPageIndex: number): any[] {
  const pairs: any[] = [];
  for (const phyItem of tocPhysicalIndex || []) {
    for (const pageItem of tocPage || []) {
      if (phyItem?.title === pageItem?.title) {
        const physicalIndex = phyItem?.physical_index;
        if (physicalIndex !== null && physicalIndex !== undefined && Number(physicalIndex) >= startPageIndex) {
          pairs.push({ title: phyItem.title, page: pageItem.page, physical_index: physicalIndex });
        }
      }
    }
  }
  return pairs;
}

export function calculatePageOffset(pairs: any[]): number | null {
  const diffs: number[] = [];
  for (const pair of pairs || []) {
    try {
      const d = Number(pair.physical_index) - Number(pair.page);
      if (Number.isFinite(d)) diffs.push(d);
    } catch {
      // ignore
    }
  }
  if (!diffs.length) return null;

  const counts = new Map<number, number>();
  for (const d of diffs) counts.set(d, (counts.get(d) || 0) + 1);

  let best: number | null = null;
  let bestCount = -1;
  for (const [k, v] of counts.entries()) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

export function addPageOffsetToTocJson(data: any[], offset: number | null): any[] {
  if (offset === null || offset === undefined) return data;
  for (const item of data || []) {
    if (item?.page !== null && item?.page !== undefined && typeof item.page === "number") {
      item.physical_index = item.page + offset;
      delete item.page;
    }
  }
  return data;
}

export function pageListToGroupText(pageContents: string[], tokenLengths: number[], maxTokens = 20000, overlapPage = 1): string[] {
  const numTokens = tokenLengths.reduce((a, b) => a + b, 0);
  if (numTokens <= maxTokens) return [pageContents.join("")];

  const subsets: string[] = [];
  let currentSubset: string[] = [];
  let currentTokenCount = 0;

  const expectedPartsNum = Math.ceil(numTokens / maxTokens);
  const averageTokensPerPart = Math.ceil(((numTokens / expectedPartsNum) + maxTokens) / 2);

  for (let i = 0; i < pageContents.length; i++) {
    const pageContent = pageContents[i];
    const pageTokens = tokenLengths[i];

    if (currentTokenCount + pageTokens > averageTokensPerPart) {
      subsets.push(currentSubset.join(""));
      const overlapStart = Math.max(i - overlapPage, 0);
      currentSubset = pageContents.slice(overlapStart, i);
      currentTokenCount = tokenLengths.slice(overlapStart, i).reduce((a, b) => a + b, 0);
    }

    currentSubset.push(pageContent);
    currentTokenCount += pageTokens;
  }

  if (currentSubset.length) subsets.push(currentSubset.join(""));
  return subsets;
}

export async function addPageNumberToToc(llm: PageIndexLlm, part: any, structure: any, model: string): Promise<any[]> {
  const fillPromptSeq = `
You are given an JSON structure of a document and a partial part of the document. Your task is to check if the title that is described in the structure is started in the partial given document.

The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

If the full target section starts in the partial given document, insert the given JSON structure with the "start": "yes", and "start_index": "<physical_index_X>".

If the full target section does not start in the partial given document, insert "start": "no",  "start_index": None.

The response should be in the following format:
[
  {
    "structure": <structure index, "x.x.x" or None> (string),
    "title": <title of the section>,
    "start": "<yes or no>",
    "physical_index": "<physical_index_X> (keep the format)" or None
  }
]
The given structure contains the result of the previous part, you need to fill the result of the current part, do not change the previous result.
Directly return the final JSON structure. Do not output anything else.`;

  const prompt = `${fillPromptSeq}\n\nCurrent Partial Document:\n${String(part)}\n\nGiven Structure\n${JSON.stringify(structure, null, 2)}\n`;
  const jsonResult = await llmJson(llm, model, prompt);

  for (const item of jsonResult || []) {
    if ("start" in item) delete item.start;
  }
  return jsonResult;
}

export function removeFirstPhysicalIndexSection(text: string): string {
  const pattern = /<physical_index_\d+>.*?<physical_index_\d+>/s;
  const m = pattern.exec(text);
  if (!m) return text;
  return text.replace(m[0], "");
}

export async function generateTocContinue(llm: PageIndexLlm, tocContent: any[], part: string, model: string): Promise<any[]> {
  const prompt = `
You are an expert in extracting hierarchical tree structure.
You are given a tree structure of the previous part and the text of the current part.
Your task is to continue the tree structure from the previous part to include the current part.

The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

For the title, you need to extract the original title from the text, only fix the space inconsistency.

The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the start and end of page X.

For the physical_index, you need to extract the physical index of the start of the section from the text. Keep the <physical_index_X> format.

The response should be in the following format:
[
  {
    "structure": <structure index, "x.x.x"> (string),
    "title": <title of the section, keep the original title>,
    "physical_index": "<physical_index_X> (keep the format)"
  }
]

Directly return the additional part of the final JSON structure. Do not output anything else.

Given text
:${part}
Previous tree structure
:${JSON.stringify(tocContent, null, 2)}`;

  const res = await llmTextWithFinish(llm, model, prompt);
  if (res.finish_reason === "finished") return extractJson(res.text || "");
  throw new Error(`finish reason: ${res.finish_reason}`);
}

export async function generateTocInit(llm: PageIndexLlm, part: string, model: string): Promise<any[]> {
  const prompt = `
You are an expert in extracting hierarchical tree structure, your task is to generate the tree structure of the document.

The structure variable is the numeric system which represents the index of the hierarchy section in the table of contents. For example, the first section has structure index 1, the first subsection has structure index 1.1, the second subsection has structure index 1.2, etc.

For the title, you need to extract the original title from the text, only fix the space inconsistency.

The provided text contains tags like <physical_index_X> and <physical_index_X> to indicate the start and end of page X.

For the physical_index, you need to extract the physical index of the start of the section from the text. Keep the <physical_index_X> format.

The response should be in the following format:
[
  {
    "structure": <structure index, "x.x.x"> (string),
    "title": <title of the section, keep the original title>,
    "physical_index": "<physical_index_X> (keep the format)"
  }
]

Directly return the final JSON structure. Do not output anything else.

Given text
:${part}`;

  const res = await llmTextWithFinish(llm, model, prompt);
  if (res.finish_reason === "finished") return extractJson(res.text || "");
  throw new Error(`finish reason: ${res.finish_reason}`);
}

export async function processNoToc(
  llm: PageIndexLlm,
  pageList: PageList,
  startIndex = 1,
  model: string,
  logger?: LoggerLike | null
): Promise<any[]> {
  const pageContents: string[] = [];
  const tokenLengths: number[] = [];

  for (let pageIndex = startIndex; pageIndex < startIndex + pageList.length; pageIndex++) {
    const pageText = `<physical_index_${pageIndex}>\n${pageList[pageIndex - startIndex]?.[0] ?? ""}\n<physical_index_${pageIndex}>\n\n`;
    pageContents.push(pageText);
    tokenLengths.push(countTokens(pageText, model));
  }

  const groupTexts = pageListToGroupText(pageContents, tokenLengths);
  logger?.info?.(`len(group_texts): ${groupTexts.length}`);

  let tocWithPageNumber: any[] = await generateTocInit(llm, groupTexts[0] || "", model);
  for (const groupText of groupTexts.slice(1)) {
    const additional = await generateTocContinue(llm, tocWithPageNumber, groupText, model);
    tocWithPageNumber = tocWithPageNumber.concat(additional);
  }

  tocWithPageNumber = convertPhysicalIndexToInt(tocWithPageNumber);
  return tocWithPageNumber;
}

export async function processTocNoPageNumbers(
  llm: PageIndexLlm,
  tocContent: string,
  tocPageList: number[],
  pageList: PageList,
  startIndex = 1,
  model: string,
  logger?: LoggerLike | null
): Promise<any[]> {
  const tocItems = await tocTransformer(llm, tocContent, model);
  logger?.info?.({ toc_transformer: tocItems });

  const pageContents: string[] = [];
  const tokenLengths: number[] = [];
  for (let pageIndex = startIndex; pageIndex < startIndex + pageList.length; pageIndex++) {
    const pageText = `<physical_index_${pageIndex}>\n${pageList[pageIndex - startIndex]?.[0] ?? ""}\n<physical_index_${pageIndex}>\n\n`;
    pageContents.push(pageText);
    tokenLengths.push(countTokens(pageText, model));
  }

  const groupTexts = pageListToGroupText(pageContents, tokenLengths);
  logger?.info?.(`len(group_texts): ${groupTexts.length}`);

  let tocWithPageNumber: any = JSON.parse(JSON.stringify(tocItems));
  for (const groupText of groupTexts) {
    tocWithPageNumber = await addPageNumberToToc(llm, groupText, tocWithPageNumber, model);
  }

  tocWithPageNumber = convertPhysicalIndexToInt(tocWithPageNumber);
  return tocWithPageNumber;
}

export async function processNonePageNumbers(llm: PageIndexLlm, tocItems: any[], pageList: PageList, startIndex = 1, model: string): Promise<any[]> {
  for (let i = 0; i < tocItems.length; i++) {
    const item = tocItems[i];
    if (!("physical_index" in item)) {
      let prevPhysicalIndex = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (tocItems[j]?.physical_index !== null && tocItems[j]?.physical_index !== undefined) {
          prevPhysicalIndex = tocItems[j].physical_index;
          break;
        }
      }

      let nextPhysicalIndex = -1;
      for (let j = i + 1; j < tocItems.length; j++) {
        if (tocItems[j]?.physical_index !== null && tocItems[j]?.physical_index !== undefined) {
          nextPhysicalIndex = tocItems[j].physical_index;
          break;
        }
      }

      const pageContents: string[] = [];
      for (let pageIndex = prevPhysicalIndex; pageIndex <= nextPhysicalIndex; pageIndex++) {
        const listIndex = pageIndex - startIndex;
        if (listIndex >= 0 && listIndex < pageList.length) {
          const pageText = `<physical_index_${pageIndex}>\n${pageList[listIndex]?.[0] ?? ""}\n<physical_index_${pageIndex}>\n\n`;
          pageContents.push(pageText);
        }
      }

      const itemCopy = JSON.parse(JSON.stringify(item));
      delete itemCopy.page;
      const result = await addPageNumberToToc(llm, pageContents, itemCopy, model);
      const pi = result?.[0]?.physical_index;
      if (typeof pi === "string" && pi.startsWith("<physical_index")) {
        item.physical_index = parseInt(pi.split("_").pop()?.replace(">", "").trim() || "", 10);
        delete item.page;
      }
    }
  }
  return tocItems;
}

export async function processTocWithPageNumbers(
  llm: PageIndexLlm,
  tocContent: string,
  tocPageList: number[],
  pageList: PageList,
  opt: PageIndexConfig,
  model: string,
  logger?: LoggerLike | null
): Promise<any[]> {
  let tocWithPageNumber = await tocTransformer(llm, tocContent, model);
  logger?.info?.({ toc_with_page_number: tocWithPageNumber });

  // Upstream's remove_page_number() is a no-op for "page" keys; keep behavior.
  const tocNoPageNumber = JSON.parse(JSON.stringify(tocWithPageNumber));

  const startPageIndex = tocPageList[tocPageList.length - 1] + 1;
  let mainContent = "";
  for (let pageIndex = startPageIndex; pageIndex < Math.min(startPageIndex + opt.toc_check_page_num, pageList.length); pageIndex++) {
    mainContent += `<physical_index_${pageIndex + 1}>\n${pageList[pageIndex]?.[0] ?? ""}\n<physical_index_${pageIndex + 1}>\n\n`;
  }

  let tocWithPhysicalIndex = await tocIndexExtractor(llm, tocNoPageNumber, mainContent, model);
  tocWithPhysicalIndex = convertPhysicalIndexToInt(tocWithPhysicalIndex);

  const matchingPairs = extractMatchingPagePairs(tocWithPageNumber, tocWithPhysicalIndex, startPageIndex);
  const offset = calculatePageOffset(matchingPairs);

  tocWithPageNumber = addPageOffsetToTocJson(tocWithPageNumber, offset);
  tocWithPageNumber = await processNonePageNumbers(llm, tocWithPageNumber, pageList, 1, model);
  return tocWithPageNumber;
}

export async function checkToc(llm: PageIndexLlm, pageList: PageList, opt: PageIndexConfig, logger?: LoggerLike | null): Promise<TocDetectResult> {
  const tocPageList = await findTocPages(llm, 0, pageList, opt, logger);
  if (tocPageList.length === 0) return { toc_content: null, toc_page_list: [], page_index_given_in_toc: "no" };

  const tocJson = await tocExtractor(llm, pageList, tocPageList, opt.model);
  if (tocJson.page_index_given_in_toc === "yes") {
    return { toc_content: tocJson.toc_content, toc_page_list: tocPageList, page_index_given_in_toc: "yes" };
  }

  let currentStartIndex = tocPageList[tocPageList.length - 1] + 1;
  while (tocJson.page_index_given_in_toc === "no" && currentStartIndex < pageList.length && currentStartIndex < opt.toc_check_page_num) {
    const additional = await findTocPages(llm, currentStartIndex, pageList, opt, logger);
    if (additional.length === 0) break;
    const additionalJson = await tocExtractor(llm, pageList, additional, opt.model);
    if (additionalJson.page_index_given_in_toc === "yes") {
      return { toc_content: additionalJson.toc_content, toc_page_list: additional, page_index_given_in_toc: "yes" };
    }
    currentStartIndex = additional[additional.length - 1] + 1;
  }

  return { toc_content: tocJson.toc_content, toc_page_list: tocPageList, page_index_given_in_toc: "no" };
}

/////////////////// fix incorrect toc //////////////////////////////////////////////////////////
export async function singleTocItemIndexFixer(llm: PageIndexLlm, sectionTitle: string, content: string, model: string): Promise<number | null> {
  const prompt = `
You are given a section title and several pages of a document, your job is to find the physical index of the start page of the section in the partial document.

The provided pages contains tags like <physical_index_X> and <physical_index_X> to indicate the physical location of the page X.

Reply in a JSON format:
{
  "thinking": <explain which page, started and closed by <physical_index_X>, contains the start of this section>,
  "physical_index": "<physical_index_X>" (keep the format)
}
Directly return the final JSON structure. Do not output anything else.

Section Title:
${sectionTitle}
Document pages:
${content}`;

  const json = await llmJson(llm, model, prompt);
  return convertPhysicalIndexToInt(json?.physical_index);
}

export async function fixIncorrectToc(
  llm: PageIndexLlm,
  tocWithPageNumber: any[],
  pageList: PageList,
  incorrectResults: any[],
  startIndex = 1,
  model: string,
  logger?: LoggerLike | null
): Promise<{ toc: any[]; invalid: any[] }> {
  const incorrectIndices = new Set<number>(incorrectResults.map((r) => Number(r.list_index)));
  const endIndex = pageList.length + startIndex - 1;
  const rangeLogs: any[] = [];

  const processAndCheckItem = async (incorrectItem: any) => {
    const listIndex = Number(incorrectItem.list_index);
    if (listIndex < 0 || listIndex >= tocWithPageNumber.length) {
      return { list_index: listIndex, title: incorrectItem.title, physical_index: incorrectItem.physical_index, is_valid: false };
    }

    let prevCorrect: number | null = null;
    for (let i = listIndex - 1; i >= 0; i--) {
      if (!incorrectIndices.has(i)) {
        const idx = tocWithPageNumber[i]?.physical_index;
        if (idx !== null && idx !== undefined) {
          prevCorrect = idx;
          break;
        }
      }
    }
    if (prevCorrect === null) prevCorrect = startIndex - 1;

    let nextCorrect: number | null = null;
    for (let i = listIndex + 1; i < tocWithPageNumber.length; i++) {
      if (!incorrectIndices.has(i)) {
        const idx = tocWithPageNumber[i]?.physical_index;
        if (idx !== null && idx !== undefined) {
          nextCorrect = idx;
          break;
        }
      }
    }
    if (nextCorrect === null) nextCorrect = endIndex;

    rangeLogs.push({ list_index: listIndex, title: incorrectItem.title, prev_correct: prevCorrect, next_correct: nextCorrect });

    const pageContents: string[] = [];
    for (let pageIndex = prevCorrect; pageIndex <= nextCorrect; pageIndex++) {
      const li = pageIndex - startIndex;
      if (li >= 0 && li < pageList.length) {
        pageContents.push(`<physical_index_${pageIndex}>\n${pageList[li]?.[0] ?? ""}\n<physical_index_${pageIndex}>\n\n`);
      }
    }
    const contentRange = pageContents.join("");

    const physicalIndexInt = await singleTocItemIndexFixer(llm, incorrectItem.title, contentRange, model);
    const checkItem = { ...incorrectItem, physical_index: physicalIndexInt };
    const checkResult = await checkTitleAppearance(llm, checkItem, pageList, startIndex, model);
    return { list_index: listIndex, title: incorrectItem.title, physical_index: physicalIndexInt, is_valid: checkResult.answer === "yes" };
  };

  const results = await Promise.allSettled(incorrectResults.map((i) => processAndCheckItem(i)));
  const fixed: any[] = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);

  const invalid: any[] = [];
  for (const r of fixed) {
    if (r.is_valid) {
      const idx = Number(r.list_index);
      if (idx >= 0 && idx < tocWithPageNumber.length) tocWithPageNumber[idx].physical_index = r.physical_index;
      else invalid.push({ list_index: r.list_index, title: r.title, physical_index: r.physical_index });
    } else {
      invalid.push({ list_index: r.list_index, title: r.title, physical_index: r.physical_index });
    }
  }

  logger?.info?.({ incorrect_results_and_range_logs: rangeLogs });
  logger?.info?.({ invalid_results: invalid });
  return { toc: tocWithPageNumber, invalid };
}

export async function fixIncorrectTocWithRetries(
  llm: PageIndexLlm,
  tocWithPageNumber: any[],
  pageList: PageList,
  incorrectResults: any[],
  startIndex = 1,
  maxAttempts = 3,
  model: string,
  logger?: LoggerLike | null
): Promise<{ toc: any[]; incorrect: any[] }> {
  let fixAttempt = 0;
  let currentToc = tocWithPageNumber;
  let currentIncorrect = incorrectResults;

  while (currentIncorrect && currentIncorrect.length) {
    const r = await fixIncorrectToc(llm, currentToc, pageList, currentIncorrect, startIndex, model, logger);
    currentToc = r.toc;
    currentIncorrect = r.invalid;
    fixAttempt += 1;
    if (fixAttempt >= maxAttempts) break;
  }

  return { toc: currentToc, incorrect: currentIncorrect };
}

/////////////////// verify toc /////////////////////////////////////////////////////////////////
export async function verifyToc(
  llm: PageIndexLlm,
  pageList: PageList,
  listResult: any[],
  startIndex = 1,
  N: number | null,
  model: string
): Promise<{ accuracy: number; incorrect_results: any[] }> {
  let lastPhysicalIndex: number | null = null;
  for (let i = listResult.length - 1; i >= 0; i--) {
    const idx = listResult[i]?.physical_index;
    if (idx !== null && idx !== undefined) {
      lastPhysicalIndex = idx;
      break;
    }
  }

  if (lastPhysicalIndex === null || lastPhysicalIndex < pageList.length / 2) return { accuracy: 0, incorrect_results: [] };

  let sampleIndices: number[] = [];
  if (N === null) sampleIndices = Array.from({ length: listResult.length }, (_, i) => i);
  else sampleIndices = randomSample(Array.from({ length: listResult.length }, (_, i) => i), Math.min(N, listResult.length));

  const indexedSampleList: any[] = [];
  for (const idx of sampleIndices) {
    const item = listResult[idx];
    if (item?.physical_index !== null && item?.physical_index !== undefined) {
      indexedSampleList.push({ ...item, list_index: idx });
    }
  }

  const results = await Promise.all(indexedSampleList.map((item) => checkTitleAppearance(llm, item, pageList, startIndex, model)));

  let correctCount = 0;
  const incorrectResults: any[] = [];
  for (const r of results) {
    if (r.answer === "yes") correctCount += 1;
    else incorrectResults.push(r);
  }

  const accuracy = results.length > 0 ? correctCount / results.length : 0;
  return { accuracy, incorrect_results: incorrectResults };
}

/////////////////// main process ///////////////////////////////////////////////////////////////
export async function metaProcessor(
  llm: PageIndexLlm,
  pageList: PageList,
  mode: "process_toc_with_page_numbers" | "process_toc_no_page_numbers" | "process_no_toc",
  opt: PageIndexConfig,
  args: { toc_content?: string; toc_page_list?: number[]; start_index?: number; logger?: LoggerLike | null }
): Promise<any[]> {
  const startIndex = args.start_index ?? 1;
  const logger = args.logger || null;

  let tocWithPageNumber: any[] = [];
  if (mode === "process_toc_with_page_numbers") {
    tocWithPageNumber = await processTocWithPageNumbers(llm, args.toc_content || "", args.toc_page_list || [], pageList, opt, opt.model, logger);
  } else if (mode === "process_toc_no_page_numbers") {
    tocWithPageNumber = await processTocNoPageNumbers(llm, args.toc_content || "", args.toc_page_list || [], pageList, startIndex, opt.model, logger);
  } else {
    tocWithPageNumber = await processNoToc(llm, pageList, startIndex, opt.model, logger);
  }

  tocWithPageNumber = (tocWithPageNumber || []).filter((i) => i?.physical_index !== null && i?.physical_index !== undefined);
  tocWithPageNumber = validateAndTruncatePhysicalIndices(tocWithPageNumber, pageList.length, startIndex, logger);

  const { accuracy, incorrect_results } = await verifyToc(llm, pageList, tocWithPageNumber, startIndex, null, opt.model);

  logger?.info?.({
    mode: "process_toc_with_page_numbers",
    accuracy,
    incorrect_results,
  });

  if (accuracy === 1.0 && incorrect_results.length === 0) return tocWithPageNumber;

  if (accuracy > 0.6 && incorrect_results.length > 0) {
    const fixed = await fixIncorrectTocWithRetries(llm, tocWithPageNumber, pageList, incorrect_results, startIndex, 3, opt.model, logger);
    return fixed.toc;
  }

  if (mode === "process_toc_with_page_numbers") {
    return await metaProcessor(llm, pageList, "process_toc_no_page_numbers", opt, args);
  }
  if (mode === "process_toc_no_page_numbers") {
    return await metaProcessor(llm, pageList, "process_no_toc", opt, args);
  }
  throw new Error("Processing failed");
}

export async function processLargeNodeRecursively(
  llm: PageIndexLlm,
  node: any,
  pageList: PageList,
  opt: PageIndexConfig,
  logger?: LoggerLike | null
): Promise<any> {
  const nodePageList = pageList.slice(Number(node.start_index) - 1, Number(node.end_index));
  const tokenNum = nodePageList.reduce((a, p) => a + Number(p?.[1] || 0), 0);

  if (Number(node.end_index) - Number(node.start_index) > opt.max_page_num_each_node && tokenNum >= opt.max_token_num_each_node) {
    const nodeTocTree = await metaProcessor(llm, nodePageList, "process_no_toc", opt, {
      start_index: Number(node.start_index),
      logger,
    });

    await checkTitleAppearanceInStartConcurrent(llm, nodeTocTree, pageList, opt.model, logger);
    const validItems = (nodeTocTree || []).filter((i) => i?.physical_index !== null && i?.physical_index !== undefined);

    if (validItems.length && String(node.title || "").trim() === String(validItems[0].title || "").trim()) {
      node.nodes = postProcessing(validItems.slice(1), Number(node.end_index));
      node.end_index = validItems.length > 1 ? validItems[1].start_index : node.end_index;
    } else {
      node.nodes = postProcessing(validItems, Number(node.end_index));
      node.end_index = validItems.length ? validItems[0].start_index : node.end_index;
    }
  }

  if (node.nodes && Array.isArray(node.nodes) && node.nodes.length) {
    await Promise.all(node.nodes.map((child: any) => processLargeNodeRecursively(llm, child, pageList, opt, logger)));
  }
  return node;
}

export async function treeParser(llm: PageIndexLlm, pageList: PageList, opt: PageIndexConfig, logger?: LoggerLike | null): Promise<any[]> {
  const checkTocResult = await checkToc(llm, pageList, opt, logger);
  logger?.info?.(checkTocResult);

  let tocWithPageNumber: any[] = [];
  if (checkTocResult.toc_content && checkTocResult.toc_content.trim() && checkTocResult.page_index_given_in_toc === "yes") {
    tocWithPageNumber = await metaProcessor(llm, pageList, "process_toc_with_page_numbers", opt, {
      start_index: 1,
      toc_content: checkTocResult.toc_content,
      toc_page_list: checkTocResult.toc_page_list,
      logger,
    });
  } else {
    tocWithPageNumber = await metaProcessor(llm, pageList, "process_no_toc", opt, { start_index: 1, logger });
  }

  tocWithPageNumber = addPrefaceIfNeeded(tocWithPageNumber);
  await checkTitleAppearanceInStartConcurrent(llm, tocWithPageNumber, pageList, opt.model, logger);

  const validItems = (tocWithPageNumber || []).filter((i) => i?.physical_index !== null && i?.physical_index !== undefined);
  const tocTree = postProcessing(validItems, pageList.length);

  const nodes = Array.isArray(tocTree) ? tocTree : [];
  await Promise.all(nodes.map((n) => processLargeNodeRecursively(llm, n, pageList, opt, logger)));
  return nodes;
}

export async function pageIndexFromPages(opts: {
  llm: PageIndexLlm;
  page_list: PageList;
  doc_name: string;
  user_opt?: Partial<PageIndexConfig> | null;
  logger?: LoggerLike | null;
}): Promise<PageIndexDoc> {
  const config = new ConfigLoader().load(opts.user_opt || undefined);
  const logger = opts.logger || new JsonLogger(opts.doc_name);

  logger.info?.({ total_page_number: opts.page_list.length });
  logger.info?.({ total_token: opts.page_list.reduce((a, p) => a + Number(p?.[1] || 0), 0) });

  let structure = await treeParser(opts.llm, opts.page_list, config, logger);

  if (config.if_add_node_id === "yes") writeNodeId(structure);
  if (config.if_add_node_text === "yes") addNodeText(structure, opts.page_list);

  if (config.if_add_node_summary === "yes") {
    if (config.if_add_node_text === "no") addNodeText(structure, opts.page_list);
    await generateSummariesForStructure(opts.llm, config.model, structure);
    if (config.if_add_node_text === "no") removeStructureText(structure);

    if (config.if_add_doc_description === "yes") {
      const cleanStructure = createCleanStructureForDescription(structure);
      const desc = await generateDocDescription(opts.llm, config.model, cleanStructure);
      addDepthLevels(structure as any);
      return { doc_name: opts.doc_name, doc_description: desc, structure };
    }
  }

  addDepthLevels(structure as any);
  return { doc_name: opts.doc_name, structure };
}

// Convenience wrapper mirroring the upstream `page_index()` function.
export async function pageIndex(opts: {
  llm: PageIndexLlm;
  page_list: PageList;
  doc_name: string;
  model?: string;
  toc_check_page_num?: number;
  max_page_num_each_node?: number;
  max_token_num_each_node?: number;
  if_add_node_id?: YesNo;
  if_add_node_summary?: YesNo;
  if_add_doc_description?: YesNo;
  if_add_node_text?: YesNo;
  logger?: LoggerLike | null;
}): Promise<PageIndexDoc> {
  const user_opt: any = {};
  if (opts.model) user_opt.model = opts.model;
  if (typeof opts.toc_check_page_num === "number") user_opt.toc_check_page_num = opts.toc_check_page_num;
  if (typeof opts.max_page_num_each_node === "number") user_opt.max_page_num_each_node = opts.max_page_num_each_node;
  if (typeof opts.max_token_num_each_node === "number") user_opt.max_token_num_each_node = opts.max_token_num_each_node;
  if (opts.if_add_node_id) user_opt.if_add_node_id = opts.if_add_node_id;
  if (opts.if_add_node_summary) user_opt.if_add_node_summary = opts.if_add_node_summary;
  if (opts.if_add_doc_description) user_opt.if_add_doc_description = opts.if_add_doc_description;
  if (opts.if_add_node_text) user_opt.if_add_node_text = opts.if_add_node_text;

  return await pageIndexFromPages({
    llm: opts.llm,
    page_list: opts.page_list,
    doc_name: opts.doc_name,
    user_opt,
    logger: opts.logger || null,
  });
}
