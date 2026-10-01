import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canOfferMint, chainLabel, mintRefusalText, nftGroupSummary, nftPreparingLabel, nftPreparingNote, nftStatusLabel, shortAddress } from './nft-status';

test('발행 준비 중인 운영 도감은 접수·진행 문구 대신 "발행 준비 중"을 보이고 발행 단추를 두지 않는다', () => {
  for (const status of ['NOT_REQUESTED', 'QUEUED', 'CONFIRMING', 'REVIEW_REQUIRED'] as const) {
    assert.equal(nftStatusLabel(status, 'PREPARING'), '발행 준비 중', status);
    assert.equal(canOfferMint(status, 'PREPARING'), false, status);
  }
  assert.equal(nftPreparingLabel, '발행 준비 중');
  // 이미 등록된 NFT는 그대로 알린다.
  assert.equal(nftStatusLabel('FINALIZED', 'PREPARING'), '등록 완료');
});

test('필드가 없으면(시연·옛 서버) 지금 문구와 발행 단추를 그대로 둔다', () => {
  assert.equal(nftStatusLabel('NOT_REQUESTED'), '발행하지 않음');
  assert.equal(nftStatusLabel('QUEUED'), 'NFT 접수');
  assert.equal(nftStatusLabel('CONFIRMING'), '블록체인 확인 중');
  assert.equal(nftStatusLabel('FINALIZED'), '등록 완료');
  assert.equal(nftStatusLabel('REVIEW_REQUIRED'), '확인 필요');
  assert.equal(canOfferMint('NOT_REQUESTED'), true);
  assert.equal(canOfferMint('QUEUED'), false);
});

test('발행 준비 중 거절(409 NFT_MINTING_PREPARING)은 코드 대신 준비 중 안내를 보인다', () => {
  assert.equal(mintRefusalText('NFT_MINTING_PREPARING'), nftPreparingNote);
  assert.match(nftPreparingNote, /준비 중.*기록은 그대로/);
  assert.equal(mintRefusalText('MINT_PENDING'), '이미 처리 중인 NFT 작업이 있습니다.');
  assert.equal(mintRefusalText('SOMETHING_NEW'), 'NFT 접수 실패: SOMETHING_NEW');
});

test('a grouped card with duplicate entitlements summarizes "실제 NFT N개 · APP N개", or the plain label for a single copy', () => {
  assert.equal(nftGroupSummary([{ nftStatus: 'NOT_REQUESTED' }]), '발행하지 않음');
  assert.equal(nftGroupSummary([{ nftStatus: 'NOT_REQUESTED' }, { nftStatus: 'NOT_REQUESTED' }, { nftStatus: 'FINALIZED' }]), '실제 NFT 1개 · APP 2개');
  assert.equal(nftGroupSummary([{ nftStatus: 'FINALIZED' }, { nftStatus: 'FINALIZED' }]), '실제 NFT 2개');
  assert.equal(nftGroupSummary([{ nftStatus: 'QUEUED' }, { nftStatus: 'NOT_REQUESTED' }]), 'APP 2개');
  assert.equal(nftGroupSummary([{ nftStatus: 'NOT_REQUESTED' }], 'PREPARING'), '발행 준비 중');
  // 운영이 발행 준비 중일 때는 여러 벌이 묶인 카드도 "접수"·"APP" 대신 "발행 준비 중"으로 말한다.
  assert.equal(nftGroupSummary([{ nftStatus: 'QUEUED' }, { nftStatus: 'NOT_REQUESTED' }], 'PREPARING'), '발행 준비 중');
  assert.equal(nftGroupSummary([{ nftStatus: 'FINALIZED' }, { nftStatus: 'NOT_REQUESTED' }], 'PREPARING'), '실제 NFT 1개 · 발행 준비 중 1개');
  assert.equal(nftGroupSummary([{ nftStatus: 'FINALIZED' }, { nftStatus: 'FINALIZED' }], 'PREPARING'), '실제 NFT 2개');
});

test('chainLabel names the networks this app mints on and shortAddress truncates long hex addresses', () => {
  assert.equal(chainLabel(84532), 'Base Sepolia');
  assert.equal(chainLabel(8453), 'Base');
  assert.equal(chainLabel(31337), 'Local Anvil');
  assert.equal(chainLabel(1), 'Chain 1');
  assert.equal(shortAddress('0x1234'), '0x1234');
  assert.equal(shortAddress('0x1234567890abcdef1234'), '0x123456…ef1234');
});
