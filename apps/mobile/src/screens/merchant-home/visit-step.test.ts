import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimSecondsRemaining, merchantStepFor } from './visit-step';

test('촬영·고객 확인·발급 순서를 서버 결과에 맞춰 표시한다', () => {
  assert.equal(merchantStepFor({ scanning: false, identified: false, issued: false }), 1);
  assert.equal(merchantStepFor({ scanning: true, identified: false, issued: false }), 1);
  assert.equal(merchantStepFor({ scanning: false, identified: true, issued: false }), 2);
  assert.equal(merchantStepFor({ scanning: false, identified: false, issued: true }), 3);
  assert.equal(merchantStepFor({ scanning: true, identified: true, issued: true }), 3);
  assert.equal(merchantStepFor({ scanning: true, identified: true, issued: false }), 1);
});

test('서버 만료 시각으로 초를 올림하고 만료·잘못된 시각에는 QR을 감춘다', () => {
  const now = Date.parse('2026-10-03T10:00:00Z');
  assert.equal(claimSecondsRemaining('2026-10-03T10:02:00Z', now), 120);
  assert.equal(claimSecondsRemaining('2026-10-03T10:00:00.001Z', now), 1);
  assert.equal(claimSecondsRemaining('2026-10-03T09:59:59Z', now), 0);
  assert.equal(claimSecondsRemaining('invalid', now), 0);
});
