/**
 * 引用地图：引用过申请人论文的文章，作者单位分布在哪些国家和机构。
 * 数据来自 OpenAlex：先按标题找到每篇论文，再让 OpenAlex 按引用方作者单位所在的国家、机构分组计数。
 * 一篇引用文章的作者来自几个国家，就在几个国家各算一次。
 */

import type { CiteMap } from "../profile";

const BASE = "https://api.openalex.org";
const MAX_PAPERS = 12;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tail = (url: unknown) => String(url ?? "").split("/").pop() ?? "";

async function openalex(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/**
 * @param titles   申请人的论文标题，被引多的在前
 * @param lastName 申请人的姓（拼音 / 英文），用来在论文作者里认出本人，从而排除自引
 */
export async function buildCiteMap(titles: string[], lastName: string): Promise<CiteMap> {
  const ids: string[] = [];
  const authors = new Map<string, { n: number; name: string }>();
  for (const title of titles.slice(0, MAX_PAPERS)) {
    // 标题里的逗号、冒号等会被当成筛选语法，去掉
    const q = title.replace(/[,:|!&()"]+/g, " ").replace(/\s+/g, " ").trim();
    let data;
    try {
      data = await openalex("/works", {
        filter: `title.search:${q}`,
        per_page: "3",
        sort: "cited_by_count:desc",
        select: "id,title,authorships",
      });
    } catch (e) {
      if (e instanceof Error && (e.message === "429" || e.message === "403")) throw e;
      continue;
    }
    const want = norm(title);
    const hit = (data.results ?? []).find((w: any) => norm(w.title ?? "") === want);
    if (!hit) continue;
    ids.push(tail(hit.id));
    for (const a of hit.authorships ?? []) {
      const id = tail(a.author?.id);
      if (!id) continue;
      const old = authors.get(id);
      authors.set(id, { n: (old?.n ?? 0) + 1, name: a.author?.display_name ?? "" });
    }
  }
  if (!ids.length) throw new Error("NOT_FOUND");

  // 认出申请人本人：姓能对上、且出现在最多篇论文里的那位作者
  const ln = norm(lastName);
  const me = [...authors.entries()]
    .filter(([, v]) => ln.length > 1 && norm(v.name).split(" ").includes(ln))
    .sort((a, b) => b[1].n - a[1].n)[0];
  const self = me && me[1].n >= Math.max(1, Math.ceil(ids.length / 2)) ? me[0] : "";
  const filter = `cites:${ids.join("|")}${self ? `,authorships.author.id:!${self}` : ""}`;

  const [byCountry, byInst] = await Promise.all([
    openalex("/works", { filter, group_by: "authorships.institutions.country_code" }),
    openalex("/works", { filter, group_by: "authorships.institutions.id" }),
  ]);
  const real = (g: any) => g.key && !/unknown|null/i.test(String(g.key)) && g.count > 0;
  return {
    fetchedAt: Date.now(),
    papers: ids.length,
    citing: byCountry.meta?.count ?? 0,
    selfExcluded: Boolean(self),
    countries: (byCountry.group_by ?? [])
      .filter(real)
      .map((g: any) => ({ code: tail(g.key).toUpperCase(), name: g.key_display_name ?? "", count: g.count })),
    institutions: (byInst.group_by ?? [])
      .filter(real)
      .slice(0, 20)
      .map((g: any) => ({ name: g.key_display_name ?? "", count: g.count })),
  };
}
