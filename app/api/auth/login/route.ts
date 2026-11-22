import { loginWithPassword, normalizeEmail, sessionCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

/** 邮箱 + 密码登录（密码是用验证码登录后在账户页自己设的） */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "请输入邮箱和密码。" }, { status: 400 });
  const r = loginWithPassword(email, password);
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, r.token) } });
}
