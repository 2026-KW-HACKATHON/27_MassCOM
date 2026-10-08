export type CollectibleArtwork = {
  publicationId: string; projectId: string; gradeId: string; gradeName: string;
  name: string; shape: 'circle' | 'stamp' | 'serrated'; theme: { name: string }; thumbnailDataUrl: string;
};
export type CollectibleParticleKind = 'confetti' | 'snow' | 'petals' | 'sparkles';
export type CollectibleMotion = { type: string; playback: 'once' | 'loop'; particle?: CollectibleParticleKind };
export type CollectibleEffect = {
  type: 'metallic' | 'hologram' | 'pearl' | 'matte' | 'glow' | 'enamel' | 'glass' | 'flame';
  target: string; strength: number; color: string; roughness: number; speed?: number;
};
export type CollectibleAngleFrames = { dataUrl: string; side: number; count: number; columns: number; stepDegrees: number };
export type CollectibleLiving = {
  dataUrl: string; count: number; columns: number; cellWidth: number; cellHeight: number; periodMs: number;
  box: { x: number; y: number; w: number; h: number };
};
export type PublishedCollectible = CollectibleArtwork & {
  imageDataUrl: string; thickness: number; angle: number; animation: string;
  rotationSpeed?: number;
  greeting: string; audio: null | { dataUrl: string; mimeType: string; durationSeconds: number };
  story: { type: 'none' | 'zoom' | 'wide' | 'follow' | 'event'; frames: { dataUrl: string; width: number; height: number }[]; cartoon: number; strength: number };
  /** v2 (Issue #284); absent on holders published before WP1/WP2/WP3 or when the web editor hasn't generated them yet. */
  backImageDataUrl?: string; angleFrames?: CollectibleAngleFrames; living?: CollectibleLiving; motions?: CollectibleMotion[];
  effects?: CollectibleEffect[];
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 80): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const image = (value: unknown, maximum = 1_500_000, mimes = 'png|jpeg|webp'): value is string => typeof value === 'string' && value.length <= maximum
  && new RegExp(`^data:image\\/(?:${mimes});base64,[A-Za-z0-9+/]+={0,2}$`).test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const inRange = (value: unknown, minimum: number, maximum: number): value is number => finite(value) && value >= minimum && value <= maximum;
const integerInRange = (value: unknown, minimum: number, maximum: number): value is number => inRange(value, minimum, maximum) && Number.isInteger(value);
const dimensions = (value: unknown): value is number => inRange(value, 1, 4096) && Number.isInteger(value);
const animations = ['still', 'rotate', 'shine', 'float', 'stamp', 'sparkle', 'pulse', 'confetti'];
// EXIF Orientation이 반영되지 않는 스프라이트 치수 함정(design doc PR #288 리뷰) 때문에 jpeg는 받지 않는다.
const spriteMimes = 'png|webp';
const particleKinds: readonly CollectibleParticleKind[] = ['confetti', 'snow', 'petals', 'sparkles'];
const effectTypes: readonly CollectibleEffect['type'][] = ['metallic', 'hologram', 'pearl', 'matte', 'glow', 'enamel', 'glass', 'flame'];

/** Baked materials remain metadata; only flame/aura needs an additional runtime layer. */
function parseEffects(value: unknown): CollectibleEffect[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const effects: CollectibleEffect[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.type !== 'string' || !effectTypes.includes(item.type as CollectibleEffect['type'])
      || typeof item.target !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.target)
      || !inRange(item.strength, 0, 100) || !inRange(item.roughness, 0, 100)
      || typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) return undefined;
    if (item.type === 'flame') {
      if (item.target !== 'aura' || (item.speed !== undefined && !inRange(item.speed, .25, 3))) return undefined;
    } else if (item.target === 'aura' || item.speed !== undefined) return undefined;
    effects.push({ type: item.type as CollectibleEffect['type'], target: item.target, strength: item.strength, color: item.color, roughness: item.roughness,
      ...(item.speed !== undefined ? { speed: item.speed as number } : {}) });
  }
  return effects;
}

