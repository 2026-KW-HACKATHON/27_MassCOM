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
  assert.match(terms, /약관 버전 terms-2026-09-30/);
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
