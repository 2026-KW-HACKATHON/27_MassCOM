import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// RN 렌더러가 없는 모바일 테스트 환경에서 화면 연결과 접근성 계약을 소스로 확인한다.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const celebration = read('../../gamification/celebration.tsx');
const shop = read('./index.tsx');
const machine = read('./gacha-machine.tsx');
const rules = read('./gacha-rules.ts');
const stampStage = read('./stamp-draw-stage.tsx');

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

test('#342 우표 연출과 결과는 스크린리더용 이름을 제공한다', () => {
  assert.match(stampStage, /accessibilityLabel="우표 뽑기 연출"/);
  assert.match(machine, /<StampDrawStage phase="idle" compact \/>/);
  assert.match(machine, /<StampDrawStage phase="opening" onComplete=\{finishOpening\} \/>/);
  assert.match(machine, /function resultAccessibilityLabel\(result: ShopRerollResult, phase: GachaRewardPhase \| undefined\): string/);
  assert.match(machine, /phase === 'reward-mileage'[\s\S]*?마일리지 \$\{result\.rewards\.mileage\.amount\}포인트/);
  assert.match(machine, /phase === 'reward-clothing'[\s\S]*?clothingRewardName\(result\)/);
  assert.match(machine, /phase === 'reward-character'[\s\S]*?캐릭터 \$\{result\.item\.name\}/);
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
  assert.match(machine, /if \(!succeeded\)[\s\S]*?advancePhase\(phaseRef\.current === 'pending' \? 'detail' : phaseRef\.current\)/);
  assert.doesNotMatch(machine, /phase === 'pending' && !busy && error \? 'picker'/);
});


