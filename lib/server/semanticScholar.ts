/**
 * Semantic Scholar 的公开接口（api.semanticscholar.org）。
 * 不配 S2_API_KEY 也能用，但免费通道是所有人共用的，偶尔会被限流（429），这里自动重试几次。
 */

const BASE = "https://api.semanticscholar.org/graph/v1";

async function s2(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (process.env.S2_API_KEY) headers["x-api-key"] = process.env.S2_API_KEY;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (res.ok) return res.json();
    if (res.status !== 429 || attempt >= 3) throw new Error(String(res.status));
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

/** 从主页链接（…/author/姓名/1234567）或纯数字里取出作者 ID */
export function s2AuthorId(input: string): string | null {
  const v = input.trim();
  if (/^\d{1,12}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (!/(^|\.)semanticscholar\.org$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/author\/(?:[^/]+\/)?(\d{1,12})\/?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function s2Search(name: string) {
  const data = await s2("/author/search", {
    query: name,
    limit: "8",
    fields: "name,affiliations,paperCount,citationCount,hIndex",
  });
  return (data.data ?? []).map((a: any) => ({
    id: String(a.authorId),
    name: a.name,
    institution: (a.affiliations ?? []).slice(0, 2).join(" / "),
    papers: a.paperCount ?? 0,
    citations: a.citationCount ?? 0,
    hIndex: a.hIndex ?? null,
  }));
}

export async function s2Author(id: string) {
  const [author, papers] = await Promise.all([
    s2(`/author/${id}`, { fields: "name,url,paperCount,citationCount,hIndex" }),
    s2(`/author/${id}/papers`, { fields: "title,year,venue,citationCount", limit: "1000" }),
  ]);
  const works = (papers.data ?? [])
    .filter((w: any) => w.title)
    .map((w: any) => ({
      title: w.title as string,
      year: (w.year ?? null) as number | null,
      venue: (w.venue ?? "") as string,
      citations: (w.citationCount ?? 0) as number,
    }))
    .sort((a: { citations: number }, b: { citations: number }) => b.citations - a.citations);
  return {
    source: "Semantic Scholar",
    url: author.url || `https://www.semanticscholar.org/author/${id}`,
    author: {
      id,
      name: author.name,
      papers: author.paperCount ?? works.length,
      citations: author.citationCount ?? 0,
      hIndex: author.hIndex ?? null,
    },
    works,
  };
}
