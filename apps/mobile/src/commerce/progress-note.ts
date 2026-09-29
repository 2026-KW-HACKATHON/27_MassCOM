// 방문이 진행·배지에 세어졌는지 고객에게 알리는 문구(Issue #243). 서버가 progressCounted와 이유를 정한다.
type Visit = { progressCounted: boolean; progressExcludedReason?: 'STAFF_SELF' };

/** 방문 완료 카드의 진행 안내. */
export function progressNote(visit: Visit): string {
  if (visit.progressCounted) return '오늘 방문이 진행 횟수에 반영됐습니다.';
  if (visit.progressExcludedReason === 'STAFF_SELF') {
    return '직원 본인 계정으로 받은 방문은 기록만 되고 진행·보상에는 세지 않습니다.';
  }
  return '방문은 기록됐지만 같은 한국 날짜의 진행은 한 번만 셉니다.';
}

/** 도장 축하 화면의 짧은 안내. */
export function celebrationNote(visit: Visit): string {
  if (visit.progressCounted) return '방문 도장이 도감에 찍혔어요.';
  if (visit.progressExcludedReason === 'STAFF_SELF') {
    return '방문은 기록됐어요. 직원 본인 계정 방문은 배지·보상에 세지 않아요.';
  }
  return '방문은 기록됐어요. 같은 가게는 하루에 한 번만 배지에 세요.';
}
