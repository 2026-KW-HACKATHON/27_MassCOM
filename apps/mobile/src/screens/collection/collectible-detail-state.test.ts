import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CommerceApiError } from '../../commerce/commerce-api';
import { collectibleDetailFailure } from './collectible-detail-state';

test('운영자가 사진을 내린 수집품(404)은 재시도 없이 "사진 없는 기존 수집품"으로 안내한다', () => {
  const failure = collectibleDetailFailure(new CommerceApiError(404, 'COLLECTIBLE_NOT_FOUND'));
  assert.equal(failure.removed, true);
  assert.match(failure.title, /다시 볼 수 있는 사진이 없어요/);
  assert.match(failure.body, /받은 기록과 보상은 도감에 그대로/);
});

test('일시적인 오류는 보유 기록이 그대로임을 알리고 다시 불러오게 한다', () => {
  for (const error of [new CommerceApiError(500, 'INTERNAL'), new CommerceApiError(401, 'SESSION'), new Error('offline')]) {
    const failure = collectibleDetailFailure(error);
    assert.equal(failure.removed, false);
    assert.match(failure.body, /보유 기록은 그대로/);
  }
});

test('상세 화면은 사진이 내려간 수집품에 재시도를 주지 않고 닫을 때 목록을 다시 읽는다', () => {
  const screen = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  assert.match(screen, /action=\{failure && !failure\.removed \? \{ label: '다시 불러오기'/);
  assert.match(screen, /const close = \(\) => \{ if \(failure\?\.removed\) onUnavailable\?\.\(\); onClose\(\); \};/);
  assert.doesNotMatch(screen, /\}, \[entitlementId, load, retry, onUnavailable\]\)/, 'onUnavailable이 effect 의존성이면 목록 갱신이 상세를 다시 읽는 고리가 된다');
  const list = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(list, /onUnavailable=\{\(\) => void refresh\(\)\}/);
  // 목록은 외형이 없는 수집품을 기존 카드(이름만)로 그린다.
  assert.match(list, /\{item\.artwork \? \(/);
  assert.match(list, /item\.artwork\?\.name \?\? item\.displayName/);
});

test('각도 슬라이더를 끌거나 동작을 멈추는 등 사람이 직접 조작하면 예약된 다음 자동재생 단계를 지운다(WP4 리뷰 2)', () => {
  const screen = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  const cancelCalls = screen.match(/cancelSequence\(\)/g) ?? [];
  // pause(), playMotionSequence, effect 정리, PanResponder 드래그 시작, 기울임 변경, 각도 스텝, 회전 토글, 저장한 동작 다시 보기 — 최소 8곳.
  assert.ok(cancelCalls.length >= 8, `사람이 조작하는 경로마다 cancelSequence()를 불러야 한다(실제 ${cancelCalls.length}곳)`);
  for (const site of [
    /const pause = useCallback\(\(\) => \{\s*audioAction\.current \+= 1;\s*cancelSequence\(\);/,
    /onPanResponderGrant: \(event\) => \{\s*cancelSequence\(\);/,
    /const handleTiltChange = useCallback\(\(degrees: number\) => \{\s*cancelSequence\(\);/,
    /const stepAngle = \(increment: number\) => \{\s*cancelSequence\(\);/,
  ]) assert.match(screen, site);
});

test('전경 복귀·동작 줄이기 토글로 자동재생 effect가 다시 돌아도 이미 보여준 once 시퀀스를 다시 틀지 않는다(WP4 리뷰 3)', () => {
  const screen = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  assert.match(screen, /const introConsumed = useRef\(false\);/);
  assert.match(screen, /playMotionSequence\(motionEntrySequence\(snapshot\.motions, intro, consumed\)\);/);
});
