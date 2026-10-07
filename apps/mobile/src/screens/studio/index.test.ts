import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { worldForScheme } from '../../theme/world';

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
  assert.equal((source.match(/<Text style=\{\[styles\.saveText,/g) ?? []).length, 1);
  assert.ok(source.indexOf('styles.saveRow') < source.indexOf("{mode === 'room'"));
  assert.match(source, /setDraft\(\(current\) => studioAfterSave\(submitted, current, saved\.studio\)\)/);
  assert.doesNotMatch(source, /저장한 동행과 수집품은 친구 공간에 바로 보여요/);
});

test('studio selection chips take palette colours so dark mode never shows white chips', () => {
  assert.match(source, /const styles = makeStyles\(palette\);/);
  const rule = (name: string) => source.match(new RegExp(`^  ${name}: \\{.*$`, 'm'))?.[0] ?? '';
  const choice = rule('choice');
  assert.match(choice, /borderColor: palette\.secondaryLabel/);
  assert.match(choice, /backgroundColor: palette\.surface/);
  const selected = rule('choiceSelected');
  assert.match(selected, /borderColor: palette\.primary/);
  assert.match(selected, /backgroundColor: palette\.primaryContainer/);
  assert.match(rule('choiceText'), /color: palette\.label/);
  for (const line of [choice, selected, rule('choiceText')]) assert.doesNotMatch(line, /#[0-9A-Fa-f]{6}/);
});

test('unselected studio chips keep a 3:1 border against the page and the chip fill in both themes', () => {
  for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
    for (const [name, behind] of [['page', worldForScheme(scheme).page], ['chip fill', palette.surface]] as const) {
      assert.ok(contrast(palette.secondaryLabel, behind) >= 3, `${scheme} chip border vs ${name}`);
    }
    assert.ok(contrast(palette.primary, worldForScheme(scheme).page) >= 3, `${scheme} selected chip border vs page`);
  }
});

test('every selectable studio chip prints a check glyph when selected, so selection is not colour-only', () => {
  // wall/floor default + themes, representative coin, scene, layout.
  for (const selected of ['draft[surface] === null', 'draft[surface] === theme', 'experience.snapshot?.profile.coinEntitlementId === item.entitlementId',
    'draft.theme === theme', 'draft.layout === layout']) {
    const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`\\{${escaped} \\? '✓ ' : ''\\}`), selected);
    assert.match(source, new RegExp(`${escaped} && styles\\.choiceSelected`), selected);
  }
});

test('studio chips with a check glyph carry a plain accessibility label, so screen readers do not read the glyph', () => {
  // Selection stays in accessibilityState (selected, plus checked on radios); the glyph is only visual.
  const labelFor = (marker: string) => {
    const at = source.indexOf(marker);
    assert.ok(at > 0, marker);
    return source.slice(source.lastIndexOf('<Pressable', at), at);
  };
  const cases: [string, RegExp][] = [
    ["{draft[surface] === null ? '✓ ' : ''}기본", /accessibilityRole="radio" accessibilityLabel="기본" accessibilityState=\{\{ checked: draft\[surface\] === null, selected: draft\[surface\] === null \}\}/],
    ["{draft[surface] === theme ? '✓ ' : ''}{themeLabels[theme]}", /accessibilityRole="radio"\s+accessibilityLabel=\{themeLabels\[theme\]\} accessibilityState=\{\{ checked: draft\[surface\] === theme, selected: draft\[surface\] === theme \}\}/],
    ["{experience.snapshot?.profile.coinEntitlementId === item.entitlementId ? '✓ ' : ''}{item.displayName}", /accessibilityLabel=\{item\.displayName\} accessibilityState=\{\{ selected: experience\.snapshot\?\.profile\.coinEntitlementId === item\.entitlementId \}\}/],
    ["{draft.theme === theme ? '✓ ' : ''}{themeLabels[theme]}", /accessibilityLabel=\{`\$\{themeLabels\[theme\]\}\$\{unlocked \? '' : ' · 잠김'\}`\}\s+accessibilityState=\{\{ selected: draft\.theme === theme, disabled: !unlocked \}\}/],
    ["{draft.layout === layout ? '✓ ' : ''}{layoutLabels[layout]}", /accessibilityLabel=\{layoutLabels\[layout\]\} accessibilityState=\{\{ selected: draft\.layout === layout \}\}/],
  ];
  for (const [marker, pattern] of cases) assert.match(labelFor(marker), pattern, marker);
  assert.match(source, /const layoutLabels = \{ shelf: '선반', gallery: '갤러리' \} as const;/);
});

