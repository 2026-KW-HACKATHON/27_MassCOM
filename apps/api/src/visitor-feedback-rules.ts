// 방문한 가게의 특징 태그·사장님께 바라는 점·짧은 의견 규칙(Issue #334, D-069). DB 없이 시험할 수 있는 순수 함수만 둔다.
// 코드 목록은 migration 0040의 CHECK와 같아야 하고(시험이 대조한다), 앱이 나중에 같은 목록을 거울처럼 복사해 시험으로 지킨다.
import { normalizeReversalNote, reversalNoteMaxLength } from './reversal-rules.js';

// 손님이 고르는 가게의 특징(최대 3). 목록 순서가 화면·정렬 동률의 기준 순서다.
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
export type VisitorTagCode = (typeof visitorTagOptions)[number]['code'];

// 사장님께 바라는 점(최대 2). 그 가게 점주·직원에게만 보이고 공개하지 않는다.
export const visitorSuggestionOptions = [
  { code: 'SOLO_MENU', label: '혼밥 메뉴가 있으면 좋겠어요' },
  { code: 'SPICE_LABEL', label: '맵기 표시가 있으면 좋겠어요' },
  { code: 'MORE_PHOTOS', label: '메뉴 사진이 더 있으면 좋겠어요' },
  { code: 'STUDENT_DISCOUNT', label: '학생 할인 시간이 있으면 좋겠어요' },
  { code: 'HOURS_INFO', label: '영업시간 안내가 있으면 좋겠어요' },
] as const;
export type VisitorSuggestionCode = (typeof visitorSuggestionOptions)[number]['code'];

export const visitorTagCodes: readonly VisitorTagCode[] = visitorTagOptions.map((option) => option.code);
export const visitorSuggestionCodes: readonly VisitorSuggestionCode[] = visitorSuggestionOptions.map((option) => option.code);
export const visitorTagLabels = Object.fromEntries(
  visitorTagOptions.map((option) => [option.code, option.label]),
) as Readonly<Record<VisitorTagCode, string>>;
export const visitorSuggestionLabels = Object.fromEntries(
  visitorSuggestionOptions.map((option) => [option.code, option.label]),
) as Readonly<Record<VisitorSuggestionCode, string>>;

export const maxVisitorTags = 3;
export const maxVisitorSuggestions = 2;
// 의견 길이와 개인정보 거름망은 되돌리기 메모(D-051)와 같은 기준이다. DB CHECK(char_length <= 100)도 같은 값이다.
export const visitorFeedbackNoteMaxLength = reversalNoteMaxLength;
// 점주 화면에 보여 주는 최근 의견 수.
export const visitorFeedbackNoteListLimit = 50;

// 실제 점포는 같은 태그를 3명 이상이 골라야 공개 목록에 나온다(1~2명이면 누가 골랐는지 짐작될 수 있다). 시연 점포는 1명부터 보인다.
export function publicVisitorTagMinVotes(isDemo: boolean): number {
  return isDemo ? 1 : 3;
}

export type VisitorFeedbackSelection = {
  tags: VisitorTagCode[];
  suggestions: VisitorSuggestionCode[];
  note: string | null;
};

export type VisitorFeedbackInvalidCode =
  | 'VISITOR_FEEDBACK_TAGS_INVALID'
  | 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID'
  | 'VISITOR_FEEDBACK_NOTE_INVALID';

export type VisitorFeedbackResult =
  | { ok: true; value: VisitorFeedbackSelection }
  | { ok: false; code: VisitorFeedbackInvalidCode };

// 알려진 코드만 받아 중복을 접고 정해진 순서로 놓는다. 접은 뒤 개수가 max를 넘거나 모르는 값이 하나라도 있으면 null이다.
function normalizeCodes<Code extends string>(raw: unknown, allowed: readonly Code[], max: number): Code[] | null {
  if (!Array.isArray(raw)) return null;
  const picked = new Set<Code>();
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || !(allowed as readonly string[]).includes(item)) return null;
    picked.add(item as Code);
  }
  if (picked.size > max) return null;
  return allowed.filter((code) => picked.has(code));
}

// 저장 전에 한 번에 검사한다. 순서는 태그, 바라는 점, 의견이고 처음 틀린 곳의 코드를 돌려준다.
export function normalizeVisitorFeedback(raw: { tags: unknown; suggestions: unknown; note: unknown }): VisitorFeedbackResult {
  const tags = normalizeCodes(raw.tags, visitorTagCodes, maxVisitorTags);
  if (!tags) return { ok: false, code: 'VISITOR_FEEDBACK_TAGS_INVALID' };
  const suggestions = normalizeCodes(raw.suggestions, visitorSuggestionCodes, maxVisitorSuggestions);
  if (!suggestions) return { ok: false, code: 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID' };
  const note = normalizeReversalNote(raw.note);
  if (!note.ok) return { ok: false, code: 'VISITOR_FEEDBACK_NOTE_INVALID' };
  return { ok: true, value: { tags, suggestions, note: note.note } };
}

// 아무것도 고르지 않은 저장은 행을 지우는 요청이다.
export function isEmptyVisitorFeedback(selection: VisitorFeedbackSelection): boolean {
  return selection.tags.length === 0 && selection.suggestions.length === 0 && selection.note === null;
}

export type VisitorCount<Code extends string = string> = { code: Code; count: number };

// 개수 내림차순, 같으면 정해진 코드 순서로 놓는다. 모르는 코드와 minCount 미만은 뺀다.
export function rankVisitorCounts<Code extends string>(
  counts: readonly VisitorCount[],
  order: readonly Code[],
  minCount: number,
): VisitorCount<Code>[] {
  return counts
    .filter((entry): entry is VisitorCount<Code> => (order as readonly string[]).includes(entry.code))
    .filter((entry) => entry.count >= minCount && entry.count > 0)
    .sort((left, right) => right.count - left.count || order.indexOf(left.code) - order.indexOf(right.code));
}

// 공개 목록(/merchants)에 싣는 태그: 점포 종류별 기준 이상만, 개수 내림차순 뒤 코드 순서. 바라는 점·의견은 여기에 오지 않는다.
export function publicVisitorTags(counts: readonly VisitorCount[], isDemo: boolean): VisitorCount<VisitorTagCode>[] {
  return rankVisitorCounts(counts, visitorTagCodes, publicVisitorTagMinVotes(isDemo));
}
