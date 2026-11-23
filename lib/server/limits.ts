/**
 * 进程内的简单限流。整个站点只有一个 Node 进程，所以放在内存里就够了；重启后清零。
 *   hold()  同一个用户同一类请求同时只能有几个在进行，防止一口气发很多请求把余额刷成很大的负数
 *   rate()  一段时间内最多多少次
 */

const g = globalThis as unknown as { __diyHeld?: Map<string, number>; __diyHits?: Map<string, number[]> };
const held: Map<string, number> = (g.__diyHeld ??= new Map<string, number>());
const hits: Map<string, number[]> = (g.__diyHits ??= new Map<string, number[]>());

/** 占一个名额；满了返回 null。用完必须调用返回的函数释放（多调几次没关系） */
export function hold(key: string, max: number): (() => void) | null {
  const n = held.get(key) ?? 0;
  if (n >= max) return null;
  held.set(key, n + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (held.get(key) ?? 1) - 1;
    if (left <= 0) held.delete(key);
    else held.set(key, left);
  };
}

/** windowMs 内超过 max 次返回 false（这一次不计入） */
export function rate(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 20_000) for (const [k, v] of hits) if (!v.some((t) => now - t < 86_400_000)) hits.delete(k);
  return true;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

export const busy = (what = "上一个请求") =>
  Response.json({ error: `${what}还在进行中，请等它结束后再试。` }, { status: 429 });
