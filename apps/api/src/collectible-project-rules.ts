import { CollectibleProjectError, type CollectibleDetail, type CollectibleProject } from './collectible-project.js';

const mb = 1024 * 1024;
export const collectiblePublicationGradeRowsLimit = 24 * mb;
export function assertCollectiblePublicationGradeRowsSize(rows: readonly { summary: string; detail: string }[]): void {
  if (rows.reduce((total, row) => total + Buffer.byteLength(row.summary) + Buffer.byteLength(row.detail), 0) > collectiblePublicationGradeRowsLimit) {
    throw new CollectibleProjectError('COLLECTIBLE_PUBLICATION_SIZE_LIMIT');
  }
}
const imageMimes = ['image/png', 'image/jpeg', 'image/webp'];
// 뒷면·각도·living 스프라이트는 픽셀 좌표로 자르고 배치하므로 JPEG의 EXIF Orientation 회전을 허용하지 않는다.
// 편집기도 이 셋은 WebP/PNG로만 만든다.
const spriteImageMimes = ['image/png', 'image/webp'];
const audioMimes = ['audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg'];
const identifier = /^[a-zA-Z0-9_-]{1,64}$/;
const hexColor = /^#[0-9a-f]{6}$/i;
// The editor renders finals, bases, masks and story previews on 512 px canvases and thumbnails at 160 px; originals may be larger.
const editorSide = 512;
const thumbnailSide = 160;

function invalid(): never { throw new CollectibleProjectError('COLLECTIBLE_INVALID_PROJECT'); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !(key in obj))) invalid();
  return obj;
}
// JSON은 짝 없는 UTF-16 서로게이트("\ud800")를 그대로 실어 오지만 PostgreSQL jsonb는 이를 거부해 저장 때 500이 난다. 짝이 맞는 것(이모티콘)은 허용한다.
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function string(value: unknown, max: number, empty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || loneSurrogate.test(value)) invalid();
}
function number(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid();
}
function enumeration(value: unknown, options: string[]): void { if (typeof value !== 'string' || !options.includes(value)) invalid(); }
function array(value: unknown, max: number, min = 0): unknown[] { if (!Array.isArray(value) || value.length < min || value.length > max) invalid(); return value; }
function id(value: unknown): void { if (typeof value !== 'string' || !identifier.test(value) || ['__proto__','prototype','constructor'].includes(value)) invalid(); }
function color(value: unknown): void { if (typeof value !== 'string' || !hexColor.test(value)) invalid(); }
function uniqueIds(values: Record<string, unknown>[]): void { const ids = values.map(value => value.id); if (new Set(ids).size !== ids.length) invalid(); }
function scopeIds(value: unknown, gradeIds: string[]): void {
  const refs = array(value, 16);
  if (new Set(refs).size !== refs.length || refs.some(ref => !gradeIds.includes(ref as string))) invalid();
}

// v2 스키마 추가분. model.mjs와 값을 맞춰 둔다(서로 import하지 않는 서버/브라우저 쌍둥이 구현).
const mascotPoses = ['cheer','explore-map','friends','gift','logo-badge','puzzled','search','sky-town-header','sleep','stamp','town-map','wave'];
// collectible-model.mjs MASCOT_BLINK와 값을 맞춘다(collectible-mascot-blink-parity.test.mjs가 일치를 확인).
const mascotBlink: string[] = ['cheer','explore-map','friends','gift','logo-badge','puzzled','search','stamp','wave'];
const particleKinds = ['confetti','snow','petals','sparkles'];
const stickerKinds = ['text','emoji','mascot'];
const stickerAligns = ['left','center','right'];
const motionPlaybacks = ['once','loop'];
const backModes = ['default','custom'];
const parallaxTools = ['fg','bg'];
const livingKinds = ['sway','bob','steam','blink'];

