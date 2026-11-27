import { getUser } from "@/lib/server/auth";
import { history, BASE_PACK, LOYALTY, LOYALTY_CYCLE, loyaltyPaid, PACKS, NOTABLE_MIN_BALANCE, SCHOLAR_COST } from "@/lib/server/credits";
import { alipayConfigured, alipayMaxCny, alipaySandbox } from "@/lib/server/alipay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 当前登录用户、余额、最近的 credit 流水，以及充值档位 */
export async function GET(req: Request) {
  const user = getUser(req);
  return Response.json(
    {
      user: user && { email: user.email, credits: user.credits, hasPassword: user.hasPassword },
      history: user ? history(user.id) : [],
      packs: PACKS,
      scholarCost: SCHOLAR_COST,
      notableMin: NOTABLE_MIN_BALANCE,
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
      alipayEnabled: alipayConfigured(),
      alipaySandbox: alipaySandbox(),
      alipayMaxCny: alipayMaxCny(),
      // 小额档累计赠送：规则，以及这个用户已经付清了几笔
      loyalty: { pack: BASE_PACK.id, tiers: LOYALTY, cycle: LOYALTY_CYCLE, paid: user ? loyaltyPaid(user.id) : 0 },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
