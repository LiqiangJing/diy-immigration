import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { grantSignupBonus } from "./credits";
import { mailConfigured, sendMail } from "./mail";

/** 邮箱验证码登录 + 基于 cookie 的会话 */

const COOKIE = "diy_session";
const CODE_TTL = 10 * 60_000;
const RESEND_AFTER = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL = 30 * 24 * 3600_000;

export type User = { id: string; email: string; credits: number; hasPassword: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 250) return null; // 先看长度：超长的输入不拿去做正则匹配
  const email = raw.trim().toLowerCase();
  if (email.length > 200) return null;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@") || /\s/.test(email)) return null;
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && domain.length - dot - 1 >= 2 ? email : null;
}

/**
 * 是不是别的网站发起的请求。浏览器会在请求里带上 Sec-Fetch-Site；别的网站让用户的浏览器来访问我们的接口时
 * （比如诱导点一个链接去触发扣费的查询，或者偷偷提交一个登录表单），它的值是 cross-site。
 * 没有这个头的（老浏览器、支付平台的服务器回调）不算。
 */
export function crossSite(req: Request): boolean {
  const s = req.headers.get("sec-fetch-site");
  return s !== null && s !== "same-origin" && s !== "none";
}
export const forbidden = () => Response.json({ error: "请从本站页面操作。" }, { status: 403 });

// 没配发信服务时把验证码直接显示在页面上，只给本地测试用：正式环境必须显式打开才行，免得漏配发信时任何人都能登录别人的账号
const devCodeAllowed = () => process.env.NODE_ENV !== "production" || process.env.DEV_LOGIN_CODE === "1";

// 发验证码的次数上限。一个验证码最多试 5 次，所以这也限制了别人能猜多少次
const HOUR = 3600_000;
const LIMITS = { emailHour: 5, emailDay: 12, ipHour: 30, ipDay: 100, allHour: 300 }; // 学校、公司常常很多人共用一个出口 IP

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
export async function requestCode(
  email: string,
  ip = "unknown",
): Promise<{ ok: true; devCode?: string } | { ok: false; error: string; sent?: boolean }> {
  const d = db();
  const now = Date.now();
  const prev = d.prepare("SELECT sent_at, expires_at FROM login_codes WHERE email = ?").get(email) as
    | { sent_at: number; expires_at: number }
    | undefined;
  if (prev && now - prev.sent_at < RESEND_AFTER) {
    // sent：刚发的那个还能用，页面可以直接让用户去输
    return { ok: false, error: "验证码刚刚发过，请查收邮件；一分钟后才能重新发送。", sent: prev.expires_at > now };
  }
  if (!mailConfigured() && !devCodeAllowed()) {
    console.error("[auth] 没有配置发信服务（SMTP_HOST），发不了验证码");
    return { ok: false, error: "登录邮件暂时发不出去，请稍后再试或联系我们。" };
  }
  const count = (where: string, arg: string | null, since: number) =>
    (
      d.prepare(`SELECT COUNT(*) AS n FROM code_requests WHERE at >= ?${where}`).get(...(arg === null ? [since] : [since, arg])) as {
        n: number;
      }
    ).n;
  if (count(" AND email = ?", email, now - HOUR) >= LIMITS.emailHour || count(" AND email = ?", email, now - 24 * HOUR) >= LIMITS.emailDay) {
    return { ok: false, error: "这个邮箱要验证码的次数太多了，请过一段时间再试。设过密码的话可以用密码登录。" };
  }
  if (
    count(" AND ip = ?", ip, now - HOUR) >= LIMITS.ipHour ||
    count(" AND ip = ?", ip, now - 24 * HOUR) >= LIMITS.ipDay ||
    count("", null, now - HOUR) >= LIMITS.allHour
  ) {
    return { ok: false, error: "现在要验证码的人太多，请稍后再试。" };
  }
  d.prepare("INSERT INTO code_requests (email, ip, at) VALUES (?, ?, ?)").run(email, ip, now);
  d.prepare("DELETE FROM code_requests WHERE at < ?").run(now - 48 * HOUR);
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
  return { token: newSession(user.id) };
}

function newSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  db()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sha(token), userId, Date.now() + SESSION_TTL);
  return token;
}

/* ---------- 密码（可选）：用验证码注册后可以设一个，之后用邮箱 + 密码登录；忘了就用验证码登录再重设 ---------- */

export const PW_MIN = 8;
const PW_MAX = 200;
const PW_MAX_FAILS = 5;
const PW_LOCK = 15 * 60_000;

function hashPassword(pw: string, salt = randomBytes(16).toString("hex")): string {
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}

function checkPassword(pw: string, stored: string): boolean {
  const [kind, salt] = stored.split("$");
  return kind === "scrypt" && Boolean(salt) && same(hashPassword(pw, salt), stored);
}

/** 设置或修改密码。为了让被别人拿到的旧登录失效，除当前这个之外的登录状态都会退出。 */
export function setPassword(req: Request, userId: string, pw: string): { ok: true } | { error: string } {
  if (pw.length < PW_MIN) return { error: `密码至少 ${PW_MIN} 位。` };
  if (pw.length > PW_MAX) return { error: "密码太长了。" };
  const d = db();
  d.prepare("UPDATE users SET password_hash = ?, pw_fails = 0, pw_locked_until = 0 WHERE id = ?").run(hashPassword(pw), userId);
  d.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(userId, sha(tokenFrom(req) ?? ""));
  return { ok: true };
}

/** 邮箱 + 密码登录。连续输错几次会锁一段时间；不区分「没有这个账号」「没设密码」「密码不对」，免得被人用来试探邮箱。 */
export function loginWithPassword(email: string, pw: string): { token: string } | { error: string } {
  const d = db();
  const u = d.prepare("SELECT id, password_hash, pw_fails, pw_locked_until FROM users WHERE email = ?").get(email) as
    | { id: string; password_hash: string | null; pw_fails: number; pw_locked_until: number }
    | undefined;
  // 账号不存在、没设密码、密码不对、被锁住，都是同一句话、花同样的时间，免得被人拿来试探哪些邮箱注册过
  const wrong = { error: "邮箱或密码不对。连续输错 5 次会锁定 15 分钟；没设过密码或忘记了的话，请改用验证码登录。" };
  const locked = Boolean(u && u.pw_locked_until > Date.now());
  const match = checkPassword(pw.slice(0, PW_MAX), u?.password_hash ?? DUMMY_HASH) && pw.length <= PW_MAX;
  if (!u || !u.password_hash || locked || !match) {
    if (u?.password_hash && !locked) {
      const fails = u.pw_fails + 1;
      d.prepare("UPDATE users SET pw_fails = ?, pw_locked_until = ? WHERE id = ?").run(
        fails >= PW_MAX_FAILS ? 0 : fails,
        fails >= PW_MAX_FAILS ? Date.now() + PW_LOCK : 0,
        u.id,
      );
    }
    return wrong;
  }
  d.prepare("UPDATE users SET pw_fails = 0, pw_locked_until = 0 WHERE id = ?").run(u.id);
  return { token: newSession(u.id) };
}

const DUMMY_HASH = hashPassword("not-a-real-password", "0".repeat(32));

function tokenFrom(req: Request): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

export function getUser(req: Request): User | null {
  if (crossSite(req)) return null;
  const token = tokenFrom(req);
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.credits, u.password_hash IS NOT NULL AS hasPassword
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha(token), Date.now()) as (Omit<User, "hasPassword"> & { hasPassword: number }) | undefined;
  if (!row) return null;
  // 页面会带上它以为自己登录的是哪个账号。同一个浏览器的另一个标签页换了账号之后，旧标签页的请求对不上，
  // 这里就当作没登录，免得把一个人的数据存进、把费用记到另一个人的账号上
  const expect = req.headers.get("x-account");
  if (expect && expect.trim().toLowerCase() !== row.email) return null;
  return { ...row, hasPassword: Boolean(row.hasPassword) };
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
