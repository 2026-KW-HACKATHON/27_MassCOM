import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('./index.tsx');
const overview = home.slice(0, home.indexOf('export function HomeMissionsScreen'));
const tickets = read('./home-tickets.tsx');
const exhibit = read('./home-exhibit.tsx');
const layout = read('../../app/_layout.tsx');

test('home shows only live summary data and four purpose routes', () => {
  assert.match(home, /ticketApi\.listStoreTickets\(\)/);
  assert.match(home, /status: 'ready', count: tickets\.length/);
  assert.match(home, /ticketCount\.status === 'ready' \? `\$\{ticketCount\.count\}장`/);
  assert.match(home, /shop\.snapshot\.mileage\.balance\.toLocaleString\('ko-KR'\)/);
  assert.match(home, /shop\.snapshot\.items\.filter\(\(item\) => item\.owned\)\.length/);
  for (const route of ['/claim', '/home/tickets', '/home/missions', '/home/exhibit']) {
    assert.match(home, new RegExp(`<Link href="${route}" asChild>`), route);
  }
  assert.match(home, /shop\.status === 'ready' && shop\.snapshot \? <CompanionScene/);
  assert.doesNotMatch(overview, /<HomeCollectionDisplay|<HomeMissionsPanel|<CollectibleReveal|tickets\.map\(/);
  assert.doesNotMatch(home, /AsyncStorage|fixture/i);
});

test('home keeps account, friends and mail in a compact header with safe scrolling', () => {
  assert.match(home, /<AppHeader title="홈" subtitle="오늘의 탐험" showFriendsEntry showMailEntry compact \/>/);
  assert.match(home, /contentContainerStyle=\{\[styles\.content, \{ paddingBottom: clearance \}\]\}/);
  assert.match(home, /<StatusBarScrim scrollY=\{scrim\.scrollY\} \/>/);
  assert.match(home, /onScroll=\{scrim\.onScroll\}/);
  assert.match(home, /progressViewOffset=\{insets\.top\}/);
  assert.match(home, /if \(request === generation\.current\) setTicketCount/);
  assert.match(home, /if \(request === generation\.current\) generation\.current \+= 1/);
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
