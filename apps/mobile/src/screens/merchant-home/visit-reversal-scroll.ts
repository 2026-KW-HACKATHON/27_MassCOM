/** 선택한 사유 양식의 위치를 유지한다. 늦게 로드된 집계가 위에서 커져도 양식을 다시 보여 준다. */
export function createVisitReversalScroll() {
  let cardY = 0;
  let formY: number | undefined;
  const position = () => formY === undefined ? undefined : cardY + formY;
  return {
    layout(y: number) { cardY = y; return position(); },
    select(y: number | undefined) { formY = y; return position(); },
  };
}
