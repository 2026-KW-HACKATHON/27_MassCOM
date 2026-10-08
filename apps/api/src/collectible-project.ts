// 8 MiB JSON: 원본 사진 3 MiB(base64 4 MiB) + 음성 1 MiB(1.34 MiB) + 등급 완성본(512 px)·썸네일(160 px)·장면 미리보기를
// 담는 크기다. 장면 원본 5장·PNG 완성본 16등급을 모두 최대로 채우는 조합은 넘을 수 있어 413 BODY_TOO_LARGE로 거절한다.
export const collectibleBodyLimit = 8 * 1024 * 1024;

export type CollectibleSticker = {
  id: string; kind: 'text' | 'emoji' | 'mascot'; text: string; x: number; y: number; size: number; rotation: number; color: string; order: number;
  align?: 'left' | 'center' | 'right'; layouts?: Record<string, { x: number; y: number; size: number; rotation: number }>;
};
export type CollectibleMotion = {
  id: string; type: 'still' | 'rotate' | 'shine' | 'float' | 'stamp' | 'sparkle' | 'pulse' | 'confetti'; gradeIds: string[];
  playback?: 'once' | 'loop'; particle?: 'confetti' | 'snow' | 'petals' | 'sparkles';
};
export type CollectibleGreetingOverride = { id: string; gradeIds: string[]; themeName: string; text: string };
export type CollectibleLivingItem = {
  id: string; kind: 'sway' | 'bob' | 'steam' | 'blink'; target: string; gradeIds: string[]; amplitude: number;
  pivot: { x: number; y: number }; strokes?: { x: number; y: number }[];
};
export type CollectibleDerivedAngleFrames = { dataUrl: string; side: number; count: number; columns: number; stepDegrees: number };
export type CollectibleDerivedLiving = { dataUrl: string; count: number; columns: number; cellWidth: number; cellHeight: number; periodMs: number; box: { x: number; y: number; w: number; h: number } };

export type CollectibleProject = {
  schemaVersion: 2;
  name: string;
  campaignId: string;
  theme: { name: string };
  photo: { originalDataUrl: string; width: number; height: number };
  shape: 'circle' | 'stamp' | 'serrated';
  crop: { x: number; y: number; zoom: number };
  photoEdits: {
    brightness: number; contrast: number; merge: number; simplify: number; cartoon: number;
    strokes: { tool: 'clean' | 'erase' | 'restore' | 'color'; points: { x: number; y: number }[]; size: number; color: string; hardness?: number }[];
  };
  style: 'original' | 'incised' | 'raised' | 'monochrome';
  baseColor: string;
  photoColor: number;
  relief: number;
  stickers: CollectibleSticker[];
  back: { mode: 'default' | 'custom'; color: string; stickers: CollectibleSticker[] };
  grades: { id: string; name: string; kind: 'basic' | 'special'; enabled: boolean }[];
  effects: { id: string; type: 'metallic' | 'hologram' | 'pearl' | 'matte' | 'glow' | 'enamel' | 'glass' | 'flame'; target: string; gradeIds: string[]; strength: number; color: string; roughness: number; speed?: number }[];
  motion: CollectibleMotion[];
  thickness: number;
  angle: number;
  rotationSpeed?: number;
  greeting: string;
  greetingOverrides: CollectibleGreetingOverride[];
  audio: null | { dataUrl: string; mimeType: string; durationSeconds: number };
  story: { type: 'none' | 'zoom' | 'wide' | 'follow' | 'event'; frames: { dataUrl: string; width: number; height: number; previewDataUrl?: string }[]; cartoon: number; strength: number };
  parallax: { strength: number; strokes: { tool: 'fg' | 'bg'; size: number; points: { x: number; y: number }[] }[] };
  living: { periodMs: number; items: CollectibleLivingItem[] };
  derived: Record<string, {
    imageDataUrl: string; thumbnailDataUrl: string; baseDataUrl?: string; effectMasks?: Record<string, string>;
    backImageDataUrl?: string; angleFrames?: CollectibleDerivedAngleFrames; living?: CollectibleDerivedLiving;
  }>;
  rewardGrades: Partial<Record<'1' | '3' | '5', string>>;
};

