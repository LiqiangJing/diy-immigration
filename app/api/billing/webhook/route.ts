import Stripe from "stripe";
import { addCredits, PACKS } from "@/lib/server/credits";

export const runtime = "nodejs";

/**
 * Stripe 在付款成功后回调这里，由它给用户加 credit。
 * 只信任带有效签名的请求；同一笔结账只入账一次。
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!secret || !key) return new Response("not configured", { status: 503 });

  const payload = await req.text();
  let event: Stripe.Event;
  try {
    event = await new Stripe(key).webhooks.constructEventAsync(
      payload,
      req.headers.get("stripe-signature") ?? "",
      secret,
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object;
    const pack = PACKS.find((p) => p.id === session.metadata?.pack);
    const userId = session.metadata?.user_id;
    // 异步到账的付款方式在 completed 时可能还没付清，等 async_payment_succeeded 再入账
    if (session.payment_status === "paid" && pack && userId && session.amount_total === pack.usd * 100) {
      addCredits(userId, pack.credits, `充值 $${pack.usd}`, `stripe:${session.id}`);
    }
  }
  return Response.json({ received: true });
}
