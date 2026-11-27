/** 小额档累计赠送的算法（服务器入账和充值页显示共用，不依赖数据库） */
export type LoyaltyTier = { count: number; bonus: number };

/** 一轮里的第几笔（1 到 cycle）：满一轮后从头累计 */
const position = (n: number, cycle: number) => ((n - 1) % cycle) + 1;

/** 买到第 n 笔（从 1 数）时额外送多少；这一笔没有赠送就是 0 */
export function loyaltyBonusAt(n: number, tiers: LoyaltyTier[], cycle: number): number {
  if (!Number.isInteger(n) || n < 1 || cycle < 1) return 0;
  return tiers.find((t) => t.count === position(n, cycle))?.bonus ?? 0;
}

/** 已经买了 paid 笔：再买几笔能拿到下一次赠送、送多少 */
export function loyaltyNext(paid: number, tiers: LoyaltyTier[], cycle: number): { need: number; bonus: number } | null {
  if (!tiers.length || cycle < 1 || !Number.isInteger(paid) || paid < 0) return null;
  const done = paid % cycle; // 这一轮已经买了几笔
  const next = tiers.find((t) => t.count > done);
  return next ? { need: next.count - done, bonus: next.bonus } : null;
}