// allowLayouts=false는 뒷면 스티커용: layouts 키 자체를 허용하지 않는다(등급별 배치는 앞면 전용).
function parseSticker(raw: unknown, gradeIds: string[], allowLayouts: boolean): Record<string, unknown> {
  const sticker = object(raw, ['id','kind','text','x','y','size','rotation','color','order'], allowLayouts ? ['align','layouts'] : ['align']);
  id(sticker.id); enumeration(sticker.kind, stickerKinds);
  if (sticker.kind === 'mascot') enumeration(sticker.text, mascotPoses);
  else {
    string(sticker.text, 80);
    if (/[\r\t]/.test(sticker.text as string)) invalid();
    if ((sticker.text as string).split('\n').length > 4) invalid();
  }
  number(sticker.x, 0, 1); number(sticker.y, 0, 1); number(sticker.size, 8, 120); number(sticker.rotation, -180, 180);
  color(sticker.color); number(sticker.order, 0, 100, true);
  if (sticker.align !== undefined) enumeration(sticker.align, stickerAligns);
  let layouts: Record<string, unknown> = {};
  if (allowLayouts && sticker.layouts !== undefined) {
    if (!sticker.layouts || typeof sticker.layouts !== 'object' || Array.isArray(sticker.layouts)) invalid();
    const entries = Object.entries(sticker.layouts as Record<string, unknown>);
    if (entries.length > 16) invalid();
    for (const [gradeId, layoutRaw] of entries) {
      if (!gradeIds.includes(gradeId)) invalid();
      const layout = object(layoutRaw, ['x','y','size','rotation']);
      number(layout.x, 0, 1); number(layout.y, 0, 1); number(layout.size, 8, 120); number(layout.rotation, -180, 180);
    }
    layouts = sticker.layouts as Record<string, unknown>;
  }
  return { ...sticker, align: (sticker.align as string | undefined) ?? 'center', ...(allowLayouts ? { layouts } : {}) };
}
// playback·particle은 구 편집기가 아직 보내지 않을 수 있어 선택 항목으로 두고 기본값을 채운다(업그레이드와 같은 기본값).
// particle은 type이 confetti일 때만 의미가 있어, 다른 종류 모션에 값이 있으면 거부한다.
function parseMotion(raw: unknown, gradeIds: string[]): Record<string, unknown> {
  const motion = object(raw, ['id','type','gradeIds'], ['playback','particle']);
  id(motion.id); enumeration(motion.type, ['still','rotate','shine','float','stamp','sparkle','pulse','confetti']);
  scopeIds(motion.gradeIds, gradeIds);
  if (motion.playback !== undefined) enumeration(motion.playback, motionPlaybacks);
  if (motion.particle !== undefined) { if (motion.type !== 'confetti') invalid(); enumeration(motion.particle, particleKinds); }
  return {
    ...motion, playback: (motion.playback as string | undefined) ?? 'loop',
    ...(motion.type === 'confetti' ? { particle: (motion.particle as string | undefined) ?? 'confetti' } : {}),
  };
}
function parseGreetingOverride(raw: unknown, gradeIds: string[]): Record<string, unknown> {
  const override = object(raw, ['id','gradeIds','themeName','text']);
  id(override.id); scopeIds(override.gradeIds, gradeIds); string(override.themeName, 80, true); string(override.text, 300);
  if ((override.gradeIds as unknown[]).length === 0 && override.themeName === '') invalid();
  return override;
}
// living은 'region'(strokes로 표시한 영역) 또는 앞면 스티커 id만 대상으로 삼는다. blink는 오직 mascot 스티커 대상,
// 그것도 MASCOT_BLINK에 있는 포즈에서만(지금은 그림이 없어 항상 비어 있다).
function parseLivingItem(raw: unknown, gradeIds: string[], frontStickers: Record<string, unknown>[]): Record<string, unknown> {
  const item = object(raw, ['id','kind','target','gradeIds','amplitude','pivot'], ['strokes']);
  id(item.id); enumeration(item.kind, livingKinds);
  const stickerIds = frontStickers.map(sticker => sticker.id as string);
  if (item.target !== 'region' && !stickerIds.includes(item.target as string)) invalid();
  scopeIds(item.gradeIds, gradeIds); number(item.amplitude, 0, 100);
  const pivot = object(item.pivot, ['x','y']); number(pivot.x, 0, 1); number(pivot.y, 0, 1);
  if (item.target === 'region') {
    if (item.kind === 'blink') invalid();
    const points = array(item.strokes, 20, 1).map(pointRaw => { const point = object(pointRaw, ['x','y']); number(point.x, 0, 1); number(point.y, 0, 1); return point; });
    return { ...item, strokes: points };
  }
  if (item.strokes !== undefined) invalid();
  if (item.kind === 'blink') {
    const sticker = frontStickers.find(candidate => candidate.id === item.target);
    if (!sticker || sticker.kind !== 'mascot' || !mascotBlink.includes(sticker.text as string)) invalid();
  }
  return { ...item };
}
// v1 → v2. 순수 재배치이며 구조가 어긋나면(예: stickers가 배열이 아님) 평범한 TypeError를 던져 호출자가 400으로 바꾼다.
// model.mjs upgradeProject와 값이 같아야 하며 같은 골든 픽스처로 함께 시험한다. 이미 v2면 그대로(깊은 복사) 돌려줘 멱등이다.
export function upgradeCollectibleProject(value: unknown): CollectibleProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const source = value as Record<string, unknown>;
  if (source.schemaVersion === 2) return structuredClone(source) as CollectibleProject;
  if (source.schemaVersion !== 1) invalid();
  const upgraded = structuredClone(source) as Record<string, unknown>;
  upgraded.schemaVersion = 2;
  upgraded.stickers = (upgraded.stickers as Record<string, unknown>[]).map(sticker => ({
    ...sticker,
    text: typeof sticker.text === 'string' ? sticker.text.replace(/[\r\n\t]+/g, ' ') : sticker.text,
    align: 'center',
    layouts: {},
  }));
  upgraded.back = { mode: 'default', color: upgraded.baseColor, stickers: [] };
  upgraded.motion = (upgraded.motion as Record<string, unknown>[]).map(motion => ({
    ...motion,
    playback: 'loop',
    ...(motion.type === 'confetti' ? { particle: 'confetti' } : {}),
  }));
  upgraded.greetingOverrides = [];
  upgraded.parallax = { strength: 0, strokes: [] };
  upgraded.living = { periodMs: 2400, items: [] };
  return upgraded as CollectibleProject;
}

// Only inline supported media is accepted. No original file name, EXIF metadata, URL, or arbitrary SVG is interpreted by the server.
// allowedImageMimes narrows image kinds further (e.g. sprite fields that are sliced/positioned by pixel geometry
// reject JPEG: its EXIF Orientation tag silently rotates the decoded pixels, so a declared 1024x768 sprite could
// actually display 768x1024 in a renderer/Android grid that only reads the header dimensions).
export function validateCollectibleMedia(value: unknown, kind: 'image' | 'audio', maxBytes: number, maxSide = 4096, allowedImageMimes: string[] = imageMimes): string {
  if (typeof value !== 'string') invalid();
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 64) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  const match = value.match(/^data:([a-z]+\/[a-z0-9]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !(kind === 'image' ? allowedImageMimes : audioMimes).includes(match[1]!)) invalid();
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length > maxBytes) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  if (bytes.length === 0 || bytes.toString('base64') !== match[2]) invalid();
  const mime = match[1]!;
  const signature = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mime === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : mime === 'audio/ogg' ? bytes.subarray(0, 4).toString() === 'OggS'
    : mime === 'audio/webm' ? bytes.subarray(0, 4).equals(Buffer.from([26,69,223,163]))
    : bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224);
  if (!signature) invalid();
  if (kind === 'image') {
    if (mime === 'image/webp' && animatedWebp(bytes)) invalid();
    const size = imageDimensions(bytes, mime);
    if (!size || size.width < 1 || size.height < 1 || size.width > maxSide || size.height > maxSide || size.width * size.height > 16_777_216) invalid();
  }
  return mime;
}

// Animated WebP (VP8X animation flag or ANIM/ANMF chunks) would play frames the server never inspected.
function animatedWebp(bytes: Buffer): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && offset + 8 < bytes.length && (bytes[offset + 8]! & 0x02))) return true;
    offset += 8 + bytes.readUInt32LE(offset + 4) + (bytes.readUInt32LE(offset + 4) % 2);
  }
  return false;
}

function imageDimensions(bytes: Buffer, mime: string): {width: number; height: number} | undefined {
  if (mime === 'image/png') {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12,16).toString() !== 'IHDR') return undefined;
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  if (mime === 'image/webp') {
    const type = bytes.subarray(12,16).toString();
    if (type === 'VP8X' && bytes.length >= 30) return {width:1+bytes.readUIntLE(24,3),height:1+bytes.readUIntLE(27,3)};
    if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits=bytes.readUInt32LE(21); return {width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};
    }
    if (type === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23,26).equals(Buffer.from([157,1,42]))) return {width:bytes.readUInt16LE(26)&0x3fff,height:bytes.readUInt16LE(28)&0x3fff};
    return undefined;
  }
  let offset=2;
  while (offset+4<=bytes.length) {
    if (bytes[offset++]!==255) return undefined;
    while (bytes[offset]===255) offset++;
    const marker=bytes[offset++]; if (marker===undefined || marker===0xda || marker===0xd9) return undefined;
    if (marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
    if (offset+2>bytes.length) return undefined;
    const length=bytes.readUInt16BE(offset); if(length<2 || offset+length>bytes.length) return undefined;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if(length<8) return undefined; return {width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};
    }
    offset+=length;
  }
  return undefined;
}

