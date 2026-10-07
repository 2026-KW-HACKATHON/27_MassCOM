import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// #333: 시연 전용 서비스 옵션(보너스 마일리지·날짜 옮기기·재뽑기 한도)이 운영에서 켜지지 않는 것은 server.ts 시작 코드의 배선 한 줄에 달려 있다.
// 그 코드는 DB·비밀값 없이 실행할 수 없어(server-ai-art-startup.test.ts가 자식 프로세스로 띄우는 것과 같은 진입점) 소스 본문을 직접 확인한다:
// 옵션은 showcaseDeployment로만 계산한 allAccess 객체를 통해서만, 방문·캐릭터·가게 코인 서비스 생성자에 펼쳐진다.
const source = readFileSync(fileURLToPath(new URL('../server.ts', import.meta.url)), 'utf8');
const code = source.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].length;
}

/** `new Name(` 뒤의 괄호 짝이 맞는 호출 전체 본문(괄호 안)을 돌려준다. */
function constructorArguments(text: string, name: string): string {
  const start = text.indexOf(`new ${name}(`);
  assert.notEqual(start, -1, `${name} 생성자 호출이 있어야 한다`);
  let depth = 0;
  for (let index = start + `new ${name}`.length; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(start + `new ${name}(`.length, index);
    }
  }
  throw new Error(`${name} 호출의 괄호가 닫히지 않았다`);
}

test('showcaseAllAccessOptions는 server.ts에서 showcaseDeployment로만, 정확히 한 번 계산한다', () => {
  assert.equal(count(code, /showcaseAllAccessOptions\(/), 1);
  assert.equal(count(code, /showcaseAllAccessOptions\(Boolean\(showcaseDeployment\)\)/), 1);
  // showcaseDeployment를 정한 뒤에 쓴다(위에서 정의되지 않은 값으로 계산하지 않는다).
  assert.ok(code.indexOf('const showcaseDeployment =') !== -1);
  assert.ok(code.indexOf('const showcaseDeployment =') < code.indexOf('showcaseAllAccessOptions('));
  assert.equal(count(code, /const allAccess = showcaseAllAccessOptions\(Boolean\(showcaseDeployment\)\);/), 1);
});

test('옵션 이름과 시연 상수는 server.ts에 직접 나오지 않고 allAccess 객체로만 서비스에 닿는다', () => {
  for (const forbidden of [
    /showcaseBonusMileage/, /showcaseTestVisitBackdating/, /SHOWCASE_BONUS_MILEAGE/, /SHOWCASE_REROLL_RATE_LIMIT/, /rerollRateLimit/,
  ]) {
    assert.equal(count(code, forbidden), 0, `${forbidden} 는 all-access.ts의 옵션 객체 안에만 있어야 한다`);
  }
  // 가게 코인과 캐릭터 상점은 같은 시연 잔액을 보여야 한다.
  assert.equal(count(code, /\ballAccess\b/), 4);
});

test('시연 방문 옵션은 방문 서비스만, 마일리지 옵션은 두 상점 서비스만 받는다', () => {
  assert.equal(count(code, /new PostgresClaimSlotService\(/), 1);
  assert.equal(count(code, /new PostgresMileageShopService\(/), 1);
  const claimSlots = constructorArguments(code, 'PostgresClaimSlotService');
  const mileageShop = constructorArguments(code, 'PostgresMileageShopService');
  assert.equal(count(code, /new PostgresCoinEconomyService\(/), 1);
  const coinEconomy = constructorArguments(code, 'PostgresCoinEconomyService');
  assert.equal(count(claimSlots, /\.\.\.allAccess\.claimSlots\b/), 1);
  assert.equal(count(claimSlots, /allAccess\.mileageShop/), 0);
  assert.equal(count(mileageShop, /\.\.\.allAccess\.mileageShop\b/), 1);
  assert.equal(count(mileageShop, /allAccess\.claimSlots/), 0);
  assert.equal(count(coinEconomy, /\.\.\.allAccess\.mileageShop\b/), 1);
  assert.equal(count(coinEconomy, /allAccess\.claimSlots/), 0);
  assert.equal(count(code, /\.\.\.allAccess\.claimSlots\b/), 1);
  assert.equal(count(code, /\.\.\.allAccess\.mileageShop\b/), 2);
});

test('시연 테스트 방문 경로는 시연 배치 신호(accessRequests)가 없으면 서비스를 부르기 전에 404다', () => {
  const route = code.slice(code.indexOf("request.url === '/showcase/test-visits'"));
  assert.ok(route.length > 0);
  const gate = route.indexOf("if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');");
  assert.notEqual(gate, -1);
  assert.ok(gate < route.indexOf('issueShowcaseTestSlot('));
  assert.ok(gate < route.indexOf('claimSlots.redeem('));
});
