import { db } from "./db";

/**
 * Credit 规则：1 credit = 0.01 美元的面值。
 * 聊天按实际 token 用量 × 加价倍数扣；其他功能按次扣固定数额。
 * 倍数定在 40：实测做完一个案件的模型成本约 1–3 美元，这样用户做完一个案件大约花 50–100 美元。
 */

export const SIGNUP_BONUS = 200; // 新用户赠送，大约够做一次案件评估
/** 每天（北京时间 0 点重置）只有前这么多个新注册用户拿得到赠送 */
export const SIGNUP_DAILY_LIMIT = Number(process.env.SIGNUP_DAILY_LIMIT) || 100;
export const SCHOLAR_COST = 20; // 一键获取学术数据
export const NOTABLE_MIN_BALANCE = 100; // 做一次重要引用分析至少要有这么多余额（实际按用量扣）
const MARKUP = Number(process.env.CREDIT_MARKUP) || 40; // 成本之上的加价倍数

/** 充值档位：付多少美元（Stripe）或人民币（支付宝），得多少 credit */
export const PACKS = [
  { id: "p5", usd: 5, cny: 36, credits: 500 },
  { id: "p20", usd: 20, cny: 145, credits: 2200 },
  { id: "p50", usd: 50, cny: 360, credits: 6000 },
  { id: "p100", usd: 100, cny: 720, credits: 13000 },
] as const;

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// 各模型的价格，美元 / 百万 token
export const PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  // GPT-6.2 Sol 的标准价；超长上下文（约 27 万 token 以上）官方另有加价，这里没有计入
  "gpt-6.2-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
} as const;
export type Price = (typeof PRICES)[keyof typeof PRICES];

/** 一次聊天要扣多少 credit；拿不到用量（比如中途被停止）时按最低 1 个算 */
export function chatCost(u: Usage | null | undefined, PRICE: Price = PRICES["claude-opus-5-5"]): number {
  if (!u) return 1;
  const usd =
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1_000_000;
  return Math.max(1, Math.ceil(usd * 100 * MARKUP));
}

/**
 * 给用户加减 credit 并记一笔流水。
 * 带 ref 时是幂等的：同一个 ref 只会入账一次，重复调用返回 false。
 */
export function addCredits(userId: string, delta: number, reason: string, ref?: string): boolean {
  const d = db();
  return d.transaction(() => {
    const r = d
      .prepare("INSERT OR IGNORE INTO ledger (user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, delta, reason, ref ?? null, Date.now());
    if (r.changes === 0) return false;
    d.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").run(delta, userId);
    return true;
  })();
}

export function history(userId: string, limit = 30) {
  return db()
    .prepare("SELECT delta, reason, created_at AS at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit) as { delta: number; reason: string; at: number }[];
}

/** 北京时间今天 0 点的时间戳（北京时间固定 UTC+8，不依赖服务器时区） */
function beijingDayStart(now = Date.now()): number {
  const off = 8 * 3600_000;
  return Math.floor((now + off) / 86_400_000) * 86_400_000 - off;
}

/** 给新用户发注册赠送；当天名额已满则不发，返回 false */
export function grantSignupBonus(userId: string): boolean {
  const d = db();
  return d.transaction(() => {
    const { n } = d
      .prepare("SELECT COUNT(*) AS n FROM ledger WHERE ref LIKE 'signup:%' AND created_at >= ?")
      .get(beijingDayStart()) as { n: number };
    if (n >= SIGNUP_DAILY_LIMIT) return false;
    return addCredits(userId, SIGNUP_BONUS, "注册赠送", `signup:${userId}`);
  })();
}
