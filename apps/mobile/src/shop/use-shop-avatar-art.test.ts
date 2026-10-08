import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./use-shop-avatar-art.ts', import.meta.url)), 'utf8');
const wardrobe = readFileSync(fileURLToPath(new URL('./wardrobe.tsx', import.meta.url)), 'utf8');
const home = readFileSync(fileURLToPath(new URL('../screens/home/index.tsx', import.meta.url)), 'utf8');

test('profile strip reloads identity and clothing on focus while the room uses shop state', () => {
  assert.match(source, /export function useShopAvatarAppearance\(/);
  assert.match(source, /export function useShopAvatarArt\(/);
  assert.match(source, /refreshToken = 0,/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{ setFocusToken\(\(value\) => value \+ 1\); \}, \[\]\)\);/);
  assert.equal((source.match(/api\.getShop\(\)/g) ?? []).length, 1, 'appearance reads GET /shop once and derives every avatar field from it');
  assert.match(source, /const avatar = selectedCompanion\(snapshot\)/);
  assert.match(source, /art: avatar \? friendArt\[avatar\] : undefined/);
  assert.match(source, /clothing: equippedClothingArt\(snapshot\)/);
  assert.match(source, /return useShopAvatarAppearance\(apiUrl, credential, refreshToken\)\?\.art;/);
  const effect = source.slice(source.indexOf('useEffect(() => {'));
  assert.match(effect, /\}, \[apiUrl, credential, refreshToken, focusToken\]\);/);
  // Home and the strip share the discovery provider's one GET /shop per focus; pull-to-refresh asks the provider again.
  assert.match(home, /const shop = discovery\.strip\.shop;/);
  assert.match(home, /discovery\.refresh\(\)/);
  const strip = readFileSync(fileURLToPath(new URL('../ui/profile-strip.tsx', import.meta.url)), 'utf8');
  assert.match(strip, /useDiscoveryOnFocus\(\)/);
  const calls = readFileSync(fileURLToPath(new URL('../discovery/discovery-calls.ts', import.meta.url)), 'utf8');
  assert.equal((calls.match(/shop\.getShop\(\)/g) ?? []).length, 1, 'the provider reads GET /shop once per strip load');
  assert.match(strip, /<AvatarWardrobe clothing=\{clothing\}/);
  assert.match(readFileSync(fileURLToPath(new URL('../experience/home-collection-display.tsx', import.meta.url)), 'utf8'),
    /clothing=\{equippedClothingArt\(shop\)\}/);
});

test('equipped clothing art is available as a pure converter for non-studio surfaces', () => {
  assert.match(wardrobe, /export function equippedClothingArt\(snapshot: Pick<ShopSnapshot, 'clothing'> \| undefined\): EquippedClothingArt \| null/);
  assert.match(wardrobe, /const equipped = snapshot\?\.clothing\.equipped/);
  assert.match(wardrobe, /snapshot\.clothing\.items\.find\(\(candidate\) => candidate\.id === equipped\)/);
  assert.match(wardrobe, /return useMemo\(\(\) => equippedClothingArt\(snapshot\), \[snapshot\]\)/);
});
