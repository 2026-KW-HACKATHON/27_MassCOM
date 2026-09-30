import type { AiArtFailureCode, ArtRoundStatus, ArtStyleKey } from './ai-art-rules.js';

export type ArtDraftView = { index: number; style: ArtStyleKey; label: string; imageDataUrl: string };

// 점주에게만 주는 모양이다. 시안·최종 이미지는 data URL이고 공개 주소가 아니다.
export type ArtRoundView = {
  id: string;
  status: ArtRoundStatus;
  drafts: ArtDraftView[];
  chosenIndex: number | null;
  final: { imageDataUrl: string } | null;
  failureCode: AiArtFailureCode | null;
  createdAt: string;
};

export type MerchantArtState = {
  configured: boolean;
  current: { artUrl: string } | null;
  quota: { draftRoundsLeft: number; finalsLeft: number };
  round: ArtRoundView | null;
};

export interface MerchantArtService {
  getState(merchantId: string): Promise<MerchantArtState>;
  createRound(input: { merchantId: string; accountId: string }): Promise<ArtRoundView>;
  getRound(input: { merchantId: string; roundId: string }): Promise<ArtRoundView>;
  // 그림을 바꾸는 네 메서드는 accountId의 현재 멤버십·MANAGE_ART를 자기 트랜잭션 안에서 다시 확인한다(잃었으면 MerchantAccessError).
  chooseDraft(input: { merchantId: string; roundId: string; index: number; accountId: string }): Promise<ArtRoundView>;
  apply(input: { merchantId: string; roundId: string; accountId: string }): Promise<{ artUrl: string }>;
  reset(input: { merchantId: string; accountId: string }): Promise<void>;
  // 지금 적용된 그림만 sha256으로 찾는다. 없으면 null.
  getPublicImage(sha256: string): Promise<Buffer | null>;
}

export type MerchantArtErrorCode =
  | 'AI_ART_NOT_CONFIGURED'
  | 'AI_ART_ROUND_IN_PROGRESS'
  | 'AI_ART_DAILY_LIMIT'
  | 'AI_ART_BUDGET_EXHAUSTED'
  | 'AI_ART_ROUND_STATE'
  | 'AI_ART_ROUND_NOT_FOUND'
  | 'ACCOUNT_DELETED';

export class MerchantArtError extends Error {
  constructor(readonly code: MerchantArtErrorCode, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = 'MerchantArtError';
  }
}
