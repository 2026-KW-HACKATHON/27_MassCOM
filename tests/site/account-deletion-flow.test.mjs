import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve(import.meta.dirname, '../../docs/account-deletion.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'account deletion page must include its request flow');

const receipt = '7K2M-Q9XD-4HTB-0RWE';
const filed = {
  receipt, receiptIssued: true, status: 'REQUESTED',
  requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z', dueAt: '2026-10-08T00:00:00.000Z',
};
const view = { status: 'REQUESTED', requestedAt: filed.requestedAt, cancelUntil: filed.cancelUntil, dueAt: filed.dueAt,
  cancelledAt: null, processedAt: null, rejectReason: null, deletion: null };

// 방문자 화면을 흉내 내는 최소 DOM. 폼은 버튼 하나를 갖고 submit 처리기를 등록한다.
function page(fetcher, nowIso = '2026-10-01T12:00:00.000Z') {
  const nodes = new Map();
  const ids = ['deletion-status', 'deletion-request', 'deletion-cancel-form', 'deletion-reissue-form', 'deletion-lookup',
    'deletion-receipt', 'deletion-receipt-code', 'deletion-receipt-dates', 'deletion-confirm', 'deletion-receipt-input',
    'deletion-lookup-result'];
  for (const id of ids) {
    const listeners = new Map();
    const button = { disabled: false };
    nodes.set(id, {
      id, textContent: '', hidden: true, checked: false, value: '', button,
      addEventListener: (type, callback) => listeners.set(type, callback),
      querySelector: () => button,
      submit: () => listeners.get('submit')({ preventDefault() {} }),
    });
  }
  const at = Date.parse(nowIso);
  class FixedDate extends Date {
    static now() { return at; }
  }
  const calls = [];
  runInNewContext(script, {
    document: { getElementById: (id) => nodes.get(id) },
    fetch: async (path, options) => { calls.push({ path, options }); return fetcher(path, options); },
    Date: FixedDate,
  });
  const node = (id) => nodes.get(id);
  return { node, calls, submit: (id) => node(id).submit() };
}

const reply = (status, body) => ({ status, json: async () => body });

test('page describes the 24 hour cancellation, 7 day processing and receipt without offering email as the method', () => {
  assert.match(html, /24시간 취소 기간/);
  assert.match(html, /처리 기한은 접수 뒤 7일/);
  assert.match(html, /접수번호만이 처리 결과를 확인할 수 있는 방법/);
  assert.match(html, /앱에서 요청 페이지 열기[\s\S]*Google 계정으로 로그인/);
  assert.match(html, /접수만으로 계정이나 보상 기록은 삭제되지 않습니다/);
  assert.match(html, /최근 5분 이내 재인증/);
  assert.match(html, /문의 이메일/);
  assert.match(html, /외부 지갑 비밀번호, 개인키, 복구 문구/);
  assert.doesNotMatch(html, /같은 Google 계정으로 다시 확인한 뒤 삭제를 접수합니다/);
  assert.doesNotMatch(html, /처리 기한은 아직 운영·법률 확인 전/);
  assert.doesNotMatch(html, /웹에서 이메일로/);
});

test('page keeps the receipt out of the URL, storage and markup injection', () => {
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML/);
  assert.doesNotMatch(script, /location\.(search|hash|href)|history\.|\?receipt=/);
  assert.match(script, /post\('\/api\/web\/account-deletion-status', \{ receipt:/);
});

test('page will not file until the person confirms the deletion and keeps the button usable', async () => {
  const p = page(async () => { throw new Error('must not call the server'); });
  await p.submit('deletion-request');
  assert.equal(p.calls.length, 0);
  assert.match(p.node('deletion-status').textContent, /체크한 뒤 접수/);
  assert.equal(p.node('deletion-request').button.disabled, false);
});

test('page posts an empty JSON request, shows the receipt once and never claims deletion', async () => {
  const p = page(async () => reply(202, filed));
  p.node('deletion-confirm').checked = true;
  await p.submit('deletion-request');
  assert.equal(p.calls.length, 1);
  const { path, options } = p.calls[0];
  assert.equal(path, '/api/web/account-deletion-intake');
  assert.equal(options.method, 'POST');
  assert.equal(options.body, '{}');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.cache, 'no-store');
  assert.equal(p.node('deletion-receipt').hidden, false);
  assert.equal(p.node('deletion-receipt-code').textContent, receipt);
  assert.match(p.node('deletion-receipt-dates').textContent, /접수 2026-10-01 09:00 KST · 취소 마감 2026-10-02 09:00 KST · 처리 기한 2026-10-08 09:00 KST/);
  assert.match(p.node('deletion-status').textContent, /접수번호를 지금 저장하세요/);
  assert.match(p.node('deletion-status').textContent, /접수만으로 계정이나 보상 기록은 삭제되지 않습니다/);
  assert.doesNotMatch(p.node('deletion-status').textContent, /삭제(가|를)? 완료/);
  assert.equal(p.node('deletion-request').button.disabled, false);
});

test('page shows no receipt for a repeat filing and points to the re-issue button instead', async () => {
  const p = page(async () => reply(202, { ...filed, receipt: undefined, receiptIssued: false }));
  p.node('deletion-confirm').checked = true;
  await p.submit('deletion-request');
  assert.equal(p.node('deletion-receipt').hidden, true);
  assert.match(p.node('deletion-status').textContent, /이미 접수된 요청이 있습니다/);
  assert.match(p.node('deletion-status').textContent, /접수번호 다시 받기/);
});

test('page re-issues a receipt with an explicit flag', async () => {
  const p = page(async () => reply(202, { ...filed, receipt: 'AAAA-BBBB-CCCC-DDDD' }));
  await p.submit('deletion-reissue-form');
  assert.equal(p.calls[0].options.body, '{"reissue":true}');
  assert.equal(p.node('deletion-receipt-code').textContent, 'AAAA-BBBB-CCCC-DDDD');
});

test('page reports login, origin, service, malformed and network failures as unconfirmed requests', async () => {
  const outcomes = [
    [reply(401, {}), /Google 계정으로 로그인/], [reply(403, {}), /이 주소에서는 접수할 수 없습니다/],
    [reply(503, {}), /접수할 수 없습니다/], [reply(202, { ...filed, status: 'DELETED' }), /접수된 것으로 간주하지 않습니다/],
  ];
  for (const [response, expected] of outcomes) {
    const p = page(async () => response);
    p.node('deletion-confirm').checked = true;
    await p.submit('deletion-request');
    assert.match(p.node('deletion-status').textContent, expected);
    assert.equal(p.node('deletion-receipt').hidden, true);
    assert.equal(p.node('deletion-request').button.disabled, false);
  }
  const offline = page(async () => { throw new Error('offline'); });
  offline.node('deletion-confirm').checked = true;
  await offline.submit('deletion-request');
  assert.match(offline.node('deletion-status').textContent, /연결을 확인할 수 없습니다/);
  assert.equal(offline.node('deletion-request').button.disabled, false);
});

test('page cancels only what the server confirms and explains each refusal', async () => {
  const cancelled = page(async () => reply(200, { status: 'CANCELLED' }));
  cancelled.node('deletion-receipt').hidden = false;
  await cancelled.submit('deletion-cancel-form');
  assert.equal(cancelled.calls[0].path, '/api/web/account-deletion-intake/cancel');
  assert.equal(cancelled.calls[0].options.body, '{}');
  assert.match(cancelled.node('deletion-status').textContent, /접수를 취소했습니다/);
  assert.equal(cancelled.node('deletion-receipt').hidden, true);
  for (const [status, expected] of [[401, /로그인한 뒤 취소/], [404, /취소할 접수가 없습니다/], [409, /24시간 취소 기간이 지나/],
    [500, /취소했다고 간주하지 않습니다/]]) {
    const p = page(async () => reply(status, {}));
    await p.submit('deletion-cancel-form');
    assert.match(p.node('deletion-status').textContent, expected, String(status));
    assert.equal(p.node('deletion-cancel-form').button.disabled, false);
  }
  const wrong = page(async () => reply(200, { status: 'REQUESTED' }));
  await wrong.submit('deletion-cancel-form');
  assert.match(wrong.node('deletion-status').textContent, /취소했다고 간주하지 않습니다/);
});

test('page looks a receipt up by body only and renders every status without account data', async () => {
  const cases = [
    [view, /접수됨 · 아직 취소할 수 있습니다\. 취소 마감 2026-10-02 09:00 KST · 처리 기한 2026-10-08 09:00 KST/],
    [{ ...view, cancelUntil: '2026-10-01T06:00:00.000Z' }, /취소 기간이 지나 운영자가 처리합니다/],
    [{ ...view, status: 'CANCELLED', cancelledAt: '2026-10-01T03:00:00.000Z' }, /취소됨 · 2026-10-01 12:00 KST에 취소/],
    [{ ...view, status: 'REJECTED', rejectReason: '본인 확인 불가' }, /처리되지 않음 · 사유: 본인 확인 불가 · 계정은 삭제되지 않았습니다/],
    [{ ...view, status: 'PROCESSED', deletion: { status: 'WAITING_FOR_MINT_FINALITY', completedAt: null } },
      /처리 중 · .*거래의 결과를 확인하는 중.*완료라고 하지 않습니다/],
    [{ ...view, status: 'PROCESSED', deletion: { status: 'COMPLETED', completedAt: '2026-10-03T00:00:00.000Z' } },
      /처리 완료 · 2026-10-03 09:00 KST에 삭제 처리가 끝났습니다/],
  ];
  for (const [body, expected] of cases) {
    const p = page(async () => reply(200, body));
    p.node('deletion-receipt-input').value = receipt;
    await p.submit('deletion-lookup');
    assert.equal(p.calls[0].path, '/api/web/account-deletion-status');
    assert.doesNotMatch(p.calls[0].path, /7K2M/);
    assert.deepEqual(JSON.parse(p.calls[0].options.body), { receipt });
    assert.match(p.node('deletion-lookup-result').textContent, expected);
    assert.equal(p.node('deletion-lookup').button.disabled, false);
  }
  for (const [status, expected] of [[404, /접수번호를 확인할 수 없습니다/], [429, /조회가 너무 잦습니다/], [503, /지금은 상태를 확인할 수 없습니다/]]) {
    const p = page(async () => reply(status, {}));
    p.node('deletion-receipt-input').value = 'wrong';
    await p.submit('deletion-lookup');
    assert.match(p.node('deletion-lookup-result').textContent, expected, String(status));
  }
  const offline = page(async () => { throw new Error('offline'); });
  await offline.submit('deletion-lookup');
  assert.match(offline.node('deletion-lookup-result').textContent, /상태를 알 수 없으니/);
  assert.equal(offline.node('deletion-lookup').button.disabled, false);
});
