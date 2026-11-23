/**
 * 学术数据查询。
 *   GET  /api/scholar?gs=链接     → 读取用户填的 Google Scholar 主页
 *   POST /api/scholar {html}      → 解析用户另存的 Google Scholar 网页（服务器被 Google 拦截时用）
 *   GET  /api/scholar?s2=链接或ID → Semantic Scholar 里该作者的统计数据和论文列表
 *   GET  /api/scholar?s2q=姓名    → 在 Semantic Scholar 里按姓名找候选作者
 *   GET  /api/scholar?q=姓名      → 在 OpenAlex 里按姓名找候选作者
 *   GET  /api/scholar?id=A123...  → OpenAlex 里该作者的统计数据和论文列表
 * 不配置 OPENALEX_API_KEY 也能用，但每天的免费额度很小。
 */

import { getUser } from "@/lib/server/auth";
import { addCredits, SCHOLAR_COST } from "@/lib/server/credits";
import { readJson, TooLarge } from "@/lib/server/body";
import { busy, hold, rate } from "@/lib/server/limits";
import { fetchScholar, parseScholarHtml, scholarUserId } from "@/lib/server/scholar";
import { s2Author, s2AuthorId, s2Search } from "@/lib/server/semanticScholar";

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
  const gs = searchParams.get("gs")?.trim();
  const s2 = searchParams.get("s2")?.trim();
  const s2q = searchParams.get("s2q")?.trim().slice(0, 100);

  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if ((id || gs || s2) && user.credits < SCHOLAR_COST) {
    return Response.json({ error: `Credit 余额不足（需要 ${SCHOLAR_COST}），请先充值。` }, { status: 402 });
  }
  // 按姓名查找不收费，限一下次数；收费的获取同一时间只能有一个在进行
  if (!(id || gs || s2) && !rate(`lookup:${user.id}`, 40, 600_000)) {
    return Response.json({ error: "查找得太频繁了，请过几分钟再试。" }, { status: 429 });
  }
  const release = id || gs || s2 ? hold(`scholar-paid:${user.id}`, 1) : hold(`scholar-free:${user.id}`, 3);
  if (!release) return busy();
  try {
    return await lookup({ q, id, gs, s2, s2q, user });
  } finally {
    release();
  }
}

type Lookup = { q?: string; id?: string; gs?: string; s2?: string; s2q?: string; user: { id: string } };

async function lookup({ q, id, gs, s2, s2q, user }: Lookup): Promise<Response> {

  if (gs) {
    const userId = scholarUserId(gs);
    if (!userId) return Response.json({ error: "这不是有效的 Google Scholar 个人主页链接。" }, { status: 400 });
    const result = await fetchScholar(userId);
    if (!result || result === "blocked") {
      return Response.json(
        { error: "Google 拦截了服务器的访问，没能直接读到你的主页。", blocked: true },
        { status: 502 },
      );
    }
    addCredits(user.id, -SCHOLAR_COST, "获取学术数据");
    return Response.json({ ...result, url: `https://scholar.google.com/citations?user=${userId}` });
  }

  if (s2 || s2q) {
    try {
      if (s2q) return Response.json({ candidates: await s2Search(s2q) });
      const authorId = s2AuthorId(s2!);
      if (!authorId) {
        return Response.json({ error: "这不是有效的 Semantic Scholar 作者主页链接。" }, { status: 400 });
      }
      const result = await s2Author(authorId);
      addCredits(user.id, -SCHOLAR_COST, "获取学术数据");
      return Response.json(result);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const msg =
        code === "404"
          ? "Semantic Scholar 里没有找到这个作者，请检查链接。"
          : code === "429"
            ? "Semantic Scholar 现在访问的人太多，请过一会儿再试。"
            : "Semantic Scholar 暂时访问不了，请稍后再试。";
      return Response.json({ error: msg }, { status: 502 });
    }
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
        source: "OpenAlex",
        url: `https://openalex.org/${id}`,
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

/** 解析用户自己在浏览器里另存的 Google Scholar 主页 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (user.credits < SCHOLAR_COST) {
    return Response.json({ error: `Credit 余额不足（需要 ${SCHOLAR_COST}），请先充值。` }, { status: 402 });
  }
  let body;
  try {
    body = await readJson(req, 9_000_000);
  } catch (e) {
    if (e instanceof TooLarge) return Response.json({ error: "文件太大，请确认上传的是另存的 Scholar 主页（.html）。" }, { status: 400 });
    throw e;
  }
  const html = typeof body?.html === "string" ? body.html : "";
  if (!html || html.length > 3_000_000) {
    return Response.json({ error: "文件为空或太大，请确认上传的是另存的 Scholar 主页（.html）。" }, { status: 400 });
  }
  const result = parseScholarHtml(html);
  if (!result) {
    return Response.json(
      { error: "没能从这个文件里读出论文列表。请确认是在你的 Google Scholar 个人主页上另存的网页。" },
      { status: 400 },
    );
  }
  // 主页默认只显示前 20 篇。保存下来的文件里不到 100 篇、而「展开」按钮还能点，说明没存全：不收费，让用户按说明重新保存
  if (result.author.more && result.works.length < 100) {
    return Response.json(
      {
        error: `这个文件里只有 ${result.works.length} 篇论文，你的主页上还有更多没显示出来。请用上面第 1 步的链接打开主页（一页显示 100 篇）再保存一次。`,
        incomplete: true,
      },
      { status: 400 },
    );
  }
  addCredits(user.id, -SCHOLAR_COST, "获取学术数据");
  return Response.json(result);
}
