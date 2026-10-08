import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertConsentComplete, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';

test('the corrected CSV disclosure requires consent to the new privacy version', () => {
  const consent = {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    ageConfirmed: true,
    termsAccepted: true,
    privacyAccepted: true,
  };
  assert.equal(CURRENT_PRIVACY_VERSION, 'privacy-2026-10-09');
  assert.doesNotThrow(() => assertConsentComplete(consent));
  assert.throws(() => assertConsentComplete({ ...consent, privacyVersion: 'privacy-2026-10-07' }),
    { code: 'CONSENT_VERSION_MISMATCH' });
});
