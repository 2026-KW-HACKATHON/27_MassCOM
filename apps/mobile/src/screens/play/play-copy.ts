import type { PlayRecord } from '@/play/play-api';
import type { GameKind } from '../../../../api/src/play-rules';

export const gameCopy: Record<GameKind, { title: string; tag: string; rule: string; color: string }> = {
  stack: { title: '가게 포장 쌓기', tag: '타이밍', rule: '움직이는 포장 상자를 아래 상자에 겹쳐 놓아요. 어긋난 부분이 잘리고, 남은 폭으로 여섯 층을 쌓아요.', color: '#DF6D62' },
  memory: { title: '방문 도감 복원', tag: '기억', rule: '등록된 메뉴·간판·내 수집품과 연습 그림을 두 장씩 찾아요. 발견한 여섯 쌍이 도감에 남아요.', color: '#699CCB' },
  delivery: { title: '동네 꾸러미 배달', tag: '피하기', rule: '포장 꾸러미를 가게 간판 앞까지 운반해요. 세 길에서 공사 상자를 피하세요. 세 번 부딪히면 도전이 끝나요.', color: '#67A989' },
  orders: { title: '꾸러미 주문 작업대', tag: '조합', rule: '등록된 메뉴와 연습 그림으로 만든 주문표의 물건 세 개를 담아 전달해요. 순서는 자유이고 잘못 담으면 고칠 수 있어요.', color: '#D7A14E' },
};

export const gamePrompt: Record<GameKind, string> = {
  stack: '상자가 아래 층과 겹칠 때 눌러 6층을 쌓아요',
  memory: '카드 두 장을 골라 같은 그림 6쌍을 찾아요',
  delivery: '공사 상자를 피해 길을 바꾸며 12구간을 지나가요',
  orders: '주문표의 물건 3개를 담고 전달해요',
};

export const themeNames: Record<string, string> = { daylight: '햇살 방', evening: '노을 방', garden: '정원 방' };

export const skillCopy: Record<GameKind, { badge: string; goal: string; reward: string; metric: string }> = {
  stack: { badge: '균형의 달인', goal: '아래 상자 중앙에서 3칸 이내로 3번 연속 놓기', reward: '균형의 달인 포즈', metric: '연속 정밀 배치' },
  memory: { badge: '기억의 달인', goal: '틀린 짝 1번 이하로 6쌍 맞히기', reward: '기억의 달인 카드 소품', metric: '효율적인 짝' },
  delivery: { badge: '배달의 달인', goal: '12구간 모두 충돌 없이 완주하기', reward: '배달의 달인 가방', metric: '충돌 없는 구간' },
  orders: { badge: '주문 박사', goal: '틀린 전달 없이 물건 8개를 연속 포장하기', reward: '주문 박사 장식', metric: '연속 포장한 물건' },
};

/** Server play counts include completed runs only; a saved partial attempt can still be awaiting its first finish. */
export function playRecordLabel(record: PlayRecord | undefined): string {
  if (!record) return '첫 완주에 도전';
  if (record.version2BestScore === undefined || record.version2Plays === undefined) {
    return record.plays > 0 ? `이전 놀이 최고 ${record.bestScore.toLocaleString()}점 · ${record.plays}회 완주` : '첫 완주에 도전';
  }
  const current = record.version2Plays > 0 ? `현재 최고 ${record.version2BestScore.toLocaleString()}점 · ${record.version2Plays}회 완주` : '첫 완주에 도전';
  const legacyPlays = Math.max(0, record.plays - record.version2Plays);
  return legacyPlays > 0 ? `${current} · 이전 놀이 최고 ${record.bestScore.toLocaleString()}점 · ${legacyPlays}회 완주` : current;
}

export const practiceTokens = [
  { name: '크루아상 그림', food: 0 },
  { name: '커피 그림', food: 1 },
  { name: '샌드위치 그림', food: 2 },
  { name: '타르트 그림', food: 3 },
  { name: '기억 카드', cosmetic: 'memory-card' },
  { name: '금빛 랜턴', cosmetic: 'gold-prop' },
] as const;

export function tokenName(art: readonly { name: string }[], value: number): string {
  return art[value]?.name ?? `${practiceTokens[value]?.name ?? '그림'} · 연습용`;
}

export const skillRewardArt: Record<GameKind, string> = {
  stack: 'stack-cheer', memory: 'memory-card', delivery: 'courier-bag', orders: 'order-sign',
};

export function playEndLabel(state: { kind: GameKind; completed: boolean; failed: boolean }, timedOut: boolean, inputLimit: boolean): string {
  if (state.completed) return state.kind === 'delivery' ? '꾸러미가 전시대에 도착했어요' : '이번 작업을 모두 완성했어요';
  if (state.failed) return state.kind === 'stack' ? '겹치는 부분이 없어 상자가 떨어졌어요' : '세 번 충돌해 꾸러미 운반이 멈췄어요';
  if (timedOut) return '시간이 끝났어요. 완성한 부분을 남겼어요';
  if (inputLimit) return '이번 판의 조작을 모두 사용했어요';
  return '직접 도전을 마쳤어요. 완성한 부분을 남겼어요';
}

export function rewardState(previouslyEarned: boolean, result: { skill?: { achieved: boolean }; newlyEarned?: boolean } | undefined): { owned: boolean; newlyEarned: boolean } {
  return { owned: previouslyEarned || result?.skill?.achieved === true || result?.newlyEarned === true,
    newlyEarned: result?.newlyEarned === true };
}
