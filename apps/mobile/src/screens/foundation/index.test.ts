import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('시연 역할 선택은 방문 가치를 설명하고 세 단계를 역할 카드 앞에 보여준다', () => {
  const role = screen.slice(screen.indexOf("{stage === 'role' ? ("), screen.indexOf('<View style={styles.roleChoices}>'));
  assert.match(role, /가게에 방문하면 도장과 코인을 모아요/);
  for (const step of ['가게 찾기', '방문 인증', '수집·꾸미기']) assert.match(role, new RegExp(step));
  for (const icon of ['explore', 'claim', 'collection']) assert.match(role, new RegExp(`\\['${icon}',`));
  assert.match(role, /<TabGlyph name=\{name\}/);
});
