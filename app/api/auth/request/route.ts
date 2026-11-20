import { normalizeEmail, requestCode } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return Response.json({ error: "请输入有效的邮箱地址。" }, { status: 400 });
  const r = await requestCode(email);
  if (!r.ok) return Response.json({ error: r.error }, { status: 429 });
  return Response.json({ ok: true, devCode: r.devCode });
}
