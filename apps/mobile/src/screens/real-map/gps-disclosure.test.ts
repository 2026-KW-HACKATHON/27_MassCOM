import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=readFileSync(new URL('./index.tsx',import.meta.url),'utf8');
test('location tap shows an optional purpose disclosure; cancel never reaches the OS permission request',()=>{
  assert.match(source,/const \[gpsPrompt,setGpsPrompt\]=useState\(false\)/);
  assert.match(source,/onPress=\{\(\)=>setGpsPrompt\(true\)\}[^>]*><Text[^>]*>현재 위치/);
  assert.match(source,/이번 한 번 현재 위치 사용/);
  assert.match(source,/서비스 서버에 좌표가 전달되고/);
  assert.match(source,/보행 경로를 요청할 때만 TMAP에 출발 좌표가 전달됩니다/);
  assert.match(source,/백그라운드 위치나 이동 경로를 수집하지 않고/);
  assert.match(source,/onPress=\{\(\)=>setGpsPrompt\(false\)\}[^>]*><Text[^>]*>취소/);
  assert.match(source,/onPress=\{\(\)=>\{setGpsPrompt\(false\);void requestGps\(\);\}\}/);
  const request=source.slice(source.indexOf('async function requestGps()'),source.indexOf('async function findManualOrigin()'));
  assert.match(request,/hasServicesEnabledAsync\(\)/);
  assert.match(request,/requestForegroundPermissionsAsync\(\)/);
  assert.match(request,/Date\.now\(\)-fix\.timestamp>60000/);
  assert.doesNotMatch(source.slice(0,source.indexOf('async function requestGps()')), /requestForegroundPermissionsAsync\(\)/);
});

test('external-app return refreshes discovery while background cleanup discards pending GPS and routes',()=>{
  assert.match(source,/const foreground = useAppForeground\(\)/);
  assert.match(source,/useFocusEffect\(useCallback\(\(\)=>\{if\(!foreground\)\{setFocused\(false\);return;\}/);
  assert.match(source,/locationGeneration\.current\+\+;request\.current\?\.abort\(\);clusterRequest\.current\?\.abort\(\)/);
  assert.match(source,/\[routeGate,foreground\]\)/);
  assert.match(source,/active=\{focused&&foreground\}/);
});
