/**
 * 引用地图。
 *   POST /api/citemap {titles, lastName} → 引用方作者单位的国家、机构分布
 * 固定扣 CITEMAP_COST 个 credit；一篇论文都没找到时不扣。
 */

import { getUser } from "@/lib/server/auth";
import { buildCiteMap } from "@/lib/server/citeMap";
import { addCredits, CITEMAP_COST } from "@/lib/server/credits";
import { busy, hold } from "@/lib/server/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (user.credits < CITEMAP_COST) {
    return Response.json({ error: `Credit 余额不足（需要 ${CITEMAP_COST}），请先充值。` }, { status: 402 });
  }
  const body = await req.json().catch(() => null);
  const titles: string[] = Array.isArray(body?.titles)
    ? body.titles.filter((t: unknown): t is string => typeof t === "string" && t.trim().length >= 8).map((t: string) => t.trim().slice(0, 400)).slice(0, 12)
    : [];
  const lastName = typeof body?.lastName === "string" ? body.lastName.trim().slice(0, 60) : "";
  if (!titles.length) return Response.json({ error: "还没有论文列表，请先获取学术记录。" }, { status: 400 });

  const release = hold(`citemap:${user.id}`, 1);
  if (!release) return busy("上一次引用地图的生成");
  try {
    const map = await buildCiteMap(titles, lastName);
    addCredits(user.id, -CITEMAP_COST, "引用地图");
    return Response.json({ map, cost: CITEMAP_COST });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const msg =
      code === "NOT_FOUND"
        ? "OpenAlex 里没有找到你的论文（可能还没被收录，或者标题不一致）。"
        : code === "429" || code === "403"
          ? "学术数据库今天的访问额度用完了，请明天再试。"
          : "生成失败，请稍后再试。";
    return Response.json({ error: msg }, { status: code === "NOT_FOUND" ? 404 : 502 });
  } finally {
    release();
  }
}
