import type { GameKind } from '../../../../api/src/play-rules';

export const gameCopy: Record<GameKind, { title: string; tag: string; rule: string; color: string }> = {
  stack: { title: '타이밍 쌓기', tag: '타이밍', rule: '움직이는 블록이 목표 자리에 왔을 때 놓으세요. 여섯 층을 쌓아요.', color: '#DF6D62' },
  memory: { title: '짝 찾기', tag: '기억', rule: '뒤집힌 카드 두 장을 골라 같은 그림을 찾으세요. 여섯 쌍을 맞히면 끝나요.', color: '#699CCB' },
  delivery: { title: '세 갈래 배달', tag: '피하기', rule: '세 길을 오가며 장애물을 피하고 선물을 챙기세요. 달리는 동안 길을 바꿀 수 있어요.', color: '#67A989' },
  orders: { title: '주문 맞추기', tag: '순서', rule: '나타난 주문 세 개를 순서대로 누르세요. 네 묶음의 주문을 완성해요.', color: '#D7A14E' },
};

export const themeNames: Record<string, string> = { daylight: '햇살 방', evening: '노을 방', garden: '정원 방' };

export const skillCopy: Record<GameKind, { badge: string; goal: string; reward: string; metric: string }> = {
  stack: { badge: '균형의 달인', goal: '중앙에서 4칸 이내로 3번 연속 놓기', reward: '균형의 달인 포즈', metric: '연속 정밀 배치' },
  memory: { badge: '기억의 달인', goal: '틀린 짝 1번 이하로 6쌍 맞히기', reward: '기억의 달인 카드 소품', metric: '효율적인 짝' },
  delivery: { badge: '배달의 달인', goal: '12구간 모두 충돌 없이 완주하기', reward: '배달의 달인 가방', metric: '충돌 없는 구간' },
  orders: { badge: '주문 박사', goal: '8개 메뉴를 연속으로 정확히 고르기', reward: '주문 박사 장식', metric: '연속 정답' },
};
