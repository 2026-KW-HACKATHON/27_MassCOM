import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { courseDraftPayload, loadAdminCourses } from '../../apps/production-web/assets/admin.mjs';

function element() {
  const listeners = new Map();
  return {
    textContent: '', value: '', children: [], attributes: {}, hidden: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    click() { return listeners.get('click')?.(); },
  };
}

const stores = [
  { id: 'a', name: '식당', status: 'ACTIVE', demo: false },
  { id: 'b', name: '카페', status: 'ACTIVE', demo: false },
  { id: 'demo', name: '시연점', status: 'ACTIVE', demo: true },
];

function page(courses = []) {
  const ids = ['admin-course-create', 'admin-course-steps', 'admin-courses', 'admin-course-status', 'admin-course-hour'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes['admin-course-create'].querySelector = () => ({ value: '2' });
  const doc = { getElementById: id => nodes[id] ?? null, createElement: element };
  const requests = [];
  const fetcher = async (path, options = {}) => {
    requests.push({ path, method: options.method ?? 'GET', body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => ({ courses }) };
  };
  const act = async (_button, request) => request();
  return { nodes, doc, fetcher, act, requests };
}

test('코스 초안은 2~4개 서로 다른 가게·목표·점주 참조를 API 형태로 보낸다', () => {
  const values = new Map([
    ['title', '식사 후 산책'], ['situation', 'AFTER_MEAL'], ['sceneKey', 'after-meal'], ['stepCount', '2'],
    ['merchantId1', 'a'], ['targetVisitCount1', '1'], ['pieceKey1', 'piece-1'], ['pieceLabel1', '그릇'],
    ['ownerOptinRef1', 'CO-2609-01'], ['merchantId2', 'b'], ['targetVisitCount2', '3'],
    ['pieceKey2', 'piece-2'], ['pieceLabel2', '컵'], ['ownerOptinRef2', 'CO-2609-02'],
  ]);
  assert.deepEqual(courseDraftPayload(values), {
    title: '식사 후 산책', situation: 'AFTER_MEAL', sceneKey: 'after-meal', startsAt: null, endsAt: null,
    countsFrom: null, steps: [
      { merchantId: 'a', targetVisitCount: 1, pieceKey: 'piece-1', pieceLabel: '그릇', ownerOptinRef: 'CO-2609-01' },
      { merchantId: 'b', targetVisitCount: 3, pieceKey: 'piece-2', pieceLabel: '컵', ownerOptinRef: 'CO-2609-02' },
    ],
  });
  assert.throws(() => courseDraftPayload(new Map(values).set('merchantId2', 'a')), /서로 다른 가게/);
  assert.throws(() => courseDraftPayload(new Map(values).set('ownerOptinRef1', '123-45-67890')), /참조 번호/);
  assert.equal(courseDraftPayload(new Map(values).set('ownerOptinRef2', '')).steps[1].ownerOptinRef, null);
  assert.throws(() => courseDraftPayload(new Map(values).set('stepCount', '5')), /2~4곳/);
  assert.equal(courseDraftPayload(new Map(values).set('startsAt', '2026-10-10T00:00')).countsFrom,
    new Date('2026-10-10T00:00').toISOString());
  assert.throws(() => courseDraftPayload(new Map(values).set('startsAt', '2026-10-11T00:00')
    .set('endsAt', '2026-10-10T00:00')), /종료 시각/);
});

test('관리 화면은 실제 점포만 고르고 저장된 점검 스냅샷과 공개·중지 동작을 표시한다', async () => {
  const course = { id: 'course-1', title: '식사 후 산책', status: 'DRAFT', checkedAt: '2026-10-08T00:00:00Z',
    steps: [{ position: 1, merchantName: '식당', targetVisitCount: 1, pieceLabel: '그릇' },
      { position: 2, merchantName: '카페', targetVisitCount: 1, pieceLabel: '컵' }],
    checkSummary: { label: '직선거리 기준 스냅샷', failures: 0, warnings: 1,
      items: [{ status: 'WARN', detail: '도보 경로가 아닌 직선거리예요.' }] } };
  const ui = page([course]);
  await loadAdminCourses(ui.fetcher, ui.doc, stores, ui.act);
  assert.equal(ui.nodes['admin-course-create'].hidden, false);
  const firstStore = ui.nodes['admin-course-steps'].children[0].children[1].children[0];
  assert.deepEqual(firstStore.children.map(option => option.value), ['a', 'b']);
  const row = ui.nodes['admin-courses'].children[0];
  assert.match(row.children[2].children[0].textContent, /스냅샷.*실패 0건 · 주의 1건/);
  assert.match(row.children[2].children[1].textContent, /직선거리/);
  await row.children[3].click();
  await row.children[4].click();
  assert.deepEqual(ui.requests.slice(1).map(request => [request.path, request.body]), [
    ['/api/web/admin/courses/course-1/check', {}],
    ['/api/web/admin/courses/course-1/publish', {}],
  ]);
  const active = page([{ ...course, status: 'ACTIVE' }]);
  await loadAdminCourses(active.fetcher, active.doc, stores, active.act);
  await active.nodes['admin-courses'].children[0].children[3].click();
  assert.equal(active.requests.at(-1).path, '/api/web/admin/courses/course-1/pause');
});

test('코스 화면은 입력 이름표와 상태 안내를 두고 인라인 이벤트를 쓰지 않는다', () => {
  const html = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="admin-course-create"/);
  assert.match(html, /id="admin-course-status" role="status" aria-live="polite"/);
  assert.match(html, /시작 시각 이후 인정된 방문만 셉니다/);
  assert.match(html, /식사\+카페 2곳.*골목 3곳.*동네 4곳/);
  assert.doesNotMatch(html, /\son(?:click|change|submit)\s*=/i);
});
