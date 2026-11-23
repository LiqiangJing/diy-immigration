/**
 * 用户上传的文件。只能访问自己的。
 *   PUT    /api/files/<id>  请求体是文件内容
 *   GET    /api/files/<id>
 *   DELETE /api/files/<id>
 */

import { getUser } from "@/lib/server/auth";
import { readBytes, TooLarge } from "@/lib/server/body";
import { deleteFile, MAX_FILE, readFile, saveFile, validFileId } from "@/lib/server/userData";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

async function auth(req: Request, ctx: Ctx) {
  const user = getUser(req);
  const { id } = await ctx.params;
  if (!user) return { error: Response.json({ error: "请先登录。" }, { status: 401 }) };
  if (!validFileId(id)) return { error: Response.json({ error: "文件 id 不对。" }, { status: 400 }) };
  return { user, id };
}

export async function PUT(req: Request, ctx: Ctx) {
  const a = await auth(req, ctx);
  if (a.error) return a.error;
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(req, MAX_FILE);
  } catch (e) {
    if (e instanceof TooLarge) return Response.json({ error: "文件超过 20 MB。" }, { status: 413 });
    throw e;
  }
  if (bytes.length === 0) return Response.json({ error: "文件是空的。" }, { status: 413 });
  if (saveFile(a.user.id, a.id, bytes) === "full") {
    return Response.json({ error: "云端空间已满（每个账号 500 MB），这个文件只保存在当前浏览器里。" }, { status: 507 });
  }
  return Response.json({ ok: true });
}

export async function GET(req: Request, ctx: Ctx) {
  const a = await auth(req, ctx);
  if (a.error) return a.error;
  const buf = readFile(a.user.id, a.id);
  if (!buf) return Response.json({ error: "没有这个文件。" }, { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await auth(req, ctx);
  if (a.error) return a.error;
  deleteFile(a.user.id, a.id);
  return Response.json({ ok: true });
}
