import { getUser, setPassword } from "@/lib/server/auth";
import { readJson, TooLarge, tooLarge } from "@/lib/server/body";

export const runtime = "nodejs";

/** 已登录的用户设置或修改自己的密码 */
export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  let body;
  try {
    body = await readJson(req, 4096);
  } catch (e) {
    if (e instanceof TooLarge) return tooLarge();
    throw e;
  }
  const r = setPassword(req, user.id, typeof body?.password === "string" ? body.password : "");
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true });
}
