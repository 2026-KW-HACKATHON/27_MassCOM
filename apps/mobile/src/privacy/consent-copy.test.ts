import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACCOUNT_DELETION_URL, CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, PRIVACY_URL, TERMS_URL,
  consentChecks, consentCopy, consentNotice, consentSummary, legalLinks,
} from './consent-copy';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const apiConsent = read('../../../api/src/account-consent.ts');
const termsPage = read('../../../../docs/terms.html');
const caddyfile = read('../../../../infra/lightsail/Caddyfile');
const privacyPage = read('../../../../docs/privacy.html');

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
  assert.match(consentNotice[1]!.body, /\(자세한 항목은 개인정보 처리방침\)\.$/, 'the item list is a summary and says where the full list is');
  assert.match(consentNotice[1]!.body, /쪽지·식사 가게와 날짜·시간/);
  assert.match(consentNotice[1]!.body, /알림 설정과 선택적 기기 토큰/);
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

test('the three-line summary covers purpose·items, retention and refusal, and agrees with the full notice', () => {
  assert.deepEqual(consentSummary.map((item) => item.heading), ['목적·항목', '보유 기간', '동의하지 않으면']);
  assert.ok(consentSummary.every((item) => item.text.length > 20));
  const [purpose, retention, refusal] = consentSummary;
  assert.match(purpose!.text, /이메일·이름은 저장하지 않아요/);
  assert.match(purpose!.text, /자세히 보기/, 'it points at the full notice');
  assert.match(retention!.text, /계정을 삭제할 때까지/);
  assert.match(consentNotice[2]!.body, /계정을 삭제할 때까지/);
  assert.match(refusal!.text, /동의하지 않을 수 있어요/);
  assert.match(consentNotice[3]!.body, /동의하지 않을 수 있어요/);
  assert.match(refusal!.text, /로그아웃/);
  // 전체 동의 changes how the three are picked, not which three are required.
  assert.equal(consentChecks.length, 3);
  assert.equal(consentCopy.agreeAll, '전체 동의');
  assert.equal(consentCopy.details, '자세히 보기');
});

test('the always-visible summary is accurate on retention and sharing, because it is what people read before 전체 동의', () => {
  const [purpose, retention] = consentSummary;
  // Retention keeps the processing window and points at the policy for the longer-kept records (docs/privacy.html section 5).
  assert.match(retention!.text, /접수 뒤 7일 이내/);
  assert.match(retention!.text, /개인정보 처리방침/);
  assert.match(retention!.text, /감사 기록·백업/);
  assert.match(privacyPage, /접수 뒤 7일 이내/, 'the page still says 7 days');
  assert.match(privacyPage, /접근권한 기록|감사 기록/);
  // Items: the session and notification settings, who else sees what, and what a store owner receives.
  assert.match(purpose!.text, /로그인 세션·알림 설정/);
  assert.match(purpose!.text, /친구·같은 가게 이웃이 내 방과 방명록을 볼 수 있고/);
  assert.match(purpose!.text, /권한 있는 점주는 가명 고객 표시로 된 방문 CSV/);
  assert.match(privacyPage, /방문 CSV는 인정 방문의 가명 고객 표시/);
  // Three entries, and the full notice is still the longer text the summary points at.
  assert.equal(consentSummary.length, 3);
  assert.match(purpose!.text, /전체 항목은 "자세히 보기"/);
});

test('the full notice says at least what the summary says: room and guestbook sharing, and the owner visit CSV (wording from docs/privacy.html)', () => {
  const purpose = consentNotice[0]!.body;
  // Friends and neighbours see the room and guestbook only after a public scope is set (privacy.html: 방 공개 범위와 가게 이웃 / 가상 방 방문과 방명록).
  assert.match(privacyPage, /내 방은 나만, 친구, 같은 가게 이웃 중 선택한 범위로 공개합니다/);
  assert.match(privacyPage, /허용된 방 방문자에게 작성자의 별명과 글이 보이며/);
  assert.match(purpose, /친구·같은 가게 이웃에게는 내가 공개 범위를 정한 뒤에만/);
  assert.match(purpose, /허용된 방문자에게 내 방과 방명록\(작성자의 별명과 글\)이 보여요/);
  // A store owner with permission gets a visit CSV with pseudonymous labels (privacy.html: 점주 직접 운영).
  assert.match(privacyPage, /권한 있는 점주에게만 제공하는 방문 CSV는 인정 방문의 가명 고객 표시·한국 날짜·첫 방문\/재방문·보상 현황으로 제한합니다/);
  assert.match(purpose, /권한 있는 점주에게만 제공하는 방문 CSV는 인정 방문의 가명 고객 표시·한국 날짜·첫 방문\/재방문·보상 현황으로 제한해요/);
  // The summary and the full notice agree on both facts, and the page already discloses them, so the privacy version is unchanged.
  const summary = consentSummary[0]!.text;
  assert.match(summary, /친구·같은 가게 이웃이 내 방과 방명록을 볼 수 있고/);
  assert.match(summary, /권한 있는 점주는 가명 고객 표시로 된 방문 CSV/);
  assert.equal(CONSENT_PRIVACY_VERSION, 'privacy-2026-10-07');
});

test('the web consent page counts title/body pairs in this file, so only the four notice items may use those key names', () => {
  const pairs = [...read('./consent-copy.ts').matchAll(/title: '([^']+)',\s*body:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(pairs, consentNotice.map((item) => [item.title, item.body]));
});

test('friends-visible facts and guestbook posts left in other rooms are disclosed in the notice and the summary (wording from docs/privacy.html 친구에게 보이는 정보)', () => {
  // The privacy page is the source of these facts.
  assert.match(privacyPage, /별명, 메달 3종의 등급, 배지 수\(9개 중\), 가본 가게의 이름과 친구 순위가 보입니다/);
  assert.match(privacyPage, /친구에게 보이는 메달·가게·순위는 한국 날짜 기준 어제까지의 방문만 셉니다/);
  assert.match(privacyPage, /허용된 방 방문자에게 작성자의 별명과 글이 보이며/);
  const purpose = consentNotice[0]!.body;
  // Friends see these whatever the room visibility is, a day late.
  assert.match(purpose, /친구에게는 방 공개 범위와 상관없이 별명, 메달 3종의 등급, 배지 수, 가본 가게의 이름과 친구 순위가 보이고/);
  assert.match(purpose, /한국 날짜 기준 어제까지의 방문만 세므로 하루 늦게 반영돼요/);
  // A guestbook post I write in someone else's room is shown to that room's allowed visitors with my nickname.
  assert.match(purpose, /내가 다른 사람의 방에 남긴 방명록 글은 그 방의 허용된 방문자에게 내 별명과 함께 보여요/);
  const summary = consentSummary[0]!.text;
  assert.match(summary, /공개 범위와 상관없이 친구에게는 별명·메달 등급·가본 가게 이름·순위가 하루 늦게 보여요/);
  assert.match(summary, /다른 사람의 방에 남긴 내 방명록 글은 그 방 방문자에게 보여요/);
  // What friends do not see is not claimed away: the notice keeps pointing at the policy for the full list.
  assert.match(consentNotice[1]!.body, /\(자세한 항목은 개인정보 처리방침\)\.$/);
});
