import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { envNumber, grantSignupBonus } from "./credits";
import { mailConfigured, sendMail } from "./mail";

/** 邮箱验证码登录 + 基于 cookie 的会话 */

const COOKIE = "diy_session";
const NONCE = "diy_login"; // 申请验证码的那个浏览器
const DEVICE = "diy_device"; // 成功登录过的浏览器
const DEVICE_TTL = 365 * 24 * 3600_000;
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

/*
 * 发验证码的次数上限。有两条通道，分开计数：
 *   known  这个浏览器以前成功登录过这个账号（带着 diy_device）。别人拿不到这个 cookie，所以挤不掉它的名额
 *   anon   其余的。同一个邮箱 + 同一个 IP 的上限比这个邮箱的总上限小：一台机器不停地替别人的邮箱要验证码，
 *          用不完那个邮箱的全部名额，邮箱的主人在自己的网络上仍然要得到
 * 一个验证码最多试 5 次，所以这些上限也限制了别人能猜多少次。
 * allDay 还要顾及发信邮箱每天能发多少封（Gmail 约 500）；换了发信服务可以用 LOGIN_CODES_PER_DAY 调大。
 */
const HOUR = 3600_000;
const LIMITS = {
  pairHour: 4,
  pairDay: 8,
  emailHour: 8,
  emailDay: 16,
  ipHour: 30, // 学校、公司常常很多人共用一个出口 IP
  ipDay: 100,
  allHour: 300,
  allDay: envNumber("LOGIN_CODES_PER_DAY", 400) || 400,
  knownHour: 5,
  knownDay: 12,
};

const sendCode = (email: string, code: string) =>
  sendMail({
    to: email,
    subject: `${code} 是你的 DIY Immigration 登录验证码`,
    text: `你的登录验证码是 ${code}，10 分钟内有效。请回到刚才申请验证码的那个浏览器页面里输入（换一个浏览器或设备输入无效）。\n\n如果不是你本人在登录，忽略这封邮件即可：对方拿不到这个验证码就登录不了。请不要把验证码告诉任何人。`,
  });

// 全站的发送量到了上限：很可能是有人在刷。给站长发一封邮件（每天最多一封），不然没人知道
let alertedOn = "";
function alertOwner(what: string) {
  console.error(`[auth] ${what}`);
  const day = new Date().toISOString().slice(0, 10);
  const to = process.env.CONTACT_EMAIL;
  if (alertedOn === day || !to || !mailConfigured()) return;
  alertedOn = day;
  sendMail({
    to,
    subject: "[DIY Immigration] 登录验证码的发送量到上限了",
    text: `${what}\n\n在这之后，没在本站登录过的浏览器暂时要不到验证码（登录过的浏览器和密码登录不受影响）。\n如果不是正常的注册高峰，多半是有人在刷发验证码的接口，可以到服务器上看 code_requests 表里是哪些 IP。`,
  }).catch((e) => console.error("[auth] 提醒邮件发送失败", e));
}

type CodeRow = { nonce_hash: string; email: string; expires_at: number; sent_at: number; attempts: number; code_hash: string };

const codeRow = (email: string, nonce: string | null) =>
  nonce
    ? (db().prepare("SELECT * FROM login_codes WHERE nonce_hash = ? AND email = ?").get(sha(nonce), email) as CodeRow | undefined)
    : undefined;

const isKnown = (email: string, device: string | null) =>
  Boolean(
    device &&
      db()
        .prepare("SELECT 1 FROM known_devices k JOIN users u ON u.id = k.user_id WHERE k.device_hash = ? AND u.email = ?")
        .get(sha(device), email),
  );

export type CodeRequest = { ip?: string; nonce?: string | null; device?: string | null };

/**
 * 生成并发送验证码。返回的 nonce 要放进这个浏览器的 cookie：验证码只有带着它才能用。
 * 没有配置发信服务（SMTP_HOST）时不发邮件，而是把验证码直接返回给页面显示——只用于本地测试。
 */
