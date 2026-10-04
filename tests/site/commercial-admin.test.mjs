import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { campaignExtensionMessage, loadAdmin } from '../../apps/production-web/assets/admin.mjs';
import { campaignTiming, orderedCampaigns } from '../../apps/production-web/assets/commercial-operation.mjs';

function element() {
  const listeners = new Map();
  return {
    textContent: '', children: [], hidden: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { return listeners.get('click')?.(); },
    focus() { this.focused = true; },
  };
}

const ok = value => ({ ok: true, json: async () => value });
const error = (status, code) => ({ ok: false, status, json: async () => ({ code }) });
const generatedAt = '2026-10-04T14:59:59.000Z'; // KST 10월 4일 23:59:59
const campaign = (id, endsAt, status = 'ACTIVE') => ({
  id, merchantName: `가게 ${id}`, title: '가을 수집', startsAt: '2026-09-01T00:00:00.000Z',
  endsAt, status, enrollmentCapacity: 20, enrolledCount: 3,
});

function page(campaigns, { confirm = () => true, onExtend = () => ok({ endsAt: '2026-11-03T16:00:00.000Z' }),
  serverTime = generatedAt, onList } = {}) {
  const ids = ['admin-status', 'admin-login', 'admin-logout', 'admin-content', 'admin-merchants',
    'admin-create', 'admin-campaigns', 'admin-campaign-summary'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const confirms = [];
  const writes = [];
  let listReads = 0;
  const doc = {
    getElementById(id) { return nodes[id] ?? null; },
    createElement: element,
    defaultView: { confirm(message) { confirms.push(message); return confirm(message); } },
  };
  const fetcher = async (path, options = {}) => {
    const method = options.method ?? 'GET';
    if (method === 'POST') {
      writes.push({ path, body: JSON.parse(options.body) });
      if (path.endsWith('/extend')) return onExtend();
      return ok({});
    }
    if (path === '/api/web/admin/me') return ok({ admin: true });
    if (path === '/api/web/admin/merchants') return ok({ merchants: [] });
    if (path === '/api/web/admin/campaigns') {
      listReads++;
      return onList?.(listReads) ?? ok({ campaigns, generatedAt: serverTime });
    }
    if (path === '/api/web/admin/campaign-drafts') return ok({ drafts: [] });
    if (path === '/api/web/admin/reward-offers') return ok({ offers: [] });
    if (path === '/api/web/admin/account-deletion-intakes') return ok({ intakes: [] });
    if (path === '/api/web/admin/operations-status') return ok({ merchants: [] });
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { nodes, doc, fetcher, confirms, writes, listReads: () => listReads };
}

test('서버 시각으로 종료일을 세고 곧 종료·종료됨을 우선 배치한다', () => {
  assert.deepEqual(campaignTiming('2026-10-04T15:00:00.000Z', generatedAt),
    { daysLeft: 1, ended: false, soon: true });
  assert.deepEqual(campaignTiming('2026-10-04T14:59:59.000Z', generatedAt),
    { daysLeft: 0, ended: true, soon: false });
  const campaigns = [campaign('later', '2026-11-01T00:00:00.000Z'),
    campaign('ended', '2026-10-01T00:00:00.000Z'), campaign('soon', '2026-10-04T15:00:00.000Z')];
  assert.deepEqual(orderedCampaigns(campaigns, generatedAt).map(item => item.id), ['soon', 'ended', 'later']);
  assert.equal(campaigns[0].id, 'later');
});

test('목록은 요약과 남은 일수를 보여 주고 30일 연장에 원본 종료 시각을 보낸다', async () => {
  const end = '2026-10-04T15:00:00.000Z';
  const campaigns = [campaign('later', '2026-11-01T00:00:00.000Z'),
    campaign('ended', '2026-10-01T00:00:00.000Z', 'ENDED'), campaign('soon', end)];
  const ui = page(campaigns);
  await loadAdmin(ui.fetcher, ui.doc);
  assert.equal(ui.nodes['admin-campaign-summary'].textContent,
    '14일 안에 끝나는 캠페인 1개 · 이미 끝난 캠페인 1개');
  assert.equal(ui.nodes['admin-campaign-summary'].hidden, false);
  const [soon, ended, later] = ui.nodes['admin-campaigns'].children;
  assert.match(soon.textContent, /가게 soon.*종료까지 1일 · 곧 종료/);
  assert.match(ended.textContent, /가게 ended.*종료됨/);
  assert.match(later.textContent, /가게 later.*종료까지/);
  assert.deepEqual(soon.children.map(button => button.textContent), ['중지', '30일 연장', '90일 연장']);
  await soon.children[1].click();
  assert.match(ui.confirms[0], /가게 soon.*2026-11-04 00:00 KST/s);
  assert.deepEqual(ui.writes.at(-1), { path: '/api/web/admin/campaigns/soon/extend',
    body: { days: 30, expectedEndsAt: end } });
  assert.match(ui.nodes['admin-status'].textContent, /캠페인을 30일 연장했습니다. 새 종료일은 2026-11-04 01:00 KST/);
  assert.equal(ui.listReads(), 2);
});

test('버전 충돌은 새 목록을 읽고 알리며, 취소는 전송하지 않고 서버 상한 오류를 안내한다', async () => {
  const first = page([campaign('one', '2026-10-10T00:00:00.000Z')],
    { onExtend: () => error(409, 'ADMIN_VERSION_CONFLICT') });
  await loadAdmin(first.fetcher, first.doc);
  await first.nodes['admin-campaigns'].children[0].children[1].click();
  assert.match(first.nodes['admin-status'].textContent, /다른 곳에서 먼저 바뀌었어요. 목록을 새로 불러왔어요/);
  assert.equal(first.listReads(), 2);
  assert.equal(first.nodes['admin-status'].focused, true);

  const cancelled = page([campaign('one', '2026-10-10T00:00:00.000Z')], { confirm: () => false });
  await loadAdmin(cancelled.fetcher, cancelled.doc);
  await cancelled.nodes['admin-campaigns'].children[0].children[1].click();
  assert.equal(cancelled.writes.filter(call => call.path.endsWith('/extend')).length, 0);

  const capped = page([campaign('long', '2027-09-30T00:00:00.000Z')],
    { onExtend: () => error(400, 'ADMIN_CAMPAIGN_EXTENSION_LIMIT') });
  await loadAdmin(capped.fetcher, capped.doc);
  await capped.nodes['admin-campaigns'].children[0].children[2].click();
  assert.match(capped.nodes['admin-status'].textContent, /365일/);
  assert.equal(capped.writes.filter(call => call.path.endsWith('/extend')).length, 1);
});

test('서버 시각이나 갱신 결과가 없으면 남은 기간을 추측하거나 갱신 성공으로 알리지 않는다', async () => {
  const oldResponse = page([campaign('one', '2026-10-10T00:00:00.000Z')], { serverTime: null });
  await loadAdmin(oldResponse.fetcher, oldResponse.doc);
  assert.match(oldResponse.nodes['admin-campaign-summary'].textContent, /서버 기준 시각을 확인하지 못했어요/);
  assert.equal(oldResponse.nodes['admin-campaigns'].children[0].children.length, 1);

  const reloadFails = () => error(503, 'TEMPORARY');
  const item = campaign('one', '2026-10-10T00:00:00.000Z');
  const success = page([item], { onList: reads => reads === 1 ? ok({ campaigns: [item], generatedAt }) : reloadFails() });
  await loadAdmin(success.fetcher, success.doc);
  await success.nodes['admin-campaigns'].children[0].children[1].click();
  assert.match(success.nodes['admin-status'].textContent, /목록을 다시 불러오지 못했습니다/);
  assert.doesNotMatch(success.nodes['admin-status'].textContent, /연장했습니다/);

  const conflict = page([item], { onExtend: () => error(409, 'ADMIN_VERSION_CONFLICT'),
    onList: reads => reads === 1 ? ok({ campaigns: [item], generatedAt }) : reloadFails() });
  await loadAdmin(conflict.fetcher, conflict.doc);
  await conflict.nodes['admin-campaigns'].children[0].children[1].click();
  assert.match(conflict.nodes['admin-status'].textContent, /목록을 다시 불러오지 못했습니다/);
  assert.doesNotMatch(conflict.nodes['admin-status'].textContent, /목록을 새로 불러왔어요/);
});

test('연장 오류 문구와 CSP 호환 마크업을 유지한다', () => {
  assert.match(campaignExtensionMessage({ code: 'ADMIN_CAMPAIGN_EXTENSION_LIMIT' }), /365일/);
  assert.match(campaignExtensionMessage({ code: 'ADMIN_CAMPAIGN_ACTIVE_EXISTS' }), /이미 공개 중인 캠페인/);
  assert.match(campaignExtensionMessage({ code: 'ADMIN_VERSION_CONFLICT' }), /목록을 새로 불러왔어요/);
  assert.match(campaignExtensionMessage({ code: 'UNKNOWN' }), /연장하지 못했습니다/);
  const html = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="admin-campaign-summary"/);
  assert.doesNotMatch(html, /\son(?:click|change|submit)\s*=|\sstyle\s*=/i);
});
