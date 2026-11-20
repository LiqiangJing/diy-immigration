/**
 * 重要引用（Notable Citations）分析。
 * 从 Semantic Scholar 取一篇论文的全部引用和「引用原文」（别人的论文里提到它的那几句话），
 * 再由模型判断每条引用是怎么用这篇论文的。引用原文一律来自 Semantic Scholar，模型只做分类，不改写原文。
 */

import { CITE_CATEGORIES } from "@/lib/profile";
import type { CitationAnalysis, CiteCategory, NotableCitation } from "@/lib/profile";
import type { Price, Usage } from "./credits";
import { completeText } from "./llm";
import { s2 } from "./semanticScholar";

const MAX_CITATIONS = 3000; // 最多翻这么多条引用
const MAX_CANDIDATES = 80; // 最多把这么多条交给模型判断

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Raw = {
  contexts: string[] | null;
  isInfluential: boolean;
  citingPaper: {
    paperId: string | null;
    title: string | null;
    year: number | null;
    venue: string | null;
    citationCount: number | null;
    authors: { authorId: string | null; name: string }[] | null;
    externalIds: { DOI?: string; ArXiv?: string } | null;
  };
};

const SYSTEM = `你在帮一位美国职业移民（NIW / EB-1A）申请人分析别人的论文是怎么引用他的论文的。申请信里只有实质性的引用才有说服力，所以要把「只是顺带提一下」和「真的用到了、评价了这项工作」分开。

你会收到被引论文的标题，以及若干条引用，每条有编号、引用方论文的标题，和引用方论文里提到被引论文的原句（可能有几句；原句是自动抽取的，可能不完整，引用标记可能是 [12]、(Author et al., 2023) 之类）。

对每一条引用，只依据给出的原句判断，给出：
- category，取下面之一：
  - "praise"：明确的正面评价，比如称其为开创性的、最先进的、显著优于以往方法、重要进展。
  - "builds"：引用方的工作建立在这篇论文之上，采用、扩展或改进了它的方法、模型、理论或框架。
  - "baseline"：把这篇论文的方法当作对比基线，或者用它提出的数据集、基准做评测。
  - "uses"：直接使用了这篇论文的方法、工具、数据或结论来完成自己的工作，但没有在其上做扩展。
  - "mention"：只是在背景或相关工作里顺带列举，和一串其他文献并列，没有具体说它做了什么或怎么用。
  - "critical"：主要是指出这篇论文的不足、局限或错误。
  一条引用同时符合几类时，取对申请最有力的那一类，优先顺序是 praise、builds、baseline、uses。
- importance，取 "high"、"medium" 或 "low"：这条引用写进申请信的价值。原句具体说明了这项工作的贡献、优点，或者明确说自己的工作依赖它，是 high；确实用到了但原句没有评价，是 medium；顺带提及、原句看不出实质关系、或者是负面的，是 low。
- reason：一句中文，说明判断依据，不超过 40 个字。不要编造原句里没有的内容。

原句看不出是在说被引论文（比如抽取错了）时，归为 "mention"、"low"。

只输出一个 JSON 数组，不要任何其他文字，也不要用代码块包起来。每个元素形如 {"i": 编号, "category": "...", "importance": "...", "reason": "..."}，每条引用都要有。`;

function parse(text: string): { i: number; category: string; importance: string; reason: string }[] {
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a < 0 || b <= a) throw new Error("模型返回的结果格式不对，请重试。");
  try {
    const arr = JSON.parse(text.slice(a, b + 1));
    if (Array.isArray(arr)) return arr;
  } catch {}
  throw new Error("模型返回的结果格式不对，请重试。");
}