export async function requestCode(
  email: string,
  { ip = "unknown", nonce = null, device = null }: CodeRequest = {},
): Promise<{ ok: true; nonce: string; devCode?: string } | { ok: false; error: string; sent?: boolean }> {
  const d = db();
  const now = Date.now();
  const mine = codeRow(email, nonce);
  // 一分钟内这个浏览器（或者同一个 IP）刚给这个邮箱要过：不重发
  const recent = d
    .prepare("SELECT 1 FROM login_codes WHERE email = ? AND (ip = ? OR nonce_hash = ?) AND sent_at > ? LIMIT 1")
    .get(email, ip, mine?.nonce_hash ?? "", now - RESEND_AFTER);
  if (recent) {
    // sent：这个浏览器刚要的那个还能用，页面可以直接让用户去输
    return {
      ok: false,
      error: "验证码刚刚发过，请查收邮件；一分钟后才能重新发送。",
      sent: Boolean(mine && mine.expires_at > now && mine.attempts < MAX_ATTEMPTS),
    };
  }
  if (!mailConfigured() && !devCodeAllowed()) {
    console.error("[auth] 没有配置发信服务（SMTP_HOST），发不了验证码");
    return { ok: false, error: "登录邮件暂时发不出去，请稍后再试或联系我们。" };
  }
  const lane = isKnown(email, device) ? "known" : "anon";
  const count = (where: string, args: string[], since: number) =>
    (d.prepare(`SELECT COUNT(*) AS n FROM code_requests WHERE at >= ? AND lane = ?${where}`).get(since, lane, ...args) as { n: number }).n;
  const over = (where: string, args: string[], hour: number, day: number) =>
    count(where, args, now - HOUR) >= hour || count(where, args, now - 24 * HOUR) >= day;
  const tooMany = { ok: false as const, error: "这个邮箱要验证码的次数太多了，请过一段时间再试。设过密码的话可以用密码登录。" };
  if (lane === "known") {
    if (over(" AND email = ?", [email], LIMITS.knownHour, LIMITS.knownDay)) return tooMany;
  } else {
    if (
      over(" AND email = ? AND ip = ?", [email, ip], LIMITS.pairHour, LIMITS.pairDay) ||
      over(" AND email = ?", [email], LIMITS.emailHour, LIMITS.emailDay)
    ) {
      return tooMany;
    }
    const busy = { ok: false as const, error: "现在要验证码的人太多，请稍后再试。设过密码的话可以用密码登录。" };
    if (over(" AND ip = ?", [ip], LIMITS.ipHour, LIMITS.ipDay)) return busy;
    if (over("", [], LIMITS.allHour, LIMITS.allDay)) {
      alertOwner(`没登录过的浏览器要验证码的总量到上限了（每小时 ${LIMITS.allHour} 个、每天 ${LIMITS.allDay} 个）。`);
      return busy;
    }
  }
  d.prepare("INSERT INTO code_requests (email, ip, at, lane) VALUES (?, ?, ?, ?)").run(email, ip, now, lane);
  d.prepare("DELETE FROM code_requests WHERE at < ?").run(now - 48 * HOUR);
  d.prepare("DELETE FROM login_codes WHERE expires_at < ?").run(now - HOUR);
  // 这个浏览器之前要的那个作废，只认最新的一个
  if (mine) d.prepare("DELETE FROM login_codes WHERE nonce_hash = ?").run(mine.nonce_hash);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const fresh = randomBytes(32).toString("hex");
  d.prepare("INSERT INTO login_codes (nonce_hash, email, ip, code_hash, expires_at, sent_at, attempts) VALUES (?, ?, ?, ?, ?, ?, 0)").run(
    sha(fresh),
    email,
    ip,
    sha(fresh + email + code),
    now + CODE_TTL,
    now,
  );

  if (!mailConfigured()) return { ok: true, nonce: fresh, devCode: code };
  try {
    await sendCode(email, code);
    return { ok: true, nonce: fresh };
  } catch (e) {
    console.error("[auth] 发送验证码失败", e);
    d.prepare("DELETE FROM login_codes WHERE nonce_hash = ?").run(sha(fresh));
    return { ok: false, error: "验证码邮件发送失败，请稍后再试。" };
  }
}

