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

export async function fetchAll(): Promise<Record<string, { value: string; rev: number }> | null> {
  try {
    const res = await fetch("/api/data", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()).items ?? {};
  } catch {
    return null;
  }
}

export type PushResult = { ok: true; rev: number } | { ok: false; conflict?: { value: string; rev: number } };

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
    return { ok: false };
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
    if (data) await uploadFile(id, data);
  }
}
