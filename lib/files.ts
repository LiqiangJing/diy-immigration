import { uid } from "./types";
import type { Attachment } from "./types";

/**
 * 文件内容（base64）保存在浏览器的 IndexedDB 里，刷新页面后仍然可用；
 * 另有一层内存缓存。localStorage 里只存文件的元信息（Attachment）。
 */

export const ACCEPT = ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif";
const MAX_FILE = 20 * 1024 * 1024;

const mem = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("diy-immigration", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction("files", mode).objectStore("files"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// 登录后文件同时存一份到服务器（见 lib/sync.ts），换设备或清缓存后能取回
let remote = false;
export const setRemoteFiles = (on: boolean) => {
  remote = on;
};

function toBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 把一个文件传到服务器；失败不影响本地使用，下次同步时会再试 */
export async function uploadFile(id: string, data: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/files/${id}`, { method: "PUT", body: new Blob([toBytes(data)]) });
    return res.ok;
  } catch {
    return false;
  }
}

async function localGet(id: string): Promise<string | undefined> {
  const hit = mem.get(id);
  if (hit !== undefined) return hit;
  try {
    const data = await run<string | undefined>("readonly", (s) => s.get(id));
    if (typeof data === "string") mem.set(id, data);
    return typeof data === "string" ? data : undefined;
  } catch {
    return undefined;
  }
}

async function localPut(id: string, data: string) {
  mem.set(id, data);
  try {
    await run("readwrite", (s) => s.put(data, id));
  } catch {
    // 存不进 IndexedDB（隐私模式、空间不足等）时退化为只在本次会话可用
  }
}

export async function putFile(id: string, data: string) {
  await localPut(id, data);
  if (remote && data) void uploadFile(id, data); // 空内容服务器不收，也没有必要传
}

/** 这个文件在当前浏览器里有没有 */
export const hasLocalFile = async (id: string) => (await localGet(id)) !== undefined;
export const getLocalFile = localGet;

export async function getFile(id: string): Promise<string | undefined> {
  const local = await localGet(id);
  if (local !== undefined || !remote) return local;
  // 当前浏览器里没有（换了设备或清过缓存），从服务器取回并存一份
  try {
    const res = await fetch(`/api/files/${id}`);
    if (!res.ok) return undefined;
    const data = fromBytes(new Uint8Array(await res.arrayBuffer()));
    await localPut(id, data);
    return data;
  } catch {
    return undefined;
  }
}

export async function dropFile(id: string) {
  mem.delete(id);
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {}
  if (remote) fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => {});
}

function mimeOf(f: File): string | null {
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "application/pdf";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type)) return f.type;
  if (f.type.startsWith("text/") || /\.(txt|md)$/i.test(f.name)) return "text/plain";
  return null;
}

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** 校验并保存用户选择的文件，返回成功的附件和出错信息 */
export async function saveUploads(files: FileList | File[]) {
  const added: Attachment[] = [];
  const problems: string[] = [];
  for (const f of Array.from(files)) {
    const type = mimeOf(f);
    if (!type) {
      problems.push(`「${f.name}」格式暂不支持（目前支持 PDF、图片、TXT、Markdown）`);
      continue;
    }
    if (f.size > MAX_FILE) {
      problems.push(`「${f.name}」超过 20 MB`);
      continue;
    }
    if (f.size === 0) {
      problems.push(`「${f.name}」是空文件`);
      continue;
    }
    try {
      const id = uid();
      await putFile(id, await toBase64(f));
      added.push({ id, name: f.name, type, size: f.size });
    } catch {
      problems.push(`「${f.name}」读取失败`);
    }
  }
  return { added, problems };
}

/**
 * 用新上传的文件替换一个已有的文件。沿用原来的 id，所以它在打包顺序里的位置、标题等设置都不变。
 * keepName 为 true 时保留原来的文件名（去掉预印本标记），否则用新文件的名字。
 */
export async function replaceUpload(old: Attachment, f: File, keepName: boolean): Promise<{ att?: Attachment; problem?: string }> {
  const type = mimeOf(f);
  if (!type) return { problem: `「${f.name}」格式暂不支持（目前支持 PDF、图片、TXT、Markdown）` };
  if (f.size > MAX_FILE) return { problem: `「${f.name}」超过 20 MB` };
  if (f.size === 0) return { problem: `「${f.name}」是空文件` };
  try {
    await putFile(old.id, await toBase64(f));
    const name = keepName ? old.name.replace(" [arXiv preprint]", "") : f.name;
    return { att: { id: old.id, name, type, size: f.size } };
  } catch {
    return { problem: `「${f.name}」读取失败` };
  }
}

export const fmtSize = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
