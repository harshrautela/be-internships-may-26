import { db } from './db.js';

const RATE = Math.max(0, Number(process.env.RATE_LIMIT_PER_MIN || 5));
export const WINDOW_MS = 60_000;

const insertWindowStmt = db.prepare(`
  INSERT OR IGNORE INTO rate_limits (user_id, window_start, count)
  VALUES (?, ?, 0)
`);

const incrementWindowStmt = db.prepare(`
  UPDATE rate_limits
  SET count = count + 1
  WHERE user_id = ? AND window_start = ?
`);

const selectWindowStmt = db.prepare(`
  SELECT count
  FROM rate_limits
  WHERE user_id = ? AND window_start = ?
`);

const cleanupStmt = db.prepare(`
  DELETE FROM rate_limits
  WHERE window_start < ?
`);

let cleanupCounter = 0;

function windowStartFor(nowMs) {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

export function consumeRateLimitInCurrentTx(userId, nowMs = Date.now()) {
  if (!userId) throw new Error('userId_required_for_rate_limit');

  const windowStart = windowStartFor(nowMs);

  insertWindowStmt.run(userId, windowStart);
  incrementWindowStmt.run(userId, windowStart);

  const row = selectWindowStmt.get(userId, windowStart);
  const count = row?.count || 0;

  // Cheap periodic cleanup so old windows do not grow forever.
  cleanupCounter += 1;
  if (cleanupCounter % 1000 === 0) {
    cleanupStmt.run(windowStart - WINDOW_MS * 2);
  }

  return {
    ok: count <= RATE,
    remaining: Math.max(RATE - count, 0),
    resetMs: windowStart + WINDOW_MS,
    limit: RATE,
  };
}

const consumeRateLimitTx = db.transaction((userId, nowMs) =>
  consumeRateLimitInCurrentTx(userId, nowMs),
);

export function checkAndConsume(userId, nowMs = Date.now()) {
  return consumeRateLimitTx(userId, nowMs);
}
