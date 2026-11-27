import { readJson } from "@/lib/server/body";
import { getUser } from "@/lib/server/auth";
import { PACKS } from "@/lib/server/credits";
import { alipayConfigured, alipayMaxCny, createAlipayOrder } from "@/lib/server/alipay";

export const runtime = "nodejs";

/** 创建一笔支付宝订单，返回收银台跳转地址 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!alipayConfigured()) {
    return Response.json({ error: "支付宝充值还没有开通（服务端未配置 ALIPAY_*）。" }, { status: 503 });
  }
  const body = await readJson(req, 64 * 1024).catch(() => null);
  const max = alipayMaxCny();
  const pack = PACKS.find((p) => p.id === body?.pack);
  if (max && pack && pack.cny > max) {
    return Response.json({ error: `支付宝目前单笔最多 ¥${max}，这一档暂时付不了。请先买小额档位，可以多买几次。` }, { status: 400 });
  }
  const origin = process.env.APP_URL || req.headers.get("origin") || new URL(req.url).origin;
  try {
    const url = createAlipayOrder(user.id, String(body?.pack ?? ""), origin);
    if (!url) return Response.json({ error: "充值档位不存在。" }, { status: 400 });
    return Response.json({ url });
  } catch (e) {
    console.error("[alipay] 创建订单失败", e);
    return Response.json({ error: "创建支付宝订单失败，请检查密钥配置。" }, { status: 502 });
  }
}
