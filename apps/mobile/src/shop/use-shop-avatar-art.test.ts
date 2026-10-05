import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./use-shop-avatar-art.ts', import.meta.url)), 'utf8');
const wardrobe = readFileSync(fileURLToPath(new URL('./wardrobe.tsx', import.meta.url)), 'utf8');
const home = readFileSync(fileURLToPath(new URL('../screens/home/index.tsx', import.meta.url)), 'utf8');

test('PR #312 리뷰 5번: 홈 탭이 다시 포커스를 받으면 대표 캐릭터와 옷을 한 번의 shop snapshot으로 다시 읽는다', () => {
  assert.match(source, /export function useShopAvatarAppearance\(/);
  assert.match(source, /export function useShopAvatarArt\(/);
  assert.match(source, /refreshToken = 0,/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ setFocusToken\(\(value\) => value \+ 1\); \}, \[\]\)\);/);
  assert.equal((source.match(/api\.getShop\(\)/g) ?? []).length, 1, 'appearance reads GET /shop once and derives every avatar field from it');
  assert.match(source, /art: snapshot\.avatar \? friendArt\[snapshot\.avatar\] : undefined/);
  assert.match(source, /clothing: equippedClothingArt\(snapshot\)/);
  assert.match(source, /return useShopAvatarAppearance\(apiUrl, credential, refreshToken\)\?\.art;/);
  const effect = source.slice(source.indexOf('useEffect(() => {'));
  assert.match(effect, /\}, \[apiUrl, credential, refreshToken, focusToken\]\);/);
  assert.match(home, /const shop = useShop\(shopApi\)/);
  assert.match(home, /const refreshShop = shop\.refreshQuietly/);
  assert.match(home, /void refreshShop\(\)/);
  assert.match(readFileSync(fileURLToPath(new URL('../experience/home-collection-display.tsx', import.meta.url)), 'utf8'),
    /clothing=\{equippedClothingArt\(shop\)\}/);
});

test('equipped clothing art is available as a pure converter for non-studio surfaces', () => {
  assert.match(wardrobe, /export function equippedClothingArt\(snapshot: Pick<ShopSnapshot, 'clothing'> \| undefined\): EquippedClothingArt \| null/);
  assert.match(wardrobe, /const equipped = snapshot\?\.clothing\.equipped/);
  assert.match(wardrobe, /snapshot\.clothing\.items\.find\(\(candidate\) => candidate\.id === equipped\)/);
  assert.match(wardrobe, /return useMemo\(\(\) => equippedClothingArt\(snapshot\), \[snapshot\]\)/);
});
