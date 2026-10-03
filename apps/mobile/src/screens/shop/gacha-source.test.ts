import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// RN 렌더러가 없는 모바일 테스트 환경에서 화면 연결과 접근성 계약을 소스로 확인한다.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const celebration = read('../../gamification/celebration.tsx');
const shop = read('./index.tsx');
const machine = read('./gacha-machine.tsx');

test('#342 축하 화면은 이번 보상을 릴로 보여주고 뽑기 CTA를 제공한다', () => {
  assert.match(celebration, /rewardReel\(/);
  assert.match(celebration, /이번에 받은 것/);
  assert.match(celebration, /지금 뽑기/);
});

test('#342 상점 구매 결과는 공통 뽑기 기계에 전달한다', () => {
  assert.match(shop, /import \{ GachaMachine \} from '\.\/gacha-machine';/);
  assert.match(shop, /<GachaMachine[\s\S]*?result=\{reveal\}[\s\S]*?ownedBefore=\{ownedBefore\}/);
});

test('#342 뽑기 연출은 언제든 건너뛸 수 있다', () => {
  assert.match(machine, /건너뛰기/);
});

test('#342 뽑기 기계와 결과는 스크린리더용 이름을 제공한다', () => {
  assert.match(machine, /accessibilityLabel="뽑기 기계"/);
  assert.match(machine, /accessibilityLabel=\{`결과: \$\{[^}]+\}`\}/);
});

test('#342는 모바일 package.json에 새 의존성을 추가하지 않는다', () => {
  const current = read('../../../package.json');
  const baseline = execFileSync('git', ['show', 'HEAD:apps/mobile/package.json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(current), JSON.parse(baseline));
});


test('방문 모달을 닫아도 구매 시도와 소유 스냅샷을 보존한다', () => {
  const claim = readFileSync(new URL('../claim-redeem/index.tsx', import.meta.url), 'utf8');
  assert.match(claim, /gachaStarted \? <ShopScreen/);
  assert.match(claim, /gachaVisible=\{gachaOpen\}/);
  assert.match(shop, /gachaOnly \? gachaVisible : machineOpen/);
  assert.match(shop, /attempt !== pending/);
  assert.match(shop, /purchaseOwnership\.current/);
});


test('방문 뽑기 재진입은 최신 잔액을 읽되 미확인 구매를 초기화하지 않는다', () => {
  assert.match(shop, /if \(gachaOnly && gachaVisible\) void refreshGachaSnapshot\(\);/);
  assert.match(shop, /\[gachaOnly, gachaVisible, refreshGachaSnapshot\]/);
  assert.match(machine, /onRefresh/);
});
