import { crossSite, deviceCookie, forbidden, loginWithPassword, normalizeEmail, rememberDevice, sessionCookie } from "@/lib/server/auth";
import { readJson, TooLarge, tooLarge } from "@/lib/server/body";
import { clientIp, rate } from "@/lib/server/limits";

export const runtime = "nodejs";

/** 邮箱 + 密码登录（密码是用验证码登录后在账户页自己设的） */
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
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return Response.json({ error: "请输入邮箱和密码。" }, { status: 400 });
  // 同一个 IP 每小时最多试 60 次，挡住拿一批邮箱逐个试密码
  if (!rate(`pw:${clientIp(req)}`, 60, 3600_000)) {
    return Response.json({ error: "尝试次数太多，请稍后再试，或改用验证码登录。" }, { status: 429 });
  }
  const r = loginWithPassword(email, password);
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie(req, r.token));
  headers.append("Set-Cookie", deviceCookie(req, rememberDevice(req, r.userId)));
  return Response.json({ ok: true }, { headers });
}
