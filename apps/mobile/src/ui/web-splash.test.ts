import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { darkWorld, lightWorld } from '../theme/world';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const root = html.slice(html.indexOf('<div id="root">'), html.indexOf('</body>'));

test('Expo가 채우는 자리표시자와 한 번씩만 있어야 하는 닫는 태그가 그대로 있다', () => {
  assert.equal(html.match(/%LANG_ISO_CODE%/g)?.length, 1);
  assert.equal(html.match(/%WEB_TITLE%/g)?.length, 1);
  assert.equal(html.match(/<\/head>/g)?.length, 1, 'extraHead·테마 메타가 끼는 자리');
  assert.equal(html.match(/<\/body>/g)?.length, 1, '번들 스크립트가 붙는 자리');
  assert.match(html, /<html lang="%LANG_ISO_CODE%">/);
  assert.match(html, /<title>%WEB_TITLE%<\/title>/);
  assert.match(html, /<style id="expo-reset">/);
  assert.match(html, /#root \{\s*display: flex;\s*height: 100%;\s*flex: 1;/);
});

test('스크립트·외부 자원 없이 CSS만 쓴다 (/play/ CSP: script-src self)', () => {
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, '인라인 이벤트 핸들러 없음');
  assert.doesNotMatch(html, /javascript:/i);
  // 주석을 뺀 본문에 http(s) 주소가 없다: 글꼴·이미지·스타일시트를 밖에서 받지 않는다.
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /https?:\/\//);
  // 그림은 data: URI 하나(CSP img-src data:)로만 넣는다.
  assert.match(html, /url\(data:image\/png;base64,[A-Za-z0-9+/=]+\)/);
});

test('#root 안에 읽어 주는 한국어 대기 안내가 있고 장식은 숨긴다', () => {
  assert.match(root, /<div id="root">\s*<div class="boot" role="status">/);
  assert.match(root, /불러오는 중…/);
  assert.match(root, /class="boot-mark" aria-hidden="true"/);
  assert.match(root, /class="boot-spin" aria-hidden="true"/);
});

test('JavaScript가 꺼져 있으면 영원히 불러오는 것처럼 보이지 않고 한국어로 켜 달라고 안내한다', () => {
  assert.match(html, /<noscript>\s*<style>\s*\.boot \{\s*display: none;/);
  assert.match(html, /<body>\s*<noscript>[\s\S]*JavaScript를 켜 주세요/);
});

test('어두운 화면과 동작 줄이기를 따르고 색은 앱 테마와 같다', () => {
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.boot-spin \{\s*animation: none;/);
  const lower = html.toLowerCase();
  assert.ok(lower.includes(`background: ${lightWorld.page.toLowerCase()}`), '밝은 배경 = world.page');
  assert.ok(lower.includes(`color: ${lightWorld.skyInk.toLowerCase()}`), '밝은 글자 = world.skyInk');
  assert.ok(lower.includes(`background: ${darkWorld.page.toLowerCase()}`), '어두운 배경 = darkWorld.page');
  assert.ok(lower.includes(`color: ${darkWorld.skyInk.toLowerCase()}`), '어두운 글자 = darkWorld.skyInk');
});
