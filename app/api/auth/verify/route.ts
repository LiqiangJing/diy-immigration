import {
  clearNonce,
  crossSite,
  deviceCookie,
  forbidden,
  nonceFrom,
  normalizeEmail,
  rememberDevice,
  sessionCookie,
  verifyCode,
} from "@/lib/server/auth";
import { clientIp, rate } from "@/lib/server/limits";
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
  // 同一个 IP 十分钟最多试 60 次：正常人用不到，挡住拿脚本不停地试。
  // 拿不到 IP（没经过反向代理，只有本地测试会这样）时不限：那样所有人会被算成同一个
  const ip = clientIp(req);
  if (ip !== "unknown" && !rate(`verify:${ip}`, 60, 600_000)) {
    return Response.json({ error: "尝试次数太多，请过几分钟再试。" }, { status: 429 });
  }
  const r = verifyCode(email, code, nonceFrom(req));
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie(req, r.token));
  headers.append("Set-Cookie", deviceCookie(req, rememberDevice(req, r.userId)));
  headers.append("Set-Cookie", clearNonce(req));
  return Response.json({ ok: true }, { headers });
}
