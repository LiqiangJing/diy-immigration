import { normalizeEmail, sessionCookie, verifyCode } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "请输入 6 位数字验证码。" }, { status: 400 });
  }
  const r = verifyCode(email, code);
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, r.token) } });
}
