import { crossSite, forbidden, normalizeEmail, sessionCookie, verifyCode } from "@/lib/server/auth";
import { readJson, TooLarge, tooLarge } from "@/lib/server/body";

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
  const code = typeof body?.code === "string" || typeof body?.code === "number" ? String(body.code).trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "请输入 6 位数字验证码。" }, { status: 400 });
  }
  const r = verifyCode(email, code);
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, r.token) } });
}
