import Stripe from "stripe";
import { getUser } from "@/lib/server/auth";
import { PACKS } from "@/lib/server/credits";

export const runtime = "nodejs";

/** 创建一个 Stripe 结账页面（支持信用卡和支付宝），返回跳转地址 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "充值功能还没有开通（服务端未配置 STRIPE_SECRET_KEY）。" }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const pack = PACKS.find((p) => p.id === body?.pack);
  if (!pack) return Response.json({ error: "充值档位不存在。" }, { status: 400 });

  const origin = process.env.APP_URL || req.headers.get("origin") || new URL(req.url).origin;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // 只在 Stripe 后台已开通的付款方式里筛选；支付宝需要先在 Dashboard 里启用
      allowed_payment_method_types: ["card", "alipay"],
      customer_email: user.email,
      client_reference_id: user.id,
      metadata: { user_id: user.id, pack: pack.id },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: pack.usd * 100,
            product_data: { name: `DIY Immigration ${pack.credits} credits` },
          },
        },
      ],
      success_url: `${origin}/?paid=1`,
      cancel_url: `${origin}/?paid=0`,
    });
    return Response.json({ url: session.url });
  } catch (e) {
    console.error("[billing] 创建结账失败", e);
    return Response.json({ error: "创建支付页面失败，请稍后再试。" }, { status: 502 });
  }
}
