import {
  db,
  insertSignalOrIgnoreStmt,
  insertSignalStmt,
  listSignals,
  maybeFail,
  selectSignalByIdStmt,
  selectSignalByIdemKeyStmt,
} from './db.js';
import { consumeRateLimitInCurrentTx } from './rateLimit.js';

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(err) {
  const code = String(err?.code || '');
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    code === 'SQLITE_PROTOCOL' ||
    code.startsWith('SQLITE_IOERR') ||
    err?.message === 'simulated_db_failure'
  );
}

async function withDbRetry(operation, log) {
  const maxAttempts = Math.max(1, Number(process.env.DB_RETRY_ATTEMPTS || 5));
  const baseMs = Math.max(1, Number(process.env.DB_RETRY_BASE_MS || 20));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return operation();
    } catch (err) {
      const canRetry = isRetryableDbError(err) && attempt < maxAttempts;

      if (!canRetry) {
        throw err;
      }

      const exponential = baseMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * baseMs);
      const delayMs = exponential + jitter;

      log?.warn?.({ err, attempt, delayMs }, 'retrying transient db failure');
      await sleep(delayMs);
    }
  }
}

const createSignalTx = db.transaction((userId, type, payload, idemKey, createdAt) => {
  if (idemKey) {
    const existing = selectSignalByIdemKeyStmt.get(idemKey);
    if (existing) {
      return { kind: 'created', signal: existing, reused: true };
    }
  }

  const rate = consumeRateLimitInCurrentTx(userId, createdAt);
  if (!rate.ok) {
    return { kind: 'rate_limited', rate };
  }

  if (idemKey) {
    insertSignalOrIgnoreStmt.run(userId, type, String(payload), idemKey, createdAt);
    const signal = selectSignalByIdemKeyStmt.get(idemKey);
    return { kind: 'created', signal, reused: false };
  }

  const info = insertSignalStmt.run(userId, type, String(payload), null, createdAt);
  const signal = selectSignalByIdStmt.get(info.lastInsertRowid);
  return { kind: 'created', signal, reused: false };
});

function normalizeIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];

  if (Array.isArray(raw)) return raw[0] || null;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function postSignal(req, reply) {
  const idemKey = normalizeIdempotencyKey(req);
  const { userId, type, payload } = req.body || {};

  if (
    typeof userId !== 'string' ||
    userId.trim().length === 0 ||
    typeof type !== 'string' ||
    type.trim().length === 0 ||
    typeof payload !== 'string'
  ) {
    return reply.code(400).send({ error: 'invalid_body' });
  }

  try {
    const result = await withDbRetry(() => {
      maybeFail();
      return createSignalTx(userId, type, payload, idemKey, nowMs());
    }, req.log);

    if (result.kind === 'rate_limited') {
      return reply.code(429).send({
        error: 'rate_limited',
        remaining: result.rate.remaining,
        resetMs: result.rate.resetMs,
        limit: result.rate.limit,
      });
    }

    return reply.code(result.reused ? 200 : 201).send(result.signal);
  } catch (err) {
    req.log.error({ err, ctx: 'postSignal' }, 'database unavailable');
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}

export async function getSignals(req, reply) {
  const { userId, limit = 20 } = req.query || {};

  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return reply.code(400).send({ error: 'missing_userId' });
  }

  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 100)
    : 20;

  try {
    const rows = await withDbRetry(() => listSignals(userId, safeLimit), req.log);
    return { items: rows };
  } catch (err) {
    req.log.error({ err, ctx: 'getSignals' }, 'database unavailable');
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}
