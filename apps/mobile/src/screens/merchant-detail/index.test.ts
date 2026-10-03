import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('./visitor-feedback-form.tsx', import.meta.url), 'utf8');

test('detail leads with collectible goals, then shows public counts after the menu and private selection only when signed in', () => {
  const collectibles = screen.indexOf('이 가게에서 모을 수 있는 수집품');
  const address = screen.indexOf('label="주소"');
  const menu = screen.indexOf('메뉴·가격');
  const tags = screen.indexOf('방문자들이 고른 특징');
  const claim = screen.indexOf('방문 코드 받기');
  const wallet = screen.indexOf('지갑 연결은 나중에');
  assert.ok(collectibles < address && address < menu && menu < tags && tags < claim && claim < wallet);
  assert.match(screen, /<GradeMaterialLayer material=\{material\}/);
  assert.match(screen, /directionsTargets\(merchant\)/);
  assert.match(screen, /merchant\.visitorTags\.map\(\(\{ code, count \}\)/);
  assert.match(screen, /visitorTagLabels\[code\].*\{count\}명/);
  assert.match(screen, /merchant\.demo \? '아직 고른 손님이 없어요' : '아직 충분히 모이지 않았어요\(같은 특징을 3명 이상 고르면 보여요\)'/);
  assert.match(screen, /auth\.credential && auth\.accountId/);
  assert.match(screen, /client\.getMine\(merchantId\)/);
  assert.match(screen, /<VisitorFeedbackForm/);
  assert.match(screen, /key=\{`\$\{merchant\.id\}:\$\{auth\.accountId\}`\}/);
});

test('feedback form keeps choices accessible, private, and text-only', () => {
  assert.match(form, /accessibilityRole="button" accessibilityLabel=\{label\} accessibilityState=\{\{ selected, disabled \}\}/);
  assert.match(form, /disabled=\{disabled\}/);
  assert.match(form, /useEffect\(\(\) => \(\) => \{ requestVersion\.current \+= 1; \}, \[client, merchantId\]\)/);
  assert.match(form, /minHeight: 48/);
  assert.match(form, /selected \? `✓ \$\{label\}` : label/);
  assert.match(form, /multiline/);
  assert.match(form, /\{noteLength\}\/\{visitorFeedbackNoteMaxLength\}/);
  assert.match(form, /의견과 바라는 점은 이 가게 점주·직원에게만 보여요\. 연락처·주소 같은 개인정보는 적지 마세요\./);
  assert.match(form, /'방문 인증한 가게에서만 고를 수 있어요\.'/);
  assert.match(form, /'연락처·주소처럼 보이는 내용은 보낼 수 없어요\.'/);
  assert.match(form, /'잠시 후 다시 시도해 주세요\.'/);
  assert.match(form, /cause\.status === 401 && onUnauthorized\) \{\s*onUnauthorized\(\);/);
  assert.doesNotMatch(`${screen}\n${form}`, /dangerouslySetInnerHTML|https?:\/\//);
});

test('successful save closes the detail form and shows thanks', () => {
  assert.match(form, /await client\.save\(merchantId, toVisitorFeedbackPayload\(form\)\);\s*if \(requestVersion\.current === version\) onSaved\(\);/);
  assert.match(screen, /onSaved=\{\(\) => \{ setSelection\(null\); setMessage\('고마워요! 다른 손님이 가게를 고를 때 도움이 돼요\.'\); \}\}/);
});
