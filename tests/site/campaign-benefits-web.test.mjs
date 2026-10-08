import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { bindAdminBenefits, campaignBenefitPayload, loadAdminBenefit } from '../../apps/production-web/assets/admin.mjs';
import { benefitStatusText, campaignBenefitsStatusText } from '../../apps/production-web/assets/campaign-benefit-status.mjs';
import { configureMerchantOperations } from '../../apps/production-web/assets/merchant.mjs';

const consent = Object.fromEntries(['Benefit', 'OwnerPaysCost', 'Validity', 'IssuanceCap', 'DuplicateUse']
  .map(name => [`consent${name}`, 'on']));
const form = extra => new Map(Object.entries({ title: '커피 한 잔', detail: '다음 방문 때 사용', validDays: '7',
  unitExtraCostWon: '1500', maxUses: '2', consentDocumentRef: 'CB-2609-01', ...consent, ...extra }));
const benefit = { id: 'benefit-1', title: '커피 한 잔', status: 'ACTIVE', maxUses: 2, issuedCount: 2,
  issued: 2, redeemed: 1, usable: 1, expiredUnused: 0, additionalIssuable: 0, unitExtraCostWon: 1500,
  costBorne: '1500', maxExposure: '3000', promisedMaxCost: '3000' };

test('admin form sends the five recorded consents and exact cost cap, rejecting incomplete terms', () => {
  assert.deepEqual(campaignBenefitPayload(form()), { title: '커피 한 잔', detail: '다음 방문 때 사용',
    validDays: 7, unitExtraCostWon: 1500, maxUses: 2, consentDocumentRef: 'CB-2609-01',
    consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true } });
  assert.throws(() => campaignBenefitPayload(form({ consentOwnerPaysCost: null })), /5항목/);
  assert.throws(() => campaignBenefitPayload(form({ unitExtraCostWon: '1000001' })), /추가 원가/);
  assert.throws(() => campaignBenefitPayload(form({ maxUses: '0' })), /발급 상한/);
  assert.throws(() => campaignBenefitPayload(form({ consentDocumentRef: '01012345678' })), /참조 번호/);
});

test('four-number cost display preserves bigint precision and names additional cost', () => {
  assert.match(benefitStatusText(benefit), /발급 2장 · 사용 1장 · 사용 가능 1장 · 만료 미사용 0장 · 추가 발급 가능 0장/);
  assert.match(benefitStatusText(benefit), /부담한 추가 원가 1,500원 · 이미 약속한 최대 비용 3,000원 · 최대 추가 원가 3,000원/);
  assert.match(benefitStatusText({ ...benefit, maxExposure: '9007199254740993' }), /9,007,199,254,740,993원/);
  assert.equal(benefitStatusText(null), '등록된 캠페인 혜택이 없습니다.');
  assert.equal(benefitStatusText({ ...benefit, maxExposure: 'bad' }), '혜택 현황을 확인하지 못했습니다.');
  assert.match(campaignBenefitsStatusText({ benefits: [{ ...benefit, id: 'old', status: 'PAUSED' },
    { ...benefit, id: 'new', title: '다음 혜택', costBorne: '5000' }] }),
  /커피 한 잔.*부담한 추가 원가 1,500원.*다음 혜택.*부담한 추가 원가 5,000원/);
});

test('admin benefit status changes the form and pause control from the selected campaign response', async () => {
  const nodes = { 'admin-benefit-campaign': { value: 'campaign-1' },
    'admin-benefit-status': { textContent: '' }, 'admin-benefit-form': { hidden: true, reference: 'OLD-2609-01', checked: true,
      resetCount: 0, reset() { this.reference = ''; this.checked = false; this.resetCount++; } },
    'admin-benefit-pause': { hidden: true } };
  const doc = { getElementById: id => nodes[id] };
  let response = { benefit: null };
  const calls = [];
  const fetcher = async (path, options) => { calls.push({ path, options }); return { ok: true, json: async () => response }; };
  await loadAdminBenefit(fetcher, doc);
  assert.equal(nodes['admin-benefit-form'].hidden, false);
  assert.equal(nodes['admin-benefit-pause'].hidden, true);
  response = { benefit };
  await loadAdminBenefit(fetcher, doc);
  assert.equal(nodes['admin-benefit-form'].hidden, true);
  assert.equal(nodes['admin-benefit-pause'].hidden, false);
  assert.match(nodes['admin-benefit-status'].textContent, /추가 원가/);
  response = { benefit: { ...benefit, status: 'PAUSED' } };
  await loadAdminBenefit(fetcher, doc);
  assert.equal(nodes['admin-benefit-form'].hidden, false);
  assert.equal(nodes['admin-benefit-pause'].hidden, true);
  assert.equal(nodes['admin-benefit-form'].reference, '');
  assert.equal(nodes['admin-benefit-form'].checked, false);
  assert.equal(nodes['admin-benefit-form'].resetCount, 2);
  assert.match(nodes['admin-benefit-status'].textContent, /발급 중지.*부담한 추가 원가 1,500원/);
  response = { benefit: benefit, benefits: [benefit, { ...benefit, id: 'old', status: 'PAUSED',
    title: '지난 혜택', promisedMaxCost: '4500' }] };
  await loadAdminBenefit(fetcher, doc);
  assert.equal(nodes['admin-benefit-form'].hidden, true);
  assert.equal(nodes['admin-benefit-pause'].hidden, false);
  assert.match(nodes['admin-benefit-status'].textContent, /지난 혜택.*이미 약속한 최대 비용 4,500원/);
  assert.equal(calls[0].path, '/api/web/admin/campaigns/campaign-1/benefit-status');
  assert.equal(calls[0].options.credentials, 'same-origin');
});

