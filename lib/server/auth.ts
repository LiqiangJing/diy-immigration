import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { grantSignupBonus } from "./credits";
import { mailConfigured, sendMail } from "./mail";

/** 邮箱验证码登录 + 基于 cookie 的会话 */

const COOKIE = "diy_session";
const CODE_TTL = 10 * 60_000;
const RESEND_AFTER = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL = 30 * 24 * 3600_000;

export type User = { id: string; email: string; credits: number };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 200 ? email : null;
}

const sendCode = (email: string, code: string) =>
  sendMail({
    to: email,
    subject: `${code} 是你的 DIY Immigration 登录验证码`,
    text: `你的登录验证码是 ${code}，10 分钟内有效。\n\n如果不是你本人在登录，忽略这封邮件即可。`,
  });

/**
 * 生成并发送验证码。
 * 没有配置发信服务（SMTP_HOST）时不发邮件，而是把验证码直接返回给页面显示——只用于本地测试。
 */
export async function requestCode(email: string): Promise<{ ok: true; devCode?: string } | { ok: false; error: string }> {
  const d = db();
  const now = Date.now();
  const prev = d.prepare("SELECT sent_at FROM login_codes WHERE email = ?").get(email) as { sent_at: number } | undefined;
  if (prev && now - prev.sent_at < RESEND_AFTER) {
    return { ok: false, error: "验证码刚刚发过，请一分钟后再试。" };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  d.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
       sent_at = excluded.sent_at, attempts = 0`,
  ).run(email, sha(email + code), now + CODE_TTL, now);

  if (!mailConfigured()) return { ok: true, devCode: code };
  try {
    await sendCode(email, code);
    return { ok: true };
  } catch (e) {
    console.error("[auth] 发送验证码失败", e);
    d.prepare("DELETE FROM login_codes WHERE email = ?").run(email);
    return { ok: false, error: "验证码邮件发送失败，请稍后再试。" };
  }
}

/** 校验验证码；成功则返回会话 token（新邮箱会自动注册；每天前若干名新用户有赠送 credit） */
export function verifyCode(email: string, code: string): { token: string } | { error: string } {
  const d = db();
  const row = d.prepare("SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?").get(email) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row || row.expires_at < Date.now()) return { error: "验证码已过期，请重新获取。" };
  if (row.attempts >= MAX_ATTEMPTS) return { error: "尝试次数过多，请重新获取验证码。" };
  if (!same(row.code_hash, sha(email + code))) {
    d.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").run(email);
    return { error: "验证码不对。" };
  }
  d.prepare("DELETE FROM login_codes WHERE email = ?").run(email);

  let user = d.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) {
    user = { id: randomBytes(12).toString("hex") };
    d.prepare("INSERT INTO users (id, email, credits, created_at) VALUES (?, ?, 0, ?)").run(user.id, email, Date.now());
    grantSignupBonus(user.id);
  }
  const token = randomBytes(32).toString("hex");
  d.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    sha(token),
    user.id,
    Date.now() + SESSION_TTL,
  );
  return { token };
}

function tokenFrom(req: Request): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export function getUser(req: Request): User | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.credits FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha(token), Date.now()) as User | undefined;
  return row ?? null;
}

export function logout(req: Request) {
  const token = tokenFrom(req);
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}

const isHttps = (req: Request) =>
  (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";

export const sessionCookie = (req: Request, token: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${isHttps(req) ? "; Secure" : ""}`;

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
