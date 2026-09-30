import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCOUNT_DELETION_URL, CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, PRIVACY_URL, TERMS_URL,
  consentChecks, consentNotice, legalLinks,
} from './consent-copy';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const apiConsent = read('../../../api/src/account-consent.ts');
const termsPage = read('../../../../docs/terms.html');
const caddyfile = read('../../../../infra/lightsail/Caddyfile');

test('the versions this app shows are the ones the server asks for and the pages declare', () => {
  assert.equal(apiConsent.match(/CURRENT_TERMS_VERSION = '([^']+)'/)?.[1], CONSENT_TERMS_VERSION);
  assert.equal(apiConsent.match(/CURRENT_PRIVACY_VERSION = '([^']+)'/)?.[1], CONSENT_PRIVACY_VERSION);
  assert.ok(termsPage.includes(CONSENT_TERMS_VERSION), 'terms page names its version');
});

test('three required boxes, no optional consent, and the four notice items Issue #253 asks for', () => {
  assert.deepEqual(consentChecks.map((check) => check.key), ['ageConfirmed', 'termsAccepted', 'privacyAccepted']);
  assert.ok(consentChecks.every((check) => check.label.startsWith('[필수]')));
  assert.equal(consentChecks.some((check) => /선택|마케팅|광고/.test(check.label)), false);
  assert.deepEqual(consentNotice.map((item) => item.title), [
    '수집·이용 목적', '수집 항목', '보유 기간', '동의를 거부할 권리와 불이익',
  ]);
  assert.ok(consentNotice.every((item) => item.body.length > 20));
  // The notice says the truth about what is not stored and what refusing costs.
  assert.match(consentNotice[1]!.body, /이메일·이름은 저장하지 않아요/);
  assert.match(consentNotice[1]!.body, /등\(자세한 항목은 개인정보 처리방침\)$/, 'the item list is a summary and says where the full list is');
  assert.match(consentNotice[2]!.body, /계정을 삭제할 때까지/);
  assert.match(consentNotice[3]!.body, /동의하지 않으면/);
});

test('links point at the public pages the site actually serves', () => {
  assert.deepEqual(legalLinks.map((link) => link.url), [TERMS_URL, PRIVACY_URL, ACCOUNT_DELETION_URL]);
  assert.equal(TERMS_URL, 'https://www.masscom.kr/terms');
  assert.equal(PRIVACY_URL, 'https://www.masscom.kr/privacy');
  assert.equal(ACCOUNT_DELETION_URL, 'https://www.masscom.kr/account-deletion');
  for (const route of ['terms', 'privacy', 'account-deletion']) {
    assert.match(caddyfile, new RegExp(`rewrite @[a-z]+ /${route}\\.html`), route);
  }
  assert.equal(consentChecks.find((check) => check.key === 'termsAccepted')?.link?.url, TERMS_URL);
  assert.equal(consentChecks.find((check) => check.key === 'privacyAccepted')?.link?.url, PRIVACY_URL);
  assert.ok(legalLinks.every((link) => link.hint.length > 0));
});
