import { loyaltyBonusAt } from "@/lib/loyalty";
import type { LoyaltyTier } from "@/lib/loyalty";
import { db } from "./db";

/**
 * Credit 规则：1 credit = 0.01 美元的面值。
 * 聊天按实际 token 用量 × 加价倍数扣；其他功能按次扣固定数额。
 * 倍数定在 40：实测做完一个案件的模型成本约 1–3 美元，这样用户做完一个案件大约花 50–100 美元。
 */

export const SIGNUP_BONUS = 200; // 新用户赠送，大约够做一次案件评估
/** 每天（北京时间 0 点重置）只有前这么多个新注册用户拿得到赠送 */
export const SIGNUP_DAILY_LIMIT = envNumber("SIGNUP_DAILY_LIMIT", 100); // 设成 0 就是不送
export const SCHOLAR_COST = 20; // 一键获取学术数据
export const CITEMAP_COST = 30; // 生成引用地图
export const NOTABLE_MIN_BALANCE = 100; // 做一次重要引用分析至少要有这么多余额（实际按用量扣）
// 重要引用分析单独用低一些的倍数：一篇论文封顶约 230 credit
export const NOTABLE_MARKUP = envNumber("NOTABLE_MARKUP", 25) || 25;
const MARKUP = envNumber("CREDIT_MARKUP", 40) || 40; // 成本之上的加价倍数（文档工作区里写文书、改文书用这个）
// 主聊天（提问、填档案）用低得多的倍数，用来吸引人试用：这部分消息多、每条成本很低，按 40 倍算的话入门的 5 美元只够问十来句。
// 收入主要来自后面写案件（文档工作区），那里保持上面的倍数
export const CHAT_MARKUP = envNumber("CHAT_MARKUP", 10) || 10;

/** 读一个数字配置；没设或写错了用默认值。0 是有效的值 */
export function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 粗略估算一段文字有多少 token：中日韩文字大约一个字一个多 token，其他文字大约四个字符一个 */
export function textTokens(s: string): number {
  const cjk = s.match(/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/g)?.length ?? 0;
  return Math.ceil(cjk * 1.2 + (s.length - cjk) / 4);
}

/** 充值档位：付多少美元（Stripe）或人民币（支付宝），得多少 credit */
export const PACKS = [
  { id: "p5", usd: 5, cny: 36, credits: 500 },
  { id: "p20", usd: 20, cny: 145, credits: 2200 },
  { id: "p50", usd: 50, cny: 360, credits: 6000 },
  { id: "p100", usd: 100, cny: 720, credits: 13000 },
] as const;

/** 累计赠送只算最小的这一档 */
export const BASE_PACK = PACKS[0];

/**
 * 小额档累计赠送：最小档买到第几笔时额外送多少。数字是从大档位算出来的，
 * 所以分多次买小档，到手的 credits 和一次买对应的大档一样多（4 笔 = $20 档，10 笔 = $50 档，20 笔 = $100 档）。
 * 支付宝单笔限额低、只能卖小档的时候，靠它保留原来“多买多送”的优惠。
 */
export const LOYALTY: LoyaltyTier[] = (() => {
  let given = 0;
  return PACKS.slice(1).map((p) => {
    const count = p.usd / BASE_PACK.usd;
    const total = p.credits - count * BASE_PACK.credits;
    const tier = { count, bonus: total - given };
    given = total;
    return tier;
  });
})();
/** 买满这么多笔算一轮，之后从头累计 */
export const LOYALTY_CYCLE = PACKS[PACKS.length - 1].usd / BASE_PACK.usd;

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
export function chatCost(
  u: Usage | null | undefined,
  PRICE: Price = PRICES["claude-opus-5-5"],
  markup = MARKUP,
): number {
  if (!u) return 1;
  const usd =
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1_000_000;
  // 上游返回的用量不是数字时不能算出 NaN：那样这笔流水会记不进去，等于白用
  if (!Number.isFinite(usd)) {
    console.error("[credits] 用量不是数字，按最低数额扣", u);
    return 1;
  }
  return Math.max(1, Math.ceil(usd * 100 * markup));
}

/**
 * 给用户加减 credit 并记一笔流水。
 * 带 ref 时是幂等的：同一个 ref 只会入账一次，重复调用返回 false。
 */
export function addCredits(userId: string, delta: number, reason: string, ref?: string): boolean {
  if (!Number.isFinite(delta)) throw new Error("credit 变动必须是数字");
  delta = Math.trunc(delta);
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

/** 这个用户已经付清了几笔最小档的订单 */
export function loyaltyPaid(userId: string): number {
  const { n } = db()
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND pack = ? AND status = 'paid'")
    .get(userId, BASE_PACK.id) as { n: number };
  return n;
}

/**
 * 一笔最小档的订单刚付清时调用：累计笔数到了赠送的门槛就把赠送入账。
 * 按订单号幂等，同一笔订单最多送一次。返回送了多少（没到门槛是 0）。
 */
export function grantLoyalty(userId: string, orderNo: string): number {
  const n = loyaltyPaid(userId);
  const bonus = loyaltyBonusAt(n, LOYALTY, LOYALTY_CYCLE);
  if (!bonus) return 0;
  return addCredits(userId, bonus, `累计充值满 ${((n - 1) % LOYALTY_CYCLE) + 1} 笔赠送`, `loyalty:${orderNo}`) ? bonus : 0;
}