export type CollectibleProjectView = {
  id: string; merchantId: string; version: number; status: 'DRAFT' | 'PUBLISHED';
  project: CollectibleProject; publicationId: string | null; createdAt: string; updatedAt: string;
};
// distributingCampaignId: 이 게시 버전이 지금 새 방문 고객에게 나가는 캠페인(게시 중지·교체·초안이면 null).
export type CollectibleProjectSummary = Omit<CollectibleProjectView, 'project'> & { name: string; schemaVersion: 2; distributingCampaignId: string | null };
// GET /api/web/merchant/merchants/:merchantId/collectible-campaigns 항목. goals는 이 캠페인에 실제로 있는 기존 목표 전체다.
export type CollectibleCampaign = {
  id: string; title: string; status: 'ACTIVE'; startsAt: string; endsAt: string; goals: number[];
  publication: { publicationId: string; projectId: string } | null;
};
export type CollectibleUnpublishResult = { projectId: string; publicationId: string; unlinkedCampaignId: string | null };
export type CollectibleArtwork = {
  projectId: string; publicationId: string; gradeId: string; gradeName: string;
  shape: CollectibleProject['shape']; theme: { name: string }; name: string; thumbnailDataUrl: string;
};
export type CollectibleDetail = CollectibleArtwork & {
  imageDataUrl: string; thickness: number; angle: number;
  rotationSpeed?: number;
  baseDataUrl?: string; effectMasks?: Record<string, string>;
  backImageDataUrl?: string; angleFrames?: CollectibleDerivedAngleFrames; living?: CollectibleDerivedLiving;
  // animation은 Android 구버전이 아는 v1 8종 그대로: 등급의 loop 재생 첫 모션(없으면 'still'). motions가 전체(재생·파티클 포함) 목록이다.
  animation: CollectibleProject['motion'][number]['type'];
  motions: { type: CollectibleMotion['type']; playback: CollectibleMotion['playback']; particle?: CollectibleMotion['particle'] }[];
  greeting: string; audio: CollectibleProject['audio']; story: CollectibleProject['story'];
  effects: Pick<CollectibleProject['effects'][number], 'type' | 'target' | 'strength' | 'color' | 'roughness' | 'speed'>[];
};

export type CollectibleProjectErrorCode =
  | 'COLLECTIBLE_INVALID_PROJECT' | 'COLLECTIBLE_MEDIA_TOO_LARGE' | 'COLLECTIBLE_PROJECT_NOT_FOUND'
  | 'COLLECTIBLE_VERSION_CONFLICT' | 'COLLECTIBLE_PUBLISHED_IMMUTABLE' | 'COLLECTIBLE_CAMPAIGN_UNAVAILABLE'
  | 'COLLECTIBLE_NOT_READY' | 'COLLECTIBLE_NOT_FOUND' | 'COLLECTIBLE_PROJECT_LIMIT' | 'COLLECTIBLE_NOT_PUBLISHED' | 'COLLECTIBLE_PUBLICATION_LIMIT' | 'ACCOUNT_DELETED';
export class CollectibleProjectError extends Error {
  constructor(readonly code: CollectibleProjectErrorCode) { super(code); this.name = 'CollectibleProjectError'; }
}

export interface CollectibleProjectService {
  list(input: { merchantId: string; accountId: string }): Promise<readonly CollectibleProjectSummary[]>;
  listCampaigns(input: { merchantId: string; accountId: string }): Promise<readonly CollectibleCampaign[]>;
  create(input: { merchantId: string; accountId: string; project: unknown }): Promise<CollectibleProjectView>;
  get(input: { merchantId: string; accountId: string; projectId: string }): Promise<CollectibleProjectView>;
  save(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number; project: unknown }): Promise<CollectibleProjectView>;
  publish(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number; campaignId: string }): Promise<{ project: CollectibleProjectView; publicationId: string; campaignId: string }>;
  copy(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<CollectibleProjectView>;
  unpublish(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<CollectibleUnpublishResult>;
  remove(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<{ projectId: string; deleted: true; unlinkedCampaignId: string | null }>;
  getAcquired(input: { accountId: string; entitlementId: string }): Promise<CollectibleDetail>;
}
