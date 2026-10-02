import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isApprovedGuestTrialOrigin } from './guest-trial-origin';

test('the showcase package only approves the real showcase API origin', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'https://demo-api.masscom.kr'), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'https://api.masscom.kr'), false);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'http://127.0.0.1:3000'), false);
});

test('the development package only approves a loopback API origin', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'http://127.0.0.1:3000'), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'http://10.0.2.2:3000'), true);
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.dev', 'https://demo-api.masscom.kr'), false);
});

test('the production package and any unknown or missing package never approve', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye', 'https://demo-api.masscom.kr'), false);
  assert.equal(isApprovedGuestTrialOrigin(undefined, 'https://demo-api.masscom.kr'), false);
  assert.equal(isApprovedGuestTrialOrigin(null, 'http://127.0.0.1:3000'), false);
});

test('a malformed API URL fails closed instead of throwing', () => {
  assert.equal(isApprovedGuestTrialOrigin('kr.masscom.wolgye.demo', 'not-a-url'), false);
});
