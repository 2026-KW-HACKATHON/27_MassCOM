import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('home loads real unopened store tickets from the authenticated server contract', () => {
  assert.match(screen, /createStoreTicketApiClient\(\{ apiUrl, credential, onSessionInvalid \}\)/);
  assert.match(screen, /ticketApi\.listStoreTickets\(\)/);
  assert.doesNotMatch(screen, /AsyncStorage|presentedCollectibleIds|fixture/i);
  assert.match(screen, /방문해서 받은 가게권을 여기서 바로 열 수 있어요\./);
  assert.doesNotMatch(screen, /열어도 새 NFT나 보상을 만들지 않아요/);
  assert.match(screen, /아직 가게 뽑기권이 없어요/);
  assert.match(screen, /방문 인증 열기/);
});

test('store ticket ACK is sent only after the reveal reports a shown card', () => {
  assert.match(screen, /<CollectibleReveal/);
  assert.match(screen, /onCardShown=\{acknowledgeShownTicket\}/);
  assert.match(screen, /ticketApi\.openStoreTicket\(entitlementId\)/);
  assert.match(screen, /useDrawMusic\(opening !== undefined\)/);
  const openTicket = screen.slice(screen.indexOf('const openTicket = useCallback'), screen.indexOf('const acknowledgeShownTicket = useCallback'));
  assert.doesNotMatch(openTicket, /openStoreTicket/);
  assert.match(screen, /load=\{commerceApi\.getCollectible\}/);
});

test('home has mail/settings in the header, QR and friends quick actions, and no home map action', () => {
  assert.match(screen, /showMailEntry/);
  assert.match(screen, /href="\/claim"/);
  assert.match(screen, /href="\/friends"/);
  assert.doesNotMatch(screen, /href="\/map"/);
});

test('home uses the shared avatar appearance so the header and hero show the equipped clothing', () => {
  assert.match(screen, /import \{ useShopAvatarAppearance \} from '@\/shop\/use-shop-avatar-art';/);
  assert.match(screen, /const \[avatarRefreshToken, setAvatarRefreshToken\] = useState\(0\);/);
  assert.match(screen, /const avatar = useShopAvatarAppearance\(apiUrl, credential, avatarRefreshToken\);/);
  assert.match(screen, /const avatarArt = avatar\?\.art;/);
  assert.match(screen, /const avatarClothing = avatar\?\.clothing \?\? null;/);
  assert.match(screen, /setAvatarRefreshToken\(\(value\) => value \+ 1\); void load\(true\);/);
  assert.match(screen, /<AppHeader title="홈" subtitle="오늘 받은 가게권과 미션을 확인해요" avatarArt=\{avatarArt\} avatarClothing=\{avatarClothing\} showMailEntry>/);
  assert.match(screen, /<Companion art=\{avatarArt\} clothing=\{avatarClothing\} interactive size=\{heroMascotSize\(fontScale, 96\)\} \/>/);
  assert.doesNotMatch(screen, /useShopAvatarArt\(/);
});

test('home scrolls under the status scrim, clears the tab bar, and scales the hero art for large text', () => {
  assert.match(screen, /const clearance = useTabBarClearance\(\);/);
  assert.match(screen, /const scrim = useStatusBarScrim\(\);/);
  assert.match(screen, /onScroll=\{scrim\.onScroll\}/);
  assert.match(screen, /contentContainerStyle=\{\[styles\.content, \{ paddingBottom: clearance \}\]\}/);
  assert.match(screen, /<StatusBarScrim scrollY=\{scrim\.scrollY\} \/>/);
  assert.match(screen, /<Companion art=\{avatarArt\} clothing=\{avatarClothing\} interactive size=\{heroMascotSize\(fontScale, 96\)\} \/>/);
  assert.match(screen, /<Mascot interactive pose="stamp" size=\{heroMascotSize\(fontScale, 96\)\} \/>/);
});

test('home drops stale async loads after focus cleanup or a newer request', () => {
  assert.match(screen, /const loadGeneration = useRef\(0\);/);
  assert.match(screen, /const load = useCallback\(async \(refresh = false, generation = \+\+loadGeneration\.current\) =>/);
  assert.match(screen, /if \(generation !== loadGeneration\.current\) return;\s*setTickets\(\{ status: 'ready', tickets: nextTickets \}\);/);
  assert.match(screen, /if \(generation !== loadGeneration\.current\) return;\s*setTickets\(\(current\) => \(\{ status: 'error'/);
  assert.match(screen, /if \(generation === loadGeneration\.current\) setRefreshing\(false\);/);
  assert.match(screen, /return \(\) => \{\s*if \(generation === loadGeneration\.current\) loadGeneration\.current \+= 1;\s*\};/);
});

test('missions reuse the existing reward box and keep 1, 3 and 5 goals visible', () => {
  assert.match(screen, /<HomeRewardCard book=\{book\} onOpen=\{badgeApi\.openReward\} onRevealed=\{onRevealed\} onOpenFailed=\{onOpenFailed\} \/>/);
  assert.match(screen, /shouldRefreshBadgesQuietly\(code\)/);
  assert.match(screen, /\[1, 3, 5\]\.map/);
  assert.match(screen, /router\.push\('\/home\/missions'\)/);
});