/** 뒷면 전용 이미지. 유효하지 않으면 호출부가 필드를 버리고 로컬 기본 뒷면을 표시한다. */
function parseBackImageDataUrl(value: unknown): string | undefined {
  return image(value, 350_000, spriteMimes) ? value : undefined;
}

/** 각도 프레임 스프라이트. count/columns/stepDegrees는 서버가 항상 12/4/15로 고정해 내려보낸다. */
function parseAngleFrames(value: unknown): CollectibleAngleFrames | undefined {
  if (!record(value) || !image(value.dataUrl, 1_400_000, spriteMimes) || !integerInRange(value.side, 256, 512)
    || value.count !== 12 || value.columns !== 4 || value.stepDegrees !== 15) return undefined;
  return { dataUrl: value.dataUrl, side: value.side, count: 12, columns: 4, stepDegrees: 15 };
}

/** Living picture 스프라이트. box는 얼굴 영역 0..1 좌표이며 밖으로 넘치지 않아야 한다. */
function parseLiving(value: unknown): CollectibleLiving | undefined {
  if (!record(value) || !image(value.dataUrl, 700_000, spriteMimes)
    || !integerInRange(value.count, 8, 24) || !integerInRange(value.columns, 1, 8)
    || !integerInRange(value.cellWidth, 16, 512) || !integerInRange(value.cellHeight, 16, 512)
    // 서버(collectible-project-rules.ts)는 periodMs를 정수로 강제하지 않는다; 여기서만 integer를 요구하면 유효한 서버 값을 버린다.
    || !inRange(value.periodMs, 1000, 4000) || !record(value.box)
    || !inRange(value.box.x, 0, 1) || !inRange(value.box.y, 0, 1) || !inRange(value.box.w, 0, 1) || !inRange(value.box.h, 0, 1)
    || value.box.x + value.box.w > 1 || value.box.y + value.box.h > 1) return undefined;
  return {
    dataUrl: value.dataUrl, count: value.count, columns: value.columns, cellWidth: value.cellWidth, cellHeight: value.cellHeight, periodMs: value.periodMs,
    box: { x: value.box.x, y: value.box.y, w: value.box.w, h: value.box.h },
  };
}

/** 모션 목록 전체를 하나의 필드로 다룬다: 항목 하나라도 깨지면 배열 전체를 버린다(상세 전체는 거절하지 않는다). 빈 배열은 "이 등급에 걸린 모션 없음"이라는 유효한 서버 응답이라 받는다. */
function parseMotions(value: unknown): CollectibleMotion[] | undefined {
  if (!Array.isArray(value) || value.length > 16) return undefined;
  const motions: CollectibleMotion[] = [];
  for (const item of value) {
    if (!record(item) || typeof item.type !== 'string' || !animations.includes(item.type) || (item.playback !== 'once' && item.playback !== 'loop')) return undefined;
    if (item.particle === undefined) { motions.push({ type: item.type, playback: item.playback }); continue; }
    if (item.type !== 'confetti' || typeof item.particle !== 'string' || !particleKinds.includes(item.particle as CollectibleParticleKind)) return undefined;
    motions.push({ type: item.type, playback: item.playback, particle: item.particle as CollectibleParticleKind });
  }
  return motions;
}

export function parseCollectibleArtwork(value: unknown): CollectibleArtwork | undefined {
  if (!record(value) || !text(value.publicationId) || !text(value.projectId) || !text(value.gradeId)
    || !text(value.gradeName, 40) || !text(value.name) || typeof value.shape !== 'string' || !['circle', 'stamp', 'serrated'].includes(value.shape)
    || !record(value.theme) || !text(value.theme.name) || !image(value.thumbnailDataUrl, 350_000)) return undefined;
  return {
    publicationId: value.publicationId, projectId: value.projectId, gradeId: value.gradeId, gradeName: value.gradeName,
    name: value.name, shape: value.shape as CollectibleArtwork['shape'], theme: { name: value.theme.name }, thumbnailDataUrl: value.thumbnailDataUrl,
  };
}

