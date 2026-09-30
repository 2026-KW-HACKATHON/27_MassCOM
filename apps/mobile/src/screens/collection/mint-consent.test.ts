import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { mintConsentMessage, mintConsentTitle, mintConsentVersion } from './mint-consent';

test('발행 동의 문구는 지갑 주소와 함께 가게 정보·방문 단계가 영구 공개되고 발행 시각이 체인에 남는다고 알린다(v2)', () => {
  const message = mintConsentMessage('0x4000000000000000000000000000000000000004', 'Base Sepolia');
  assert.equal(mintConsentVersion, 'nft-mint-v2');
  assert.equal(mintConsentTitle, '양도 제한 NFT 접수');
  assert.match(message, /^받을 주소\n0x4000000000000000000000000000000000000004\n\n체인 Base Sepolia\n/);
  for (const phrase of ['지갑 주소와 함께', '가게 이름', '동네', '업종', '방문 단계', '영구히', '발행 시각이 공개 블록체인에 기록',
    '지우거나 바꿀 수 없습니다', '일반 전송이 제한']) {
    assert.ok(message.includes(phrase), phrase);
  }
});

test('도감 화면은 동의 문구와 판을 이 모듈에서만 가져온다', () => {
  const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(screen, /consentVersion: mintConsentVersion/);
  assert.match(screen, /mintConsentMessage\(binding\.address, chainLabel\(binding\.chainId\)\)/);
  assert.doesNotMatch(screen, /nft-mint-v1/);
});
