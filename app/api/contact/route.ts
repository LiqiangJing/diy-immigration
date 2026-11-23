import { crossSite, forbidden, getUser, normalizeEmail } from "@/lib/server/auth";
import { readJson, TooLarge, tooLarge } from "@/lib/server/body";
import { db } from "@/lib/server/db";
import { mailConfigured, sendMail } from "@/lib/server/mail";

export const runtime = "nodejs";

// 简单的防刷：同一个 IP 每小时最多 5 条
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

/**
 * 「联系我们」：留言先存进数据库，再发邮件通知站长（CONTACT_EMAIL）。
 * 发信没配置或发送失败时留言仍然保存着，不会丢。
 */
export async function POST(req: Request) {
  if (crossSite(req)) return forbidden();
  let body;
  try {
    body = await readJson(req, 64 * 1024);
  } catch (e) {
    if (e instanceof TooLarge) return tooLarge("留言");
    throw e;
  }
  const user = getUser(req);
  const email = normalizeEmail(body?.email) ?? user?.email ?? null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!email) return Response.json({ error: "请填写有效的邮箱，方便我们回复你。" }, { status: 400 });
  if (message.length < 5) return Response.json({ error: "请把问题写得具体一些。" }, { status: 400 });
  if (message.length > 5000) return Response.json({ error: "内容太长了，请控制在 5000 字以内。" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (limited(ip)) return Response.json({ error: "提交得太频繁了，请稍后再试。" }, { status: 429 });

  const d = db();
  const { lastInsertRowid } = d
    .prepare("INSERT INTO contact_messages (user_id, email, message, created_at, emailed) VALUES (?, ?, ?, ?, 0)")
    .run(user?.id ?? null, email, message, Date.now());

  const to = process.env.CONTACT_EMAIL;
  if (to && mailConfigured()) {
    try {
      await sendMail({
        to,
        replyTo: email,
        subject: `[DIY Immigration] 新留言：${message.slice(0, 30).replace(/\s+/g, " ")}`,
        text: `来自：${email}${user ? "（已登录用户）" : "（未登录）"}\n时间：${new Date().toISOString()}\n\n${message}\n\n直接回复这封邮件即可回复对方。`,
      });
      d.prepare("UPDATE contact_messages SET emailed = 1 WHERE id = ?").run(lastInsertRowid);
    } catch (e) {
      console.error("[contact] 通知邮件发送失败", e);
    }
  }
  return Response.json({ ok: true });
}
