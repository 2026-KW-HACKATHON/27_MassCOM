import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProductionServer } from '../../apps/production-web/server.mjs';

// 화면 검수용 합성 서버가 운영 모양과 어긋나면(예: 공개 /merchants가 id·campaign을 돌려주면) 운영에서만 드러나는 결함이 가려진다.
const fixture = fileURLToPath(new URL('../fixtures/collectible-qa-server.mjs', import.meta.url));
let child, port;
before(async () => {
  port = await new Promise(resolve => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => resolve(free)); }); });
  child = spawn(process.execPath, [fixture], { env: { ...process.env, COLLECTIBLE_QA_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.on('data', chunk => { if (String(chunk).includes('ready')) resolve(); }); });
});
after(() => child?.kill());
const get = async path => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

test('QA 서버의 /merchants는 운영 프록시가 돌려주는 모양과 같고 id·campaign이 없다', async () => {
  const raw = await get('/merchants');
  const proxy = createProductionServer(() => fetch(`http://127.0.0.1:${port}/merchants`));
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const proxied = await (await fetch(`http://127.0.0.1:${proxy.address().port}/merchants`)).json();
    assert.deepEqual(raw, proxied);
    assert.equal(raw.merchants.some(item => 'id' in item || 'campaign' in item), false);
  } finally { await new Promise(resolve => proxy.close(resolve)); }
});

test('QA 서버의 캠페인 목록은 서버 계약(docs/COLLECTIBLE_CREATOR.md)의 모양이다', async () => {
  const me = await get('/api/web/merchant/me');
  assert.deepEqual(Object.keys(me.merchants[0]).sort(), ['id', 'name', 'role']);
  const { campaigns } = await get(`/api/web/merchant/merchants/${me.merchants[0].id}/collectible-campaigns`);
  assert.equal(campaigns.length, 1);
  assert.deepEqual(Object.keys(campaigns[0]).sort(), ['endsAt', 'goals', 'id', 'publication', 'startsAt', 'status', 'title']);
  assert.equal(campaigns[0].status, 'ACTIVE');
  assert.deepEqual(campaigns[0].goals, [1, 3, 5]);
  assert.equal(campaigns[0].publication, null);
});
