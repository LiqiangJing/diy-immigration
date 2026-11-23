import { crossSite, forbidden, normalizeEmail, requestCode } from "@/lib/server/auth";
import { readJson, TooLarge, tooLarge } from "@/lib/server/body";
import { clientIp } from "@/lib/server/limits";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (crossSite(req)) return forbidden();
  let body;
  try {
    body = await readJson(req, 4096);
  } catch (e) {
    if (e instanceof TooLarge) return tooLarge();
    throw e;
  }
  const email = normalizeEmail(body?.email);
  if (!email) return Response.json({ error: "请输入有效的邮箱地址。" }, { status: 400 });
  const r = await requestCode(email, clientIp(req));
  if (!r.ok) return Response.json({ error: r.error, sent: r.sent }, { status: 429 });
  return Response.json({ ok: true, devCode: r.devCode });
}
