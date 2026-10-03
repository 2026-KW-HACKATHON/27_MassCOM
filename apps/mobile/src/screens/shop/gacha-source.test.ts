import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// RN 렌더러가 없는 모바일 테스트 환경에서 화면 연결과 접근성 계약을 소스로 확인한다.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const celebration = read('../../gamification/celebration.tsx');
const shop = read('./index.tsx');
const machine = read('./gacha-machine.tsx');

test('#342 축하 화면은 이번 보상을 릴로 보여주고 뽑기 보조 링크를 제공한다', () => {
  assert.match(celebration, /rewardReel\(/);
  assert.match(celebration, /이번에 받은 것/);
  assert.match(celebration, /상점 뽑기/);
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

test('#342는 별도 연출 라이브러리에 의존하지 않는다', () => {
  const manifest = JSON.parse(read('../../../package.json'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of ['lottie-react-native', 'moti', '@shopify/react-native-skia']) {
      assert.equal(Object.hasOwn(manifest[section] ?? {}, name), false, `${section}에 ${name}이 없어야 한다`);
    }
  }
});

test('구매 완료 결과는 오류 표시와 무관하게 실제 뽑기 상태를 복원한다', () => {
  assert.match(shop, /onDraw=\{buy\}/);
  assert.match(machine, /const succeeded = await onDraw\(selected\);/);
  assert.match(machine, /if \(!succeeded\)[\s\S]*?advancePhase\(gachaPhaseAfter\(phaseRef.current, \{ type: 'purchase-failed' \}\)\)/);
  assert.doesNotMatch(machine, /phase === 'pending' && !busy && error \? 'picker'/);
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