test('방문 모달을 닫아도 구매 시도와 소유 스냅샷을 보존한다', () => {
  const claim = readFileSync(new URL('../claim-redeem/index.tsx', import.meta.url), 'utf8');
  assert.match(claim, /gachaStarted \? <ShopScreen[\s\S]*?accountId=\{accountId\}/);
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


test('뽑기 결과는 마일리지, 옷, 캐릭터를 순차 공개하고 최종 요약에서만 3줄을 함께 보여준다', () => {
  assert.match(machine, /type GachaRewardPhase/);
  assert.match(machine, /displayPhase === 'reward-mileage' \? <MileageReward/);
  assert.match(machine, /displayPhase === 'reward-clothing' \? <ClothingReward/);
  assert.match(machine, /displayPhase === 'reward-character' \? <CharacterReward/);
  assert.match(machine, /displayPhase === 'result' \? <ResultSummary/);
  assert.match(machine, /<Text style=\{styles\.rewardStep\}>1\. 마일리지/);
  assert.match(machine, /<Text style=\{styles\.rewardStep\}>2\. 옷/);
  assert.match(machine, /<Text style=\{styles\.rewardStep\}>3\. 캐릭터 \{result\.item\.name\}/);
  const sequentialArea = machine.slice(machine.indexOf('function MileageReward'), machine.indexOf('function ResultSummary'));
  assert.doesNotMatch(sequentialArea, /styles\.rewardStep/, '순차 공개 카드에는 최종 요약 3줄을 렌더하지 않는다');
});

test('보상 화면은 기다려도 유지되고 다음 버튼을 눌러야 다음 보상 또는 최종 결과로 이동한다', () => {
  const reveal = machine.slice(machine.indexOf('const startRewardReveal ='), machine.indexOf('useEffect(() => {'));
  assert.doesNotMatch(reveal, /setTimeout|setInterval/, '보상 단계 사이에 자동 전환 타이머가 없어야 한다');
  assert.match(reveal, /const revealNext = useCallback\(\(\) => \{[\s\S]*?startRewardReveal\(gachaNextRewardPhase\(current\)\)/);
  for (const name of ['MileageReward', 'ClothingReward', 'CharacterReward']) {
    assert.match(machine, new RegExp(`<${name}[^>]*onNext=\\{revealNext\\}`));
  }
  assert.match(machine, /const finishOpening = useCallback\(\(\) => \{[\s\S]*?startRewardReveal\('reward-mileage'\)/, '개봉 영상 완료 뒤 첫 보상은 여전히 보여야 한다');
  assert.match(machine, /onComplete=\{finishOpening\}/, '개봉 영상 완료 콜백이 화면 전환에 연결되어야 한다');
  assert.match(machine, /if \(!succeeded\)[\s\S]*?advancePhase\(phaseRef\.current === 'pending' \? 'detail' : phaseRef\.current\)/, '구매 실패는 보상 화면으로 이동하지 않아야 한다');
});

test('최종 보상 요약 뒤 도감 등록 확인으로 넘어가고 마일리지는 등록 항목에 넣지 않는다', () => {
  assert.match(machine, /import \{ RegistrationAlbum, type RegistrationItem \} from '@\/acquisition\/registration-album';/);
  assert.match(machine, /displayPhase === 'album-registration'[\s\S]*?<RegistrationAlbum/);
  assert.match(machine, /<Control label=\{alreadyRegistered \? '등록 결과 다시 보기' : '도감 등록 확인'\} primary[\s\S]*?advancePhase\('album-registration'\)/);
  const registration = machine.slice(machine.indexOf('function legacyRegistrationItems'), machine.indexOf('function registrationStatus'));
  assert.match(registration, /result\.rewards\.clothing\.item/);
  assert.match(registration, /kindLabel: '캐릭터'/);
  assert.doesNotMatch(registration, /mileage|마일리지/, '마일리지는 도감 수집품 등록 항목이 아니다');
  assert.match(machine, /function registrationStatus\(replayed: boolean, alreadyOwned: boolean\): RegistrationItem\['status'\][\s\S]*?if \(replayed\) return 'owned';[\s\S]*?alreadyOwned \? 'duplicate' : 'new'/);
  assert.match(machine, /alreadyRegistered \? '등록 결과 다시 보기' : '도감 등록 확인'/);
  assert.match(machine, /setRegisteredReceiptId\(currentReceiptId\); advancePhase\('result'\)/);
  assert.match(machine, /!result\.replayed && !alreadyRegistered \? <ConfettiBurst/);
});

test('도감 등록 확인 단계는 unrelated rerender나 motion toggle에서 결과로 돌아가지 않는다', () => {
  assert.match(rules, /type GachaPhase[\s\S]*?'album-registration'/);
  assert.match(rules, /if \(phase === 'album-registration'\) return 'album-registration';/);
  const consumedBranch = machine.slice(machine.indexOf('if (consumedResult.current === result)'), machine.indexOf('const burstStyle'));
  assert.match(consumedBranch, /activeResult\.current === result/);
  assert.match(consumedBranch, /phaseRef\.current !== 'album-registration'/);
  assert.doesNotMatch(consumedBranch, /advancePhase\('result'\)/, '이미 등록 화면에 들어간 결과를 직접 최종 결과로 되감지 않는다');
});

test('미공개 캐릭터 이름은 캐릭터 단계 전 접근성 라벨에 포함되지 않는다', () => {
  const labelFunction = machine.slice(machine.indexOf('function resultAccessibilityLabel'), machine.indexOf('function clothingRewardName'));
  assert.match(labelFunction, /phase === 'reward-mileage'[\s\S]*?마일리지/);
  assert.match(labelFunction, /phase === 'reward-clothing'[\s\S]*?clothingRewardName\(result\)/);
  assert.doesNotMatch(labelFunction.slice(0, labelFunction.indexOf("phase === 'reward-character'")), /result\.item\.name/);
});

test('구매 버튼은 가격을 마일리지 단위로 바로 말하고 보상 단계마다 SE와 햅틱을 낸다', () => {
  assert.match(machine, /label=\{`\$\{selected\.price\.toLocaleString\('ko-KR'\)\} 마일리지`\}/);
  assert.match(machine, /purchase\s+disabled=\{!selectedAvailability\.enabled/);
  assert.match(machine, /purchase: \{ alignSelf: 'stretch', backgroundColor: '#2E8B57'/);
  assert.match(machine, /primary: \{ backgroundColor: '#FFD579' \}/);
  assert.match(machine, /void drawHaptic\(\);/);
  assert.match(machine, /playUiSound\(next === 'reward-character' \? 'success' : 'flip'\)/);
});
