import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { uiMetrics } from '../theme/ui-metrics';

// Issue #412: 글자는 12dp 아래로, 누르는 영역은 44dp 아래로 내려가지 않는다. 이 저장소에는 RN 렌더러가 없어 소스 본문을 훑는다.
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sources(sourceRoot).map((path) => ({ path, name: relative(sourceRoot, path), text: readFileSync(path, 'utf8') }));
const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** 이미지로 내보내는 공유 카드: 화면 글자가 아니라 그림이라 작은 글자를 허용한다. */
const exportCards = [
  'studio/studio-share.tsx',
  'gamification/share-card.tsx',
  'screens/collection/collectible-share.tsx',
  'screens/collection/collection-share.tsx',
];

/** 눌러도 되지만 입력은 따로 있는 게임 말이다: 쌓기 놀이의 "지금 상자 놓기" 버튼(48dp)이 실제 조작이다. */
const gamePieces = ['screens/play/quality-session.tsx:package'];

test('the minimum tokens are 12dp text and a 44dp compact touch target below the 48dp default', () => {
  assert.equal(uiMetrics.minFont, 12);
  assert.equal(uiMetrics.minTouchCompact, 44);
  assert.ok(uiMetrics.minTouchCompact < uiMetrics.minTouch);
});

test('every export-card exemption still names a real file', () => {
  for (const card of exportCards) assert.ok(existsSync(join(sourceRoot, card)), card);
});

test('no screen text is drawn below the minimum font size, except the exported share cards', () => {
  const violations: string[] = [];
  for (const file of files) {
    if (exportCards.includes(file.name)) continue;
    for (const match of file.text.matchAll(/\bfontSize:\s*(\d+(?:\.\d+)?)\b/g)) {
      if (Number(match[1]) < uiMetrics.minFont) violations.push(`${file.name}:${lineOf(file.text, match.index)}: fontSize ${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});

/** `<Pressable ...>` 여는 태그 하나의 본문. 속성 안의 `=>`와 문자열 때문에 중괄호 깊이가 0일 때의 `>`까지만 본다. */
function pressableTags(text: string): { index: number; tag: string }[] {
  const tags: { index: number; tag: string }[] = [];
  for (const start of text.matchAll(/<Pressable\b/g)) {
    let depth = 0;
    let quote = '';
    let end = start.index;
    for (; end < text.length; end += 1) {
      const char = text[end];
      if (quote) { if (char === quote && text[end - 1] !== '\\') quote = ''; continue; }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) break;
    }
    tags.push({ index: start.index, tag: text.slice(start.index, end) });
  }
  return tags;
}

test('a Pressable never takes a style with a literal height or width under the compact touch size', () => {
  const violations: string[] = [];
  for (const file of files) {
    const sameDirectory = files.filter((other) => dirname(other.path) === dirname(file.path));
    for (const { index, tag } of pressableTags(file.text)) {
      // 안쪽 View/Text 크기가 아니라 눌리는 요소 자신의 스타일만 본다.
      for (const reference of tag.matchAll(/\bstyles\.(\w+)/g)) {
        for (const other of sameDirectory) {
          const entry = new RegExp(`\\b${reference[1]}:\\s*\\{([^{}]*)\\}`).exec(other.text);
          if (!entry) continue;
          for (const size of entry[1]!.matchAll(/\b(minHeight|minWidth|height|width):\s*(\d+(?:\.\d+)?)\b/g)) {
            const value = Number(size[2]);
            const named = `${file.name}:${reference[1]}`;
            if (gamePieces.includes(named)) continue;
            if (value > 0 && value < uiMetrics.minTouchCompact) violations.push(`${file.name}:${lineOf(file.text, index)}: styles.${reference[1]} ${size[1]} ${value}`);
          }
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('the tab labels give way and the explore filters wrap when a zoomed-in window is narrow', () => {
  const read = (path: string) => readFileSync(join(sourceRoot, path), 'utf8');
  const bar = read('navigation/floating-tab-bar.tsx');
  assert.match(bar, /import \{ isNarrow \} from '@\/ui\/large-text';/);
  // 글자만 숨기고 접근성 이름은 라벨로 남긴다(아이콘만 보이는 탭도 읽힌다).
  assert.match(bar, /accessibilityLabel=\{accessibilityLabel \?\? label\}/);
  assert.match(bar, /\{narrow \? null : <Text /);
  const map = read('screens/real-map/index.tsx');
  assert.match(map, /import \{ isLargeText, isNarrow \} from '@\/ui\/large-text';/);
  assert.match(map, /const narrow = isNarrow\(width\);/);
  assert.match(map, /narrow\s*&&\s*\{\s*flexWrap:\s*'wrap',\s*width\s*\}/);
});
