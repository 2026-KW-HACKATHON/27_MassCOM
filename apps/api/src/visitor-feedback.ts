// 방문한 손님이 그 가게에 남기는 특징 태그·사장님께 바라는 점·짧은 의견의 서비스 계약(Issue #334, D-069).
// 응답에는 고객 계정 ID·이메일·시각을 싣지 않는다. 점주 요약은 가게마다 다른 가림 표시와 한국 날짜만 싣는다.
import type {
  VisitorFeedbackInvalidCode,
  VisitorFeedbackSelection,
  VisitorSuggestionCode,
  VisitorTagCode,
} from './visitor-feedback-rules.js';

export type { VisitorFeedbackSelection } from './visitor-feedback-rules.js';

export type VisitorFeedbackCount<Code extends string> = { code: Code; label: string; count: number };

export type VisitorFeedbackNote = {
  // `손님 K7QM`: 방문 취소 화면(recent-visits)과 같은 가림 표시다.
  customerLabel: string;
  // 마지막으로 고친 한국 날짜 `YYYY-MM-DD`. 시각은 싣지 않는다.
  date: string;
  text: string;
};

// 점주·직원 요약. 태그는 점포 안에서 기준 없이 모두 센다(공개 목록의 기준 3표는 여기에 적용하지 않는다).
export type VisitorFeedbackSummary = {
  tags: VisitorFeedbackCount<VisitorTagCode>[];
  suggestions: VisitorFeedbackCount<VisitorSuggestionCode>[];
  notes: VisitorFeedbackNote[];
};

export type VisitorFeedbackErrorCode =
  | VisitorFeedbackInvalidCode
  | 'VISITOR_FEEDBACK_NOT_ELIGIBLE'
  | 'ACCOUNT_DELETED';

export class VisitorFeedbackError extends Error {
  constructor(readonly code: VisitorFeedbackErrorCode) {
    super(code);
    this.name = 'VisitorFeedbackError';
  }
}

export interface VisitorFeedbackService {
  // 이 계정이 그 가게에 남긴 선택. 없으면 빈 선택이다.
  getMine(accountId: string, merchantId: string): Promise<VisitorFeedbackSelection>;
  // 선택을 통째로 바꾼다(가게마다 계정당 한 줄). 세 칸이 모두 비면 행을 지운다. 입력은 서비스가 검사한다.
  upsert(
    accountId: string,
    merchantId: string,
    input: { tags: unknown; suggestions: unknown; note: unknown },
  ): Promise<VisitorFeedbackSelection>;
  merchantSummary(merchantId: string): Promise<VisitorFeedbackSummary>;
}