// 구조 검사 전에 값을 통째로 structuredClone하면, 알려진 키 이름 아래 원소 수만 개짜리 배열 하나를 심은 입력이
// 실제 배열 상한 검사(뒤에서 array()가 함)에 닿기도 전에 복제 시간·메모리 비용부터 치르게 한다(수백 KB~수 MB
// 요청으로 수백 ms·수백 MiB를 태울 수 있음). upgrade·구조 복제보다 먼저, 얕게 훑기만 해서 배열 길이와 전체
// 노드 수를 빠르게 거절한다(이 훑기는 새로 할당하지 않으므로 같은 크기의 입력이라도 훨씬 싸다).
const MAX_SHAPE_ARRAY_LENGTH = 2000; // 실제로 쓰는 가장 큰 개별 배열 상한(스트로크 점 1,000)보다 넉넉히 커서 정상 입력을 막지 않는다.
// 정상 최대치: 사진 붓 100획×1,000점(배열 원소+x·y 키 ≈ 300,500) + 패럴랙스·살아 있는 그림 2만 점(≈ 60,000) + 나머지(수천).
// 이보다 넉넉히 잡아 정상 입력은 통과시키고, 그 이상은 복제 전에 끊는다. 값을 훑는 비용은 수 ms다.
const MAX_SHAPE_NODES = 450_000;
// 정상 프로젝트의 가장 깊은 중첩은 living.items[i].strokes[j].points[k].x 까지 8단계다. 깊이 상한이 없으면
// 길이·노드 예산 안에서도 수만 단계로 겹친 배열 하나가 재귀를 터뜨려(RangeError) 500이 된다.
const MAX_SHAPE_DEPTH = 16;
function assertBoundedShape(value: unknown, nodes: { count: number } = { count: 0 }, depth = 0): void {
  if (depth > MAX_SHAPE_DEPTH) invalid();
  if (Array.isArray(value)) {
    if (value.length > MAX_SHAPE_ARRAY_LENGTH) invalid();
    nodes.count += value.length;
    if (nodes.count > MAX_SHAPE_NODES) invalid();
    for (const item of value) assertBoundedShape(item, nodes, depth + 1);
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    nodes.count += keys.length;
    if (nodes.count > MAX_SHAPE_NODES) invalid();
    for (const key of keys) assertBoundedShape((value as Record<string, unknown>)[key], nodes, depth + 1);
  }
}

// v1이면 위의 순수 upgradeCollectibleProject로 재배치한 뒤 v2 규칙 전체로 검증한다(재배치 자체는 값을 검사하지 않으므로,
// v1 쪽 구조·범위 위반도 이 아래 v2 검증에서 그대로 걸러진다). 그 외 버전은 거부.
export function validateCollectibleProject(value: unknown, publish = false): CollectibleProject {
  assertBoundedShape(value);
  let upgraded: CollectibleProject;
  try { upgraded = upgradeCollectibleProject(value); }
  catch (error) { if (error instanceof CollectibleProjectError) throw error; invalid(); }
  return validateUpgradedProject(upgraded, publish);
}

