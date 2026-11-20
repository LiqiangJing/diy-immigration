/**
 * 重要引用分析。
 *   POST /api/citations {title} → 这篇论文被别人怎么引用的：每条引用的原文、分类和重要程度
 * 按模型的实际用量扣 credit（算法和聊天一样，但加价倍数单独设得低一些）；没找到论文或没有可分析的引用时不扣。
 */

import { getUser } from "@/lib/server/auth";
import { analyzeCitations } from "@/lib/server/citations";
import { addCredits, chatCost, NOTABLE_MARKUP, NOTABLE_MIN_BALANCE } from "@/lib/server/credits";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (user.credits < NOTABLE_MIN_BALANCE) {
    return Response.json(
      { error: `Credit 余额不足（分析一篇论文的引用需要至少 ${NOTABLE_MIN_BALANCE}），请先充值。` },
      { status: 402 },
    );
  }
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 500) : "";
  if (title.length < 8) return Response.json({ error: "论文标题太短。" }, { status: 400 });

  try {
    const { analysis, usage, price } = await analyzeCitations(title, req.signal);
    let cost = 0;
    if (price) {
      cost = chatCost(usage, price, NOTABLE_MARKUP);
      addCredits(user.id, -cost, "重要引用分析");
    }
    return Response.json({ analysis, cost });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const msg =
      code === "NOT_FOUND"
        ? "Semantic Scholar 里没有找到这篇论文（可能还没被收录，或者标题和它收录的不一致）。"
        : code === "429"
          ? "Semantic Scholar 现在访问的人太多，请过一会儿再试。"
          : /^\d+$/.test(code)
            ? "Semantic Scholar 暂时访问不了，请稍后再试。"
            : code || "分析失败，请稍后再试。";
    return Response.json({ error: msg }, { status: code === "NOT_FOUND" ? 404 : 502 });
  }
}
