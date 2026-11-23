/**
 * 用户数据同步。
 *   GET /api/data                  → {items: {key: {value, rev}}}
 *   PUT /api/data {key, value, rev} → {rev}；版本对不上时 409 {value, rev}
 */

import { getUser } from "@/lib/server/auth";
import { readJson, TooLarge } from "@/lib/server/body";
import { DATA_KEYS, MAX_VALUE, readAll, writeOne } from "@/lib/server/userData";
import type { DataKey } from "@/lib/server/userData";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  return Response.json({ items: readAll(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  let body;
  try {
    // 上限按字节算，比字数上限宽：中文一个字占三个字节
    body = await readJson(req, MAX_VALUE * 3 + 4096);
  } catch (e) {
    if (e instanceof TooLarge) return Response.json({ error: "数据太大，保存不了。" }, { status: 413 });
    throw e;
  }
  const key = body?.key as DataKey;
  const value = body?.value;
  const rev = body?.rev;
  if (!DATA_KEYS.includes(key) || typeof value !== "string" || !Number.isInteger(rev) || rev < 0) {
    return Response.json({ error: "请求格式不对。" }, { status: 400 });
  }
  if (value.length > MAX_VALUE) return Response.json({ error: "数据太大，保存不了。" }, { status: 413 });
  try {
    JSON.parse(value);
  } catch {
    return Response.json({ error: "请求格式不对。" }, { status: 400 });
  }
  const r = writeOne(user.id, key, value, rev);
  if (!r.ok) return Response.json({ value: r.value, rev: r.rev }, { status: 409 });
  return Response.json({ rev: r.rev });
}
