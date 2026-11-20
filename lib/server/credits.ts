import { db } from "./db";

/**
 * Credit 规则：1 credit = 0.01 美元的面值。
 * 聊天按实际 token 用量 × 加价倍数扣；其他功能按次扣固定数额。
 */

export const SIGNUP_BONUS = 100; // 新用户赠送
export const SCHOLAR_COST = 5; // 一键获取学术数据
const MARKUP = Number(process.env.CREDIT_MARKUP) || 2; // 成本之上的加价倍数

/** 充值档位：付多少美元（Stripe）或人民币（支付宝），得多少 credit */
export const PACKS = [
  { id: "p5", usd: 5, cny: 36, credits: 500 },
  { id: "p20", usd: 20, cny: 145, credits: 2200 },
  { id: "p50", usd: 50, cny: 360, credits: 6000 },
] as const;

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

// Claude Opus 5.5 的价格，美元 / 百万 token
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/** 一次聊天要扣多少 credit；拿不到用量（比如中途被停止）时按最低 1 个算 */
export function chatCost(u: Usage | null | undefined): number {
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
