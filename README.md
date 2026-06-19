# Signals Challenge (Node.js + Fastify)

Minimal production-leaning service for creating and listing user signals with API-key auth, atomic idempotency, database-backed rate limiting, and retry/backoff for transient database failures.

## Endpoints

### `GET /healthz`

Returns service health.

```json
{ "ok": true }
```

### `POST /v1/signals`

Headers:

- `X-API-Key`: required
- `Idempotency-Key`: optional, but recommended for safe retries

Body:

```json
{
  "userId": "u1",
  "type": "note",
  "payload": "hello"
}
```

Behavior:

- Rate limited per `userId` using `RATE_LIMIT_PER_MIN` per fixed 60-second window.
- If the same `Idempotency-Key` is used again, the service returns the already-created signal instead of creating a duplicate.
- New signals return `201`; idempotency replays return `200`.
- Transient SQLite failures are retried with exponential backoff and jitter.

### `GET /v1/signals?userId=u1&limit=20`

Lists latest signals for one user. `limit` is clamped between `1` and `100`.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Default `.env` values:

```bash
API_KEY=change-me
PORT=8080
DATABASE_URL=./data/signals.db
RATE_LIMIT_PER_MIN=5
DB_FAIL_RATE=0
DB_RETRY_ATTEMPTS=5
DB_RETRY_BASE_MS=20
```

## Test

```bash
npm test
```

The tests cover:

- basic idempotency replay
- concurrent idempotency burst creating only one signal
- basic rate limit behavior
- parallel rate limit burst safety

## Quick manual check

```bash
curl -X POST http://localhost:8080/v1/signals \
  -H "X-API-Key: change-me" \
  -H "Idempotency-Key: demo-1" \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","type":"note","payload":"hello"}'

curl "http://localhost:8080/v1/signals?userId=u1&limit=10" \
  -H "X-API-Key: change-me"
```

## Implementation notes

- Idempotency is protected by a database-level `UNIQUE` constraint on `signals.idempotency_key`.
- Creation is done inside a SQLite transaction. If an idempotency key already exists, the existing resource is returned before consuming rate limit.
- Rate limit counters live in the `rate_limits` table and are updated inside transactions, so parallel requests cannot race an in-memory counter.
- SQLite runs in WAL mode with a `busy_timeout` to reduce lock-related transient failures.
