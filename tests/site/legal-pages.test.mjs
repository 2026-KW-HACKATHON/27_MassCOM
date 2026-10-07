import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../../docs');
const read = (name) => readFileSync(resolve(docs, name), 'utf8');
const terms = read('terms.html');
const privacy = read('privacy.html');
const deletion = read('account-deletion.html');
const legalCss = read('assets/legal.css');

test('terms page uses the same shell, metadata and accessibility hooks as the other legal pages', () => {
  assert.ok(terms.startsWith('<!DOCTYPE html>'));
  assert.match(terms, /<html lang="ko">/);
  assert.match(terms, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(terms, /<link rel="canonical" href="https:\/\/www\.masscom\.kr\/terms">/);
  assert.match(terms, /<title>이용약관 · 월계 마스코트<\/title>/);
  // Both themes: the same light/dark theme-color pair and the shared stylesheet that defines dark mode.
  assert.match(terms, /theme-color" content="#FFFFFF" media="\(prefers-color-scheme: light\)"/);
  assert.match(terms, /theme-color" content="#14171D" media="\(prefers-color-scheme: dark\)"/);
  assert.match(terms, /href="assets\/project\.css\?v=\d+"/);
  assert.match(terms, /href="assets\/legal\.css\?v=\d+"/);
  assert.match(legalCss, /@media \(prefers-color-scheme: dark\)/);
  // Landmarks: skip link to the main landmark, one h1, header and footer.
  assert.match(terms, /<a class="skip-link" href="#main-content">/);
  assert.match(terms, /<main class="legal-main" id="main-content">/);
  assert.equal((terms.match(/<h1>/g) ?? []).length, 1);
  assert.match(terms, /<header class="legal-header">/);
  assert.match(terms, /<footer class="legal-footer">/);
  // Void elements keep the HTML style and nothing is loaded from another origin or run as script.
  assert.doesNotMatch(terms, /<(?:meta|link|br)\b[^>]*\/>/);
  assert.doesNotMatch(terms, /<script\b/i);
  assert.doesNotMatch(terms, /(?:src|href)="https?:\/\/(?!www\.masscom\.kr\/terms")/);
  // Decorative brand image is hidden from assistive technology like the sibling pages.
  assert.match(terms, /<img class="brand-mark" src="assets\/mascot-stamp\.png" alt=""/);
  assert.equal(terms.match(/<h2>\d+\./g)?.length, 12);
});

test('terms cover the Issue #253 decisions in plain, honest terms', () => {
  assert.match(terms, /약관 버전 terms-2026-10-06/);
  assert.match(terms, /Google Play 일반 공개 전 개발·검증 단계/);
  assert.match(terms, /법률 검토를 마치기 전의 문안/);
  assert.match(terms, /무료/);
  assert.match(terms, /혜택은 점주가 제공합니다/);
  assert.match(terms, /양도할 수 없습니다/);
  assert.match(terms, /서비스는 이미 블록체인에 기록된 정보를 지울 수 없습니다/);
  assert.match(terms, /만 14세 이상/);
  assert.match(terms, /24시간은 취소할 수 있고, 그 뒤 운영자가 접수 뒤 7일 안에 처리/);
  assert.match(terms, /하지 말아야 할 일/);
  assert.match(terms, /고의 또는 중대한 과실/);
  assert.match(terms, /대한민국 법에 따르며/);
  assert.match(terms, /개인키나 복구 문구를 묻거나 저장하지 않으며/);
  assert.match(terms, /mailto:choijunhuk2007@gmail\.com/);
});

test('the legal pages link to one another and to the deletion guide', () => {
  assert.match(terms, /href="privacy\.html"/);
  assert.match(terms, /href="account-deletion\.html"/);
  assert.match(privacy, /href="terms\.html"/);
  assert.match(deletion, /href="terms\.html"/);
  assert.match(read('index.html'), /href="terms\.html"/);
});

test('terms are built, served at /terms and checked after deploy exactly like the privacy policy', () => {
  const root = resolve(import.meta.dirname, '../..');
  const source = (path) => readFileSync(resolve(root, path), 'utf8');
  const caddyfile = source('infra/lightsail/Caddyfile');
  assert.match(caddyfile, /@terms path \/terms\n\trewrite @terms \/terms\.html/);
  assert.match(caddyfile, /@privacy path \/privacy\n\trewrite @privacy \/privacy\.html/);
  assert.match(source('scripts/build-public-site.mjs'), /'terms\.html'/);
  for (const script of ['scripts/deploy-lightsail.sh', 'scripts/deploy-lightsail-web.sh']) {
    assert.match(source(script), /docs\/privacy\.html docs\/terms\.html docs\/account-deletion\.html/, script);
  }
  assert.match(source('scripts/deploy-lightsail-web.sh'), /for path in \/ \/open \/privacy \/terms \/account-deletion \/app\//);
  assert.match(source('tests/ops/run_aws_web_smoke.sh'), /\/privacy \/terms \/account-deletion/);
});

const repoRoot = resolve(import.meta.dirname, '../..');
const source = (path) => readFileSync(resolve(repoRoot, path), 'utf8');

test('the privacy policy states retention periods instead of saying they are undecided', () => {
  assert.doesNotMatch(privacy, /확정되지 않았습니다|아직 정하지 않았습니다|보관 기간, 처리 위탁/);
  assert.match(privacy, /<h3>보관 기간<\/h3>/);
  for (const [label, period] of [
    ['계정·방문·보상·친구 기록', /탈퇴\(계정 삭제 요청 처리\)할 때까지/],
    ['동의 기록', /계정을 삭제할 때까지 보관하고, 삭제 처리 때 지웁니다/],
    ['로그인 세션', /만료되거나 로그아웃으로 해지되면/],
    ['일회용 확인 기록', /만료되었거나 사용한 지 1일이 지나면/],
    ['삭제 접수 기록', /처리·취소·거절한 뒤 1년이 지나면 삭제합니다/],
    ['접근권한 기록', /기록한 날부터 3년 뒤 삭제합니다[^\n]*제5조 제3항/],
    ['관리자·점주 처리·감사 기록', /기록한 날부터 1년 뒤 삭제합니다/],
    ['서버 로그', /용량 기준으로만/],
    ['배포 전 데이터베이스 백업', /만든 지 30일이 지난 백업은 다음 날 정리 작업/],
    ['OpenAI 전송분', /최대 30일/],
    ['발행된 NFT', /서비스가 지울 수 없습니다/],
  ]) {
    assert.match(privacy, new RegExp(`<li><strong>${label}:</strong>[^\\n]*`), label);
    const line = privacy.split('\n').find((row) => row.includes(`<strong>${label}:</strong>`) && /보관|삭제|순환|OpenAI|지울|지웁/.test(row));
    assert.match(line ?? '', period, label);
  }
});

test('each retention promise in the policy is the value the code and the server jobs implement', () => {
  const retention = source('apps/api/src/postgres/retention.ts');
  assert.equal((retention.match(/ago\('1 year'\)/g) ?? []).length, 1, 'one place defines the one-year period');
  assert.equal((retention.match(/ago\('1 day'\)/g) ?? []).length, 1, 'one place defines the one-day margin');
  for (const table of ['auth_sessions', 'web_sessions', 'account_deletion_intake_requests', 'platform_admin_audit',
    'platform_admin_role_audit', 'staff_registration_audit', 'badge_coupon_audit']) {
    assert.match(retention, new RegExp(`table: '${table}'`), table);
  }
  // Only finished filings are removed; an active one is never retention material.
  assert.match(retention, /status <> 'REQUESTED'/);
  // Access-right records (owner grant/revoke, admin role, staff registration) are kept three years, the rest of the audit one year.
  assert.equal((retention.match(/ago\('3 years'\)/g) ?? []).length, 1);
  assert.match(retention, /admin_owner_audit[\s\S]*threeYearsAgo/);
  assert.match(retention, /admin_role_audit[^\n]*threeYearsAgo/);
  assert.match(retention, /staff_registration_audit[^\n]*threeYearsAgo/);
  assert.match(retention, /action NOT IN \$\{ownerChangeActions\}/);
  for (const table of ['customer_identity_tokens', 'wallet_challenges', 'web_oauth_states', 'staff_registration_requests']) {
    assert.match(retention, new RegExp(`table: '${table}'`), table);
  }
  // 30 days of backups: the job's default, its unit-free name pattern and the policy agree; the default is the same on both hosts.
  for (const job of ['infra/lightsail/host-jobs/masscom-retention.sh', 'infra/showcase-host/host-jobs/masscom-retention.sh']) {
    assert.match(source(job), /^retention_days=30$/m, job);
  }
  assert.match(privacy, /만든 지 30일이 지난 백업은 다음 날 정리 작업\(하루 한 번\) 때 삭제합니다/);
  assert.doesNotMatch(privacy, /최대 30일 남을 수 있습니다/);
  // App sessions last 30 days and web sessions 24 hours; the policy says so.
  assert.match(source('infra/lightsail/compose.yml'), /AUTH_SESSION_TTL_MS: "2592000000"/);
  assert.match(source('apps/api/src/server.ts'), /ttlMs: 24 \* 60 \* 60 \* 1000/);
  assert.match(privacy, /앱 로그인의 유효 기간은 30일, 웹 로그인은 24시간/);
  // Log rotation: the numbers in the text are the ones in both compose files, and the text promises no time bound.
  for (const file of ['infra/lightsail/compose.yml', 'infra/showcase-host/compose.yml']) {
    assert.match(source(file), /max-size: "10m"[\s\S]*max-file: "3"/, file);
  }
  assert.match(privacy, /10 MB 파일 3개\(최대 30 MB\)/);
  assert.match(privacy, /시간 기준으로 지우지는 않습니다/);
  assert.doesNotMatch(privacy, /3개월/);
  // Caddy has no `log` directive, so no per-request access log exists; the policy says that and only that.
  assert.doesNotMatch(source('infra/lightsail/Caddyfile'), /^\s*log\b/m);
  assert.match(privacy, /웹 서버는 요청마다 접속 기록을 남기지 않도록 구성했습니다/);
  // The database error log carries no row values or SQL text: the compose command that makes it so is what the text describes.
  for (const file of ['infra/lightsail/compose.yml', 'infra/showcase-host/compose.yml']) {
    assert.match(source(file), /command: \["postgres", "-c", "log_error_verbosity=terse", "-c", "log_min_error_statement=panic"\]/, file);
  }
  assert.match(privacy, /오류가 난 행의 값\(상세 항목\)과 실패한 SQL 문을 남기지 않도록 설정/);
  assert.match(privacy, /잘못된 입력 형식 같은 일부 오류 문구에는 입력한 값이 들어갈 수 있습니다/);
  assert.doesNotMatch(privacy, /데이터베이스 오류 메시지에는 오류가 난 행의 값/);
});

test('the privacy policy carries the OpenAI contacts from the Korean addendum and names the consent record', () => {
  assert.match(privacy, /OpenAI OpCo, L\.L\.C\./);
  assert.match(privacy, /미국 캘리포니아주 샌프란시스코 3번가 1455번지/);
  assert.match(privacy, /서울특별시 강남구 테헤란로 518, 10층/);
  assert.match(privacy, /mailto:privacy@openai\.com">privacy@openai\.com</);
  assert.match(privacy, /오픈에이아이코리아 유한회사/);
  assert.match(privacy, /mailto:privacykorea@openai\.com">privacykorea@openai\.com</);
  assert.match(privacy, /02\) 722-3599/);
  assert.match(privacy, /2026-03-27/);
  assert.match(privacy, /<strong>동의 기록:<\/strong> 이용약관·개인정보 수집·이용에 동의한 계정의 식별자/);
  assert.match(privacy, /href="terms\.html">이용약관</);
  // Both legal pages link to the terms from the header too, and the deletion page says lookups stop finding old filings.
  assert.match(privacy, /<nav class="legal-header-links"[^>]*>\s*<a href="terms\.html">이용약관<\/a>/);
  assert.match(deletion, /<nav class="legal-header-links"[^>]*>\s*<a href="terms\.html">이용약관<\/a>/);
  assert.match(deletion, /1년이 지나면 삭제하므로, 그 뒤에는 접수번호로 조회해도 찾을 수 없다고 나옵니다/);
});

test('the versions named on the two pages are the ones the server, the app and the web app use', () => {
  const api = source('apps/api/src/account-consent.ts');
  const serverTerms = api.match(/CURRENT_TERMS_VERSION = '([^']+)'/)?.[1];
  const serverPrivacy = api.match(/CURRENT_PRIVACY_VERSION = '([^']+)'/)?.[1];
  assert.equal(serverTerms, 'terms-2026-10-06');
  assert.equal(serverPrivacy, 'privacy-2026-10-07');
  assert.ok(terms.includes(serverTerms));
  assert.ok(privacy.includes(serverPrivacy));
  for (const version of privacy.match(/privacy-\d{4}-\d{2}-\d{2}/g) ?? []) {
    assert.equal(version, serverPrivacy, 'privacy body must not name a stale policy version');
  }
  const mobile = source('apps/mobile/src/privacy/consent-copy.ts');
  assert.equal(mobile.match(/CONSENT_TERMS_VERSION = '([^']+)'/)?.[1], serverTerms);
  assert.equal(mobile.match(/CONSENT_PRIVACY_VERSION = '([^']+)'/)?.[1], serverPrivacy);
  const web = source('apps/production-web/assets/production.mjs');
  assert.equal(web.match(/CONSENT_TERMS_VERSION = '([^']+)'/)?.[1], serverTerms);
  assert.equal(web.match(/CONSENT_PRIVACY_VERSION = '([^']+)'/)?.[1], serverPrivacy);
});
