import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./push-runtime.ts', import.meta.url)), 'utf8');
const friendsScreen = readFileSync(fileURLToPath(new URL('../screens/friends/index.tsx', import.meta.url)), 'utf8');
const mapScreen = readFileSync(fileURLToPath(new URL('../screens/town-map/index.tsx', import.meta.url)), 'utf8');
const pinSheet = readFileSync(fileURLToPath(new URL('../screens/town-map/pin-sheet.tsx', import.meta.url)), 'utf8');

test('push runtime keeps expo-notifications lazy so web/typecheck can fall back before root installs native config', () => {
  assert.match(source, /await import\('expo-notifications'\)/);
  assert.doesNotMatch(source, /from 'expo-notifications'/);
  assert.match(source, /Platform\.OS === 'web'/);
});

test('root owns one social push provider while screens consume the context', () => {
  assert.match(source, /export function SocialPushProvider/);
  assert.match(source, /export function useSocialPush/);
  assert.match(source, /createElement\(SocialPushContext, \{ value \}, children\)/);
  assert.match(friendsScreen, /useSocialPush\(\)/);
  assert.doesNotMatch(friendsScreen, /useSocialPushBinding\(/);
});

test('push binding asks OS permission only from the explicit friend screen button', () => {
  assert.match(source, /requestPermissionAndBind/);
  assert.match(source, /requestPermissionsAsync\(\)/);
  assert.match(friendsScreen, /우편 알림 켜기/);
  assert.match(friendsScreen, /onPress=\{\(\) => \{ void push\.requestPermissionAndBind\(\); \}\}/);
});

test('push binding protects account and token rotation with stored binding and generation checks', () => {
  assert.match(source, /generation\.current/);
  assert.match(source, /addPushTokenListener/);
  assert.match(source, /registerNativeToken\(token, ticket, revocationTicket\)/);
  assert.match(source, /getExpoPushTokenAsync\(\{ projectId: latest\.projectId, devicePushToken \}\)/);
  assert.match(source, /getLastNotificationResponseAsync/);
  assert.match(source, /mailIdPattern\.test\(data\.mailId\)/);
  assert.match(source, /clearLastNotificationResponseAsync\?\.\(\)/);
  assert.match(source, /notificationResponseKey\(response, mailId\)/);
  assert.match(source, /handledResponseKeys\.current\.has\(responseKey\)/);
  assert.match(source, /revokeSocialPushBindings/);
  assert.match(source, /beginSocialPushBindingRevocation/);
  assert.match(source, /socialPushRevocationGeneration !== revocationTicket/);
  assert.match(source, /registerPushBindingWithServer/);
  assert.match(source, /unregisterStoredPushBinding/);
  assert.match(source, /preparePushBindingRegistration/);
  assert.match(source, /preparePushBindingRevocation/);
  assert.match(source, /queuedPushBindingStore/);
  assert.match(source, /pushBindingMatchesInput/);
  assert.match(source, /binding: revoking/);
  assert.match(source, /store: queuedPushBindingStore/);
});

test('package id resolves the server push variant without exposing account identifiers', () => {
  assert.match(source, /packageId === 'kr\.masscom\.wolgye\.demo' \? 'SHOWCASE_APP' : 'ANDROID'/);
  assert.doesNotMatch(source, /email|friendCode|console\.(log|info|warn|error|debug)/);
});

test('meal merchant selection is optional and leaves the normal map route behaviour in place', () => {
  assert.match(mapScreen, /selectionMode\?:/);
  assert.match(mapScreen, /selectionMode\s*\?\s*\([\s\S]*?<AppHeader title=\{selectionMode\.title\} subtitle=\{TOWN_MAP_DISCLOSURE\}>[\s\S]*?accessibilityLabel="뒤로"[\s\S]*?onPress=\{leaveRoute\}[\s\S]*?>뒤로</);
  assert.match(mapScreen, /<AppHeader title=\{TOWN_MAP_TITLE\} subtitle=\{TOWN_MAP_DISCLOSURE\}>[\s\S]*?accessibilityLabel="홈으로"[\s\S]*?router\.replace\('\/'\)[\s\S]*?>홈으로</);
  const selectionHeader = mapScreen.slice(mapScreen.indexOf('? ('), mapScreen.indexOf(': (', mapScreen.indexOf('? (')));
  assert.doesNotMatch(selectionHeader, /홈으로/);
  assert.match(pinSheet, /selectionAction\?:/);
  assert.match(pinSheet, /label=\{selectionAction\.label\}/);
  assert.match(pinSheet, /label="자세히 보기"/);
  assert.match(pinSheet, /label="길찾기"/);
});
