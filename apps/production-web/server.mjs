import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/production.css', ['assets/production.css', 'text/css; charset=utf-8']],
  ['/assets/production.mjs', ['assets/production.mjs', 'text/javascript; charset=utf-8']],
]);

export function resolveProductionBindHost(raw) {
  if (raw === undefined || raw === '') return '127.0.0.1';
  if (raw === '0.0.0.0') return raw;
  throw new Error('WEB_BIND_HOST_INVALID');
}

export function createProductionServer(fetcher = fetch) {
  return createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.writeHead(405, { Allow: 'GET' }).end();
      return;
    }

    const path = request.url?.split('?')[0];
    if (path === '/merchants') {
      try {
        const upstream = await fetcher('https://api.masscom.kr/merchants', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!upstream.ok || !upstream.headers.get('content-type')?.startsWith('application/json')) {
          throw new Error('merchant upstream unavailable');
        }
        const body = await upstream.text();
        if (body.length > 1_000_000) throw new Error('merchant response too large');
        const payload = JSON.parse(body);
        if (!Array.isArray(payload?.merchants) || !payload.merchants.every((merchant) =>
          merchant !== null && typeof merchant === 'object' &&
          typeof merchant.demo === 'boolean' &&
          typeof merchant.name === 'string' &&
          typeof merchant.story === 'string' &&
          typeof merchant.roadAddress === 'string')) {
          throw new Error('invalid merchant response');
        }
        const merchants = payload.merchants
          .filter((merchant) => merchant?.demo === false)
          .map(({ name, story, roadAddress }) => ({ name, story, roadAddress, demo: false }));
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          .end(JSON.stringify({ merchants }));
      } catch {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
          .end('{"error":"MERCHANTS_UNAVAILABLE"}');
      }
      return;
    }

    const file = files.get(path);
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    try {
      const content = await readFile(join(root, file[0]));
      response.writeHead(200, { 'Content-Type': file[1] }).end(content);
    } catch {
      response.writeHead(500).end();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4173);
  const bindHost = resolveProductionBindHost(process.env.MASSCOM_WEB_BIND_HOST);
  createProductionServer().listen(port, bindHost, () => {
    console.log(`운영 웹 실행: ${bindHost}:${port}`);
  });
}