function validateUpgradedProject(value: unknown, publish: boolean): CollectibleProject {
  const p = object(value, ['schemaVersion','name','campaignId','theme','photo','shape','crop','photoEdits','style','baseColor','photoColor','relief',
    'stickers','back','grades','effects','motion','thickness','angle','greeting','greetingOverrides','audio','story','parallax','living','derived','rewardGrades'], ['rotationSpeed']);
  if (p.schemaVersion !== 2) invalid();
  string(p.name, 80); string(p.campaignId, 120, true); const theme = object(p.theme, ['name']); string(theme.name, 80);
  enumeration(p.shape, ['circle','stamp','serrated']); enumeration(p.style, ['original','incised','raised','monochrome']);
  color(p.baseColor); number(p.photoColor, 0, 100); number(p.relief, 0, 100); number(p.thickness, 1, 48); number(p.angle, -180, 180);
  if (p.rotationSpeed !== undefined) number(p.rotationSpeed, .25, 3);
  const photo = object(p.photo, ['originalDataUrl','width','height']);
  if (photo.originalDataUrl === '') { if (photo.width !== 0 || photo.height !== 0 || publish) throw new CollectibleProjectError(publish ? 'COLLECTIBLE_NOT_READY' : 'COLLECTIBLE_INVALID_PROJECT'); }
  else {
    const mime=validateCollectibleMedia(photo.originalDataUrl, 'image', 3 * mb); number(photo.width, 1, 4096, true); number(photo.height, 1, 4096, true);
    const actual=imageDimensions(Buffer.from((photo.originalDataUrl as string).split(',')[1]!,'base64'),mime);
    if(!actual || !((actual.width===photo.width && actual.height===photo.height)
      || (mime==='image/jpeg' && actual.height===photo.width && actual.width===photo.height))) invalid();
  }
  const crop = object(p.crop, ['x','y','zoom']); number(crop.x, -1, 1); number(crop.y, -1, 1); number(crop.zoom, 1, 8);
  const edits = object(p.photoEdits, ['brightness','contrast','merge','simplify','cartoon','strokes']);
  number(edits.brightness, -100, 100); number(edits.contrast, -100, 100);
  for (const key of ['merge','simplify','cartoon']) number(edits[key], 0, 100);
  for (const raw of array(edits.strokes, 100)) {
    const stroke = object(raw, ['tool','points','size','color'], ['hardness']); enumeration(stroke.tool, ['clean','erase','restore','color']); color(stroke.color); number(stroke.size, 0.01, 0.2);
    if (stroke.hardness !== undefined) number(stroke.hardness, 0, 100);
    for (const pointRaw of array(stroke.points, 1000, 1)) { const point = object(pointRaw, ['x','y']); number(point.x, 0, 1); number(point.y, 0, 1); }
  }
  const grades = array(p.grades, 16, 1).map(raw => object(raw, ['id','name','kind','enabled'])); uniqueIds(grades);
  for (const grade of grades) { id(grade.id); string(grade.name, 40); enumeration(grade.kind, ['basic','special']); if (typeof grade.enabled !== 'boolean') invalid(); }
  const gradeIds = grades.map(grade => grade.id as string);
  const scope = (value: unknown) => scopeIds(value, gradeIds);
  const stickers = array(p.stickers, 30).map(raw => parseSticker(raw, gradeIds, true)); uniqueIds(stickers);
  const back = object(p.back, ['mode','color','stickers']); enumeration(back.mode, backModes); color(back.color);
  const backStickers = array(back.stickers, 10).map(raw => parseSticker(raw, gradeIds, false));
  uniqueIds([...stickers, ...backStickers]);
  const effects = array(p.effects, 64).map(raw => object(raw,['id','type','target','gradeIds','strength','color','roughness'], ['speed'])); uniqueIds(effects);
  for (const effect of effects) {
    id(effect.id); enumeration(effect.type,['metallic','hologram','pearl','matte','glow','enamel','glass','flame']);
    if (effect.type === 'flame') {
      if (effect.target !== 'aura') invalid();
      if (effect.speed !== undefined) number(effect.speed, .25, 3);
    } else if (effect.speed !== undefined || effect.target === 'aura' || !['surface','photo','border', ...stickers.map(s => s.id)].includes(effect.target)) invalid();
    scope(effect.gradeIds); number(effect.strength,0,100); number(effect.roughness,0,100); color(effect.color);
  }
  const motions = array(p.motion, 10).map(raw => parseMotion(raw, gradeIds)); uniqueIds(motions);
  string(p.greeting, 300, true);
  const greetingOverrides = array(p.greetingOverrides, 16).map(raw => parseGreetingOverride(raw, gradeIds)); uniqueIds(greetingOverrides);
  let normalizedAudio: { dataUrl: string; durationSeconds: number } | undefined;
  if (p.audio !== null) {
    const audio = object(p.audio,['dataUrl','mimeType','durationSeconds']); const mime = validateCollectibleMedia(audio.dataUrl,'audio',mb);
    if (audio.mimeType !== mime) invalid(); number(audio.durationSeconds,0.1,30);
    // The stored length always comes from the media, never from the client. MP3 uploads lose ID3/APE tags; Ogg recordings get an
    // empty OpusTags packet; WebM recordings with tag/attachment/chapter/title elements are rejected.
    const bytes = Buffer.from((audio.dataUrl as string).slice((audio.dataUrl as string).indexOf(',') + 1), 'base64');
    const normalized = mime === 'audio/ogg' ? normalizeOggOpus(bytes) : mime === 'audio/webm' ? inspectWebmOpus(bytes) : normalizeMp3(bytes);
    normalizedAudio = { dataUrl: `data:${mime};base64,${normalized.bytes.toString('base64')}`, durationSeconds: normalized.durationSeconds };
  }
  const story = object(p.story,['type','frames','cartoon','strength']); enumeration(story.type,['none','zoom','wide','follow','event']); number(story.cartoon,0,100); number(story.strength,0,100);
  for (const raw of array(story.frames, 5)) {
    const frame = object(raw,['dataUrl','width','height'],['previewDataUrl']); const mime=validateCollectibleMedia(frame.dataUrl,'image',512*1024); number(frame.width,1,4096,true); number(frame.height,1,4096,true);
    const actual=imageDimensions(Buffer.from((frame.dataUrl as string).split(',')[1]!,'base64'),mime);
    if(!actual || !((actual.width===frame.width && actual.height===frame.height)
      || (mime==='image/jpeg' && actual.height===frame.width && actual.width===frame.height))) invalid();
    if(frame.previewDataUrl!==undefined) validateCollectibleMedia(frame.previewDataUrl,'image',512*1024,editorSide);
    if(publish && story.type!=='none' && frame.previewDataUrl===undefined) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  }
  const storyMinimum = { none: 0, zoom: 0, wide: 1, follow: 2, event: 3 }[story.type as CollectibleProject['story']['type']];
  if (publish && (story.frames as unknown[]).length < storyMinimum) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  const parallax = object(p.parallax, ['strength','strokes']); number(parallax.strength, 0, 100);
  const parallaxStrokes = array(parallax.strokes, 100).map(raw => {
    const stroke = object(raw, ['tool','size','points']); enumeration(stroke.tool, parallaxTools); number(stroke.size, 0.01, 0.2);
    const points = array(stroke.points, 1000, 1).map(pointRaw => { const point = object(pointRaw, ['x','y']); number(point.x, 0, 1); number(point.y, 0, 1); return point; });
    return { ...stroke, points };
  });
  const living = object(p.living, ['periodMs','items']); number(living.periodMs, 1000, 4000);
  const livingItems = array(living.items, 4).map(raw => parseLivingItem(raw, gradeIds, stickers)); uniqueIds(livingItems);
  let totalPoints = parallaxStrokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  for (const item of livingItems) if (item.strokes) totalPoints += (item.strokes as unknown[]).length;
  if (totalPoints > 20_000) invalid();
  if (!p.derived || typeof p.derived !== 'object' || Array.isArray(p.derived)) invalid();
  for (const [gradeId, raw] of Object.entries(p.derived)) {
    if (!gradeIds.includes(gradeId)) invalid();
    const asset = object(raw,['imageDataUrl','thumbnailDataUrl'],['baseDataUrl','effectMasks','backImageDataUrl','angleFrames','living']);
    validateCollectibleMedia(asset.imageDataUrl,'image',mb,editorSide); validateCollectibleMedia(asset.thumbnailDataUrl,'image',128*1024,thumbnailSide);
    if (asset.baseDataUrl !== undefined) validateCollectibleMedia(asset.baseDataUrl,'image',mb,editorSide);
    if (asset.effectMasks !== undefined) {
      if (!asset.effectMasks || typeof asset.effectMasks !== 'object' || Array.isArray(asset.effectMasks)) invalid();
      const masks = Object.entries(asset.effectMasks); if (masks.length > 64) invalid();
      const targets = effects.filter(e => e.target !== 'aura' && (e.gradeIds as string[]).includes(gradeId)).map(e => e.target);
      for (const [target, mask] of masks) { if (!targets.includes(target)) invalid(); validateCollectibleMedia(mask,'image',256*1024,editorSide); }
    }
    if (asset.backImageDataUrl !== undefined) validateCollectibleMedia(asset.backImageDataUrl, 'image', 256 * 1024, 512, spriteImageMimes);
    if (asset.angleFrames !== undefined) {
      const angleFrames = object(asset.angleFrames, ['dataUrl','side','count','columns','stepDegrees']);
      number(angleFrames.side, 256, 512, true);
      if (angleFrames.count !== 12 || angleFrames.columns !== 4 || angleFrames.stepDegrees !== 15) invalid();
      const side = angleFrames.side as number;
      const mime = validateCollectibleMedia(angleFrames.dataUrl, 'image', mb, side * 4, spriteImageMimes);
      const actual = imageDimensions(Buffer.from((angleFrames.dataUrl as string).split(',')[1]!, 'base64'), mime);
      if (!actual || actual.width !== side * 4 || actual.height !== side * 3) invalid();
    }
    if (asset.living !== undefined) {
      const derivedLiving = object(asset.living, ['dataUrl','count','columns','cellWidth','cellHeight','periodMs','box']);
      number(derivedLiving.count, 8, 24, true); number(derivedLiving.columns, 1, 8, true);
      number(derivedLiving.cellWidth, 16, 512, true); number(derivedLiving.cellHeight, 16, 512, true); number(derivedLiving.periodMs, 1000, 4000);
      const box = object(derivedLiving.box, ['x','y','w','h']);
      number(box.x, 0, 1); number(box.y, 0, 1); number(box.w, 0, 1); number(box.h, 0, 1);
      if ((box.x as number) + (box.w as number) > 1 || (box.y as number) + (box.h as number) > 1) invalid();
      const columns = derivedLiving.columns as number, cellWidth = derivedLiving.cellWidth as number, cellHeight = derivedLiving.cellHeight as number, count = derivedLiving.count as number;
      const width = columns * cellWidth, height = Math.ceil(count / columns) * cellHeight;
      if (width > 4096 || height > 4096) invalid();
      const mime = validateCollectibleMedia(derivedLiving.dataUrl, 'image', 512 * 1024, Math.max(width, height), spriteImageMimes);
      const actual = imageDimensions(Buffer.from((derivedLiving.dataUrl as string).split(',')[1]!, 'base64'), mime);
      if (!actual || actual.width !== width || actual.height !== height) invalid();
    }
  }
  if (!p.rewardGrades || typeof p.rewardGrades !== 'object' || Array.isArray(p.rewardGrades)) invalid();
  const mappings = Object.entries(p.rewardGrades);
  for (const [goal, gradeId] of mappings) { if (!['1','3','5'].includes(goal) || !grades.some(g => g.id === gradeId && g.enabled === true)) invalid(); }
  const derived = p.derived as Record<string, any>;
  if (publish && (mappings.length === 0 || mappings.some(([, gradeId]) => !Object.hasOwn(derived, gradeId as string)))) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  // backImageDataUrl은 선택으로 남긴다. 새 편집기는 항상 만들지만, 배포 스큐 동안 이미 열려 있던 구 편집기
  // 탭이나 v1에서 올라온 기존 프로젝트는 이 필드 없이 게시를 시도할 수 있다. 필수로 두면 그 순간 게시가 전부
  // COLLECTIBLE_NOT_READY로 막힌다. 클라이언트는 이미 없을 때를 대비한다(뒷면 없음 → 기존 모습로 대체).
  // living만은 지금 편집기가 만들 방법이 없는 항목을 프로젝트가 스스로 선언했을 때
  // (누군가 API를 직접 쳐서 living 항목을 등급에 걸었을 때)만 필요해, 항상 안전하게 강제할 수 있다.
  if (publish) {
    const linkedGrades = new Set(Object.values(p.rewardGrades as Record<string, string>));
    for (const gradeId of linkedGrades) {
      if (!gradeId) continue;
      const needsLiving = livingItems.some(item => (item.gradeIds as string[]).includes(gradeId));
      if (needsLiving && !derived[gradeId]?.living) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
    }
  }
  (p as Record<string, unknown>).stickers = stickers;
  (p as Record<string, unknown>).back = { ...back, stickers: backStickers };
  (p as Record<string, unknown>).motion = motions;
  (p as Record<string, unknown>).greetingOverrides = greetingOverrides;
  (p as Record<string, unknown>).parallax = { ...parallax, strokes: parallaxStrokes };
  (p as Record<string, unknown>).living = { ...living, items: livingItems };
  const result = structuredClone(p) as CollectibleProject;
  if (normalizedAudio && result.audio) { result.audio.dataUrl = normalizedAudio.dataUrl; result.audio.durationSeconds = normalizedAudio.durationSeconds; }
  // Originals are only visible to MANAGE_ART holders and copied with each project copy, but camera EXIF (GPS, device, time)
  // is not needed for editing, so every stored image keeps pixels (and JPEG orientation) only.
  if (result.photo.originalDataUrl) result.photo.originalDataUrl = stripImageMetadata(result.photo.originalDataUrl);
  for (const frame of result.story.frames) {
    frame.dataUrl = stripImageMetadata(frame.dataUrl);
    if (frame.previewDataUrl !== undefined) frame.previewDataUrl = stripImageMetadata(frame.previewDataUrl);
  }
  for (const asset of Object.values(result.derived)) {
    asset.imageDataUrl = stripImageMetadata(asset.imageDataUrl); asset.thumbnailDataUrl = stripImageMetadata(asset.thumbnailDataUrl);
    if (asset.baseDataUrl !== undefined) asset.baseDataUrl = stripImageMetadata(asset.baseDataUrl);
    if (asset.effectMasks) for (const target of Object.keys(asset.effectMasks)) asset.effectMasks[target] = stripImageMetadata(asset.effectMasks[target]!);
    if (asset.backImageDataUrl !== undefined) asset.backImageDataUrl = stripImageMetadata(asset.backImageDataUrl);
    if (asset.angleFrames !== undefined) asset.angleFrames.dataUrl = stripImageMetadata(asset.angleFrames.dataUrl);
    if (asset.living !== undefined) asset.living.dataUrl = stripImageMetadata(asset.living.dataUrl);
  }
  return result;
}

