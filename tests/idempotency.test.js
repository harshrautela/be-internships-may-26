import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson, postJson, startServer, stopServer, tempDb } from './helpers.js';

test('idempotency returns same resource for same key', async () => {
  const port = '9091';
  const proc = await startServer({
    API_KEY: 'k',
    PORT: port,
    DATABASE_URL: tempDb('idempotency-basic'),
    RATE_LIMIT_PER_MIN: '100',
  });

  try {
    const base = `http://localhost:${port}`;
    const idem = 'same-key';

    const a = await postJson(`${base}/v1/signals`, {
      headers: { 'x-api-key': 'k', 'Idempotency-Key': idem },
      body: { userId: 'u1', type: 'note', payload: 'x' },
    });
    const b = await postJson(`${base}/v1/signals`, {
      headers: { 'x-api-key': 'k', 'Idempotency-Key': idem },
      body: { userId: 'u1', type: 'note', payload: 'x' },
    });

    assert.equal(a.statusCode, 201);
    assert.equal(b.statusCode, 200);
    assert.equal(a.body.id, b.body.id);
    assert.equal(a.body.idempotencyKey, b.body.idempotencyKey);
  } finally {
    stopServer(proc);
  }
});

test('concurrent idempotent requests create only one signal', async () => {
  const port = '9093';
  const proc = await startServer({
    API_KEY: 'k',
    PORT: port,
    DATABASE_URL: tempDb('idempotency-concurrent'),
    RATE_LIMIT_PER_MIN: '100',
  });

  try {
    const base = `http://localhost:${port}`;
    const requests = Array.from({ length: 25 }, () =>
      postJson(`${base}/v1/signals`, {
        headers: { 'x-api-key': 'k', 'Idempotency-Key': 'parallel-key' },
        body: { userId: 'u2', type: 'note', payload: 'x' },
      }),
    );

    const responses = await Promise.all(requests);
    const ids = new Set(responses.map((r) => r.body.id));

    assert.deepEqual(new Set(responses.map((r) => r.statusCode)), new Set([200, 201]));
    assert.equal(ids.size, 1);

    const listed = await getJson(`${base}/v1/signals?userId=u2&limit=10`, {
      headers: { 'x-api-key': 'k' },
    });

    assert.equal(listed.statusCode, 200);
    assert.equal(listed.body.items.length, 1);
  } finally {
    stopServer(proc);
  }
});
