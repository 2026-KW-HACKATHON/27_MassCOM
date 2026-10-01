import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./use-shop-avatar-art.ts', import.meta.url)), 'utf8');
const merchantList = readFileSync(fileURLToPath(new URL('../screens/merchant-list/index.tsx', import.meta.url)), 'utf8');

test('PR #312 리뷰 5번: 홈 탭이 다시 포커스를 받거나 당겨서 새로고침하면 대표 캐릭터 그림을 다시 읽는다', () => {
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ setFocusToken\(\(value\) => value \+ 1\); \}, \[\]\)\);/);
  assert.match(source, /refreshToken = 0,/);
  const effect = source.slice(source.indexOf('useEffect(() => {'));
  assert.match(effect, /\}, \[apiUrl, credential, refreshToken, focusToken\]\);/);
  // 홈 화면은 badgeRefreshToken(당겨서 새로고침마다 오르는 기존 토큰)을 그대로 넘긴다 — 아바타만을 위한 새 상태를 따로 만들지 않는다.
  assert.match(merchantList, /useShopAvatarArt\(apiUrl, auth\.credential, badgeRefreshToken\)/);
});
