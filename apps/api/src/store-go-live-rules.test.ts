import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { parseNftMintingMode } from './collection.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import {
  composeOfferConsentNote, isCompleteOwnerOfferConsent, isOwnerDemotionReason, missingPublishRequirements,
  normalizeDocumentReference, ownerOfferConsentChecklistVersion, rewardOfferIssuanceCapMax,
} from './store-go-live-rules.js';

test('document references keep only short codes and refuse registration numbers, phones, emails and addresses', () => {
  assert.equal(normalizeDocumentReference('  CS-2609-01 '), 'CS-2609-01');
  assert.equal(normalizeDocumentReference('OWN.A01_0930'), 'OWN.A01_0930');
  assert.equal(normalizeDocumentReference('abc'), 'abc');
  assert.equal(normalizeDocumentReference(`A${'b'.repeat(39)}`), `A${'b'.repeat(39)}`);
  for (const rejected of [
    '123-45-67890', // 사업자등록번호
    '1234567890',
    '010-1234-5678', // 휴대전화
    '02.123.4567.8',
    'CS-20260930-01', // 날짜를 통째로 쓰면 8자리 숫자열이다
    'owner@example.com',
    'shop.kr',
    'https://x',
    'ab', // 너무 짧다
    `A${'b'.repeat(40)}`, // 41자
    '-CS01', // 영문·숫자로 시작해야 한다
    'CS 01',
    '동의서-01',
    'ＣＳ０１', // 전각
    '',
    undefined,
    12345,
  ]) {
    assert.equal(normalizeDocumentReference(rejected), null, String(rejected));
  }
});

test('owner offer consent needs exactly the five D-043 items, all ticked', () => {
  const full = { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true };
  assert.equal(isCompleteOwnerOfferConsent(full), true);
  for (const key of Object.keys(full)) {
    assert.equal(isCompleteOwnerOfferConsent({ ...full, [key]: false }), false, key);
    const missing: Record<string, boolean> = { ...full };
    delete missing[key];
    assert.equal(isCompleteOwnerOfferConsent(missing), false, key);
  }
  assert.equal(isCompleteOwnerOfferConsent({ ...full, extra: true }), false);
  assert.equal(isCompleteOwnerOfferConsent({ ...full, benefit: 'true' }), false);
  assert.equal(isCompleteOwnerOfferConsent(null), false);
  assert.equal(isCompleteOwnerOfferConsent([true, true, true, true, true]), false);
  assert.equal(rewardOfferIssuanceCapMax, 10_000);
});

test('consent note carries the reference and checklist version for existing readers', () => {
  const note = composeOfferConsentNote('CS-2609-01');
  assert.match(note, /CS-2609-01/);
  assert.match(note, new RegExp(ownerOfferConsentChecklistVersion));
  assert.match(note, /혜택 내용·비용 점주 부담·유효 기간·발급 상한·중복 사용 정책/);
  assert.ok(note.trim().length > 0);
});

test('demotion reasons are a fixed list', () => {
  for (const reason of ['OWNER_REQUEST', 'OWNERSHIP_CHANGED', 'VERIFICATION_FAILED', 'OTHER']) {
    assert.equal(isOwnerDemotionReason(reason), true);
  }
  assert.equal(isOwnerDemotionReason('owner_request'), false);
  assert.equal(isOwnerDemotionReason(undefined), false);
});

test('publish readiness lists every missing field', () => {
  assert.deepEqual(missingPublishRequirements({ menuItemCount: 1, businessHours: '10-18', roadAddress: '서울' }), []);
  assert.deepEqual(missingPublishRequirements({ menuItemCount: 0, businessHours: '  ', roadAddress: ' ' }),
    ['MENU', 'HOURS', 'ADDRESS']);
});

test('NFT minting mode defaults to live and refuses unknown values', () => {
  assert.equal(parseNftMintingMode(undefined), 'LIVE');
  assert.equal(parseNftMintingMode(''), 'LIVE');
  assert.equal(parseNftMintingMode('LIVE'), 'LIVE');
  assert.equal(parseNftMintingMode('PREPARING'), 'PREPARING');
  assert.throws(() => parseNftMintingMode('preparing'), /NFT_MINTING_MODE/);
  assert.throws(() => parseNftMintingMode('OFF'), /NFT_MINTING_MODE/);
});

test('the collection says minting is preparing only when the API is configured for it', async () => {
  const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
  assert.deepEqual(await new PostgresCollectionReader(pool, { nftMinting: 'PREPARING' }).getCollection('acct-1'),
    { visits: [], collectibles: [], nftMinting: 'PREPARING' });
  assert.deepEqual(await new PostgresCollectionReader(pool, { nftMinting: 'LIVE' }).getCollection('acct-1'),
    { visits: [], collectibles: [] });
  assert.deepEqual(await new PostgresCollectionReader(pool).getCollection('acct-1'), { visits: [], collectibles: [] });
});

test('offer text with control or format characters is refused before the database, like deletion reject reasons', async () => {
  const { PostgresAdminService } = await import('./postgres/admin.js');
  const pool = { connect: async () => { throw new Error('must not reach the database'); } } as unknown as Pool;
  const admin = new PostgresAdminService(pool, 'store-go-live-unit-test-hmac-secret-32-bytes');
  const base = { merchantId: 'real-1', milestone: 1, title: '김밥 한 줄 무료', detail: '', validDays: 30, issuanceCap: 100,
    consentDocumentRef: 'OF-2609-01',
    consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true } };
  for (const text of [
    { detail: '주문은 shop\u200B.kr/menu' }, // 너비 없는 공백으로 주소 모양 검사를 피하려는 글
    { title: '김밥 \u202E무료' }, // 방향 바꿈
    { detail: '첫 줄\n둘째 줄' },
    { title: '김밥\u0007' },
  ]) {
    await assert.rejects(admin.createRewardOffer('admin-1', { ...base, ...text }), /ADMIN_OFFER_TEXT_INVALID/, JSON.stringify(text));
  }
  await assert.rejects(admin.createRewardOffer('admin-1', base), /must not reach the database/);
});
