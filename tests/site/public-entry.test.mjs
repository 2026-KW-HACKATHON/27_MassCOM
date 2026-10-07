import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(`../../docs/${name}`, import.meta.url), 'utf8');

test('포털 첫 행동은 시연 체험과 Android 설치이며 검증 기록은 접혀 있다', () => {
  const html = read('index.html');
  const hero = html.match(/<div class="passport-hero">([\s\S]*?)<\/div>\s*<\/section>/)?.[1];
  assert.ok(hero, '포털 첫 화면을 찾을 수 있어야 한다');
  assert.match(hero, /href="https:\/\/demo-api\.masscom\.kr\/play\/"[^>]*>3분 체험하기<\/a>/);
  assert.match(hero, /href="https:\/\/masscom\.kr\/open"[^>]*>Android 설치<\/a>/);
  assert.ok(hero.indexOf('3분 체험하기') < hero.indexOf('전체 흐름 보기'));
  assert.match(html, /<details class="truth-board">[\s\S]*?지금 사실인 것[\s\S]*?VERIFIED[\s\S]*?BLOCKED[\s\S]*?<\/details>/);
  assert.match(html, /2026-10-01 KST 기준 검증 기록/);
  assert.doesNotMatch(html, /Phase 4|출시 준비/);
  assert.match(hero, /가상 점포/);
  assert.match(hero, /앱 수집품은 NFT가 아닙니다/);
});

test('설치 화면은 경고보다 앞에 기존 릴리스로 가는 APK 버튼을 둔다', () => {
  const html = read('open.html');
  const button = /<a class="(?:primary-action|secondary-action)" href="https:\/\/github\.com\/2026-KW-HACKATHON\/27_MassCOM\/releases\/tag\/(android-v0\.1\.0-test\.13|showcase-android-v0\.1\.0-preview\.22)">(?:운영|시연) APK 받기<\/a>/g;
  const matches = [...html.matchAll(button)];
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match[1]), ['android-v0.1.0-test.13', 'showcase-android-v0.1.0-preview.22']);
  assert.ok(matches[1].index < html.indexOf('<details'));
  assert.match(html, /<details[\s\S]*?앱이 열리지 않나요\?[\s\S]*?SHA256SUMS\.txt[\s\S]*?versionCode 2[\s\S]*?<\/details>/);
});

test('공개 페이지의 버튼과 상세 열기 대상은 44px 이상이다', () => {
  const projectCss = read('assets/project.css');
  const legalCss = read('assets/legal.css');
  assert.match(projectCss, /body\s*\{[^}]*word-break:\s*keep-all/s);
  assert.match(projectCss, /\.primary-action,\s*\.secondary-action\s*\{[^}]*min-height:\s*48px/s);
  assert.match(legalCss, /\.legal-main details > summary\s*\{[^}]*min-height:\s*4[48]px/s);
});