test('admin form creates only with consent, then pauses the selected benefit', async () => {
  const nodes = { 'admin-benefit-campaign': node(), 'admin-benefit-status': node(),
    'admin-benefit-form': node(), 'admin-benefit-pause': node() };
  nodes['admin-benefit-campaign'].value = 'campaign-1';
  nodes['admin-benefit-form'].querySelector = () => node();
  nodes['admin-benefit-form'].reset = () => {};
  const doc = { getElementById: id => nodes[id], defaultView: { confirm: () => true,
    FormData: class { constructor() { return form(); } } } };
  let current = null;
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) });
    if (path.endsWith('/benefit') && options.method === 'POST') current = benefit;
    if (path.endsWith('/benefit/pause')) current = { ...benefit, status: 'PAUSED' };
    return { ok: true, json: async () => ({ benefit: current }) };
  };
  bindAdminBenefits(fetcher, doc);
  await nodes['admin-benefit-form'].fire('submit');
  assert.equal(calls[0].path, '/api/web/admin/campaigns/campaign-1/benefit');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.consent.ownerPaysCost, true);
  assert.equal(nodes['admin-benefit-pause'].hidden, false);
  await nodes['admin-benefit-pause'].fire('click');
  assert.equal(calls.at(-2).path, '/api/web/admin/campaigns/campaign-1/benefit/pause');
  assert.equal(nodes['admin-benefit-pause'].hidden, true);
  assert.equal(nodes['admin-benefit-form'].hidden, false);
  assert.match(nodes['admin-benefit-status'].textContent, /발급 중지/);
});

function node() {
  const listeners = new Map();
  return { value: '', textContent: '', hidden: false, children: [],
    append(...children) { this.children.push(...children); if (!this.value && children[0]?.value) this.value = children[0].value; },
    replaceChildren() { this.children = []; this.value = ''; },
    addEventListener(kind, listener) { listeners.set(kind, listener); },
    fire(kind) { return listeners.get(kind)?.({ preventDefault() {}, currentTarget: this }); },
  };
}

test('owner panel reads the selected campaign and displays all old and current obligations', async () => {
  const ids = ['merchant-operations', 'merchant-operations-merchant', 'merchant-benefit-campaign',
    'merchant-extension-status', 'merchant-extension-current', 'merchant-benefit-status',
    'merchant-staff-list', 'merchant-staff-status'];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  const doc = { getElementById: id => nodes[id], createElement: node };
  const calls = [];
  const fetcher = async path => {
    calls.push(path);
    const data = path.endsWith('/campaigns') ? { campaigns: [{ id: 'campaign-1', title: '점심', endsAt: '2026-11-01T00:00:00Z' }] }
      : path.endsWith('/staff') ? { staff: [] } : { benefit, benefits: [benefit, { ...benefit, id: 'old',
        title: '지난 혜택', status: 'PAUSED', promisedMaxCost: '4500' }] };
    return { ok: true, json: async () => data };
  };
  configureMerchantOperations(fetcher, doc, [{ id: 'merchant-1', name: '월계 김밥', role: 'OWNER' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes('/api/web/merchant/merchants/merchant-1/campaigns/campaign-1/benefit-status'));
  assert.match(nodes['merchant-benefit-status'].textContent, /커피 한 잔.*지난 혜택.*이미 약속한 최대 비용 4,500원/);
});

test('benefit markup keeps each control labelled and provides live status', () => {
  const admin = readFileSync(new URL('../../apps/production-web/admin.html', import.meta.url), 'utf8');
  const merchant = readFileSync(new URL('../../apps/production-web/merchant.html', import.meta.url), 'utf8');
  assert.match(admin, /id="admin-benefit-form"[^]*?점주 동의 확인 \(5항목 모두\)/);
  assert.match(admin, /id="admin-benefit-status" class="status" role="status" aria-live="polite"/);
  assert.match(merchant, /id="merchant-benefit-status" class="status" role="status" aria-live="polite"/);
  assert.doesNotMatch(admin + merchant, /신규 고객|첫 손님/);
});
