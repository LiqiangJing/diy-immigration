import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** 服务端数据库（SQLite）。文件默认放在项目下的 data/ 目录，可用 DATA_DIR 指定别处。 */

const g = globalThis as unknown as { __diyDb?: Database.Database };

export const dataDir = () => process.env.DATA_DIR || join(process.cwd(), "data");

export function db(): Database.Database {
  if (g.__diyDb) return g.__diyDb;
  const dir = dataDir();
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
    -- 「联系我们」的留言
    CREATE TABLE IF NOT EXISTS contact_messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT,
      email      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      emailed    INTEGER NOT NULL DEFAULT 0
    );
    -- 用户自己的数据（档案、案件、文档、会话），每个 key 一份 JSON。rev 每保存一次加一，用来发现两台设备同时改
    CREATE TABLE IF NOT EXISTS user_data (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      rev        INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    -- 用户上传的文件；内容放在磁盘上 DATA_DIR/files/<用户>/<文件 id>
    CREATE TABLE IF NOT EXISTS user_files (
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_id    TEXT NOT NULL,
      size       INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, file_id)
    );
    -- 支付宝订单
    CREATE TABLE IF NOT EXISTS orders (
      order_no   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack       TEXT NOT NULL,
      amount     TEXT NOT NULL,
      status     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      paid_at    INTEGER
    );
  `);
  // 密码登录是后加的：老数据库里补上这几列
  const cols = (d.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("password_hash")) {
    d.exec(`
      ALTER TABLE users ADD COLUMN password_hash TEXT;
      ALTER TABLE users ADD COLUMN pw_fails INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN pw_locked_until INTEGER NOT NULL DEFAULT 0;
    `);
  }
  g.__diyDb = d;
  return d;
}
