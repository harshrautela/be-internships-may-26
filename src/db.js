import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_URL || './data/signals.db';

if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_signals_user_created
    ON signals(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS rate_limits (
    user_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, window_start)
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limits_window
    ON rate_limits(window_start);
`);

export function maybeFail() {
  const rate = Number(process.env.DB_FAIL_RATE || 0);

  if (rate > 0 && Math.random() < rate) {
    const err = new Error('simulated_db_failure');
    err.code = 'SQLITE_BUSY';
    throw err;
  }
}

export const selectSignalByIdStmt = db.prepare(`
  SELECT
    id,
    user_id AS userId,
    type,
    payload,
    idempotency_key AS idempotencyKey,
    created_at AS createdAt
  FROM signals
  WHERE id = ?
`);

export const selectSignalByIdemKeyStmt = db.prepare(`
  SELECT
    id,
    user_id AS userId,
    type,
    payload,
    idempotency_key AS idempotencyKey,
    created_at AS createdAt
  FROM signals
  WHERE idempotency_key = ?
`);

export const insertSignalStmt = db.prepare(`
  INSERT INTO signals (user_id, type, payload, idempotency_key, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

export const insertSignalOrIgnoreStmt = db.prepare(`
  INSERT OR IGNORE INTO signals (user_id, type, payload, idempotency_key, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const listSignalsStmt = db.prepare(`
  SELECT
    id,
    user_id AS userId,
    type,
    payload,
    idempotency_key AS idempotencyKey,
    created_at AS createdAt
  FROM signals
  WHERE user_id = ?
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

export function insertSignal(userId, type, payload, idemKey, nowMs) {
  maybeFail();
  const info = insertSignalStmt.run(userId, type, String(payload), idemKey || null, nowMs);
  return info;
}

export function getByIdemKey(idemKey) {
  maybeFail();
  if (!idemKey) return null;
  return selectSignalByIdemKeyStmt.get(idemKey) || null;
}

export function listSignals(userId, limit) {
  maybeFail();
  return listSignalsStmt.all(userId, limit);
}
