/**
 * 下载一篇论文的公开全文 PDF。
 *   POST /api/paper {title, url?} → {name, data(base64), size, source}
 * 优先正式发表的版本，没有公开的正式版时给 arXiv 预印本（version = "preprint"）。
 * 只能拿到开放获取的版本；拿不到时返回 404，由用户自己下载后上传。不扣 credit。
 */

import { getUser } from "@/lib/server/auth";
import { fetchPaperPdf } from "@/lib/server/papers";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const user = getUser(req);
  if (!user) return Response.json({ error: "请先登录。" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 500) : "";
  const url = typeof body?.url === "string" ? body.url.trim().slice(0, 500) : undefined;
  if (title.length < 8) return Response.json({ error: "论文标题太短。" }, { status: 400 });

  try {
    const r = await fetchPaperPdf(title, url);
    if (r === null) return Response.json({ error: "没有找到这篇论文。" }, { status: 404 });
    if (r === "closed") {
      return Response.json({ error: "这篇论文没有公开的 PDF，需要你自己下载后上传。", closed: true }, { status: 404 });
    }
    return Response.json({
      title: r.title,
      source: r.source,
      version: r.version,
      venue: r.venue,
      size: r.bytes.length,
      data: Buffer.from(r.bytes).toString("base64"),
    });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    return Response.json(
      { error: code === "429" ? "现在访问的人太多，请过一会儿再试。" : "下载失败，请稍后再试。" },
      { status: 502 },
    );
  }
}
