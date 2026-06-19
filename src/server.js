import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSignals, postSignal } from './signals.js';

dotenv.config();

const API_KEY = process.env.API_KEY || 'change-me';
const PORT = Number(process.env.PORT || 8080);

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;

    const key = req.headers['x-api-key'];
    if (!key || key !== API_KEY) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.post('/v1/signals', postSignal);
  app.get('/v1/signals', getSignals);

  return app;
}

const currentFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMain = currentFile === entryFile;

if (isMain) {
  const app = buildApp();

  app.listen({ host: '0.0.0.0', port: PORT }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}