const mp3Bitrates = { mpeg1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320], mpeg2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160] };
const mp3SampleRates: Record<number, number[]> = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };
type Mp3Frame = { length: number; samples: number; sampleRate: number; version: number };

// MPEG audio Layer III frame header (MPEG-1/2/2.5). Reserved version/layer/bitrate/sample-rate/emphasis values are rejected.
function mp3Frame(bytes: Buffer, offset: number): Mp3Frame | undefined {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff) return undefined;
  const b1 = bytes[offset + 1]!, b2 = bytes[offset + 2]!, b3 = bytes[offset + 3]!;
  const version = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, bitrateIndex = b2 >> 4, rateIndex = (b2 >> 2) & 3;
  if ((b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3 || (b3 & 3) === 2) return undefined;
  const bitrate = (version === 3 ? mp3Bitrates.mpeg1 : mp3Bitrates.mpeg2)[bitrateIndex]! * 1000;
  const sampleRate = mp3SampleRates[version]![rateIndex]!; const samples = version === 3 ? 1152 : 576;
  return { length: Math.floor((samples / 8) * bitrate / sampleRate) + ((b2 >> 1) & 1), samples, sampleRate, version };
}

// Removes leading ID3v2 tags (syncsafe size, optional footer), a trailing ID3v1 "TAG" block and a trailing APEv2 tag, then
// requires the rest to be consecutive Layer III frames with one version/sample rate. A cut-off last frame is dropped.
// Anything else (HTML, a second container, junk between frames) is rejected. Returns the frames and their play length.
export function normalizeMp3(bytes: Buffer): { bytes: Buffer; durationSeconds: number } {
  let start = 0, end = bytes.length;
  while (end - start >= 10 && bytes.toString('latin1', start, start + 3) === 'ID3') {
    const size = bytes.subarray(start + 6, start + 10);
    if (size.some(byte => byte & 0x80)) invalid();
    start += 10 + ((size[0]! << 21) | (size[1]! << 14) | (size[2]! << 7) | size[3]!) + ((bytes[start + 5]! & 0x10) ? 10 : 0);
    if (start > end) invalid();
  }
  if (end - start >= 128 && bytes.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128;
  if (end - start >= 32 && bytes.toString('latin1', end - 32, end - 24) === 'APETAGEX') {
    const total = bytes.readUInt32LE(end - 20) + ((bytes.readUInt32LE(end - 12) & 0x80000000) ? 32 : 0);
    if (total < 32 || total > end - start) invalid();
    end -= total;
  }
  let offset = start, samples = 0; let first: Mp3Frame | undefined;
  while (offset < end) {
    const frame = mp3Frame(bytes.subarray(0, end), offset);
    if (!frame || (first && (frame.version !== first.version || frame.sampleRate !== first.sampleRate))) invalid();
    first ??= frame;
    if (offset + frame.length > end) break;
    offset += frame.length; samples += frame.samples;
  }
  if (!first || samples === 0) invalid();
  return { bytes: Buffer.from(bytes.subarray(start, offset)), durationSeconds: boundedDuration(samples / first.sampleRate) };
}

// Counted lengths include encoder delay/padding that players trim, so allow half a second before calling it too long.
function boundedDuration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) invalid();
  const rounded = Math.round(seconds * 100) / 100;
  if (rounded > 30.5) throw new CollectibleProjectError('COLLECTIBLE_MEDIA_TOO_LARGE');
  return Math.max(0.1, Math.min(30, rounded));
}

const oggCrcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index << 24;
  for (let bit = 0; bit < 8; bit++) value = (value & 0x80000000) ? ((value << 1) ^ 0x04c11db7) : (value << 1);
  return value >>> 0;
});
function oggChecksum(page: Buffer): number {
  let crc = 0;
  for (let index = 0; index < page.length; index++) {
    const byte = index >= 22 && index < 26 ? 0 : page[index]!; // the checksum field itself counts as zero
    crc = ((crc << 8) ^ oggCrcTable[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc;
}
function oggPage(header: Buffer, body: Buffer): Buffer {
  const page = Buffer.concat([header.subarray(0, 26), Buffer.from([1, body.length]), body]);
  page.writeUInt32LE(oggChecksum(page), 22); return page;
}

// Ogg Opus as produced by browser recorders: one logical stream of CRC-checked pages with consecutive sequence numbers,
// OpusHead alone on the first (BOS) page and OpusTags alone on the second. Any other byte, a second stream or a chained stream
// is rejected. OpusTags is replaced by an empty one (no vendor, no comments) and the length comes from the last granule position.
export function normalizeOggOpus(bytes: Buffer): { bytes: Buffer; durationSeconds: number } {
  const pages: { start: number; end: number; flags: number; granule: bigint; serial: number; sequence: number; lacing: Buffer; body: Buffer }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 27 > bytes.length || bytes.toString('latin1', offset, offset + 4) !== 'OggS' || bytes[offset + 4] !== 0) invalid();
    const lacing = bytes.subarray(offset + 27, offset + 27 + bytes[offset + 26]!);
    const bodyStart = offset + 27 + lacing.length; const end = bodyStart + lacing.reduce((sum, value) => sum + value, 0);
    if (lacing.length !== bytes[offset + 26] || end > bytes.length) invalid();
    const page = bytes.subarray(offset, end);
    if (page.readUInt32LE(22) !== oggChecksum(page)) invalid();
    pages.push({ start: offset, end, flags: bytes[offset + 5]!, granule: bytes.readBigInt64LE(offset + 6), serial: bytes.readUInt32LE(offset + 14),
      sequence: bytes.readUInt32LE(offset + 18), lacing, body: bytes.subarray(bodyStart, end) });
    offset = end;
  }
  const [head, tags] = pages;
  if (!head || !tags || pages.length < 3) invalid();
  const single = (page: typeof head) => page.lacing.length > 0 && page.lacing.subarray(0, -1).every(value => value === 255) && page.lacing.at(-1)! < 255;
  if (!(head.flags & 0x02) || !single(head) || head.body.length < 19 || head.body.toString('latin1', 0, 8) !== 'OpusHead' || head.body[8]! > 15 || head.body[9] === 0) invalid();
  if (!single(tags) || (tags.flags & 0x01) || tags.body.toString('latin1', 0, 8) !== 'OpusTags') invalid();
  pages.forEach((page, index) => { if (page.serial !== head.serial || page.sequence !== index || (index > 0 && (page.flags & 0x02))) invalid(); });
  const preSkip = head.body.readUInt16LE(10);
  const granules = pages.slice(2).map(page => page.granule).filter(granule => granule >= 0n);
  if (!granules.length) invalid();
  const last = granules.reduce((max, granule) => granule > max ? granule : max, 0n);
  const emptyTags = Buffer.concat([Buffer.from('OpusTags', 'latin1'), Buffer.alloc(8)]);
  const rewritten = oggPage(bytes.subarray(tags.start, tags.start + 26), emptyTags);
  return { bytes: Buffer.concat([bytes.subarray(0, head.end), rewritten, bytes.subarray(tags.end)]),
    durationSeconds: boundedDuration(Number(last - BigInt(preSkip)) / 48000) };
}

function ebmlVint(bytes: Buffer, offset: number, marker: boolean): { value: number; length: number; unknown: boolean } {
  const first = bytes[offset];
  if (first === undefined || first === 0) invalid();
  const length = Math.clz32(first) - 23;
  if (offset + length > bytes.length || (marker && length > 4)) invalid();
  let value = marker ? first : first & (0xff >> length); let allOnes = value === (0xff >> length);
  for (let index = 1; index < length; index++) { value = value * 256 + bytes[offset + index]!; allOnes &&= bytes[offset + index] === 0xff; }
  return { value, length, unknown: !marker && allOnes };
}
const webmSegmentChildren = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0xec]);
// Any segment-level ID (allowed or not) ends an unknown-size cluster; Void (0xEC) may also sit inside a cluster, so it does not.
const webmClusterEnd = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x1941a469, 0x1043a770]);
const webmClusterChildren = new Set([0xe7, 0x5854, 0xa7, 0xab, 0xa3, 0xa0, 0xec, 0xbf]);
const webmInfoChildren = new Set([0x2ad7b1, 0x4489, 0x4d80, 0x5741, 0x73a4, 0x4461, 0xec]);