export function parsePublishedCollectible(value: unknown): PublishedCollectible | undefined {
  const artwork = parseCollectibleArtwork(value);
  if (!artwork || !record(value) || !image(value.imageDataUrl) || !inRange(value.thickness, 1, 48)
    || !inRange(value.angle, -180, 180) || typeof value.animation !== 'string' || !animations.includes(value.animation)
    || typeof value.greeting !== 'string' || value.greeting.length > 300
    || !record(value.story) || typeof value.story.type !== 'string' || !['none', 'zoom', 'wide', 'follow', 'event'].includes(value.story.type)
    || !Array.isArray(value.story.frames) || value.story.frames.length > 5 || !inRange(value.story.cartoon, 0, 100) || !inRange(value.story.strength, 0, 100)) return undefined;
  const frames: PublishedCollectible['story']['frames'] = [];
  for (const frame of value.story.frames) {
    if (!record(frame) || !image(frame.dataUrl, 700_000) || !dimensions(frame.width) || !dimensions(frame.height)) return undefined;
    frames.push({ dataUrl: frame.dataUrl, width: frame.width, height: frame.height });
  }
  let audio: PublishedCollectible['audio'] = null;
  if (value.audio !== null && value.audio !== undefined) {
    if (!record(value.audio) || typeof value.audio.dataUrl !== 'string' || value.audio.dataUrl.length > 1500000
      || !/^data:audio\/(?:mpeg|mp3|webm|ogg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.audio.dataUrl)
      || typeof value.audio.mimeType !== 'string' || !value.audio.dataUrl.startsWith(`data:${value.audio.mimeType};base64,`)
      || !inRange(value.audio.durationSeconds, 0.1, 30)) return undefined;
    audio = { dataUrl: value.audio.dataUrl, mimeType: value.audio.mimeType, durationSeconds: value.audio.durationSeconds };
  }
  const minimumFrames = { none: 0, zoom: 0, wide: 1, follow: 2, event: 3 }[value.story.type as PublishedCollectible['story']['type']];
  if (frames.length < minimumFrames) return undefined;
  const backImageDataUrl = parseBackImageDataUrl(value.backImageDataUrl);
  const angleFrames = parseAngleFrames(value.angleFrames);
  const living = parseLiving(value.living);
  const motions = parseMotions(value.motions);
  const effects = parseEffects(value.effects);
  return { ...artwork, imageDataUrl: value.imageDataUrl, thickness: value.thickness, angle: value.angle,
    animation: value.animation, greeting: value.greeting, audio,
    ...(inRange(value.rotationSpeed, .25, 3) ? { rotationSpeed: value.rotationSpeed } : {}),
    story: { type: value.story.type as PublishedCollectible['story']['type'], frames, cartoon: value.story.cartoon, strength: value.story.strength },
    ...(backImageDataUrl !== undefined ? { backImageDataUrl } : {}),
    ...(angleFrames !== undefined ? { angleFrames } : {}),
    ...(living !== undefined ? { living } : {}),
    ...(motions !== undefined ? { motions } : {}),
    ...(effects !== undefined ? { effects } : {}) };
}

/**
 * 방문 수령으로 받은 보상 중 "다시 볼 수 있는 가게 수집품"(게시 외형)이 실제로 붙은 것을 고른다.
 * 1·3·5회 보상이 함께 지급되면 외형이 붙은 것 가운데 가장 높은 방문 목표를 고르고, 외형이 붙은 보상이 없으면 undefined다.
 */
export function grantedArtworkEntitlement(
  granted: readonly { entitlementId: string; targetVisitCount: number }[],
  collectibles: readonly { entitlementId: string; artwork?: unknown }[],
): string | undefined {
  const withArtwork = new Set(collectibles.filter((item) => item.artwork).map((item) => item.entitlementId));
  let best: { entitlementId: string; targetVisitCount: number } | undefined;
  for (const reward of granted) {
    if (withArtwork.has(reward.entitlementId) && (!best || reward.targetVisitCount > best.targetVisitCount)) best = reward;
  }
  return best?.entitlementId;
}
