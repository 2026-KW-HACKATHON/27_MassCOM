import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConsentApiError, type ConsentState } from './consent-api';
import { consentChecks, CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION } from './consent-copy';
import { canSubmitConsent, loadConsentState, noChecks, stateFromServer, submitConsent, type ConsentChecks } from './consent-flow';

const bearer = { kind: 'bearer', sessionToken: 'session' } as const;
const current = { termsVersion: CONSENT_TERMS_VERSION, privacyVersion: CONSENT_PRIVACY_VERSION };
const all: ConsentChecks = { ageConfirmed: true, termsAccepted: true, privacyAccepted: true };

test('the button needs all three required boxes', () => {
  assert.equal(consentChecks.length, 3);
  assert.equal(canSubmitConsent(noChecks), false);
  assert.equal(canSubmitConsent(all), true);
  for (const missing of ['ageConfirmed', 'termsAccepted', 'privacyAccepted'] as const) {
    assert.equal(canSubmitConsent({ ...all, [missing]: false }), false, missing);
  }
});

test('the server decides whether the gate opens and an unknown version is never consented to', () => {
  assert.deepEqual(stateFromServer({ required: false, ...current }), { kind: 'accepted' });
  assert.deepEqual(stateFromServer({ required: true, ...current }), { kind: 'required' });
  // The screen shows this build's text. If the server asks for other versions, asking would record consent to text the user never saw.
  assert.deepEqual(stateFromServer({ required: true, termsVersion: 'terms-2027-01-01', privacyVersion: current.privacyVersion }), { kind: 'outdated' });
  assert.deepEqual(stateFromServer({ required: true, termsVersion: current.termsVersion, privacyVersion: 'privacy-2027-01-01' }), { kind: 'outdated' });
});

test('loading maps the answer, a lost connection to a retry state, and an ended session to sign-out', async () => {
  assert.deepEqual(await loadConsentState({ status: async () => ({ required: true, ...current }) }, bearer),
    { kind: 'state', state: { kind: 'required' } });
  assert.deepEqual(await loadConsentState({ status: async () => ({ required: false, ...current }) }, bearer),
    { kind: 'state', state: { kind: 'accepted' } });
  for (const failure of [new Error('network'), new ConsentApiError(404, 'NOT_FOUND'), new ConsentApiError(502, 'HTTP_502')]) {
    assert.deepEqual(await loadConsentState({ status: async () => { throw failure; } }, bearer),
      { kind: 'state', state: { kind: 'failed' } }, String(failure));
  }
  assert.deepEqual(await loadConsentState({ status: async () => { throw new ConsentApiError(401, 'SESSION_INVALID'); } }, bearer),
    { kind: 'sessionInvalid' });
});

test('submitting needs all three boxes, records once and maps every refusal', async () => {
  const calls: string[] = [];
  const recorded: ConsentState = { required: false, ...current };
  const ok = { record: async () => { calls.push('record'); return recorded; } };
  assert.deepEqual(await submitConsent(ok, bearer, noChecks), { kind: 'state', state: { kind: 'required' } });
  assert.deepEqual(await submitConsent(ok, bearer, { ...all, privacyAccepted: false }), { kind: 'state', state: { kind: 'required' } });
  assert.deepEqual(calls, [], 'an incomplete form never reaches the server');
  assert.deepEqual(await submitConsent(ok, bearer, all), { kind: 'state', state: { kind: 'accepted' } });
  assert.deepEqual(calls, ['record']);

  const failing = (error: unknown) => ({ record: async () => { throw error; } });
  assert.deepEqual(await submitConsent(failing(new ConsentApiError(409, 'CONSENT_VERSION_MISMATCH')), bearer, all),
    { kind: 'state', state: { kind: 'outdated' } });
  assert.deepEqual(await submitConsent(failing(new ConsentApiError(401, 'SESSION_INVALID')), bearer, all), { kind: 'sessionInvalid' });
  for (const error of [new Error('offline'), new ConsentApiError(500, 'INTERNAL_ERROR'), new ConsentApiError(410, 'ACCOUNT_DELETED')]) {
    assert.deepEqual(await submitConsent(failing(error), bearer, all), { kind: 'submitFailed' }, String(error));
  }
  // Recorded but the server still wants consent (versions moved meanwhile): ask again rather than open the app.
  assert.deepEqual(await submitConsent({ record: async () => ({ required: true, ...current }) }, bearer, all),
    { kind: 'state', state: { kind: 'required' } });
});
