import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

export function tempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signals-test-'));
  return path.join(dir, `${name}.db`);
}

export async function startServer(env) {
  const proc = spawn('node', ['src/server.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  await wait(450);
  return proc;
}

export function stopServer(proc) {
  if (proc && !proc.killed) proc.kill();
}

export function postJson(url, { headers = {}, body = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let chunks = '';
        res.on('data', (chunk) => {
          chunks += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body: chunks ? JSON.parse(chunks) : {},
          });
        });
      },
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

export function getJson(url, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, (res) => {
      let chunks = '';
      res.on('data', (chunk) => {
        chunks += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: chunks ? JSON.parse(chunks) : {},
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}
