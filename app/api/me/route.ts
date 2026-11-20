import { getUser } from "@/lib/server/auth";
import { history, PACKS, SCHOLAR_COST } from "@/lib/server/credits";
import { alipayConfigured, alipaySandbox } from "@/lib/server/alipay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 当前登录用户、余额、最近的 credit 流水，以及充值档位 */
export async function GET(req: Request) {
  const user = getUser(req);
  return Response.json(
    {
      user: user && { email: user.email, credits: user.credits },
      history: user ? history(user.id) : [],
      packs: PACKS,
      scholarCost: SCHOLAR_COST,
      stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
      alipayEnabled: alipayConfigured(),
      alipaySandbox: alipaySandbox(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
