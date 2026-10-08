export const uiMetrics = {
  pageInset: 20,
  sectionGap: 24,
  cardRadius: 20,
  minTouch: 48,
  /** 빽빽한 줄(칩·보조 버튼)의 눌림 영역 하한. WCAG 2.5.5 기준 44이며 일반 버튼은 minTouch(48)를 쓴다. */
  minTouchCompact: 44,
  /** 화면에 그리는 글자의 하한(dp). 공유 카드처럼 이미지로 내보내는 그림은 예외다. */
  minFont: 12,
} as const;
