// 8 MiB JSON: 원본 사진 3 MiB(base64 4 MiB) + 음성 1 MiB(1.34 MiB) + 등급 완성본(512 px)·썸네일(160 px)·장면 미리보기를
// 담는 크기다. 장면 원본 5장·PNG 완성본 16등급을 모두 최대로 채우는 조합은 넘을 수 있어 413 BODY_TOO_LARGE로 거절한다.
export const collectibleBodyLimit = 8 * 1024 * 1024;

export type CollectibleProject = {
  schemaVersion: 1;
  name: string;
  campaignId: string;
  theme: { name: string };
  photo: { originalDataUrl: string; width: number; height: number };
  shape: 'circle' | 'stamp' | 'serrated';
  crop: { x: number; y: number; zoom: number };
  photoEdits: {
    brightness: number; contrast: number; merge: number; simplify: number; cartoon: number;
    strokes: { tool: 'clean' | 'erase' | 'restore' | 'color'; points: { x: number; y: number }[]; size: number; color: string }[];
  };
  style: 'original' | 'incised' | 'raised';
  baseColor: string;
  photoColor: number;
  relief: number;
  stickers: { id: string; kind: 'text' | 'emoji'; text: string; x: number; y: number; size: number; rotation: number; color: string; order: number }[];
  grades: { id: string; name: string; kind: 'basic' | 'special'; enabled: boolean }[];
  effects: { id: string; type: 'metallic' | 'hologram' | 'pearl' | 'matte' | 'glow' | 'enamel' | 'glass'; target: string; gradeIds: string[]; strength: number; color: string; roughness: number }[];
  motion: { id: string; type: 'still' | 'rotate' | 'shine' | 'float' | 'stamp' | 'sparkle' | 'pulse' | 'confetti'; gradeIds: string[] }[];
  thickness: number;
  angle: number;
  greeting: string;
  audio: null | { dataUrl: string; mimeType: string; durationSeconds: number };
  story: { type: 'none' | 'zoom' | 'wide' | 'follow' | 'event'; frames: { dataUrl: string; width: number; height: number; previewDataUrl?: string }[]; cartoon: number; strength: number };
  derived: Record<string, { imageDataUrl: string; thumbnailDataUrl: string; baseDataUrl?: string; effectMasks?: Record<string, string> }>;
  rewardGrades: Partial<Record<'1' | '3' | '5', string>>;
};

export type CollectibleProjectView = {
  id: string; merchantId: string; version: number; status: 'DRAFT' | 'PUBLISHED';
  project: CollectibleProject; publicationId: string | null; createdAt: string; updatedAt: string;
};
// distributingCampaignId: 이 게시 버전이 지금 새 방문 고객에게 나가는 캠페인(게시 중지·교체·초안이면 null).
export type CollectibleProjectSummary = Omit<CollectibleProjectView, 'project'> & { name: string; schemaVersion: 1; distributingCampaignId: string | null };
export type CollectibleUnpublishResult = { projectId: string; publicationId: string; unlinkedCampaignId: string | null };
export type CollectibleArtwork = {
  projectId: string; publicationId: string; gradeId: string; gradeName: string;
  shape: CollectibleProject['shape']; theme: { name: string }; name: string; thumbnailDataUrl: string;
};
export type CollectibleDetail = CollectibleArtwork & {
  imageDataUrl: string; thickness: number; angle: number;
  baseDataUrl?: string; effectMasks?: Record<string, string>;
  animation: CollectibleProject['motion'][number]['type'];
  greeting: string; audio: CollectibleProject['audio']; story: CollectibleProject['story'];
  effects: Pick<CollectibleProject['effects'][number], 'type' | 'target' | 'strength' | 'color' | 'roughness'>[];
};

export type CollectibleProjectErrorCode =
  | 'COLLECTIBLE_INVALID_PROJECT' | 'COLLECTIBLE_MEDIA_TOO_LARGE' | 'COLLECTIBLE_PROJECT_NOT_FOUND'
  | 'COLLECTIBLE_VERSION_CONFLICT' | 'COLLECTIBLE_PUBLISHED_IMMUTABLE' | 'COLLECTIBLE_CAMPAIGN_UNAVAILABLE'
  | 'COLLECTIBLE_NOT_READY' | 'COLLECTIBLE_NOT_FOUND' | 'COLLECTIBLE_PROJECT_LIMIT' | 'COLLECTIBLE_NOT_PUBLISHED' | 'ACCOUNT_DELETED';
export class CollectibleProjectError extends Error {
  constructor(readonly code: CollectibleProjectErrorCode) { super(code); this.name = 'CollectibleProjectError'; }
}

export interface CollectibleProjectService {
  list(input: { merchantId: string; accountId: string }): Promise<readonly CollectibleProjectSummary[]>;
  create(input: { merchantId: string; accountId: string; project: unknown }): Promise<CollectibleProjectView>;
  get(input: { merchantId: string; accountId: string; projectId: string }): Promise<CollectibleProjectView>;
  save(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number; project: unknown }): Promise<CollectibleProjectView>;
  publish(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number; campaignId: string }): Promise<{ project: CollectibleProjectView; publicationId: string; campaignId: string }>;
  copy(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<CollectibleProjectView>;
  unpublish(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<CollectibleUnpublishResult>;
  remove(input: { merchantId: string; accountId: string; projectId: string; expectedVersion: number }): Promise<{ projectId: string; deleted: true; unlinkedCampaignId: string | null }>;
  getAcquired(input: { accountId: string; entitlementId: string }): Promise<CollectibleDetail>;
}
