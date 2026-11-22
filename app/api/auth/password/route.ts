import { getUser, setPassword } from "@/lib/server/auth";

export const runtime = "nodejs";

/** 已登录的用户设置或修改自己的密码 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = setPassword(req, user.id, typeof body?.password === "string" ? body.password : "");
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true });
}