test('studio checkbox rows expose aria-checked on the web and toggle on Space through the same guarded toggle as a press', () => {
  // react-native-web ignores accessibilityState, so aria-checked is what reaches the DOM. It is not web-only: RN 0.86 Pressable maps aria-checked
  // onto accessibilityState.checked, so on native too the radios that only set `selected` now announce checked. accessibilityState stays as it was.
  assert.match(source, /import \{ spaceToggles \} from '@\/ui\/space-toggles';/);
  const coinRow = source.slice(source.lastIndexOf('<Pressable accessibilityRole="checkbox"', source.indexOf('{checked ? \'✓\' : \'+\'}')), source.indexOf('{checked ? \'✓\' : \'+\'}'));
  assert.match(coinRow, /accessibilityState=\{\{ checked \}\} aria-checked=\{checked\}/);
  assert.match(coinRow, /onPress=\{toggle\} \{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(toggle\) \} : \{\}\)\}/);
  assert.match(source, /const toggle = \(\) => toggleCoinSource\(\{ sourceKind: source\.sourceKind, sourceId: source\.sourceId \}\);/);
  const itemRow = source.slice(source.lastIndexOf('<Pressable key={item.entitlementId} accessibilityRole="checkbox"', source.indexOf('{selectedItem ? \'✓\' : \'+\'}')), source.indexOf('{selectedItem ? \'✓\' : \'+\'}'));
  assert.match(itemRow, /accessibilityState=\{\{ checked: selectedItem \}\} aria-checked=\{selectedItem\}/);
  assert.match(itemRow, /onPress=\{toggle\} \{\.\.\.\(Platform\.OS === 'web' \? \{ onKeyDown: spaceToggles\(toggle\) \} : \{\}\)\}/);
  assert.match(source, /const toggle = \(\) => toggleSlot\(item\.entitlementId\);/);
  // Both toggles already refuse while saving, so neither key path can change a draft mid-save.
  for (const name of ['toggleSlot', 'toggleCoinSource']) assert.match(source, new RegExp(`function ${name}\\([^)]*\\) \\{\\s+if \\(!draft \\|\\| saving\\) return;`));
});

test('every studio radio exposes aria-checked on the web and picks on Space; saving locks the key path like the pointer path', () => {
  const radios = source.match(/accessibilityRole="radio"/g) ?? [];
  assert.equal(radios.length, 8);
  assert.equal((source.match(/aria-checked=\{/g) ?? []).length, radios.length + 2, '8 radios + 2 checkboxes = the 10 role sites');
  assert.equal((source.match(/onKeyDown: spaceToggles\(/g) ?? []).length, radios.length + 2);
  // pointerEvents="none" only blocks pointers; Enter still reaches onPress through the RN-web press responder. So the saving guard lives in the
  // shared choose function and onPress and Space call the same one, like toggleSlot does for the checkboxes.
  assert.match(source, /function chooseAvatar\(id: string\) \{ if \(avatarSaving \|\| clothingSaving\) return; setAvatarChoice\(id\); \}/);
  assert.match(source, /function chooseClothing\(id: string \| null\) \{ if \(avatarSaving \|\| clothingSaving\) return; setClothingChoice\(id\); \}/);
  assert.match(source, /function chooseGoal\(goal: StudioGoal\) \{ if \(saving\) return; setDraft/);
  for (const call of ['chooseAvatar(item.id)', 'chooseClothing(null)', 'chooseClothing(item.id)', 'chooseGoal(null)', 'chooseGoal(option.goal)']) {
    assert.ok(source.includes(`onPress={() => ${call}}`), `onPress ${call}`);
    assert.ok(source.includes(`onKeyDown: spaceToggles(() => ${call})`), `Space ${call}`);
  }
  assert.doesNotMatch(source, /onPress=\{\(\) => set(Avatar|Clothing)Choice\(/);
  assert.doesNotMatch(source, /spaceToggles\(\(\) => \{ if \(/);
});

test('button chips whose label hides the check glyph expose their selected state on the web as aria-pressed', () => {
  // react-native-web drops accessibilityState and the plain accessibilityLabel hides the ✓, so aria-pressed is the only selected state on the web.
  for (const selected of ['experience.snapshot?.profile.coinEntitlementId === item.entitlementId', 'draft.theme === theme', 'draft.layout === layout', 'draft.accent === accent']) {
    const escaped = selected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`accessibilityState=\\{\\{ selected: ${escaped}(, disabled: !unlocked)? \\}\\}\\s+aria-pressed=\\{${escaped}\\}`), selected);
  }
  assert.equal((source.match(/aria-pressed=\{/g) ?? []).length, 4);
});
