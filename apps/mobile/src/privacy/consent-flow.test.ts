import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConsentApiError, type ConsentState } from './consent-api';
import { consentChecks, CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION } from './consent-copy';
import {
  canSubmitConsent, consentRequiredMessage, consentRecheckLabel, loadConsentState, masterConsentState, needsConsentRecheck,
  noChecks, shouldAskConsent, stateFromServer, submitConsent, toggleAllConsent, type ConsentChecks,
} from './consent-flow';

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

const demo = { kind: 'demo', accountId: 'demo-1', allowInsecureReauthentication: false } as const;
const ask = (over: Partial<Parameters<typeof shouldAskConsent>[0]> = {}) => shouldAskConsent({
  status: 'signedIn', accountId: 'acct-a', credential: bearer, apiAvailable: true, consentedAccountId: undefined, ...over,
});

test('the gate asks a freshly signed-in account and stops asking once the server said yes for that account', () => {
  assert.equal(ask(), true, 'first login');
  assert.equal(ask({ consentedAccountId: 'acct-a' }), false, 'same account again in this run');
});

test('a different account is asked even after the first one agreed, and sign-out never asks by itself', () => {
  assert.equal(ask({ accountId: 'acct-b', consentedAccountId: 'acct-a' }), true, 'switch account');
  // Sign out, then B: while signed out nothing is asked (the sign-in screen comes first), then B is asked, not carried over from A.
  assert.equal(ask({ status: 'signedOut', accountId: undefined, credential: undefined, consentedAccountId: 'acct-a' }), false);
  assert.equal(ask({ accountId: 'acct-b', consentedAccountId: 'acct-a' }), true);
  // A signing in again in the same run was already recorded by the server, so it is not asked twice.
  assert.equal(ask({ consentedAccountId: 'acct-a' }), false);
});

test('states without a real server session or API never ask', () => {
  assert.equal(ask({ apiAvailable: false }), false, 'API unavailable');
  assert.equal(ask({ status: 'demo', accountId: 'demo-1', credential: demo }), false, 'development demo status');
  assert.equal(ask({ credential: demo }), false, 'a demo credential is not a server session');
  assert.equal(ask({ status: 'demo', accountId: 'demo-1', credential: demo, recheckRequestedAccountId: 'other' }), false, 'another account asked to re-check');
  for (const status of ['restoring', 'switchingAccount', 'signedOut', 'signingIn']) {
    assert.equal(ask({ status }), false, status);
  }
  assert.equal(ask({ accountId: undefined }), false);
  assert.equal(ask({ credential: undefined }), false);
  assert.equal(ask({ accountId: '' }), false);
});

test('a demo account is asked only after its own re-check request, and stops once the server said yes', () => {
  const demoAsk = (over: Partial<Parameters<typeof shouldAskConsent>[0]> = {}) => ask({
    status: 'demo', accountId: 'demo-1', credential: demo, recheckRequestedAccountId: 'demo-1', ...over,
  });
  assert.equal(demoAsk(), true, 'consent button pressed');
  assert.equal(demoAsk({ consentedAccountId: 'demo-1' }), false, 'recorded');
  assert.equal(demoAsk({ apiAvailable: false }), false);
  assert.equal(demoAsk({ credential: bearer }), false, 'a demo status never asks with a bearer credential');
});

test('a 403 consent error asks to re-check the current Korean notice through the root gate', () => {
  assert.equal(consentRequiredMessage, '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.');
  assert.equal(consentRecheckLabel, '동의 확인하기');
  assert.equal(needsConsentRecheck({ status: 403, code: 'CONSENT_REQUIRED' }), true);
  assert.equal(needsConsentRecheck({ status: 403, code: 'OTHER' }), false);
  assert.equal(needsConsentRecheck({ status: 401, code: 'CONSENT_REQUIRED' }), false);
  assert.equal(ask({ consentedAccountId: 'acct-a' }), false);
  assert.equal(ask({ consentedAccountId: undefined }), true, 'clearing the root cache re-checks the server');
});

test('전체 동의: the master state is true, mixed or false, and a press turns everything on unless everything is already on', () => {
  assert.equal(masterConsentState(noChecks), false);
  assert.equal(masterConsentState(all), true);
  for (const key of ['ageConfirmed', 'termsAccepted', 'privacyAccepted'] as const) {
    assert.equal(masterConsentState({ ...noChecks, [key]: true }), 'mixed', `only ${key}`);
    assert.equal(masterConsentState({ ...all, [key]: false }), 'mixed', `all but ${key}`);
  }
  // All off -> all on; partial (one or two) -> all on; all on -> all off.
  assert.deepEqual(toggleAllConsent(noChecks), all);
  assert.deepEqual(toggleAllConsent({ ...noChecks, termsAccepted: true }), all);
  assert.deepEqual(toggleAllConsent({ ...all, privacyAccepted: false }), all);
  assert.deepEqual(toggleAllConsent(all), noChecks);
  // It never invents or drops a key: the result is exactly the required set, and it enables or disables the start button as a whole.
  assert.deepEqual(Object.keys(toggleAllConsent(noChecks)).sort(), consentChecks.map(({ key }) => key).sort());
  assert.equal(canSubmitConsent(toggleAllConsent(noChecks)), true);
  assert.equal(canSubmitConsent(toggleAllConsent(all)), false);
  // The input is not mutated.
  const before = { ...noChecks };
  toggleAllConsent(noChecks);
  assert.deepEqual(noChecks, before);
});
