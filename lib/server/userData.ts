/**
 * 用户数据的服务端存储：四份 JSON（会话、案件、档案、文档）和上传的文件。
 * 浏览器里仍然保留一份，服务器这份用来换设备、清缓存后找回。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, db } from "./db";

export const DATA_KEYS = ["conversations", "cases", "profile", "docs"] as const;
export type DataKey = (typeof DATA_KEYS)[number];
export const MAX_VALUE = 8 * 1024 * 1024; // 每份 JSON 的上限
export const MAX_FILE = 20 * 1024 * 1024; // 单个文件
export const MAX_TOTAL = 500 * 1024 * 1024; // 每个用户的文件总量

export function readAll(userId: string): Record<string, { value: string; rev: number }> {
  const rows = db().prepare("SELECT key, value, rev FROM user_data WHERE user_id = ?").all(userId) as {
    key: string;
    value: string;
    rev: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, { value: r.value, rev: r.rev }]));
}

/**
 * 保存一份数据。rev 是客户端上次看到的版本号；和服务器上的不一致说明别的设备先改过，
 * 这时不保存，把服务器上的那份还给客户端去合并。
 */
export function writeOne(
  userId: string,
  key: DataKey,
  value: string,
  rev: number,
): { ok: true; rev: number } | { ok: false; value: string; rev: number } {
  const d = db();
  return d.transaction(() => {
    const cur = d.prepare("SELECT value, rev FROM user_data WHERE user_id = ? AND key = ?").get(userId, key) as
      | { value: string; rev: number }
      | undefined;
    if ((cur?.rev ?? 0) !== rev) return { ok: false as const, value: cur?.value ?? "", rev: cur?.rev ?? 0 };
    d.prepare(
      `INSERT INTO user_data (user_id, key, value, rev, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, rev = excluded.rev, updated_at = excluded.updated_at`,
    ).run(userId, key, value, rev + 1, Date.now());
    return { ok: true as const, rev: rev + 1 };
  })();
}

export const validFileId = (id: string) => /^[A-Za-z0-9_-]{4,64}$/.test(id);
// 用户 id 和文件 id 都只含字母数字，拼出来的路径不会跳出 files 目录
const fileDir = (userId: string) => join(dataDir(), "files", userId.replace(/[^A-Za-z0-9_-]/g, ""));

export function listFiles(userId: string): string[] {
  return (db().prepare("SELECT file_id FROM user_files WHERE user_id = ?").all(userId) as { file_id: string }[]).map(
    (r) => r.file_id,
  );
}

export function saveFile(userId: string, id: string, bytes: Uint8Array): "ok" | "full" {
  const d = db();
  const used = (
    d.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM user_files WHERE user_id = ? AND file_id != ?").get(userId, id) as {
      n: number;
    }
  ).n;
  if (used + bytes.length > MAX_TOTAL) return "full";
  mkdirSync(fileDir(userId), { recursive: true });
  writeFileSync(join(fileDir(userId), id), bytes);
  d.prepare(
    `INSERT INTO user_files (user_id, file_id, size, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, file_id) DO UPDATE SET size = excluded.size, created_at = excluded.created_at`,
  ).run(userId, id, bytes.length, Date.now());
  return "ok";
}

export function readFile(userId: string, id: string): Buffer | null {
  const row = db().prepare("SELECT 1 FROM user_files WHERE user_id = ? AND file_id = ?").get(userId, id);
  if (!row) return null;
  try {
    return readFileSync(join(fileDir(userId), id));
  } catch {
    return null;
  }
}

export function deleteFile(userId: string, id: string) {
  db().prepare("DELETE FROM user_files WHERE user_id = ? AND file_id = ?").run(userId, id);
  rmSync(join(fileDir(userId), id), { force: true });
}
