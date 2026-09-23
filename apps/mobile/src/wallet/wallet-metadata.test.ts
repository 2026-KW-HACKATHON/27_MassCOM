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
