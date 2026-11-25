/**
 * 把浏览器里的数据和服务器上的那份对齐。
 * 四份数据各自有一个版本号 rev：每保存一次加一。浏览器记着自己上次同步到的 rev 和「本地有没有还没传上去的改动」。
 */

import { getLocalFile, hasLocalFile, uploadFile } from "./files";
import { emptyProfile } from "./profile";
import { uid } from "./types";

export const SYNC_KEYS = ["conversations", "cases", "profile", "docs"] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];

export type SyncMeta = {
  user: string; // 这份本地数据上次是和哪个账号同步的
  revs: Partial<Record<SyncKey, number>>;
  dirty: Partial<Record<SyncKey, boolean>>; // 本地有还没传上去的改动
  /** 每份数据上次和服务器对齐时内容的指纹。本地内容的指纹和它不一样，就说明本地有服务器上没有的改动（不管当时有没有登录） */
  hash?: Partial<Record<SyncKey, string>>;
  /** 本机存储满了、这份数据没能存进浏览器：下次打开时本机的那份是旧的，要以服务器为准 */
  stale?: Partial<Record<SyncKey, boolean>>;
};

const META_KEY = "pathway.sync";

export function loadMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    const m = raw ? (JSON.parse(raw) as SyncMeta) : null;
    return m && typeof m.user === "string"
      ? { user: m.user, revs: m.revs ?? {}, dirty: m.dirty ?? {}, hash: m.hash, stale: m.stale }
      : null;
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

/** 内容的指纹（不用于安全，只用来判断内容变没变） */
export function hashOf(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return `${s.length}.${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/* ---------- 换账号时暂存还没上传的内容 ---------- */

const STASH_KEY = "pathway.stash";
type Stash = { user: string; data: Partial<Record<SyncKey, unknown>> };

/** 这个浏览器要换成另一个账号的数据了：把原账号还没传上去的内容存起来，等原账号再登录时合并回去 */
export function saveStash(user: string, data: Partial<Record<SyncKey, unknown>>) {
  if (!Object.keys(data).length) return;
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify({ user, data } satisfies Stash));
  } catch {}
}

/** 取出（并删掉）之前为这个账号暂存的内容 */
export function takeStash(user: string): Partial<Record<SyncKey, unknown>> | null {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    const st = raw ? (JSON.parse(raw) as Stash) : null;
    if (!st || st.user !== user) return null;
    localStorage.removeItem(STASH_KEY);
    return st.data ?? null;
  } catch {
    return null;
  }
}

type Item = { id?: string; updatedAt?: number };

export const isEmpty = (key: SyncKey, v: unknown) =>
  key === "profile" ? !((v as Item | null)?.updatedAt ?? 0) : !Array.isArray(v) || v.length === 0;

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
        if (S.has(k)) {
          const v = S.get(k);
          // 不知道这一项原来的样子时（没有 base），两边改得不一样的地方以修改时间新的为准
          const newer = !B.has(k) && isObj(l) && isObj(v) && typeof l.updatedAt === "number" && typeof v.updatedAt === "number" && v.updatedAt > l.updatedAt;
          out.push(newer ? merge3(undefined, v, l) : merge3(B.get(k), l, v));
        } else if (!B.has(k) || !same(l, B.get(k))) out.push(l); // 这边新增的，或者那边删了但这边改过的
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

/** 没有 base 可对照时用的「空白」：这样只有一边填了的地方会被保留，而不是被另一边的空白盖掉 */
const blank = (key: SyncKey): unknown => (key === "profile" ? emptyProfile() : []);

/** 把服务器上的版本并进本地的内容。base 是上次对齐时的内容；不知道的话传 undefined */
export function mergeKey(key: SyncKey, base: unknown, local: unknown, server: unknown): unknown {
  if (server === null || server === undefined) return local;
  const known = base !== undefined && base !== null;
  const merged = merge3(known ? base : blank(key), local, server, key !== "profile");
  return key === "docs" && known ? withConflictCopies(base, local, server, merged) : merged;
}

/**
 * 同一份文档的正文在两台设备上都改过：合并结果里留的是这台设备上的版本，
 * 另一台设备上的版本另存成一份副本，免得悄悄丢掉。
 */
function withConflictCopies(base: unknown, local: unknown, server: unknown, merged: unknown): unknown {
  if (!Array.isArray(base) || !Array.isArray(local) || !Array.isArray(server) || !Array.isArray(merged)) return merged;
  type Doc = { id?: string; title?: string; content?: string; [k: string]: unknown };
  const byId = (list: unknown[]) => new Map((list as Doc[]).filter((d) => d?.id).map((d) => [d.id as string, d]));
  const B = byId(base);
  const S = byId(server);
  const out = [...(merged as Doc[])];
  for (const l of local as Doc[]) {
    const b = l?.id ? B.get(l.id) : undefined;
    const v = l?.id ? S.get(l.id) : undefined;
    if (!b || !v || typeof l.content !== "string" || typeof v.content !== "string") continue;
    if (l.content === v.content || l.content === b.content || v.content === b.content) continue;
    const copyId = `${l.id}-c${hashOf(v.content).split(".")[1]}`;
    if (out.some((d) => d?.id === copyId)) continue;
    const at = out.findIndex((d) => d?.id === l.id);
    out.splice(at + 1, 0, { ...v, id: copyId, title: `${v.title || "文档"}（另一台设备上的版本）`, chat: [], undo: undefined, redo: undefined });
  }
  return out;
}

export async function fetchAll(): Promise<Record<string, { value: string; rev: number }> | "auth" | null> {
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (res.status === 401) return "auth";
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
      // 聊天卡片的撤销记录里也有文件的信息，但那只是「当时加了哪一项」的记录，不算还在用这个文件
      for (const k of Object.keys(o)) if (k !== "undo") walk(o[k]);
    }
  };
  values.forEach(walk);
  return [...ids];
}

/**
 * 这些文件里哪些已经确定在服务器上了（缺的先补传，最多花 budgetMs）。
 * 退出登录时用：只有云端确实有的，才把这个浏览器里的那份清掉。
 */
export async function filesSafeOnServer(ids: string[], budgetMs = 15_000): Promise<string[]> {
  const deadline = Date.now() + budgetMs;
  try {
    const res = await fetch("/api/files", { cache: "no-store" });
    if (!res.ok) return [];
    const onServer = new Set<string>((await res.json()).ids ?? []);
    const safe: string[] = [];
    for (const id of new Set(ids)) {
      if (onServer.has(id)) {
        safe.push(id);
        continue;
      }
      if (Date.now() > deadline) continue;
      const data = await getLocalFile(id);
      if (data && (await uploadFile(id, data))) safe.push(id);
    }
    return safe;
  } catch {
    return [];
  }
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