export async function analyzeCitations(
  title: string,
  signal: AbortSignal,
): Promise<{ analysis: CitationAnalysis; usage: Usage | null; price: Price | null }> {
  // 1. 按标题找到这篇论文
  let paper: { paperId: string; title: string; year: number | null; citationCount: number; authors: { authorId: string | null }[] };
  try {
    const m = await s2("/paper/search/match", { query: title, fields: "title,year,citationCount,authors" });
    paper = m.data?.[0];
  } catch (e) {
    if (e instanceof Error && e.message === "404") throw new Error("NOT_FOUND");
    throw e;
  }
  // 标题对不上（比如只匹配到一篇相近的论文）就不继续，免得分析错论文
  const want = norm(title);
  const got = norm(paper?.title ?? "");
  if (!paper || !(got === want || got.startsWith(want) || want.startsWith(got))) throw new Error("NOT_FOUND");
  const own = new Set(paper.authors.map((a) => a.authorId).filter(Boolean));

  // 2. 取全部引用
  const raw: Raw[] = [];
  for (let offset = 0; offset < MAX_CITATIONS; offset += 1000) {
    const page = await s2(`/paper/${paper.paperId}/citations`, {
      offset: String(offset),
      limit: "1000",
      fields:
        "contexts,isInfluential,citingPaper.title,citingPaper.year,citingPaper.venue,citingPaper.citationCount,citingPaper.authors,citingPaper.externalIds",
    });
    raw.push(...(page.data ?? []));
    if (page.next == null) break;
  }

  // 3. 去掉自引和没有引用原文的，按「值得看」的程度排序后取前若干条
  const isSelf = (r: Raw) => (r.citingPaper.authors ?? []).some((a) => a.authorId && own.has(a.authorId));
  const independent = raw.filter((r) => r.citingPaper?.title && !isSelf(r));
  const usable = independent.filter((r) => (r.contexts ?? []).some((c) => c && c.trim().length > 30));
  const score = (r: Raw) =>
    (r.isInfluential ? 4 : 0) +
    Math.min((r.contexts ?? []).length, 4) +
    Math.log10(1 + (r.citingPaper.citationCount ?? 0)) +
    (r.citingPaper.venue ? 0.5 : 0);
  const picked = usable.sort((a, b) => score(b) - score(a)).slice(0, MAX_CANDIDATES);

  const base: CitationAnalysis = {
    title: paper.title,
    year: paper.year ?? null,
    paperUrl: `https://www.semanticscholar.org/paper/${paper.paperId}`,
    analyzedAt: Date.now(),
    total: Math.max(paper.citationCount ?? 0, raw.length),
    scanned: raw.length,
    selfCitations: raw.length - independent.length,
    withContext: usable.length,
    analyzed: picked.length,
    items: [],
  };
  if (!picked.length) return { analysis: base, usage: null, price: null };

  // 4. 引用方作者里最资深的一位（按 h-index），用来判断引用方的分量
  const hIndex = new Map<string, { name: string; h: number }>();
  const ids = [...new Set(picked.flatMap((r) => (r.citingPaper.authors ?? []).map((a) => a.authorId)).filter(Boolean))] as string[];
  try {
    for (let i = 0; i < ids.length; i += 500) {
      const list = await s2("/author/batch", { fields: "name,hIndex" }, { ids: ids.slice(i, i + 500) });
      for (const a of list ?? []) if (a?.authorId) hIndex.set(a.authorId, { name: a.name, h: a.hIndex ?? 0 });
    }
  } catch {
    // 拿不到就不显示，不影响主流程
  }

  // 5. 交给模型分类
  const prompt =
    `被引论文：${paper.title}\n\n` +
    picked
      .map((r, i) => {
        const ctx = (r.contexts ?? [])
          .filter((c) => c && c.trim())
          .slice(0, 4)
          .map((c) => `  - ${c.trim().slice(0, 600)}`)
          .join("\n");
        return `[${i}] 引用方论文：${r.citingPaper.title}\n${ctx}`;
      })
      .join("\n\n");
  const { text, usage, price } = await completeText({ system: SYSTEM, text: prompt, signal });
  const verdicts = new Map(parse(text).map((v) => [Number(v.i), v]));

  const items: NotableCitation[] = picked.map((r, i) => {
    const v = verdicts.get(i);
    const p = r.citingPaper;
    const authors = p.authors ?? [];
    const top = authors
      .map((a) => (a.authorId ? hIndex.get(a.authorId) : undefined))
      .filter((a): a is { name: string; h: number } => Boolean(a))
      .sort((a, b) => b.h - a.h)[0];
    return {
      citingTitle: p.title!,
      authors:
        authors.length > 3 ? `${authors[0].name} et al.` : authors.map((a) => a.name).join(", "),
      venue: p.venue ?? "",
      year: p.year ?? null,
      citations: p.citationCount ?? 0,
      url: p.externalIds?.DOI
        ? `https://doi.org/${p.externalIds.DOI}`
        : p.externalIds?.ArXiv
          ? `https://arxiv.org/abs/${p.externalIds.ArXiv}`
          : p.paperId
            ? `https://www.semanticscholar.org/paper/${p.paperId}`
            : "",
      topAuthor: top && top.h >= 20 ? `${top.name}（h-index ${top.h}）` : "",
      contexts: (r.contexts ?? []).filter((c) => c && c.trim()).slice(0, 4).map((c) => c.trim()),
      category: (v && v.category in CITE_CATEGORIES ? v.category : "mention") as CiteCategory,
      importance: v && ["high", "medium", "low"].includes(v.importance) ? (v.importance as "high" | "medium" | "low") : "low",
      reason: typeof v?.reason === "string" ? v.reason.slice(0, 120) : "",
    };
  });
  const rank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => rank[a.importance] - rank[b.importance] || b.citations - a.citations);
  return { analysis: { ...base, items }, usage, price };
}
