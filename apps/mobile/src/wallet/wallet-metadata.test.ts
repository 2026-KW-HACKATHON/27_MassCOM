import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createWalletMetadata } from './wallet-metadata';

test('wallet prompts identify the public service without changing native return schemes', () => {
  for (const scheme of ['masscom-dev', 'masscom']) {
    assert.deepEqual(createWalletMetadata(scheme), {
      name: '월계 마스코트',
      description: '월계1동 음식점 방문 인증과 마스코트 수집',
      url: 'https://masscom.kr',
      icons: ['https://masscom.kr/assets/wallet-mark.svg'],
      redirect: { native: `${scheme}://wallet` },
    });
  }
});

test('showcase wallet metadata is distinct from the operating service', () => {
  assert.deepEqual(createWalletMetadata('masscom-demo'), {
    name: '월계 마스코트 체험용',
    description: '체험용 가상 점포와 마스코트 수집 · 실제 방문 혜택이 아닙니다.',
    url: 'https://demo.masscom.kr',
    icons: ['https://masscom.kr/assets/wallet-mark.svg'],
    redirect: { native: 'masscom-demo://wallet' },
  });
});
