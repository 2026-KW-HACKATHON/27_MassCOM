import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createIdentityRequestGate } from '../../commerce/customer-identity';
import { claimQrSizeForArea, minimumClaimQrSize } from './qr-layout';

const staff = readFileSync(new URL('./staff.tsx', import.meta.url), 'utf8');

test('QR 크기는 측정 전과 작은 화면에서도 180 이상이며 넓은 화면은 320으로 제한한다', () => {
  assert.equal(minimumClaimQrSize, 180);
  assert.equal(claimQrSizeForArea(0, 0), 180);
  assert.equal(claimQrSizeForArea(280, 16), 180);
  assert.equal(claimQrSizeForArea(280, 196), 180);
  assert.equal(claimQrSizeForArea(280, 260), 244);
  assert.equal(claimQrSizeForArea(600, 500), 320);
});

for (const operation of ['재발급', '복구']) {
  for (const outcome of ['성공', '실패']) {
    test(`${operation} 요청 중 닫은 뒤 늦은 ${outcome} 응답과 완료가 새 고객을 덮지 않는다`, async () => {
      const gate = createIdentityRequestGate();
      let state = { visible: true, customer: '이전 고객', busy: true, message: '' };
      const current = gate.start();
      let succeed!: () => void;
      let fail!: () => void;
      const pending = new Promise<void>((resolve, reject) => { succeed = resolve; fail = () => reject(new Error('늦은 오류')); });
      const request = (async () => {
        try {
          await pending;
          if (!gate.isCurrent(current)) return;
          state = { ...state, visible: true, customer: '이전 고객의 응답' };
        } catch {
          if (!gate.isCurrent(current)) return;
          state = { ...state, message: '이전 고객의 오류' };
        } finally {
          if (gate.isCurrent(current)) state = { ...state, busy: false };
        }
      })();
      // 완료는 네트워크를 기다리지 않고 닫으며 새 고객 요청도 바로 시작한다.
      gate.cancel();
      state = { visible: false, customer: '', busy: false, message: '' };
      assert.equal(gate.isCurrent(current), false);
      assert.equal(state.visible, false);
      const next = gate.start();
      state = { visible: false, customer: '새 고객', busy: true, message: '' };
      if (outcome === '성공') succeed(); else fail();
      await request;
      assert.deepEqual(state, { visible: false, customer: '새 고객', busy: true, message: '' });
      assert.equal(gate.isCurrent(next), true);
    });
  }
}

test('화면은 닫기와 세션 변경을 무효화하고 재발급·복구의 모든 결과를 같은 가드로 보호한다', () => {
  const done = staff.slice(staff.indexOf('function done('), staff.indexOf('async function startScan('));
  assert.match(done, /cancel\(\)/);
  assert.doesNotMatch(done, /if \(busy\)/);
  const cancel = staff.slice(staff.indexOf('function cancel('), staff.indexOf('async function resolve('));
  assert.match(cancel, /requestGate.cancel\(\)/);
  assert.match(cancel, /setQrVisible\(false\)/);
  assert.match(cancel, /setBusy\(false\)/);
  assert.match(staff, /useEffect\(\(\) => \(\) => requestGate.cancel\(\), \[api, merchantId, requestGate\]\)/);
  for (const [name, end] of [['reissue', 'async function recoverCurrent('], ['recoverCurrent', 'return <View']]) {
    const block = staff.slice(staff.indexOf(`async function ${name}(`), staff.indexOf(end, staff.indexOf(`async function ${name}(`)));
    assert.match(block, /const current = requestGate.start\(\)/);
    assert.match(block, /if \(!requestGate.isCurrent\(current\)\) return;\s*setIssued\(next\)/);
    assert.match(block, /catch \(error\) \{\s*if \(!requestGate.isCurrent\(current\)\) return/);
    assert.match(block, /finally \{\s*if \(requestGate.isCurrent\(current\)\) setBusy\(false\)/);
    assert.doesNotMatch(block, /setQrVisible\(true\)/);
  }
  assert.match(staff, /<Modal visible=\{qrVisible && active\}[\s\S]*?onRequestClose=\{done\}/);
});

test('정상 QR과 복구 실패 모두 안내만 스크롤하고 완료 버튼과 QR 영역은 고정한다', () => {
  const modal = staff.slice(staff.indexOf('<Modal'), staff.indexOf('</Modal>'));
  const guidance = modal.slice(modal.indexOf('<ScrollView'), modal.indexOf('</ScrollView>'));
  assert.match(modal, /minHeight: minimumClaimQrSize \+ 16/);
  assert.match(modal, /!issuedUncertain && seconds > 0 \? <ClaimQr/);
  assert.doesNotMatch(modal, /qrSize > 0/);
  assert.match(guidance, /issuedUncertain \? <Text/);
  assert.match(guidance, /message \? <Text accessibilityLiveRegion="polite"/);
  assert.doesNotMatch(guidance, /<ClaimQr|label="다 됐어요"/);
  assert.match(modal.slice(modal.indexOf('</ScrollView>')), /flexShrink: 0[\s\S]+label="다 됐어요" onPress=\{done\}/);
});

test('촬영 취소와 발급 복구의 접근성 이름은 표시 문구와 같은 상태를 쓴다', () => {
  assert.match(staff, /label=\{scanning \? '촬영 취소' : '고객 QR 찍기'\} disabled/);
  assert.match(staff, /label=\{busy \? '확인 중…' : issueAttempted \? '발급 결과 확인·복구' : '방문 코드 발급'\} disabled/);
  assert.match(staff, /accessibilityLabel=\{accessibilityLabel \?\? label\}/);
});

test('점포·세션·클라이언트 변경은 대기 중인 고객 상태까지 새 화면으로 교체한다', () => {
  const boundary = staff.slice(staff.indexOf('export function StaffClaimScreen('), staff.indexOf('function StaffClaimSession('));
  assert.match(boundary, /JSON.stringify\(\[props.apiUrl, props.accountId, props.merchantId, props.credential\]\)/);
  assert.match(boundary, /scope.identity !== identity \|\| scope.credential !== props.credential \|\| scope.callback !== props.onSessionInvalid/);
  assert.match(boundary, /version: scope.version \+ 1/);
  assert.match(boundary, /<StaffClaimSession key=\{scope.version\} \{...props\} \/>/);
});
