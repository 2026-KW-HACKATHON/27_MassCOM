import assert from 'node:assert/strict';
import { test } from 'node:test';

import { configureMerchantOperations } from '../../apps/production-web/assets/merchant.mjs';

function node() {
  const listeners = new Map();
  return {
    value: '', textContent: '', hidden: false, disabled: false, children: [],
    append(...children) {
      this.children.push(...children);
      if (!this.value && children[0]?.value) this.value = children[0].value;
    },
    replaceChildren() { this.children = []; this.value = ''; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatch(type) { return listeners.get(type)?.({ preventDefault() {}, currentTarget: this }); },
    querySelector() { return this.button; },
    click() { this.clicked = true; },
    remove() { this.removed = true; },
  };
}

test('merchant CSV control downloads a real Blob with the chosen KST date range', async () => {
  const ids = ['merchant-operations', 'merchant-operations-merchant', 'merchant-extension-campaign',
    'merchant-extension-status', 'merchant-extension-current', 'merchant-staff-list', 'merchant-staff-status',
    'merchant-export-status', 'merchant-extension-form', 'merchant-staff-approve', 'merchant-export-form'];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  const form = nodes['merchant-export-form'];
  form.button = node();
  form.elements = { from: { value: '2026-10-01' }, to: { value: '2026-10-07' } };
  nodes['merchant-extension-form'].button = node();
  nodes['merchant-staff-approve'].button = node();
  const links = [];
  const doc = {
    getElementById(id) { return nodes[id]; },
    createElement() { return node(); },
    body: { append(link) { links.push(link); } },
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/campaigns')) return { ok: true, json: async () => ({ campaigns: [] }) };
    if (url.endsWith('/staff')) return { ok: true, json: async () => ({ staff: [] }) };
    if (url.includes('/visits.csv?')) return { ok: true, blob: async () => new Blob(['\uFEFF방문일\r\n']) };
    throw new Error(`unexpected URL ${url}`);
  };
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  let revoked = '';
  URL.createObjectURL = () => 'blob:test-csv';
  URL.revokeObjectURL = value => { revoked = value; };
  try {
    configureMerchantOperations(fetcher, doc, [{ id: 'shop-a', name: '가게 A', role: 'OWNER' }]);
    await form.dispatch('submit');
    assert.equal(nodes['merchant-operations'].hidden, false);
    assert.equal(calls.at(-1).url,
      '/api/web/merchant/merchants/shop-a/visits.csv?from=2026-10-01&to=2026-10-07');
    assert.equal(calls.at(-1).options.credentials, 'same-origin');
    assert.equal(links[0].download, 'masscom-visits-2026-10-01-2026-10-07.csv');
    assert.equal(links[0].clicked, true);
    assert.equal(links[0].removed, true);
    assert.equal(revoked, 'blob:test-csv');
    assert.equal(nodes['merchant-export-status'].textContent, 'CSV를 내려받았습니다.');
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
