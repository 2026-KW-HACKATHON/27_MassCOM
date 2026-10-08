import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimSecondsRemaining, merchantCardStep, merchantDemoSteps, merchantStepFor } from './visit-step';

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

test('단계 카드는 네 단계이고 라벨이 말하는 일에 맞춰 켜진다', () => {
  assert.equal(merchantDemoSteps.length, 4);
  assert.match(merchantDemoSteps[1], /손님이 되어 QR 보여주기/);
  assert.match(merchantDemoSteps[2], /방문 코드 발급/);
  // ① 처음 열렸을 때, ② 고객 QR을 찍거나 만드는 중, ③ 고객을 확인하고 방문 코드를 발급할 차례(발급 뒤까지), ④ 확정된 방문을 처음 화면에서 만났을 때.
  assert.equal(merchantCardStep(1, false, false), 1);
  assert.equal(merchantCardStep(1, true, false), 2);
  assert.equal(merchantCardStep(2, false, false), 3, '"방문 코드 발급" 단추가 보이는 화면은 ③이다');
  assert.equal(merchantCardStep(3, false, false), 3);
  assert.equal(merchantCardStep(1, false, true), 4);
  assert.equal(merchantCardStep(1, true, true), 2, '새 촬영 중에는 ②에 머문다');
  assert.equal(merchantCardStep(2, false, true), 3);
  assert.equal(merchantCardStep(3, true, true), 3);
});