// WebM Opus as produced by browser recorders. The EBML header must say webm; the Segment may only hold SeekHead, Info, Tracks,
// Cluster, Cues and Void (Tags, Attachments, Chapters are rejected) and Info may not carry a Title. Exactly one A_OPUS track.
// Cluster/Segment may have unknown size (live recording). The length is the latest block time (or Info Duration if longer).
export function inspectWebmOpus(bytes: Buffer): { bytes: Buffer; durationSeconds: number } {
  const element = (offset: number) => {
    const id = ebmlVint(bytes, offset, true); const size = ebmlVint(bytes, offset + id.length, false);
    const start = offset + id.length + size.length;
    if (!size.unknown && start + size.value > bytes.length) invalid();
    return { id: id.value, start, end: size.unknown ? bytes.length : start + size.value, unknown: size.unknown };
  };
  const children = (start: number, end: number, stopAt?: Set<number>) => {
    const found: ReturnType<typeof element>[] = [];
    for (let offset = start; offset < end;) {
      const child = element(offset);
      if (stopAt?.has(child.id)) break;
      found.push(child); offset = child.unknown ? end : child.end;
    }
    return found;
  };
  const readUint = (item: ReturnType<typeof element>) => {
    if (item.end - item.start > 6) invalid(); let value = 0;
    for (let index = item.start; index < item.end; index++) value = value * 256 + bytes[index]!;
    return value;
  };
  const header = element(0);
  if (header.id !== 0x1a45dfa3 || header.unknown) invalid();
  const docType = children(header.start, header.end).find(item => item.id === 0x4282);
  if (!docType || bytes.toString('latin1', docType.start, docType.end).replace(/\0+$/, '') !== 'webm') invalid();
  const segment = element(header.end);
  if (segment.id !== 0x18538067 || segment.end !== bytes.length) invalid();
  let scale = 1_000_000, infoDuration = 0, maxBlock = 0, opusTracks = 0, tracks = 0;
  const top: ReturnType<typeof element>[] = [];
  for (let offset = segment.start; offset < segment.end;) {
    const child = element(offset);
    if (!webmSegmentChildren.has(child.id)) invalid();
    if (child.id === 0x1f43b675 && child.unknown) {
      // An unknown-size cluster ends where the next segment-level element starts.
      const inner = children(child.start, segment.end, webmClusterEnd);
      const end = inner.length ? inner.at(-1)!.end : child.start;
      top.push({ ...child, end, unknown: false }); offset = end; continue;
    }
    if (child.unknown) invalid();
    top.push(child); offset = child.end;
  }
  for (const item of top) {
    if (item.id === 0x1549a966) {
      for (const field of children(item.start, item.end)) {
        if (!webmInfoChildren.has(field.id)) invalid();
        if (field.id === 0x2ad7b1) scale = readUint(field);
        if (field.id === 0x4489) infoDuration = field.end - field.start === 4 ? bytes.readFloatBE(field.start) : field.end - field.start === 8 ? bytes.readDoubleBE(field.start) : invalid();
      }
    } else if (item.id === 0x1654ae6b) {
      for (const entry of children(item.start, item.end)) {
        if (entry.id !== 0xae) continue;
        tracks++;
        const codec = children(entry.start, entry.end).find(field => field.id === 0x86);
        if (codec && bytes.toString('latin1', codec.start, codec.end) === 'A_OPUS') opusTracks++;
      }
    } else if (item.id === 0x1f43b675) {
      let base = 0;
      for (const field of children(item.start, item.end)) {
        if (!webmClusterChildren.has(field.id)) invalid();
        if (field.id === 0xe7) base = readUint(field);
        const block = field.id === 0xa3 ? field : field.id === 0xa0 ? children(field.start, field.end).find(inner => inner.id === 0xa1) : undefined;
        if (!block) continue;
        const track = ebmlVint(bytes, block.start, false);
        if (block.start + track.length + 3 > block.end) invalid();
        maxBlock = Math.max(maxBlock, base + bytes.readInt16BE(block.start + track.length));
      }
    }
  }
  if (tracks !== 1 || opusTracks !== 1 || scale <= 0) invalid();
  return { bytes, durationSeconds: boundedDuration((Math.max(maxBlock, infoDuration) * scale) / 1e9 || 0.1) };
}

export function collectibleSnapshot(project: CollectibleProject, projectId: string, publicationId: string, gradeId: string): CollectibleDetail {
  const grade = project.grades.find(g => g.id === gradeId && g.enabled);
  const asset = project.derived[gradeId];
  if (!grade || !asset) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
  const safeAsset = {
    imageDataUrl: stripImageMetadata(asset.imageDataUrl), thumbnailDataUrl: stripImageMetadata(asset.thumbnailDataUrl),
    ...(asset.baseDataUrl ? {baseDataUrl:stripImageMetadata(asset.baseDataUrl)} : {}),
    ...(asset.effectMasks ? {effectMasks:Object.fromEntries(Object.entries(asset.effectMasks).map(([key,url])=>[key,stripImageMetadata(url)]))} : {}),
    ...(asset.backImageDataUrl ? { backImageDataUrl: stripImageMetadata(asset.backImageDataUrl) } : {}),
    ...(asset.angleFrames ? { angleFrames: { ...asset.angleFrames, dataUrl: stripImageMetadata(asset.angleFrames.dataUrl) } } : {}),
    ...(asset.living ? { living: { ...asset.living, dataUrl: stripImageMetadata(asset.living.dataUrl) } } : {}),
  };
  const story = { type: project.story.type, cartoon: 0, strength: project.story.strength,
    frames: project.story.type==='none' ? [] : project.story.frames.map(frame => {
      if(!frame.previewDataUrl) throw new CollectibleProjectError('COLLECTIBLE_NOT_READY');
      const mime = frame.previewDataUrl.slice(5,frame.previewDataUrl.indexOf(';'));
      const dimensions=imageDimensions(Buffer.from(frame.previewDataUrl.split(',')[1]!,'base64'),mime)!;
      return {dataUrl:stripImageMetadata(frame.previewDataUrl),...dimensions};
    }),
  };
  // motions는 이 등급에 걸린 전체 모션(재생 방식·파티클 포함), animation은 v1 Android가 아는 8종뿐인 "첫 loop 모션(없으면 still)".
  const gradeMotions = project.motion.filter(m => m.gradeIds.includes(gradeId));
  return {
    projectId, publicationId, gradeId, gradeName: grade.name, name: project.name, shape: project.shape,
    theme: { name: project.theme.name }, ...safeAsset, thickness: project.thickness, angle: project.angle,
    ...(project.rotationSpeed !== undefined ? { rotationSpeed: project.rotationSpeed } : {}),
    animation: gradeMotions.find(m => (m.playback ?? 'loop') === 'loop')?.type ?? 'still',
    motions: gradeMotions.map(({ type, playback, particle }) => ({ type, playback: playback ?? 'loop', ...(particle !== undefined ? { particle } : {}) })),
    greeting: resolveGreeting(project, gradeId),
    audio: structuredClone(project.audio), story,
    effects: project.effects.filter(effect => effect.gradeIds.includes(gradeId)).map(({type,target,strength,color,roughness,speed}) => ({type,target,strength,color,roughness, ...(speed !== undefined ? { speed } : {})})),
  };
}
// model.mjs resolveGreeting과 값이 같아야 하며(등급+테마 > 등급 > 테마 > 기본, 동점은 배열 순서), 같은 vectors 픽스처로 함께 시험한다.
export function resolveGreeting(project: CollectibleProject, gradeId: string): string {
  const themeName = project.theme.name;
  let best: CollectibleProject['greetingOverrides'][number] | undefined; let bestScore = -1;
  for (const override of project.greetingOverrides) {
    const gradeMatch = override.gradeIds.length === 0 || override.gradeIds.includes(gradeId);
    const themeMatch = override.themeName === '' || override.themeName === themeName;
    if (!gradeMatch || !themeMatch) continue;
    const score = (override.gradeIds.length > 0 ? 2 : 0) + (override.themeName !== '' ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = override; }
  }
  return best ? best.text : project.greeting;
}

