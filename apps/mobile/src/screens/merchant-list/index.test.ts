import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const list = readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
const map = readFileSync(new URL('../real-map/index.tsx',import.meta.url),'utf8');
test('list and map use the same v1 discovery state and ID detail navigation',()=>{
  assert.match(list,/RealMapScreen/);assert.match(list,/initialMode="list"/);
  assert.match(map,/discoveryState\.select\(id\)/);assert.match(map,/api\.search\(token\.query/);
  assert.match(map,/pathname:'\/merchants\/\[merchantId\]'/);
});
test('discovery offers actual map, pagination, same-building leaves and honest empty/key states',()=>{
  assert.match(map,/<TmapMap/);assert.match(map,/onCluster=\{cluster\}/);
  assert.match(map,/state\.nextCursor\?<Pressable/);assert.match(map,/같은 건물 가게/);
  assert.match(map,/실제 가게가 없습니다/);assert.match(map,/지도 키가 연결되지 않았습니다/);
});


test('oversized open-only search offers a changed-query recovery',()=>{
  assert.match(map,/DISCOVERY_ZOOM_REQUIRED/);
  assert.match(map,/지도를 확대하거나 영업 중 필터를 해제하세요/);
  assert.match(map,/discoveryState\.setFilters\(\{openOnly:false\}\)/);
});

test('real rows announce verified status, campaign and straight-line distance at large text',()=>{
  assert.match(map,/accessibilityLabel=\{`\$\{merchant\.name\}/);
  assert.match(map,/businessLabel\(merchant\.business\)/);
  assert.match(map,/Math\.round\(merchant\.distance\.meters\)/);
  assert.match(map,/accessibilityState=\{\{selected:state\.selectedId===merchant\.id\}\}/);
  assert.match(map,/fontScale>=1\.8&&\{minHeight:100\}/);
});


test('wanted filter reads the saved collectible target with account isolation and current preview',()=>{
  assert.match(map,/studioApi\.getMine\(\)/);assert.match(map,/fetchCollectiblePreview\(apiUrl,goal\.merchantId\)/);
  assert.match(map,/resolveStudioGoal\(wanted\.goal,goalMerchants,progress\.collection/);
  assert.match(map,/auth\.accountId===wantedState\?\.accountId/);
  assert.doesNotMatch(map,/readFavorites|wishlist/);
});


test('list scrolls its avatar/header and filters under the status bar with pull refresh',()=>{
  const listBranch=map.slice(map.indexOf("return state.mode==='list'"),map.indexOf("</View> : <View",map.indexOf("return state.mode==='list'")));
  assert.match(listBranch,/onScroll=\{scrim\.onScroll\}/);
  assert.match(listBranch,/refreshControl=\{<RefreshControl refreshing=\{state\.loading\} onRefresh=\{refresh\}/);
  assert.match(listBranch,/\{controls\}\{panels\}/);
  assert.match(listBranch,/<StatusBarScrim scrollY=\{scrim\.scrollY\}/);
  assert.match(map,/const controls=<>[\s\S]*?<AppHeader/);
  assert.match(map,/const refresh=\(\)=>\{setFilterToken\(value=>value\+1\);load\(\);\}/);
});

test('map keeps native gesture canvas outside a vertical ScrollView and bounds its panel',()=>{
  const mapBranch=map.slice(map.indexOf("</View> : <View",map.indexOf("return state.mode==='list'")));
  assert.match(mapBranch,/<View style=\{\[styles\.mapCanvas/);
  assert.match(mapBranch,/<TmapMap/);
  assert.match(mapBranch,/<ScrollView keyboardShouldPersistTaps="handled" style=\{styles\.mapPanel\}>/);
  assert.ok(mapBranch.indexOf('<TmapMap')<mapBranch.indexOf('<ScrollView keyboardShouldPersistTaps="handled" style={styles.mapPanel}>'));
});
