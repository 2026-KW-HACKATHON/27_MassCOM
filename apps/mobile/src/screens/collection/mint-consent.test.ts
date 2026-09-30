import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { mintConsentMessage, mintConsentTitle, mintConsentVersion } from './mint-consent';
import { mintRefusalText } from './nft-status';

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

test('옛 판 동의로 요청한 앱에는 업데이트를 안내하고, 동의가 없을 때의 안내는 그대로다', () => {
  assert.equal(mintRefusalText('CONSENT_VERSION_OUTDATED'), '발행 안내가 바뀌었어요. 앱을 업데이트해 주세요.');
  assert.equal(mintRefusalText('CONSENT_REQUIRED'), '최신 공개·양도 제한 안내 동의가 필요합니다.');
});

test('앱의 동의 판·API 기본값·운영 compose가 모두 nft-mint-v2다', () => {
  const server = readFileSync(new URL('../../../../api/src/server.ts', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../../../../../infra/lightsail/compose.yml', import.meta.url), 'utf8');
  assert.match(server, /process\.env\.NFT_MINT_CONSENT_VERSION \?\? 'nft-mint-v2'/);
  assert.match(compose, /^\s+NFT_MINT_CONSENT_VERSION: nft-mint-v2$/m);
  assert.equal(mintConsentVersion, 'nft-mint-v2');
});
