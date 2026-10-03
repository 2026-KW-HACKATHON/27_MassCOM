import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVisitReversalScroll } from './visit-reversal-scroll';

test('여러 최근 방문 뒤의 선택 양식으로 이동하고 늦은 집계 레이아웃도 보정한다', () => {
  const navigation = createVisitReversalScroll();
  assert.equal(navigation.layout(100), undefined);
  assert.equal(navigation.select(320), 420);
  // 집계 카드가 늦게 나타나 최근 방문 영역의 시작 위치가 아래로 밀렸다.
  assert.equal(navigation.layout(760), 1080);
});

test('양식이 먼저 준비되거나 목록 행 높이가 바뀌어도 최신 위치로 이동한다', () => {
  const navigation = createVisitReversalScroll();
  assert.equal(navigation.select(120), 120);
  assert.equal(navigation.layout(300), 420);
  assert.equal(navigation.select(210), 510);
});

test('취소 양식을 닫은 뒤에는 집계 새로 고침이 화면 위치를 빼앗지 않는다', () => {
  const navigation = createVisitReversalScroll();
  navigation.layout(300);
  assert.equal(navigation.select(120), 420);
  assert.equal(navigation.select(undefined), undefined);
  assert.equal(navigation.layout(800), undefined);
});
