export type CollectibleArtwork = {
  publicationId: string; projectId: string; gradeId: string; gradeName: string;
  name: string; shape: 'circle' | 'stamp' | 'serrated'; theme: { name: string }; thumbnailDataUrl: string;
};
export type PublishedCollectible = CollectibleArtwork & {
  imageDataUrl: string; thickness: number; angle: number; animation: string;
  greeting: string; audio: null | { dataUrl: string; mimeType: string; durationSeconds: number };
  story: { type: 'none' | 'zoom' | 'wide' | 'follow' | 'event'; frames: { dataUrl: string; width: number; height: number }[]; cartoon: number; strength: number };
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 80): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const image = (value: unknown, maximum = 1_500_000): value is string => typeof value === 'string' && value.length <= maximum
  && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const inRange = (value: unknown, minimum: number, maximum: number): value is number => finite(value) && value >= minimum && value <= maximum;
const dimensions = (value: unknown): value is number => inRange(value, 1, 4096) && Number.isInteger(value);
const animations = ['still', 'rotate', 'shine', 'float', 'stamp', 'sparkle', 'pulse', 'confetti'];

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
  if (!artwork || !record(value) || !image(value.imageDataUrl) || !inRange(value.thickness, 1, 24)
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
  return { ...artwork, imageDataUrl: value.imageDataUrl, thickness: value.thickness, angle: value.angle,
    animation: value.animation, greeting: value.greeting, audio,
    story: { type: value.story.type as PublishedCollectible['story']['type'], frames, cartoon: value.story.cartoon, strength: value.story.strength } };
}
