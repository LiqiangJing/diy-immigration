/** GET /api/files → {ids}：这个用户已经存到服务器上的文件 */

import { getUser } from "@/lib/server/auth";
import { listFiles } from "@/lib/server/userData";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  return Response.json({ ids: listFiles(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
