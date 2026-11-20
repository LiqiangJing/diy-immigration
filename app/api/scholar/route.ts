/**
 * 学术数据查询，数据来自 OpenAlex（https://openalex.org）。
 *   GET /api/scholar?q=姓名      → 候选作者列表
 *   GET /api/scholar?id=A123...  → 该作者的统计数据和论文列表
 * 不配置 OPENALEX_API_KEY 也能用，但每天的免费额度很小。
 */

import { getUser } from "@/lib/server/auth";
import { addCredits, SCHOLAR_COST } from "@/lib/server/credits";

export const runtime = "nodejs";

const BASE = "https://api.openalex.org";

async function openalex(path: string, params: Record<string, string>) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const shortId = (url: string) => String(url ?? "").split("/").pop() ?? "";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim().slice(0, 100);
  const id = searchParams.get("id")?.trim();

  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (id && user.credits < SCHOLAR_COST) {
    return Response.json({ error: `Credit 余额不足（需要 ${SCHOLAR_COST}），请先充值。` }, { status: 402 });
  }

  try {
    if (id) {
      if (!/^A\d+$/.test(id)) return Response.json({ error: "作者 ID 格式不对" }, { status: 400 });
      const [author, works] = await Promise.all([
        openalex(`/authors/${id}`, { select: "id,display_name,works_count,cited_by_count,summary_stats" }),
        openalex("/works", {
          filter: `author.id:${id}`,
          sort: "cited_by_count:desc",
          "per-page": "200",
          select: "id,title,publication_year,cited_by_count,primary_location,type",
        }),
      ]);
      addCredits(user.id, -SCHOLAR_COST, "获取学术数据");
      return Response.json({
        author: {
          id,
          name: author.display_name,
          papers: author.works_count,
          citations: author.cited_by_count,
          hIndex: author.summary_stats?.h_index ?? null,
        },
        works: (works.results ?? [])
          .filter((w: any) => w.title)
          .map((w: any) => ({
            title: w.title,
            year: w.publication_year ?? null,
            venue: w.primary_location?.source?.display_name ?? "",
            citations: w.cited_by_count ?? 0,
          })),
      });
    }

    if (q) {
      const data = await openalex("/authors", {
        search: q,
        "per-page": "8",
        select: "id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions",
      });
      return Response.json({
        candidates: (data.results ?? []).map((a: any) => ({
          id: shortId(a.id),
          name: a.display_name,
          institution: (a.last_known_institutions ?? []).map((i: any) => i.display_name).slice(0, 2).join(" / "),
          papers: a.works_count,
          citations: a.cited_by_count,
          hIndex: a.summary_stats?.h_index ?? null,
        })),
      });
    }

    return Response.json({ error: "缺少查询参数" }, { status: 400 });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const msg =
      code === "429" || code === "403"
        ? "学术数据接口今天的免费额度用完了，请稍后再试，或在服务端配置 OPENALEX_API_KEY。"
        : "学术数据接口暂时访问不了，请稍后再试。";
    return Response.json({ error: msg }, { status: 502 });
  }
}
