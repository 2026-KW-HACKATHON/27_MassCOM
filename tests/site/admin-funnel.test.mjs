import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAdmin, loadAdminFunnel } from '../../apps/production-web/assets/admin.mjs';
import { installMiniDom } from '../fixtures/mini-dom.mjs';

const response = body => ({ ok: true, json: async () => body });
const sample = (days = 30, merchants = [{
  merchantId: 'real-1', name: '<월계 가게>', detailViews: 1234, countedVisits: 12,
  uniqueVisitors: 9, repeatVisitors: 2, couponsIssued: 3, couponsRedeemed: 1,
  collectiblesAcquired: 5,
}]) => ({
  from: '2026-09-04', to: '2026-10-03', days,
  totals: { detailViews: 1234, countedVisits: 12, newVisitors: 7,
    newVisitorsWithSecondStore: 2, repeatVisitors: 2 }, merchants,
});

function page(doc) {
  for (const [tag, id] of [['select', 'admin-funnel-days'], ['p', 'admin-funnel-status'],
    ['dl', 'admin-funnel-totals'], ['table', 'admin-funnel-table']]) {
    const node = doc.createElement(tag);
    node.id = id;
    doc.body.append(node);
  }
  for (const days of ['7', '30', '90']) {
    const option = doc.createElement('option');
    option.value = days;
    doc.getElementById('admin-funnel-days').append(option);
  }
  doc.getElementById('admin-funnel-days').value = '30';
}

test('관리자 흐름 지표는 계약 필드와 한국어 주의 문구를 표시하고 점포 이름을 텍스트로 다룬다', async () => {
  const dom = installMiniDom();
  try {
    page(dom.document);
    const calls = [];
    await loadAdminFunnel(async (path, init) => { calls.push({ path, init }); return response(sample()); }, dom.document);
    assert.equal(calls[0].path, '/api/web/admin/funnel?days=30');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.cache, 'no-store');
    const totals = dom.document.getElementById('admin-funnel-totals');
    assert.deepEqual(totals.querySelectorAll('dt').map(node => node.textContent),
      ['상세 조회', '방문', '새 방문자', '그중 두 번째 가게 방문', '재방문자']);
    assert.deepEqual(totals.querySelectorAll('dd').map(node => node.textContent), ['1,234', '12', '7', '2', '2']);
    const table = dom.document.getElementById('admin-funnel-table');
    assert.equal(table.querySelectorAll('tbody tr').length, 1);
    assert.equal(table.querySelector('tbody th').textContent, '<월계 가게>');
    assert.equal(table.querySelectorAll('tbody td').map(node => node.textContent).join(','), '1,234,12,9,2,3,1,5');
    assert.equal(table.querySelector('tbody th').children.length, 0, 'name is text, never parsed markup');
    const html = await import('node:fs/promises').then(fs => fs.readFile(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8'));
    assert.match(html, /방문 인증 기준이며 매출과 다를 수 있어요/);
    assert.match(html, /조회는 사람 수가 아니라 열람 횟수예요\(조회와 방문은 같은 사람으로 연결하지 않아요\)/);
  } finally { dom.restore(); }
});

test('기간 변경 중 늦은 응답은 새 지표를 덮지 않는다', async () => {
  const dom = installMiniDom();
  try {
    page(dom.document);
    let finishOld;
    const old = loadAdminFunnel(() => new Promise(resolve => { finishOld = resolve; }), dom.document);
    dom.document.getElementById('admin-funnel-days').value = '7';
    await loadAdminFunnel(async () => response(sample(7, [])), dom.document);
    finishOld(response(sample()));
    await old;
    assert.match(dom.document.getElementById('admin-funnel-status').textContent, /표시할 실제 점포가 없습니다/);
    assert.equal(dom.document.getElementById('admin-funnel-table').children.length, 0);
    assert.equal(dom.document.getElementById('admin-funnel-totals').querySelectorAll('dd').length, 5);
  } finally { dom.restore(); }
});

test('오류나 권한 실패 시 이전 수치를 지우고 상태를 알린다', async () => {
  const dom = installMiniDom();
  try {
    page(dom.document);
    await loadAdminFunnel(async () => response(sample()), dom.document);
    await loadAdminFunnel(async () => response({ days: 30, merchants: [] }), dom.document);
    assert.equal(dom.document.getElementById('admin-funnel-totals').children.length, 0);
    assert.match(dom.document.getElementById('admin-funnel-status').textContent, /불러오지 못했어요/);
    const denied = { ok: false, status: 403, json: async () => ({ code: 'ADMIN_FORBIDDEN' }) };
    await assert.rejects(loadAdminFunnel(async () => denied, dom.document), error => error.status === 403);
    assert.match(dom.document.getElementById('admin-funnel-status').textContent, /관리자 권한/);
  } finally { dom.restore(); }
});

test('전체 관리자 화면은 권한 확인 뒤에만 흐름 지표를 읽고 권한 실패 시 수치를 지운다', async () => {
  const dom = installMiniDom();
  try {
    page(dom.document);
    for (const [tag, id] of [['p', 'admin-status'], ['a', 'admin-login'], ['button', 'admin-logout'],
      ['section', 'admin-content'], ['div', 'admin-merchants'], ['form', 'admin-create']]) {
      const node = dom.document.createElement(tag);
      node.id = id;
      dom.document.body.append(node);
    }
    const calls = [];
    const fetcher = async path => {
      calls.push(path);
      if (path === '/api/web/admin/me') return response({ admin: true });
      if (path === '/api/web/admin/merchants') return response({ merchants: [] });
      if (path === '/api/web/admin/funnel?days=30') return response(sample(30, []));
      throw new Error(`unexpected ${path}`);
    };
    await loadAdmin(fetcher, dom.document);
    assert.deepEqual(calls, ['/api/web/admin/me', '/api/web/admin/merchants', '/api/web/admin/funnel?days=30']);
    assert.equal(dom.document.getElementById('admin-content').hidden, false);
    assert.equal(dom.document.getElementById('admin-funnel-totals').children.length, 5);
    await loadAdmin(async path => path === '/api/web/admin/me'
      ? { ok: false, status: 403, json: async () => ({ code: 'ADMIN_FORBIDDEN' }) }
      : response(sample()), dom.document);
    assert.equal(dom.document.getElementById('admin-content').hidden, true);
    assert.equal(dom.document.getElementById('admin-funnel-totals').children.length, 0);
    assert.match(dom.document.getElementById('admin-status').textContent, /관리자 권한이 없습니다/);
  } finally { dom.restore(); }
});
