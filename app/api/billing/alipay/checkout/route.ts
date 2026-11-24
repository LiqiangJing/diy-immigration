import { readJson } from "@/lib/server/body";
import { getUser } from "@/lib/server/auth";
import { alipayConfigured, createAlipayOrder } from "@/lib/server/alipay";

export const runtime = "nodejs";

/** 创建一笔支付宝订单，返回收银台跳转地址 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!alipayConfigured()) {
    return Response.json({ error: "支付宝充值还没有开通（服务端未配置 ALIPAY_*）。" }, { status: 503 });
  }
  const body = await readJson(req, 64 * 1024).catch(() => null);
  const origin = process.env.APP_URL || req.headers.get("origin") || new URL(req.url).origin;
  const mobile = /Mobile|Android|iPhone|iPad/i.test(req.headers.get("user-agent") ?? "");
  try {
    const url = createAlipayOrder(user.id, String(body?.pack ?? ""), origin, mobile);
    if (!url) return Response.json({ error: "充值档位不存在。" }, { status: 400 });
    return Response.json({ url });
  } catch (e) {
    console.error("[alipay] 创建订单失败", e);
    return Response.json({ error: "创建支付宝订单失败，请检查密钥配置。" }, { status: 502 });
  }
}
