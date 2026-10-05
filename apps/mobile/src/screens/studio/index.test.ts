import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');

test('studio loads equipped clothing from the shop snapshot and previews it in the scene', () => {
  assert.match(source, /const \[clothingChoice, setClothingChoice\] = useState<string \| null>\(null\);/);
  assert.match(source, /setClothingChoice\(shopSnapshot\.clothing\.items\.some\(\(item\) => item\.id === shopSnapshot\.clothing\.equipped && item\.owned\)/);
  assert.match(source, /const clothingPreview = useMemo\(\(\) => shop \? \{ clothing: \{ \.\.\.shop\.clothing, equipped: clothingChoice \} \} : undefined, \[shop, clothingChoice\]\);/);
  assert.match(source, /const clothingArt = useEquippedClothingArt\(clothingPreview\);/);
  assert.match(source, /<StudioScene studio=\{draft\} items=\{selected\} avatar=\{avatarChoice\} clothing=\{clothingArt\}/);
});

test('studio only offers owned clothing and saves through the shop clothing endpoint', () => {
  assert.match(source, /shop\.clothing\.items\.filter\(\(item\) => item\.owned\)\.map/);
  assert.match(source, /clothingChoice !== null && !shop\.clothing\.items\.some\(\(item\) => item\.id === clothingChoice && item\.owned\)/);
  assert.match(source, /shopClient\.setClothing\(clothingChoice\)/);
  assert.match(source, /items: current\.clothing\.items\.map\(\(item\) => \(\{ \.\.\.item, equipped: item\.id === result\.equippedClothing \}\)\)/);
  assert.match(source, /accessibilityLabel="옷 입히지 않기"/);
});
