import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('./index.tsx');
const overview = home.slice(0, home.indexOf('export function HomeMissionsScreen'));
const nextAction = read('./next-action.ts');
const tickets = read('./home-tickets.tsx');
const exhibit = read('./home-exhibit.tsx');
const layout = read('../../app/_layout.tsx');

test('home loads real room, ticket, reward, collection and merchant data', () => {
  // Collection and coin shop come from the one discovery provider request per focus (also read by the profile strip), not a second copy here.
  for (const request of ['clients.studio.getMine()', 'loadCoinShop()', 'clients.rewards.listStoreTickets()',
    'loadCollection()', 'clients.merchants.listMerchants()']) assert.ok(home.includes(request), request);
  assert.doesNotMatch(home, /createCommerceApiClient|createCoinApiClient|createShopApiClient|useShop\(/);
  // Each request settles into its own section (home-load.ts), so no single slow request holds the whole screen back.
  assert.doesNotMatch(home, /Promise\.allSettled\(/);
  for (const section of ['studio', 'coins', 'rewards', 'collection', 'merchants']) assert.match(home, new RegExp(`track\\('${section}', `), section);
  assert.match(home, /settleHomeSection\(data, section, \{ ok: true, value \}\)/);
  assert.match(home, /homeVisitGoal\(data\.merchants, data\.collection, data\.loadedAt\)/);
  assert.match(home, /data\?\.studio \? <View[\s\S]*?<StudioScene/);
  assert.doesNotMatch(home, /AsyncStorage|fixture/i);
});

test('home keeps room, visit, rewards and friends one tap away', () => {
  for (const route of ['/studio', '/coin-shop', '/claim', '/friends', '/home/missions', '/home/exhibit', '/room-explore']) {
    assert.match(home, new RegExp(`<Link href="${route}" asChild>`), route);
  }
  for (const route of ['/home/tickets', '/coin-shop', '/coin-collection', '/search', '/collection']) assert.ok(nextAction.includes(`href: '${route}'`), route);
  assert.doesNotMatch(overview, /<HomeCollectionDisplay|<HomeMissionsPanel|<CollectibleReveal|tickets\.map\(/);
});

test('방문 기록이 없는 홈은 탐색을 주 행동으로 보여주고 방문 인증을 보조로 남긴다', () => {
  assert.match(overview, /const nextAction = homeNextAction\(data, goal\)/);
  assert.match(overview, /nextAction \? <Link href=\{nextAction\.kind === 'next-visit'/);
  assert.match(overview, /accessibilityLabel=\{`\$\{nextAction\.title\}\. \$\{nextAction\.detail\}`\}/);
  assert.match(overview, /accessibilityLiveRegion="polite"[\s\S]*?다음 행동을 확인하고 있어요/);
  assert.match(nextAction, /data\.collection\.visits\.length === 0/);
  assert.match(overview, /<Link href="\/claim" asChild>/);
});

test('home keeps account access and refresh controls inside safe scrolling', () => {
  assert.match(home, /<AppHeader title="홈" showFriendsEntry showMailEntry compact \/>/);
  assert.match(home, /contentContainerStyle=\{\{ paddingBottom: clearance \+ 8 \}\}/);
  assert.match(home, /<StatusBarScrim scrollY=\{scrim\.scrollY\} \/>/);
  assert.match(home, /onScroll=\{scrim\.onScroll\}/);
  assert.match(home, /progressViewOffset=\{insets\.top\}/);
  assert.match(home, /if \(request !== generation\.current\) return/);
  assert.match(home, /generation\.current\+\+;/);
});

test('ticket detail lists every server entitlement and ACKs only after the reveal shows its card', () => {
  assert.match(tickets, /createStoreTicketApiClient\(\{ apiUrl, credential, onSessionInvalid \}\)/);
  assert.match(tickets, /ticketApi\.listStoreTickets\(\)/);
  assert.match(tickets, /tickets\.tickets\.map\(\(ticket\) =>/);
  assert.match(tickets, /key=\{ticket\.entitlementId\}/);
  assert.match(tickets, /onPress=\{\(\) => openTicket\(ticket\)\}/);
  assert.match(tickets, /<CollectibleReveal/);
  assert.match(tickets, /onCardShown=\{acknowledgeShownTicket\}/);
  assert.match(tickets, /ticketApi\.openStoreTicket\(entitlementId\)/);
  assert.match(tickets, /useDrawMusic\(opening !== undefined\)/);
  const openTicket = tickets.slice(tickets.indexOf('const openTicket = useCallback'), tickets.indexOf('const acknowledgeShownTicket = useCallback'));
  assert.doesNotMatch(openTicket, /openStoreTicket/);
  assert.match(tickets, /load=\{commerceApi\.getCollectible\}/);
  assert.match(tickets, /<BackHeader title="받은 가게권" \/>/);
  assert.match(tickets, /if \(generation !== loadGeneration\.current\) return/);
});

test('exhibit detail keeps the single full exhibit and its real goal, collection and shop data', () => {
  assert.match(exhibit, /<HomeCollectionDisplay experience=\{experience\.snapshot\} collection=\{collection\} shop=\{shop\.snapshot\}/);
  assert.match(exhibit, /resolveStudioGoal\(goalData\[0\]\.studio\.goal, goalData\[1\], nextCollection\)/);
  assert.match(exhibit, /<BackHeader title="나의 전시" \/>/);
  assert.match(exhibit, /experience\.error \? 'error' : 'loading'/);
  assert.match(exhibit, /if \(request !== generation\.current\) return/);
});

test('new detail routes guard auth and API configuration and reset on account switch', () => {
  for (const path of ['tickets', 'exhibit']) {
    const route = read(`../../app/home/${path}.tsx`);
    assert.match(route, /if \(!auth\.credential \|\| !auth\.accountId\)/);
    assert.match(route, /if \(!publicApiConfig\.available\)/);
    assert.match(route, /key=\{auth\.accountId\}/);
    assert.match(layout, new RegExp(`Stack.Screen name="home/${path}" options=\\{\\{ headerShown: false \\}\\}`));
  }
});

test('missions keep the 1, 3 and 5 goals and existing reward box on a backable page', () => {
  assert.match(home, /<BackHeader title="미션" \/>/);
  assert.match(home, /<HomeRewardCard book=\{book\} onOpen=\{badgeApi\.openReward\} onRevealed=\{onRevealed\} onOpenFailed=\{onOpenFailed\} \/>/);
  assert.match(home, /shouldRefreshBadgesQuietly\(code\)/);
  assert.match(home, /\[1, 3, 5\]\.map/);
});

test('a visitor with no visit gets one highlighted first store, and an empty room with coins gets a place-them action', () => {
  assert.match(overview, /const firstStore = pickFirstStore\(data, goal\)/);
  assert.match(overview, /pathname: '\/merchants\/\[merchantId\]', params: \{ merchantId: firstStore\.merchantId, from: 'recommendation' \}/);
  assert.match(overview, /clients\.recommendations\.listRecommendations\(\)/);
  assert.match(overview, /label: `수집품 \$\{collectedCount\}개 · 방에 놓기`, onPress: \(\) => router\.push\('\/studio'\)/);
  assert.match(overview, /emptyRoom && collectedCount > 0/);
});

test('each home section names its own loading or failure instead of waiting for the others', () => {
  assert.match(overview, /failed\('studio'\) \? '마이룸을 불러오지 못했어요\.' : '마이룸을 불러오고 있어요\.'/);
  // 보유 뽑기권 has no empty heading or "none yet" card any more: it appears only with a ticket, and a failed read is still named below.
  assert.doesNotMatch(overview, /뽑기권을 불러오지 못했어요|뽑기권 확인 중|아직 뽑기권이 없어요/);
  assert.match(overview, /\{ticketGroups\.size \? <View[^>]*>\s*<Text accessibilityRole="header" style=\{heading\}>보유 뽑기권<\/Text>/);
  // A failure is named only for what is on screen: no 마이룸 before the room opens, no 뽑기권 once the coin shop answered with no ticket.
  // A coin-shop read that failed has no answer, so its failure stays named (the section is missing and nothing else says why).
  assert.match(overview, /const errorText = homeErrorText\(data\?\.errors \?\? \[\], \[\.\.\.\(showRoom \? \[\] : \['studio' as const\]\), \.\.\.\(data\?\.coinShop && !ticketGroups\.size \? \['coins' as const\] : \[\]\)\]\);/);
  assert.match(overview, /\{errorText \? <Pressable[\s\S]*?\{errorText\}<\/Text>/);
  assert.match(overview, /failed\('collection'\) \|\| failed\('merchants'\) \? '방문 목표를 불러오지 못했어요'/);
});

test('a superseded or revisited load never asks for a recommendation, so the first-store card does not flicker or swap', () => {
  assert.match(overview, /const hadRecommendations = loadedRef\.current\?\.clients === clients && loadedRef\.current\.value\.recommendations !== undefined;/);
  assert.match(overview, /request === generation\.current && needsFirstStoreRecommendation\(collection\.visits\.length, hadRecommendations\)/);
});

test('progressive disclosure: the room and exhibit open after the first coin; friends and neighbours only by opt-in', () => {
  assert.match(overview, /const \{ stage, optIn, loadCollection, loadCoinShop \} = discovery;/);
  assert.match(overview, /const showRoom = atLeast\(stage, 'after-first'\);/);
  // Both room blocks (heading + scene) are behind showRoom; the first-coin empty-room action stays on the scene.
  assert.match(overview, /\{showRoom \? <View[^>]*>\s*<Text accessibilityRole="header" style=\{heading\}>마이룸<\/Text>/);
  assert.match(overview, /\{showRoom \? data\?\.studio \? <View[\s\S]*?<StudioScene/);
  assert.match(overview, /emptyAction=\{emptyRoom && collectedCount > 0 \?/);
  assert.match(overview, /\{showRoom \? <Link href="\/home\/exhibit" asChild>/);
  assert.match(overview, /\{optIn\.social \? <Link href="\/friends" asChild>/);
  assert.match(overview, /\{optIn\.social \? <Link href="\/room-explore" asChild>/);
  // 방문 인증 stays the one always-on quick action; a row with nothing in it is not drawn.
  assert.match(overview, /<Link href="\/claim" asChild>/);
  assert.match(overview, /\{showRoom \|\| optIn\.social \? <View/);
});

test('the shop card appears right after the first coin once a draw is affordable, with the price from the server', () => {
  assert.match(overview, /shopEntryVisible\(stage, shop\?\.mileage\.balance \?\? 0, cheapestDrawPrice\(shop\)\)/);
  assert.match(overview, /<Link href="\/shop" asChild>/);
});
