// Issue #334: these choices mirror apps/api/src/visitor-feedback-rules.ts.
export const visitorTagOptions = [
  { code: 'SOLO', label: '혼밥하기 좋아요' },
  { code: 'TAKEOUT', label: '포장이 편해요' },
  { code: 'GENEROUS', label: '양이 넉넉해요' },
  { code: 'QUIET', label: '조용해서 대화하기 좋아요' },
  { code: 'KIND', label: '친절해요' },
  { code: 'VALUE', label: '가성비가 좋아요' },
  { code: 'STUDENT', label: '학생이 가기 좋아요' },
  { code: 'DESSERT', label: '디저트가 좋아요' },
] as const;

export const visitorSuggestionOptions = [
  { code: 'SOLO_MENU', label: '혼밥 메뉴가 있으면 좋겠어요' },
  { code: 'SPICE_LABEL', label: '맵기 표시가 있으면 좋겠어요' },
  { code: 'MORE_PHOTOS', label: '메뉴 사진이 더 있으면 좋겠어요' },
  { code: 'STUDENT_DISCOUNT', label: '학생 할인 시간이 있으면 좋겠어요' },
  { code: 'HOURS_INFO', label: '영업시간 안내가 있으면 좋겠어요' },
] as const;

export type VisitorTagCode = (typeof visitorTagOptions)[number]['code'];
export type VisitorSuggestionCode = (typeof visitorSuggestionOptions)[number]['code'];

export const visitorTagCodes: readonly VisitorTagCode[] = visitorTagOptions.map(({ code }) => code);
export const visitorSuggestionCodes: readonly VisitorSuggestionCode[] = visitorSuggestionOptions.map(({ code }) => code);
export const visitorTagLabels = Object.fromEntries(visitorTagOptions.map(({ code, label }) => [code, label])) as Readonly<Record<VisitorTagCode, string>>;
export const visitorSuggestionLabels = Object.fromEntries(visitorSuggestionOptions.map(({ code, label }) => [code, label])) as Readonly<Record<VisitorSuggestionCode, string>>;

export const maxVisitorTags = 3;
export const maxVisitorSuggestions = 2;
export const visitorFeedbackNoteMaxLength = 100;

export function isVisitorTagCode(value: unknown): value is VisitorTagCode {
  return typeof value === 'string' && (visitorTagCodes as readonly string[]).includes(value);
}

export function isVisitorSuggestionCode(value: unknown): value is VisitorSuggestionCode {
  return typeof value === 'string' && (visitorSuggestionCodes as readonly string[]).includes(value);
}
