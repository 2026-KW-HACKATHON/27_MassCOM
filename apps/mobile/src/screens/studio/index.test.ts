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
  assert.match(source, /<AvatarWardrobe clothing=\{clothingArtForId\(item\.id\)\} size=\{42\} \/>/);
  assert.doesNotMatch(source, /item\.name\.slice\(0, 1\)/);
});

test('dirty studio guards route removal and does not reload on a temporary refocus or pull refresh', () => {
  assert.match(source, /usePreventRemove\(dirty && !allowRemoval/);
  assert.match(source, /navigation\.dispatch\(action\)/);
  assert.match(source, /<ConfirmDialog visible=\{showDiscard\}/);
  assert.doesNotMatch(source, /window\.confirm|Alert\.alert/);
  assert.match(source, /studioNeedsReload\(loadedFor\.current, client, requestKey\)/);
  assert.match(source, /onRefresh=\{refreshIfClean\}/);
  assert.doesNotMatch(source, /confirmDiscard/);
});

test('studio exposes focused edit modes with one early save and preserves the shared draft', () => {
  assert.match(source, /requestedEntitlement \|\| requestedSourceId \? 'coins' : requestedAvatar \? 'companion' : 'room'/);
  for (const mode of ['room', 'coins', 'companion', 'goal']) assert.match(source, new RegExp(`mode === '${mode}'`));
  assert.match(source, /<Fold title="새 꾸미기와 해금 조건"/);
  assert.equal((source.match(/<Text style=\{styles\.saveText\}>/g) ?? []).length, 1);
  assert.ok(source.indexOf('styles.saveRow') < source.indexOf("{mode === 'room'"));
  assert.match(source, /setDraft\(\(current\) => studioAfterSave\(submitted, current, saved\.studio\)\)/);
  assert.doesNotMatch(source, /저장한 동행과 수집품은 친구 공간에 바로 보여요/);
});