/**
 * 校验验证码；成功则返回会话 token（新邮箱会自动注册；每天前若干名新用户有赠送 credit）。
 * 验证码只在申请它的那个浏览器里有效（nonce 对得上）。别的浏览器不管填什么都对不上，也不会消耗它的尝试次数。
 */
export function verifyCode(email: string, code: string, nonce: string | null): { token: string; userId: string } | { error: string } {
  const d = db();
  const row = codeRow(email, nonce);
  if (!row || row.expires_at < Date.now()) {
    return { error: "验证码已过期，或者不是在这个浏览器里获取的。请在这里重新获取验证码。" };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { error: "尝试次数过多，请重新获取验证码。" };
  if (!same(row.code_hash, sha(nonce + email + code))) {
    d.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE nonce_hash = ?").run(row.nonce_hash);
    return { error: "验证码不对。" };
  }
  d.prepare("DELETE FROM login_codes WHERE nonce_hash = ?").run(row.nonce_hash);

  let user = d.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) {
    user = { id: randomBytes(12).toString("hex") };
    d.prepare("INSERT INTO users (id, email, credits, created_at) VALUES (?, ?, 0, ?)").run(user.id, email, Date.now());
    grantSignupBonus(user.id);
  }
  return { token: newSession(user.id), userId: user.id };
}

/** 记下「这个浏览器成功登录过这个账号」，返回要放进 cookie 的随机串（已有就沿用，一个浏览器可以登录过好几个账号） */
export function rememberDevice(req: Request, userId: string): string {
  const device = cookieOf(req, DEVICE) ?? randomBytes(32).toString("hex");
  db()
    .prepare("INSERT INTO known_devices (device_hash, user_id, at) VALUES (?, ?, ?) ON CONFLICT(device_hash, user_id) DO UPDATE SET at = excluded.at")
    .run(sha(device), userId, Date.now());
  // 每个账号只留最近用过的 30 个浏览器，一年没用过的也清掉
  db()
    .prepare(
      `DELETE FROM known_devices WHERE at < ? OR (user_id = ? AND device_hash NOT IN
         (SELECT device_hash FROM known_devices WHERE user_id = ? ORDER BY at DESC LIMIT 30))`,
    )
    .run(Date.now() - DEVICE_TTL, userId, userId);
  return device;
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
  d.prepare("DELETE FROM known_devices WHERE user_id = ? AND device_hash != ?").run(userId, sha(cookieOf(req, DEVICE) ?? ""));
  return { ok: true };
}

/** 邮箱 + 密码登录。连续输错几次会锁一段时间；不区分「没有这个账号」「没设密码」「密码不对」，免得被人用来试探邮箱。 */
export function loginWithPassword(email: string, pw: string): { token: string; userId: string } | { error: string } {
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
  return { token: newSession(u.id), userId: u.id };
}

const DUMMY_HASH = hashPassword("not-a-real-password", "0".repeat(32));

/** 读一个我们自己发的 cookie（都是 64 位十六进制的随机串） */
function cookieOf(req: Request, name: string): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`));
  return m ? m[1] : null;
}
const tokenFrom = (req: Request) => cookieOf(req, COOKIE);
export const nonceFrom = (req: Request) => cookieOf(req, NONCE);
export const deviceFrom = (req: Request) => cookieOf(req, DEVICE);

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

// 下面两个只有登录相关的接口用得到，所以只发给 /api/auth
const authCookie = (req: Request, name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
/** 申请验证码的浏览器的凭据：比验证码多留几分钟就够了 */
export const nonceCookie = (req: Request, nonce: string) => authCookie(req, NONCE, nonce, CODE_TTL / 1000 + 300);
export const clearNonce = (req: Request) => authCookie(req, NONCE, "", 0);
export const deviceCookie = (req: Request, device: string) => authCookie(req, DEVICE, device, DEVICE_TTL / 1000);
