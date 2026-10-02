import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isApprovedGuestTrialOrigin } from './guest-trial-origin';

// app.config.ts가 시연 빌드에만 넣는 값과 같은 모양(Issue #325).
const showcaseExtra = { masscomShowcase: { googleWebClientId: '123-demo.apps.googleusercontent.com', apiOrigin: 'https://demo-api.masscom.kr' } };

test('the showcase package only approves the real showcase API origin', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'https://demo-api.masscom.kr', showcaseExtra), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'https://api.masscom.kr', showcaseExtra), false);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'http://127.0.0.1:3000', showcaseExtra), false);
});

test('the showcase package fails closed without the showcase build origin', () => {
  for (const extra of [
    undefined,
    null,
    {},
    { masscomShowcase: undefined },
    { masscomShowcase: { googleWebClientId: '123-demo.apps.googleusercontent.com' } },
    { masscomShowcase: { apiOrigin: 42 } },
    { masscomShowcase: { apiOrigin: 'http://demo-api.masscom.kr' } },
    { masscomShowcase: { apiOrigin: 'https://demo-api.masscom.kr/' } },
    { masscomShowcase: { apiOrigin: 'https://demo-api.masscom.kr/v1' } },
    { masscomShowcase: { apiOrigin: 'not-a-url' } },
  ]) {
    assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'https://demo-api.masscom.kr', extra), false, JSON.stringify(extra));
  }
});

test('the development package only approves a loopback API origin', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'http://127.0.0.1:3000', undefined), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'http://10.0.2.2:3000', undefined), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'https://demo-api.masscom.kr', showcaseExtra), false);
});

test('the production package and any unknown or missing package never approve', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye', 'https://demo-api.masscom.kr', showcaseExtra), false);
  assert.equal(isApprovedGuestTrialOrigin(undefined, 'https://demo-api.masscom.kr', showcaseExtra), false);
  assert.equal(isApprovedGuestTrialOrigin(null, 'http://127.0.0.1:3000', showcaseExtra), false);
});

test('a malformed API URL fails closed instead of throwing', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'not-a-url', showcaseExtra), false);
});
