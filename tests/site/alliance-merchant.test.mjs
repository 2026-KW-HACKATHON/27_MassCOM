import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadMerchantAlliances } from '../../apps/production-web/assets/merchant.mjs';

function node() {
  const listeners = new Map();
  return {
    children: [], textContent: '', value: '', disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    fire(type) { return listeners.get(type)?.({ preventDefault() {} }); },
  };
}

test('owner portal shows only server drafts and submits this merchant consent reference', async () => {
  const list = node(), status = node();
  const doc = { getElementById: id => ({ 'merchant-alliance-list': list,
    'merchant-alliance-status': status })[id], createElement: node, createTextNode: value => value };
  const calls = [];
  let ownerOptinRef = null;
  const fetcher = async (path, options) => {
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    if (options.method === 'POST') ownerOptinRef = JSON.parse(options.body).ownerOptinRef;
    return { ok: true, status: 200, json: async () => ({ courses: [{ id: 'course-1', title: '동네 방문',
      status: 'DRAFT', startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-20T00:00:00Z', ownerOptinRef,
      steps: [{ merchantName: '실제 가게' }, { merchantName: '다른 가게' }] }] }) };
  };
  await loadMerchantAlliances(fetcher, doc, 'store-1');
  const card = list.children[0], form = card.children[4];
  assert.match(card.children[1].textContent, /실제 가게 · 다른 가게/);
  form.children[0].children[0].value = 'OWNER-OPTIN-1';
  form.children[1].children[0].checked = true;
  await form.fire('submit');
  assert.deepEqual(calls.map(call => [call.path, call.method]), [
    ['/api/web/merchant/merchants/store-1/courses', 'GET'],
    ['/api/web/merchant/merchants/store-1/courses/course-1/opt-in', 'POST'],
    ['/api/web/merchant/merchants/store-1/courses', 'GET'],
  ]);
  assert.deepEqual(calls[1].body, { ownerOptinRef: 'OWNER-OPTIN-1', consentAccepted: true });
  assert.match(list.children[0].children[3].textContent, /동의를 등록/);
  assert.equal(list.children[0].children[4].children[0].children[0].value, 'OWNER-OPTIN-1');
});
