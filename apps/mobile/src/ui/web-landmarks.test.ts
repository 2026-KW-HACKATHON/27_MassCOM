import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a decorative mascot leaves the web tab order and the accessibility tree, a labelled one does not', () => {
  const mascot = source('ui/mascot.tsx');
  // 웹에서만: 라벨 없는(또는 decorativeOnWeb로 라벨을 버린) 마스코트는 tabIndex -1 + aria-hidden.
  assert.match(mascot, /const accessibilityLabel = Platform\.OS === 'web' && decorativeOnWeb \? undefined : labelProp;/);
  assert.match(mascot, /Platform\.OS === 'web' && !accessibilityLabel \? \(\{ tabIndex: -1, 'aria-hidden': true \} as const\) : undefined/);
  assert.match(mascot, /const a11y = \{ \.\.\.mascotAccessibility\(accessibilityLabel, interactive\), \.\.\.webDecoration \};/);
  // 두 영웅 마스코트는 라벨을 그대로 두고(네이티브는 announced 버튼) 웹에서만 장식 처리를 요청한다.
  const foundation = source('screens/foundation/index.tsx');
  assert.match(foundation, /<Mascot interactive pose="wave" size=\{136\} accessibilityLabel="손을 흔드는 마스코트" decorativeOnWeb \/>/);
  assert.match(source('screens/auth-required/index.web.tsx'), /<Mascot pose="wave" size=\{96\} accessibilityLabel="손을 흔드는 마스코트" decorativeOnWeb \/>/);
  // 장식 처리는 플랫폼 검사 뒤에만 일어난다: decorativeOnWeb는 mascot.tsx 밖에서 라벨을 지우지 않는다.
  assert.doesNotMatch(foundation, /accessibilityLabel=\{[^}]*undefined/);
});

test('page content is the main landmark, below the header', () => {
  const sky = source('ui/sky-scroll-view.tsx');
  assert.match(sky, /<View role="main" style=\{\[styles\.grow, contentContainerStyle\]\}>\{children\}<\/View>/);
  assert.ok(sky.indexOf('{header}') < sky.indexOf('role="main"'), 'the header stays outside main');
  assert.match(source('screens/foundation/index.tsx'), /<ScrollView role="main" contentContainerStyle=\{styles\.onboarding\}/);
});

test('both tab bars are a labelled navigation landmark on the web only, keep the tab list inside and never block touches', () => {
  const floating = source('navigation/floating-tab-bar.tsx');
  // Web-only, so Android TalkBack gets no extra stop; the two bars share one definition.
  assert.match(floating, /export const navigationLandmark = Platform\.OS === 'web' \? \(\{ role: 'navigation', 'aria-label': '주요 메뉴' \} as const\) : \{\};/);
  assert.doesNotMatch(source('navigation/context-tab-bar.tsx'), /role="navigation"|aria-label=/);
  for (const file of ['navigation/floating-tab-bar.tsx', 'navigation/context-tab-bar.tsx']) {
    const bar = source(file);
    // role outranks accessibilityRole in react-native-web, so the landmark is its own wrapper around the tablist.
    assert.match(bar, /<View \{\.\.\.navigationLandmark\} pointerEvents="box-none" style=\{StyleSheet\.absoluteFill\}>/, file);
    assert.ok(bar.indexOf('{...navigationLandmark}') < bar.indexOf('accessibilityRole="tablist"'), file);
  }
  assert.match(source('navigation/context-tab-bar.tsx'), /import \{ TabSlot, navigationLandmark \} from '\.\/floating-tab-bar';/);
});
