import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** 服务端数据库（SQLite）。文件默认放在项目下的 data/ 目录，可用 DATA_DIR 指定别处。 */

const g = globalThis as unknown as { __diyDb?: Database.Database };

export function db(): Database.Database {
  if (g.__diyDb) return g.__diyDb;
  const dir = process.env.DATA_DIR || join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const d = new Database(join(dir, "app.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      credits    INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_codes (
      email      TEXT PRIMARY KEY,
      code_hash  TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      sent_at    INTEGER NOT NULL,
      attempts   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    -- 每一笔 credit 变动。ref 用来防止同一笔充值被重复入账
    CREATE TABLE IF NOT EXISTS ledger (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta      INTEGER NOT NULL,
      reason     TEXT NOT NULL,
      ref        TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, id DESC);
  `);
  g.__diyDb = d;
  return d;
}
