import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { configureCreator, validMerchantArtFile } from '../../apps/production-web/assets/merchant.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom;
beforeEach(() => { dom = installMiniDom(); });
afterEach(() => dom.restore());

const oldArt = `/merchant-art/${'a'.repeat(64)}.webp`;
const newArt = `/merchant-art/${'b'.repeat(64)}.webp`;
const imageDataUrl = 'data:image/png;base64,AAAA';
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function page({ role = 'OWNER', upload = () => response({ artUrl: newArt }) } = {}) {
  const doc = dom.document;
  doc.body.innerHTML = readFileSync(new URL('../../apps/production-web/merchant.html', import.meta.url), 'utf8');
  const merchant = { id: 'shop-1', name: '월계 식당', role, artUrl: oldArt };
  const calls = [];
  const fetcher = async (path, options) => { calls.push({ path, options }); return upload(path, options); };
  configureCreator(fetcher, doc, { accountScope: 'photo-test', merchants: [merchant] });
  const input = doc.getElementById('merchant-art-file');
  const rights = doc.getElementById('merchant-art-rights');
  const preview = doc.getElementById('merchant-art-preview');
  const current = doc.getElementById('merchant-art-current-image');
  const apply = doc.getElementById('merchant-art-apply');
  const cancel = doc.getElementById('merchant-art-cancel');
  const form = doc.getElementById('merchant-art-upload-form');
  const status = doc.getElementById('merchant-art-status');
  const choose = async file => { input.files = [file]; input.value = 'C:\\fakepath\\photo.png'; await input.onchange(); await settle(); };
  const submit = () => form.onsubmit({ preventDefault() {} });
  return { doc, merchant, calls, input, rights, preview, current, apply, cancel, form, status, choose, submit };
}

test('direct photo selection previews locally; only explicit apply sends the owner session request', async () => {
  const ui = page();
  assert.equal(ui.current.src, oldArt);
  await ui.choose({ type: 'image/png', size: 4, dataUrl: imageDataUrl });
  assert.equal(ui.input.value, 'C:\\fakepath\\photo.png', 'required file input remains selected until apply or cancel');
  assert.equal(ui.preview.src, imageDataUrl);
  assert.equal(ui.preview.hidden, false);
  assert.equal(ui.apply.disabled, true);
  assert.deepEqual(ui.calls, []);
  ui.rights.checked = true; ui.rights.onchange();
  assert.equal(ui.apply.disabled, false);
  await ui.submit();
  assert.deepEqual(ui.calls.map(call => [call.path, call.options.method, call.options.credentials,
    call.options.headers['Content-Type'], JSON.parse(call.options.body)]), [[
    '/api/web/merchant/merchants/shop-1/art/upload', 'POST', 'same-origin', 'application/json', { imageDataUrl },
  ]]);
  assert.equal(ui.merchant.artUrl, newArt);
  assert.equal(ui.current.src, newArt);
  assert.equal(ui.preview.hidden, true);
});

test('cancel and failed upload leave the previous art applied', async () => {
  const ui = page({ upload: () => response({ code: 'MERCHANT_ACCESS_DENIED' }, 403) });
  await ui.choose({ type: 'image/png', size: 4, dataUrl: imageDataUrl });
  ui.cancel.onclick();
  assert.equal(ui.current.src, oldArt);
  assert.equal(ui.preview.hidden, true);
  assert.deepEqual(ui.calls, []);
  await ui.choose({ type: 'image/png', size: 4, dataUrl: imageDataUrl });
  ui.rights.checked = true; ui.rights.onchange();
  await ui.submit();
  assert.equal(ui.current.src, oldArt);
  assert.equal(ui.merchant.artUrl, oldArt);
  assert.equal(ui.preview.hidden, false);
  assert.match(ui.status.textContent, /그림 제작 권한/);
});

test('invalid image type or size and staff without art permission never upload', async () => {
  assert.equal(validMerchantArtFile({ type: 'image/webp', size: 5 * 1024 * 1024 }), true);
  for (const file of [{ type: 'image/svg+xml', size: 4 }, { type: 'image/png', size: 5 * 1024 * 1024 + 1 },
    { type: 'image/jpeg', size: 0 }]) assert.equal(validMerchantArtFile(file), false);
  const ui = page({ role: 'STAFF' });
  await ui.choose({ type: 'image/svg+xml', size: 4 });
  assert.equal(ui.preview.hidden, true);
  assert.equal(ui.doc.getElementById('merchant-creator').hidden, true);
  await ui.submit();
  assert.deepEqual(ui.calls, []);
});
