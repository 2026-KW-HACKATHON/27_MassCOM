// Issue #254: 발행 동의 판. v2부터 가게 정보·방문 단계 영구 공개와 발행 시각 기록을 알리고, 옛 판은 앱 업데이트를 안내한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MintRequestError, consentVersionRefusal, mintConsentVersionFromEnv, type MintRequestService,
} from './mint-request-service.js';
import { createApiServer } from './server-test-support.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('API 시작 판은 비어 있으면 nft-mint-v2이고 v2보다 낮거나 형식이 틀리면 시작하지 않는다', () => {
  assert.equal(mintConsentVersionFromEnv(undefined), 'nft-mint-v2');
  assert.equal(mintConsentVersionFromEnv(''), 'nft-mint-v2');
  assert.equal(mintConsentVersionFromEnv('nft-mint-v2'), 'nft-mint-v2');
  assert.equal(mintConsentVersionFromEnv(' nft-mint-v3 '), 'nft-mint-v3');
  for (const raw of ['nft-mint-v1', 'nft-mint-v0', 'nft-mint-v02', 'v2', 'nft-mint-2', 'NFT-MINT-V2']) {
    assert.throws(() => mintConsentVersionFromEnv(raw), /NFT_MINT_CONSENT_VERSION/, raw);
  }
});

test('요청 판이 낮으면 CONSENT_VERSION_OUTDATED, 없거나 모르는 값이면 CONSENT_REQUIRED다', () => {
  assert.equal(consentVersionRefusal('nft-mint-v2', 'nft-mint-v2'), undefined);
  assert.equal(consentVersionRefusal('nft-mint-v1', 'nft-mint-v2'), 'CONSENT_VERSION_OUTDATED');
  for (const submitted of [undefined, '', 'nft-mint-v3', 'agreed', 42]) {
    assert.equal(consentVersionRefusal(submitted, 'nft-mint-v2'), 'CONSENT_REQUIRED', String(submitted));
  }
});

test('운영 compose·API 기본값·앱의 동의 판이 모두 nft-mint-v2다', () => {
  const compose = readFileSync(new URL('../../../infra/lightsail/compose.yml', import.meta.url), 'utf8');
  const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../../mobile/src/screens/collection/mint-consent.ts', import.meta.url), 'utf8');
  assert.match(compose, /^\s+NFT_MINT_CONSENT_VERSION: nft-mint-v2$/m);
  assert.match(server, /supportedConsentVersion: mintConsentVersionFromEnv\(process\.env\.NFT_MINT_CONSENT_VERSION\)/);
  assert.match(app, /export const mintConsentVersion = 'nft-mint-v2';/);
  assert.equal(mintConsentVersionFromEnv(/NFT_MINT_CONSENT_VERSION: (\S+)/.exec(compose)![1]), 'nft-mint-v2');
});

test('옛 판 거절은 400 CONSENT_VERSION_OUTDATED로 알린다', async (t) => {
  const mintRequests: MintRequestService = {
    requestMint: async () => { throw new MintRequestError('CONSENT_VERSION_OUTDATED'); },
    getMintJob: async () => { throw new Error('unused'); },
  };
  const service = new WalletChallengeService({
    store: new InMemoryChallengeStore(), domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532, ttlMs: 60_000, nonce: () => 'abc12345def67890', challengeId: () => 'challenge-1',
  });
  const server = createApiServer(service, () => 'customer-1', undefined, undefined, undefined, undefined, undefined,
    mintRequests);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const response = await fetch(`http://127.0.0.1:${address.port}/entitlements/20000000-0000-4000-8000-000000000001/mint`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'mint-request-1' },
    body: JSON.stringify({ walletBindingId: '30000000-0000-4000-8000-000000000001', bindingVersion: 1,
      consentVersion: 'nft-mint-v1' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'CONSENT_VERSION_OUTDATED' });
});
