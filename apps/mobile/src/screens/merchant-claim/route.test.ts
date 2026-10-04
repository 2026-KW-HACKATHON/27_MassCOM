import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../../app/merchant.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

test('unavailable merchant route alone replaces the stack header with the signed-out sky and back header', () => {
  assert.match(layout, /<Stack.Screen name="merchant" options=\{\{ title: '점주 방문 확인' \}\} \/>/);
  assert.match(route, /if \(!canOpenDeveloperMerchantRoute[\s\S]*?return <SkyBackdrop>\s*<Stack.Screen options=\{\{ headerShown: false \}\} \/>/);
  assert.equal((route.match(/headerShown: false/g) ?? []).length, 1);
  assert.match(route, /if \(!publicApiConfig\.available \|\| !demoRuntimeConfig\.merchant\) \{\s*return <>\s*<Stack.Screen options=\{\{ headerShown: true \}\} \/>\s*<DemoConfigurationRequired/);
  assert.match(route, /return \(\s*<>\s*<Stack.Screen options=\{\{ headerShown: true \}\} \/>\s*<MerchantClaimScreen/);
  assert.equal((route.match(/headerShown: true/g) ?? []).length, 2, 'both non-denied branches restore the stack header');
  assert.match(route, /<SkyBackdrop>/);
  assert.match(route, /<SkyScrollView header=\{<BackHeader title="점주 방문 확인" \/>\}/);
  assert.match(route, /<FloatingCard style=\{styles\.statusCard\}>/);
  assert.match(route, /<Text style=\{styles\.statusTitle\}>이 계정에서는 개발용 점주 발급 화면을 사용할 수 없습니다/);
  assert.match(route, /<Link href="\/" asChild>[\s\S]*<Pressable accessibilityRole="button" style=\{styles\.guestButton\}>/);
  assert.match(route, /<Text style=\{styles\.guestButtonLabel\}>음식점 탐색으로 돌아가기<\/Text>/);
  assert.match(route, /makeAuthRequiredStyles\(colorsForScheme\(useColorScheme\(\)\)/);
});
