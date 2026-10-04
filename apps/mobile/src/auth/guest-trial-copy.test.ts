import assert from 'node:assert/strict';
import test from 'node:test';

import {
  guestTrialAccountLabel,
  guestTrialDescription,
  guestTrialFailureMessage,
  guestTrialRestartConfirmation,
  guestTrialRestartLabel,
  guestTrialStartLabel,
} from './guest-trial-copy';

test('guest trial copy explains its lifetime, merchant access, and reset consequence', () => {
  assert.equal(guestTrialStartLabel, '로그인 없이 바로 체험');
  assert.equal(guestTrialRestartLabel, '체험 처음부터 다시');
  assert.match(guestTrialDescription, /24시간.*임시 체험 계정/);
  assert.match(guestTrialDescription, /사장님 화면/);
  assert.match(guestTrialDescription, /로그아웃하거나 시간이 지나면 기록은 이어지지 않아요/);
  assert.match(guestTrialRestartConfirmation, /현재 체험 기록은 이어지지 않아요/);
});

test('guest trial failures have shared, actionable copy on native and web', () => {
  for (const platform of ['native', 'web'] as const) {
    assert.match(guestTrialFailureMessage('GUEST_TRIAL_RATE_LIMITED', platform), /시도가 너무 많습니다/);
    assert.match(guestTrialFailureMessage('GUEST_TRIAL_IP_LIMIT', platform), /이 네트워크에서 체험이 너무 많아요/);
    assert.match(guestTrialFailureMessage('GUEST_TRIAL_BUSY', platform), /체험 중인 사람이 많아/);
    assert.match(guestTrialFailureMessage('NETWORK_ERROR', platform), /네트워크를 확인/);
    assert.match(guestTrialFailureMessage('REQUEST_TIMEOUT', platform), /응답이 지연/);
    assert.match(guestTrialFailureMessage('SIGN_IN_FAILED', platform), /로그인을 완료하지 못했습니다/);
    assert.equal(guestTrialFailureMessage('WEB_SHOWCASE_ONLY', platform), '웹 체험판은 시연 전용이에요.');
  }
  assert.match(guestTrialFailureMessage('SECURE_STORAGE_UNAVAILABLE', 'web'), /이 브라우저/);
  assert.match(guestTrialFailureMessage('SECURE_STORAGE_UNAVAILABLE', 'native'), /기기 보안 저장소/);
});

test('temporary account label rounds remaining hours up and handles unknown expiry', () => {
  const now = Date.parse('2026-10-04T00:00:00.000Z');
  assert.equal(guestTrialAccountLabel(), '임시 체험 계정');
  assert.equal(guestTrialAccountLabel('invalid', now), '임시 체험 계정');
  assert.equal(guestTrialAccountLabel(new Date(now + 24 * 3_600_000).toISOString(), now), '임시 체험 계정 · 24시간 남음');
  assert.equal(guestTrialAccountLabel(new Date(now + 1).toISOString(), now), '임시 체험 계정 · 1시간 남음');
  assert.equal(guestTrialAccountLabel(new Date(now - 1).toISOString(), now), '임시 체험 계정 · 0시간 남음');
});
