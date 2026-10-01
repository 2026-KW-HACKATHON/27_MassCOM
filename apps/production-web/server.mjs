import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/production.css', ['assets/production.css', 'text/css; charset=utf-8']],
  ['/app/assets/production.css', ['assets/production.css', 'text/css; charset=utf-8']],
  ['/assets/production.mjs', ['assets/production.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/mascot-stamp.png', ['assets/mascot-stamp.png', 'image/png']],
  ['/app/assets/mascot-stamp.png', ['assets/mascot-stamp.png', 'image/png']],
  ['/merchant/assets/mascot-stamp.png', ['assets/mascot-stamp.png', 'image/png']],
  ['/admin/assets/mascot-stamp.png', ['assets/mascot-stamp.png', 'image/png']],
  ['/admin/', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin/assets/admin.mjs', ['assets/admin.mjs', 'text/javascript; charset=utf-8']],
  ['/merchant/', ['merchant.html', 'text/html; charset=utf-8']],
  ['/merchant/assets/merchant.mjs', ['assets/merchant.mjs', 'text/javascript; charset=utf-8']],
]);
for (const file of ['collectible-model.mjs', 'collectible-errors.mjs', 'collectible-assist.mjs', 'collectible-editor.mjs', 'collectible-studio.mjs', 'collectible-renderer.mjs', 'collectible-viewer.mjs', 'collectible-editor.css', 'collectible-viewer.css']) {
  const mime = file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
  for (const prefix of ['/assets/', '/app/assets/', '/merchant/assets/']) files.set(`${prefix}${file}`, [`assets/${file}`, mime]);
}

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
    if (path?.startsWith('/admin/') || path?.startsWith('/merchant/')) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
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
          typeof merchant.roadAddress === 'string' &&
          (merchant.businessHours === undefined || (typeof merchant.businessHours === 'string' &&
            merchant.businessHours.length <= 1000)) &&
          (merchant.menuItems === undefined || (Array.isArray(merchant.menuItems) &&
            merchant.menuItems.length <= 30 && merchant.menuItems.every(item => item &&
              typeof item.name === 'string' && item.name.trim() && item.name.length <= 200 &&
              Number.isSafeInteger(item.priceWon) && item.priceWon >= 0 && item.priceWon <= 1_000_000_000))))) {
          throw new Error('invalid merchant response');
        }
        const merchants = payload.merchants
          .filter((merchant) => merchant?.demo === false)
          .map(({ name, story, roadAddress, menuItems = [], businessHours = '' }) =>
            ({ name, story, roadAddress, menuItems, businessHours, demo: false }));
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
