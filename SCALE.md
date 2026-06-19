# Scale Plan

## Data model and indexes

Current SQLite schema is enough for the assignment, but for production I would move the write path to Postgres.

- `signals(id BIGSERIAL PRIMARY KEY, user_id, type, payload, idempotency_key, created_at)`
- Unique index: `UNIQUE(idempotency_key)` for atomic idempotency.
- Read index: `(user_id, created_at DESC)` for `GET /v1/signals?userId=...`.
- Optional partitioning by `created_at` if retention grows very large.

## Idempotency across instances

The important rule is: never do naive check-then-insert in app memory.

Production approach:

- Store idempotency in a shared durable database.
- Use one atomic statement/transaction such as `INSERT ... ON CONFLICT DO NOTHING` followed by a select, or `INSERT ... ON CONFLICT DO UPDATE/RETURNING`.
- All app instances share the same idempotency store, so retries, restarts, and concurrent requests return the same resource.
- Keep idempotency keys for a defined TTL if business rules allow cleanup.

## Rate limiting across instances

Current implementation uses a DB-backed counter table, so it is safe for local concurrency and multiple processes sharing the same SQLite file.

For real 10k RPS production traffic:

- Use Redis as the shared rate-limit store.
- Use an atomic Lua script or Redis transaction to increment the per-user per-window key and set expiry in one operation.
- Key format: `rate:user:{userId}:{windowStart}`.
- This makes rate limiting safe across horizontal app instances.

## Retry and failure handling

- Retry only transient DB errors like lock/busy/temporary IO errors.
- Use exponential backoff with jitter to avoid thundering herd retries.
- Keep writes idempotent so a retry cannot create duplicates when `Idempotency-Key` is present.
- Return `503 db_unavailable` after retry budget is exhausted.
- In production, add a circuit breaker so the service fails fast during a sustained database outage.

## Connection pooling

- App servers should use a bounded Postgres pool per instance.
- Pool size should be calculated from database capacity, not guessed per instance.
- Use pgbouncer or managed DB pooling if many app instances are deployed.

## Caching and queues

- `GET /v1/signals` can be cached briefly if product semantics allow it, but the write path must remain strongly consistent for idempotency.
- Heavy payload processing should be moved to a queue after the signal row is accepted.
- The synchronous API should only validate, rate-limit, write the durable row, and return quickly.

## Observability

Track:

- request count, latency, error rate
- 429 rate-limit count
- idempotency replay count
- DB retry attempts and exhausted retries
- DB lock time / connection pool wait time
- queue lag if async processing is added

Alerts:

- high 5xx rate
- DB retry exhaustion
- high DB latency
- Redis unavailable or high latency
- queue lag beyond SLO

## 10k RPS design sketch

- Load balancer in front of multiple stateless Node/Fastify instances.
- Redis cluster for shared rate limiting.
- Postgres primary for writes, read replica for list queries if needed.
- Unique DB constraint for idempotency correctness.
- Bounded DB pool and pgbouncer to prevent overload.
- Queue for downstream/background processing.
- Horizontal scale app instances based on CPU and p95 latency.

Approximate flow:

1. Validate request and API key.
2. Check Redis rate limit atomically.
3. Insert signal into Postgres with idempotency conflict handling.
4. Enqueue optional async work.
5. Return created or replayed signal.

This keeps correctness in shared infrastructure instead of relying on per-process memory.
