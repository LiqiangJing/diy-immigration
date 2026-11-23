/**
 * 把浏览器里的数据和服务器上的那份对齐。
 * 四份数据各自有一个版本号 rev：每保存一次加一。浏览器记着自己上次同步到的 rev 和「本地有没有还没传上去的改动」。
 */

import { getLocalFile, hasLocalFile, uploadFile } from "./files";

export const SYNC_KEYS = ["conversations", "cases", "profile", "docs"] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

export type SyncMeta = {
  user: string; // 这份本地数据上次是和哪个账号同步的
  revs: Partial<Record<SyncKey, number>>;
  dirty: Partial<Record<SyncKey, boolean>>; // 本地有还没传上去的改动
};

const META_KEY = "pathway.sync";

export function loadMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    const m = raw ? (JSON.parse(raw) as SyncMeta) : null;
    return m && typeof m.user === "string" ? { user: m.user, revs: m.revs ?? {}, dirty: m.dirty ?? {} } : null;
  } catch {
    return null;
  }
}

export function saveMeta(m: SyncMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {}
}

export function clearMeta() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {}
}

type Item = { id?: string; updatedAt?: number };

export const isEmpty = (key: SyncKey, v: unknown) =>
  key === "profile" ? !((v as Item | null)?.updatedAt ?? 0) : !Array.isArray(v) || v.length === 0;

/**
 * 两边都有改动时合并：列表按 id 合并，同一个 id 取修改时间新的（没有修改时间的取本地）；档案整份取新的。
 */
export function merge(key: SyncKey, local: unknown, server: unknown): unknown {
  if (key === "profile") {
    const l = (local ?? {}) as Item;
    const s = (server ?? {}) as Item;
    return (s.updatedAt ?? 0) > (l.updatedAt ?? 0) ? s : l;
  }
  const l = Array.isArray(local) ? (local as Item[]) : [];
  const s = Array.isArray(server) ? (server as Item[]) : [];
  const byId = new Map(s.filter((x) => x?.id).map((x) => [x.id as string, x]));
  const out = l.map((x) => {
    const other = x?.id ? byId.get(x.id) : undefined;
    if (other) byId.delete(x.id as string);
    return other && (other.updatedAt ?? 0) > (x.updatedAt ?? 0) ? other : x;
  });
  return [...out, ...byId.values()];
}

/* ---------- 三方合并 ---------- */

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

/** 内容是否相同（不看对象里字段的先后顺序；值为 undefined 的字段当作没有） */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  const oa = a as Json;
  const ob = b as Json;
  const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
  const kb = Object.keys(ob).filter((k) => ob[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => same(oa[k], ob[k]));
}

/** 列表里每一项用什么认：案件、文档、会话、消息、学位、项目都有 id；学术记录按来源，引用分析按论文标题 */
function keyOf(x: unknown): string | null {
  if (!isObj(x)) return null;
  if (typeof x.id === "string" && x.id) return `i:${x.id}`;
  if (typeof x.source === "string" && x.source) return `s:${x.source}`;
  if (typeof x.title === "string" && x.title) return `t:${x.title}`;
  if (typeof x.citingTitle === "string" && x.citingTitle) return `c:${x.citingTitle}`;
  return null;
}
function index(list: unknown[]): Map<string, unknown> | null {
  const m = new Map<string, unknown>();
  for (const x of list) {
    const k = keyOf(x);
    if (k === null || m.has(k)) return null; // 有认不出来或重复的项：这个列表不能逐项合并
    m.set(k, x);
  }
  return m;
}
const plain = (list: unknown[]) => list.every((x) => typeof x === "string" || typeof x === "number");

/**
 * 两台设备都改过同一份数据时的合并。base 是这台设备上次和服务器对齐时的内容，
 * 对照它就能知道哪边改了什么：只有一边改过的地方用改过的那一边；一边删掉、另一边没动的就删掉；
 * 一边删掉、另一边改过的保留；同一个地方两边改得不一样时，以这台设备上的为准。
 * newFirst：服务器那边新增的项放在列表最前面（案件、文档、会话都是新的在前），否则接在后面。
 */
export function merge3(base: unknown, local: unknown, server: unknown, newFirst = false): unknown {
  if (same(local, server)) return local;
  if (same(local, base)) return server;
  if (same(server, base)) return local;
  if (Array.isArray(local) && Array.isArray(server)) {
    const b = Array.isArray(base) ? base : [];
    const L = index(local);
    const S = index(server);
    const B = index(b);
    if (L && S && B) {
      const out: unknown[] = [];
      for (const [k, l] of L) {
        if (S.has(k)) out.push(merge3(B.get(k), l, S.get(k)));
        else if (!B.has(k) || !same(l, B.get(k))) out.push(l); // 这边新增的，或者那边删了但这边改过的
      }
      const added: unknown[] = [];
      for (const [k, v] of S) {
        if (!L.has(k) && (!B.has(k) || !same(v, B.get(k)))) added.push(v); // 那边新增的，或者这边删了但那边改过的
      }
      return newFirst ? [...added, ...out] : [...out, ...added];
    }
    if (plain(local) && plain(server) && plain(b)) {
      // 一串勾选项（清单、申报条件等）：这边的，去掉那边取消的，加上那边新勾的
      const out = local.filter((x) => server.includes(x) || !b.includes(x));
      for (const x of server) if (!b.includes(x) && !out.includes(x)) out.push(x);
      return out;
    }
    return local;
  }
  if (isObj(local) && isObj(server)) {
    const b = isObj(base) ? base : {};
    const out: Json = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(server)])) {
      const l = local[k];
      const v = server[k];
      const merged = k === "updatedAt" && typeof l === "number" && typeof v === "number" ? Math.max(l, v) : merge3(b[k], l, v);
      if (merged !== undefined) out[k] = merged;
    }
    return out;
  }
  return local;
}

export async function fetchAll(): Promise<Record<string, { value: string; rev: number }> | null> {
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).items ?? {};
  } catch {
    return null;
  }
}

export type PushResult = { ok: true; rev: number } | { ok: false; conflict?: { value: string; rev: number }; status?: number };

export async function pushOne(key: SyncKey, value: string, rev: number): Promise<PushResult> {
  try {
    const res = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, rev }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && typeof data?.rev === "number") return { ok: true, rev: data.rev };
    if (res.status === 409 && typeof data?.rev === "number") return { ok: false, conflict: { value: data.value ?? "", rev: data.rev } };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false };
  }
}

/** 数据里引用到的所有文件 id（案件文件、聊天附件） */
export function fileIds(...values: unknown[]): string[] {
  const ids = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.name === "string" && typeof o.size === "number" && typeof o.type === "string") ids.add(o.id);
      Object.values(o).forEach(walk);
    }
  };
  values.forEach(walk);
  return [...ids];
}

/** 把当前浏览器里有、服务器上还没有的文件补传上去 */
export async function uploadMissingFiles(ids: string[]) {
  let onServer: Set<string>;
  try {
    const res = await fetch("/api/files", { cache: "no-store" });
    if (!res.ok) return;
    onServer = new Set((await res.json()).ids ?? []);
  } catch {
    return;
  }
  for (const id of ids) {
    if (onServer.has(id) || !(await hasLocalFile(id))) continue;
    const data = await getLocalFile(id);
    if (data) await uploadFile(id, data); // 空内容不传
  }
}