// SOF0-3, SOF5-7, SOF9-11, SOF13-15, DHT, DAC, SOS, DQT, DRI.
const jpegImageSegments = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf,0xc4,0xcc,0xda,0xdb,0xdd]);

// Reads the Orientation (0x0112) of IFD0 from an APP1 "Exif\0\0" payload; any malformed or missing value returns undefined.
function exifOrientation(payload: Buffer): number | undefined {
  if(payload.length<14 || payload.toString('latin1',0,6)!=='Exif\0\0') return undefined;
  const tiff=payload.subarray(6); const order=tiff.toString('latin1',0,2);
  if(order!=='II' && order!=='MM') return undefined;
  const u16=(at:number)=>order==='II'?tiff.readUInt16LE(at):tiff.readUInt16BE(at);
  const u32=(at:number)=>order==='II'?tiff.readUInt32LE(at):tiff.readUInt32BE(at);
  if(u16(2)!==42) return undefined;
  const ifd=u32(4); if(ifd+2>tiff.length) return undefined;
  const count=u16(ifd);
  for(let index=0;index<count;index++) {
    const entry=ifd+2+index*12; if(entry+12>tiff.length) return undefined;
    if(u16(entry)===0x0112 && u16(entry+2)===3) return u16(entry+8);
  }
  return undefined;
}

// Metadata can identify a camera, photographer or location even when the pixels are a final cropped export.
// Keep the lossless encoded image chunks and remove metadata before placing media in a customer snapshot.
export function stripImageMetadata(dataUrl: string): string {
  const comma=dataUrl.indexOf(','); const mime=dataUrl.slice(5,dataUrl.indexOf(';'));
  const bytes=Buffer.from(dataUrl.slice(comma+1),'base64'); const parts: Buffer[]=[];
  if(mime==='image/png') {
    parts.push(bytes.subarray(0,8)); let offset=8;
    while(offset+12<=bytes.length) {
      const length=bytes.readUInt32BE(offset); const end=offset+length+12; if(end>bytes.length) invalid();
      const type=bytes.subarray(offset+4,offset+8).toString();
      if(['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type)) parts.push(bytes.subarray(offset,end));
      offset=end; if(type==='IEND') break;
    }
  } else if(mime==='image/jpeg') {
    parts.push(bytes.subarray(0,2)); let offset=2; let orientation=1; let jfif: Buffer | undefined;
    while(offset<bytes.length) {
      const start=offset; if(bytes[offset++]!==255) invalid(); while(bytes[offset]===255) offset++;
      const marker=bytes[offset++]; if(marker===undefined) invalid();
      if(marker===0xd9) { parts.push(bytes.subarray(start,offset)); break; }
      if(marker>=0xd0 && marker<=0xd7) {parts.push(bytes.subarray(start,offset));continue;}
      if(marker===0x01) continue;
      if(offset+2>bytes.length) invalid(); const length=bytes.readUInt16BE(offset); const end=offset+length;
      if(length<2 || end>bytes.length) invalid();
      const payload=bytes.subarray(offset+2,end);
      if(marker===0xe1) orientation=exifOrientation(payload) ?? orientation;
      // JFIF APP0 keeps only version, units and density; its embedded thumbnail (a second picture) is dropped.
      if(marker===0xe0 && !jfif && payload.length>=12 && payload.toString('latin1',0,5)==='JFIF\0') {
        jfif=Buffer.concat([Buffer.from([0xff,0xe0,0,16]),payload.subarray(0,12),Buffer.from([0,0])]);
      }
      // Allow list: frame (SOFn), Huffman/arithmetic/quantization tables, restart interval and scans. Every APPn, COM, DNL,
      // extension and reserved segment is dropped.
      if(jpegImageSegments.has(marker)) parts.push(bytes.subarray(start,end));
      offset=end;
      if(marker===0xda) {
        // Keep stuffed entropy bytes and restart markers; return to segment parsing between progressive scans.
        const scanStart=offset;
        while(offset<bytes.length) {
          if(bytes[offset]!==255) {offset++;continue;}
          const next=bytes[offset+1];
          if(next===0 || (next!==undefined&&next>=0xd0&&next<=0xd7)) {offset+=2;continue;}
          if(next===255) {offset++;continue;}
          break;
        }
        parts.push(bytes.subarray(scanStart,offset));
      }
    }
    // Browsers rotate photos by the EXIF Orientation tag, and the saved width/height follow that rotation. Keep only that tag.
    if(orientation>=2&&orientation<=8) parts.splice(1,0,Buffer.from([0xff,0xe1,0,34,...Buffer.from('Exif\0\0','latin1'),
      0x4d,0x4d,0,0x2a,0,0,0,8, 0,1, 0x01,0x12,0,3,0,0,0,1,0,orientation,0,0, 0,0,0,0]));
    if(jfif) parts.splice(1,0,jfif);
  } else if(mime==='image/webp') {
    let offset=12;
    while(offset+8<=bytes.length) {
      const length=bytes.readUInt32LE(offset+4); const end=offset+8+length+(length%2); if(end>bytes.length) invalid();
      const type=bytes.subarray(offset,offset+4).toString();
      // Allow list: only image data chunks survive (EXIF, XMP, ICC profile and unknown chunks are dropped).
      if(['VP8X','VP8 ','VP8L','ALPH'].includes(type)) {
        const chunk=Buffer.from(bytes.subarray(offset,end)); if(type==='VP8X'&&chunk.length>8) chunk[8]=chunk[8]!&~(0x20|0x08|0x04); parts.push(chunk);
      }
      offset=end;
    }
    const header=Buffer.from(bytes.subarray(0,12)); header.writeUInt32LE(4+parts.reduce((n,p)=>n+p.length,0),4); parts.unshift(header);
  } else invalid();
  return `data:${mime};base64,${Buffer.concat(parts).toString('base64')}`;
}
