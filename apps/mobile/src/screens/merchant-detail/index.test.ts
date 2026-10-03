import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('./visitor-feedback-form.tsx', import.meta.url), 'utf8');

test('detail shows public counts after the menu and loads only the signed-in visitor selection', () => {
  const menu = screen.indexOf('메뉴·가격');
  const tags = screen.indexOf('방문자들이 고른 특징');
  const campaign = screen.indexOf('진행 중인 캠페인');
  assert.ok(menu < tags && tags < campaign);
  assert.match(screen, /merchant\.visitorTags\.map\(\(\{ code, count \}\)/);
  assert.match(screen, /visitorTagLabels\[code\].*\{count\}명/);
  assert.match(screen, /아직 충분히 모이지 않았어요\(같은 특징을 3명 이상 고르면 보여요\)/);
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
  assert.match(form, /의견과 바라는 점은 이 가게 사장님께만 보여요\. 연락처·주소 같은 개인정보는 적지 마세요\./);
  assert.match(form, /'방문 인증한 가게에서만 고를 수 있어요\.'/);
  assert.match(form, /'연락처·주소처럼 보이는 내용은 보낼 수 없어요\.'/);
  assert.match(form, /'잠시 후 다시 시도해 주세요\.'/);
  assert.doesNotMatch(`${screen}\n${form}`, /dangerouslySetInnerHTML|https?:\/\//);
});
