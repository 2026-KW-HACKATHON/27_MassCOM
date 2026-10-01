import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks (not a renderer) for the same reason as collection/index.test.ts: this screen renders
// react-native views, which the node:test/esbuild runner cannot load.
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

// PR #301 리뷰: 홈 보상 카드가 `onOpenFailed`를 넘기지 않아, 보상 열기가 거절돼도(예: 마지막 쿠폰 소진) 배지 책을
// 다시 읽지 않았다 — 그 상자가 계속 READY로 보여 homeFeaturedReward가 같은 상자만 돌려주고 다음 READY 상자를 가렸다.
test('the home reward card wires onOpenFailed through to a quiet badge refresh (#301 review)', () => {
  assert.match(screen, /<HomeRewardCard book=\{book\} onOpen=\{badgeApi\.openReward\} onRevealed=\{onRevealed\} onOpenFailed=\{onOpenFailed\} \/>/);
  const onOpenFailed = screen.slice(screen.indexOf('const onOpenFailed = useCallback'), screen.indexOf('const onRevealed = useCallback'));
  assert.match(onOpenFailed, /shouldRefreshBadgesQuietly\(code\)/);
  assert.match(onOpenFailed, /void refreshQuietly\(\);/);
});

// PR #301 리뷰: 당겨서 새로고침이 음식점 목록만 다시 받고 배지 책(여권 칩·보상 카드)은 그대로였다.
test('pull-to-refresh also refreshes the badge book, not just the store list (#301 review)', () => {
  const pullToRefresh = screen.slice(screen.indexOf('refreshControl={'), screen.indexOf('ListHeaderComponent={'));
  assert.doesNotMatch(pullToRefresh, /onRefresh=\{refresh\}/);
  assert.match(pullToRefresh, /onRefresh=\{refreshAll\}/);
  const refreshAll = screen.slice(screen.indexOf('const refreshAll = useCallback'), screen.indexOf('}, [refresh]);'));
  assert.match(refreshAll, /void refresh\(\);/);
  assert.match(refreshAll, /setBadgeRefreshToken/);
  assert.match(screen, /SignedInPassportChip[^/]*refreshToken=\{badgeRefreshToken\}/);
  assert.match(screen, /SignedInRewardCard[^/]*refreshToken=\{badgeRefreshToken\}/);
});
