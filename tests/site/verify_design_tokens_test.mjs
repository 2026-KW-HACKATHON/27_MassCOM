// 웹 디자인 토큰 정합 검사 (Issue #218, docs/superpowers/specs/2026-09-29-web-design-system.md §1·§2)
// 앱 색 정본(apps/mobile/src/theme/palette.ts·medal-colors.ts)과 모든 공개·운영 웹 CSS의 --mc-* 라이트·다크 값을 대조한다.
// 작업 중 일부 파일만 보려면: DESIGN_STYLE_FILES=docs/assets/project.css,docs/assets/legal.css node --test tests/site/verify_design_tokens_test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(join(repo, path), 'utf8');

export const stylesheets = [
  'docs/assets/project.css',
  'docs/assets/legal.css',
  'apps/showcase-web/assets/showcase.css',
  'apps/production-web/assets/production.css',
];

const hex = /#[0-9a-f]{6}\b/i;

/** Brace-matched body of the first `{` at or after `start`. */
function blockAt(source, start) {
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return { body: source.slice(open + 1, i), end: i + 1 };
  }
  throw new Error(`unbalanced braces after offset ${start}`);
}

/** `key: '#hex'` pairs of one exported object literal (flat or nested one level). */
function tsObject(source, name) {
  const at = source.search(new RegExp(`export const ${name}\\b[^=]*=\\s*{`));
  assert.ok(at >= 0, `${name} not found`);
  const { body } = blockAt(source, at);
  const flat = {};
  const nested = {};
  let rest = body;
  for (const match of body.matchAll(/(\w+)\s*:\s*{([^}]*)}/g)) {
    nested[match[1]] = Object.fromEntries([...match[2].matchAll(/(\w+)\s*:\s*'(#[0-9A-Fa-f]{6})'/g)].map((m) => [m[1], m[2]]));
    rest = rest.replace(match[0], '');
  }
  for (const match of rest.matchAll(/(\w+)\s*:\s*'(#[0-9A-Fa-f]{6})'/g)) flat[match[1]] = match[2];
  const sky = rest.match(/sky\s*:\s*\[([^\]]*)\]/);
  if (sky) flat.sky = [...sky[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
  return { ...flat, ...nested };
}

/** Spec §1 token → value, built only from the app's source of truth. */
function expectedTokens(colors, medal) {
  const tokens = {
    '--mc-bg': colors.background,
    '--mc-surface': colors.surface,
    '--mc-label': colors.label,
    '--mc-secondary': colors.secondaryLabel,
    '--mc-separator': colors.separator,
    '--mc-primary': colors.primary,
    '--mc-on-primary': colors.onPrimary,
    '--mc-primary-container': colors.primaryContainer,
    '--mc-on-primary-container': colors.onPrimaryContainer,
    '--mc-success': colors.success,
    '--mc-success-container': colors.successContainer,
    '--mc-on-success-container': colors.onSuccessContainer,
    '--mc-error': colors.error,
    '--mc-error-container': colors.errorContainer,
    '--mc-on-error-container': colors.onErrorContainer,
    '--mc-accent-container': colors.accentContainer,
    '--mc-on-accent-container': colors.onAccentContainer,
    '--mc-sky-1': medal.sky?.[0],
    '--mc-sky-2': medal.sky?.[1],
    '--mc-sky-3': medal.sky?.[2],
    '--mc-sky-ink': medal.skyInk,
    '--mc-sky-muted': medal.skyMuted,
    '--mc-locked-edge': medal.lockedEdge,
    '--mc-locked-fill': medal.lockedFill,
    '--mc-stamp-ink': medal.stampInk,
  };
  for (const tier of ['bronze', 'silver', 'gold']) {
    tokens[`--mc-${tier}`] = medal[tier]?.base;
    tokens[`--mc-${tier}-edge`] = medal[tier]?.edge;
    tokens[`--mc-${tier}-container`] = medal[tier]?.container;
    tokens[`--mc-on-${tier}-container`] = medal[tier]?.onContainer;
  }
  for (const [name, value] of Object.entries(tokens)) assert.match(value ?? '', hex, `app source missing value for ${name}`);
  return tokens;
}

const palette = read('apps/mobile/src/theme/palette.ts');
const medalColors = read('apps/mobile/src/theme/medal-colors.ts');
const expected = {
  light: expectedTokens(tsObject(palette, 'lightColors'), tsObject(medalColors, 'lightMedalColors')),
  dark: expectedTokens(tsObject(palette, 'darkColors'), tsObject(medalColors, 'darkMedalColors')),
};
const layoutTokens = {
  '--mc-radius-card': '20px',
  '--mc-radius-control': '14px',
  '--mc-radius-pill': '999px',
  '--mc-page': 'min(72rem, calc(100vw - 40px))',
};

/** Top-level `:root` declarations (light) and `@media (prefers-color-scheme: dark) { :root }` declarations (dark). */
function declaredTokens(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const dark = {};
  let topLevel = '';
  let cursor = 0;
  for (const match of source.matchAll(/@media[^{]*\(\s*prefers-color-scheme\s*:\s*dark\s*\)[^{]*/g)) {
    if (match.index < cursor) continue;
    const { body, end } = blockAt(source, match.index);
    topLevel += source.slice(cursor, match.index);
    cursor = end;
    for (const root of body.matchAll(/:root\s*{([^}]*)}/g)) Object.assign(dark, declarations(root[1]));
  }
  topLevel += source.slice(cursor);
  const withoutOtherMedia = topLevel.replace(/@media[^{]*{(?:[^{}]*{[^{}]*})*[^{}]*}/g, '');
  const light = {};
  for (const root of withoutOtherMedia.matchAll(/(?:^|[}\s]):root\s*{([^}]*)}/g)) Object.assign(light, declarations(root[1]));
  return { light, dark, source };
}

function declarations(body) {
  return Object.fromEntries([...body.matchAll(/(--mc-[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1], m[2].trim()]));
}

const only = process.env.DESIGN_STYLE_FILES?.split(',').map((file) => file.trim()).filter(Boolean);

test('앱 색 정본에서 사양 §1 색 토큰 37개를 모두 읽는다', () => {
  assert.equal(Object.keys(expected.light).length, 37);
  assert.equal(Object.keys(expected.dark).length, 37);
  assert.equal(expected.light['--mc-primary'].toUpperCase(), '#076F64');
  assert.equal(expected.dark['--mc-gold-edge'].toUpperCase(), '#E6B93A');
});

for (const file of stylesheets) {
  test(`${file}: --mc-* 라이트·다크 값이 앱과 같고 Georgia를 쓰지 않는다`, { skip: only && !only.includes(file) }, () => {
    const { light, dark, source } = declaredTokens(read(file));
    for (const [token, value] of Object.entries(expected.light)) {
      assert.equal(light[token]?.toLowerCase(), value.toLowerCase(), `${file} light ${token}`);
    }
    for (const [token, value] of Object.entries(expected.dark)) {
      assert.equal(dark[token]?.toLowerCase(), value.toLowerCase(), `${file} dark ${token}`);
    }
    for (const [token, value] of Object.entries(layoutTokens)) {
      assert.equal(light[token]?.replace(/\s+/g, ' '), value, `${file} ${token}`);
    }
    assert.match(light['--mc-font'] ?? '', /^Pretendard,/, `${file} --mc-font`);
    assert.match(source, /:root\s*{\s*color-scheme:\s*light dark;/, `${file} color-scheme`);
    assert.doesNotMatch(source, /Georgia/i, `${file} Georgia`);
  });
}
