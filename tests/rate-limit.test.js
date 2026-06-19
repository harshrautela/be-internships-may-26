import test from 'node:test';
import assert from 'node:assert/strict';
import { postJson, startServer, stopServer, tempDb } from './helpers.js';

test('rate limit: allow 5 per minute, 6th is 429', async () => {
  const port = '9092';
  const proc = await startServer({
    API_KEY: 'k',
    PORT: port,
    RATE_LIMIT_PER_MIN: '5',
    DATABASE_URL: tempDb('rate-basic'),
  });

  try {
    const base = `http://localhost:${port}`;
    const statuses = [];

    for (let i = 0; i < 6; i += 1) {
      const res = await postJson(`${base}/v1/signals`, {
        headers: { 'x-api-key': 'k' },
        body: { userId: 'u1', type: 'note', payload: String(i) },
      });
      statuses.push(res.statusCode);
    }

    const counts = statuses.reduce((acc, code) => {
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});

    assert.equal(counts[201], 5);
    assert.equal(counts[429], 1);
  } finally {
    stopServer(proc);
  }
});

test('rate limit is safe under parallel burst for same user', async () => {
  const port = '9094';
  const proc = await startServer({
    API_KEY: 'k',
    PORT: port,
    RATE_LIMIT_PER_MIN: '5',
    DATABASE_URL: tempDb('rate-parallel'),
  });

  try {
    const base = `http://localhost:${port}`;
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        postJson(`${base}/v1/signals`, {
          headers: { 'x-api-key': 'k' },
          body: { userId: 'burst-user', type: 'note', payload: String(i) },
        }),
      ),
    );

    const successCount = responses.filter((r) => r.statusCode === 201).length;
    const limitedCount = responses.filter((r) => r.statusCode === 429).length;

    assert.equal(successCount, 5);
    assert.equal(limitedCount, 15);
  } finally {
    stopServer(proc);
  }
});
