import {
  shapePoints, cropTransform, effectsForGrade, cloneProject, resolveSticker, stickerLines, stickerLineOffsets, particleAt, ONCE_MS,
  strokeAlpha, parallaxOffset, livingPhaseAt, livingFrameAt, livingSpriteCount, livingSpriteGrid, livingBoundingBox, angleFrameIndex, MASCOT_BLINK,
} from './collectible-model.mjs';

// Originals and editing instructions stay separate. Preview buffers are bounded
// and never become the source for a later edit or a published version.
const imageCache = new Map();
const photoCache = new Map();
const resizedSourceCache = new Map();
let currentPhotoSource = '';
let photoGeneration = 0;
const boundedSet = (cache, key, value, max) => {
  cache.set(key, value);
  while (cache.size > max) cache.delete(cache.keys().next().value);
  return value;
};
// 패럴랙스 전경 마스크는 획 키(JSON)로만 바뀌므로 "마스크는 획 키로 캐시한다"(설계 문서) 그대로 한 장만 보관한다.
// PR #310 리뷰(nit): 패럴랙스 획과 living 항목마다의 합성 획(서로 다른 strokes 배열)이 한 슬롯을 같이 쓰면
// 매번 서로를 밀어내 캐시가 전혀 안 맞는다(각도 프레임 12칸마다 다시 만듦). 획 배열+크기로 키를 잡은 Map으로 바꾼다.
const strokeMaskCache = new Map();
export function clearCollectibleRenderCache() { imageCache.clear(); photoCache.clear(); resizedSourceCache.clear(); currentPhotoSource = ''; photoGeneration++; strokeMaskCache.clear(); }

async function imageFor(source) {
  if (!source) return null;
  if (imageCache.has(source)) return imageCache.get(source);
  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { imageCache.delete(source); reject(new Error('사진을 읽지 못했어요. 다른 사진으로 다시 시도해 주세요.')); };
    image.src = source;
  });
  return boundedSet(imageCache, source, pending, 12);
}
function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
export function traceShape(context, shape, width, height, offsetX = 0, offsetY = 0) {
  const points = shapePoints(shape, width, height);
  context.beginPath();
  points.forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](point.x + offsetX, point.y + offsetY));
  context.closePath();
}
const clamp = (value, min = 0, max = 255) => Math.min(max, Math.max(min, value));
const rgb = hex => /^#[0-9a-f]{6}$/i.test(hex || '') ? [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) : [199, 151, 78];

/** Pure deterministic pixel operation, shared by preview and final export. */
export function processPhotoPixels(input, width, height, edits = {}, style = 'original', color = '#c7974e', photoColor = 100, relief = 45) {
  const source = new Uint8ClampedArray(input);
  const result = new Uint8ClampedArray(input);
  const base = rgb(color);
  const brightness = (edits.brightness || 0) * 2.55;
  const contrast = 1 + (edits.contrast || 0) / 100;
  const quantize = 1 + Math.round((edits.merge || 0) / 100 * 55);
  const cartoon = (edits.cartoon || 0) / 100;
  const simplify = Math.round((edits.simplify || 0) / 100 * 3);
  const sample = (x, y, channel) => source[(clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)) * 4 + channel];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const lum = channel => (sample(x, y, channel) + sample(x + simplify, y, channel) + sample(x, y + simplify, channel)) / 3;
      const edge = Math.abs(sample(x - 1, y - 1, 0) - sample(x + 1, y + 1, 0)) / 255;
      const reliefSign = style === 'incised' ? -1 : 1;
      const ridge = ((sample(x - 1, y - 1, 0) + sample(x - 1, y - 1, 1) + sample(x - 1, y - 1, 2)) - (sample(x + 1, y + 1, 0) + sample(x + 1, y + 1, 1) + sample(x + 1, y + 1, 2))) / 3;
      const grey = (sample(x, y, 0) * .299 + sample(x, y, 1) * .587 + sample(x, y, 2) * .114) / 255;
      for (let channel = 0; channel < 3; channel++) {
        let value = clamp((lum(channel) - 128) * contrast + 128 + brightness);
        value = Math.round(value / quantize) * quantize;
        if (cartoon) value = value * (1 - cartoon) + Math.round(value / 48) * 48 * cartoon - edge * 95 * cartoon;
        if (style !== 'original') {
          const metal = base[channel] * (.52 + grey * .58) + reliefSign * ridge * relief / 45;
          value = metal * (1 - photoColor / 100) + value * photoColor / 100;
          // Opposite directional highlights distinguish raised and incised relief
          // even when the merchant keeps some original photographic color.
          value += reliefSign * ridge * relief / 85;
        }
        result[index + channel] = clamp(value);
      }
    }
  }
  for (const stroke of edits.strokes || []) {
    const radius = Math.max(1, (stroke.size || .04) * Math.min(width, height) / 2);
    const paint = rgb(stroke.color);
    const points = stroke.points || [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const first = points[Math.max(0, pointIndex - 1)], last = points[pointIndex];
      const distance = Math.hypot((last.x - first.x) * width, (last.y - first.y) * height);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
      for (let step = 0; step <= steps; step++) {
        const cx = (first.x + (last.x - first.x) * step / steps) * width;
        const cy = (first.y + (last.y - first.y) * step / steps) * height;
        const sx = clamp(Math.round(cx + radius * 2), 0, width - 1), sy = clamp(Math.round(cy), 0, height - 1);
        const neighbor = (sy * width + sx) * 4;
        for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(height - 1, Math.ceil(cy + radius)); y++) {
          for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(width - 1, Math.ceil(cx + radius)); x++) {
            if (Math.hypot(x - cx, y - cy) > radius) continue;
            const index = (y * width + x) * 4;
            if (stroke.tool === 'erase') result[index + 3] = 0;
            else if (stroke.tool === 'restore') for (let channel = 0; channel < 4; channel++) result[index + channel] = source[index + channel];
            else if (stroke.tool === 'color') for (let channel = 0; channel < 3; channel++) result[index + channel] = paint[channel];
            else if (stroke.tool === 'clean') for (let channel = 0; channel < 3; channel++) result[index + channel] = result[index + channel] * .2 + source[neighbor + channel] * .8;
          }
        }
      }
    }
  }
  return result;
}

async function photoFor(project, max = 960, style = project.style) {
  const source = project.photo?.originalDataUrl;
  if (!source) return null;
  const edits = structuredClone(project.photoEdits), color = project.baseColor, photoColor = project.photoColor, relief = project.relief;
  if (source !== currentPhotoSource) { currentPhotoSource = source; photoCache.clear(); photoGeneration++; }
  // Avoid serializing megabytes of unchanged original image bytes on every frame.
  const key = JSON.stringify([photoGeneration, edits, style, color, photoColor, relief, max]);
  if (photoCache.has(key)) return photoCache.get(key);
  // Decode one bounded editing buffer per original rather than retaining a full
  // multi-megapixel texture for every undo state. Original file bytes stay private.
  let pending = resizedSourceCache.get(source);
  if (!pending) {
    pending = (async () => {
      const ratio = Math.min(1, 960 / Math.max(project.photo.width, project.photo.height));
      const resized = canvasOf(project.photo.width * ratio, project.photo.height * ratio);
      if (globalThis.createImageBitmap) {
        const match = source.match(/^data:([^;]+);base64,(.+)$/);
        const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }), { resizeWidth: resized.width, resizeHeight: resized.height, resizeQuality: 'high' });
        resized.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
      } else {
        const image = await imageFor(source); resized.getContext('2d').drawImage(image, 0, 0, resized.width, resized.height); imageCache.delete(source);
      }
      return resized;
    })();
    boundedSet(resizedSourceCache, source, pending, 1);
  }
  let resized;
  try { resized = await pending; } catch (error) { resizedSourceCache.delete(source); throw error; }
  const ratio = Math.min(1, max / Math.max(resized.width, resized.height));
  const canvas = canvasOf(resized.width * ratio, resized.height * ratio);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(resized, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(processPhotoPixels(pixels.data, canvas.width, canvas.height, edits, style, color, photoColor, relief));
  context.putImageData(pixels, 0, 0);
  return boundedSet(photoCache, key, canvas, 3);
}
function checkerboard(context, size) {
  const step = size / 16;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    context.fillStyle = (x + y) % 2 ? '#d8dce2' : '#f3f4f6'; context.fillRect(x * step, y * step, step + 1, step + 1);
  }
}
export async function renderCrop(canvas, project) {
  project = cloneProject(project);
  const size = canvas.width;
  const context = canvas.getContext('2d');
  const photo = await photoFor(project, 700, 'original');
  context.clearRect(0, 0, size, canvas.height);
  checkerboard(context, size);
  if (photo) {
    const box = cropTransform(project, size, canvas.height);
    context.drawImage(photo, box.x, box.y, box.width, box.height);
  }
  // Even-odd fill keeps the inside clear while darkening only the exterior.
  context.beginPath(); context.rect(0, 0, size, canvas.height);
  const points = shapePoints(project.shape, size, canvas.height);
  points.forEach((point, index) => context[index ? 'lineTo' : 'moveTo'](point.x, point.y));
  context.closePath(); context.fillStyle = 'rgba(10,20,35,.65)'; context.fill('evenodd');
  traceShape(context, project.shape, size, canvas.height);
  context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke();
  traceShape(context, project.shape, size * .7, size * .7, size * .15, size * .15);
  context.strokeStyle = 'rgba(255,255,255,.7)'; context.setLineDash([5, 5]); context.lineWidth = 1; context.stroke(); context.setLineDash([]);
}

function effectPaint(context, effect, size, angle, time = 0, shape = 'circle') {
  const strength = (effect.strength ?? 45) / 100;
  context.save();
  if (effect.type === 'glow') {
    context.shadowColor = effect.color || '#f1d391'; context.shadowBlur = size * .05 * strength;
    context.strokeStyle = effect.color || '#fff2b3'; context.globalAlpha = strength;
    context.lineWidth = size * .025; traceShape(context, shape, size * .96, size * .96, size * .02, size * .02); context.stroke();
  } else if (effect.type === 'matte') {
    context.fillStyle = '#ddd4c4'; context.globalCompositeOperation = 'soft-light'; context.globalAlpha = strength * .6; context.fillRect(0, 0, size, size);
  } else if (effect.type === 'enamel') {
    context.fillStyle = effect.color || '#e4b954'; context.globalCompositeOperation = 'overlay'; context.globalAlpha = strength * .45; context.fillRect(0, 0, size, size);
    const gloss = context.createLinearGradient(0, 0, size, size);
    gloss.addColorStop(0, 'rgba(255,255,255,.8)'); gloss.addColorStop(.32, 'rgba(255,255,255,0)'); gloss.addColorStop(1, 'rgba(0,0,0,.2)');
    context.globalCompositeOperation = 'screen'; context.fillStyle = gloss; context.globalAlpha = strength; context.fillRect(0, 0, size, size);
  } else if (effect.type === 'glass') {
    context.globalCompositeOperation = 'destination-in'; context.globalAlpha = 1 - strength * .45; context.fillStyle = '#fff'; context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = 'source-atop'; context.globalAlpha = strength * .7; context.fillStyle = '#dcefff'; context.fillRect(0, 0, size, size);
  } else {
    const phase = angle / 180 + time / 6000;
    const shift = Math.sin(phase * Math.PI) * size * .55;
    const gradient = context.createLinearGradient(-size * .3 + shift, 0, size * 1.3 + shift, size);
    if (effect.type === 'hologram') {
      ['#ad76ff', '#48e5ce', '#ffc85e', '#ed91ee', '#4dd5ef'].forEach((color, index) => gradient.addColorStop(index / 4, color));
      context.globalCompositeOperation = 'color'; context.globalAlpha = strength * .8;
    } else if (effect.type === 'pearl') {
      gradient.addColorStop(0, '#e2c8e7'); gradient.addColorStop(.5, '#f8faf6'); gradient.addColorStop(1, '#b9dfda');
      context.globalCompositeOperation = 'screen'; context.globalAlpha = strength * .4;
    } else {
      gradient.addColorStop(0, '#262220'); gradient.addColorStop(.36, effect.color || '#e0c07c'); gradient.addColorStop(.48, '#fff'); gradient.addColorStop(.6, effect.color || '#bc9351'); gradient.addColorStop(1, '#55462e');
      context.globalCompositeOperation = 'soft-light'; context.globalAlpha = strength * (1 - (effect.roughness || 0) / 150);
    }
    context.fillStyle = gradient; context.fillRect(0, 0, size, size);
  }
  context.restore();
}
async function stickerLayer(sticker, size, effects, angle, time) {
  const layer = canvasOf(size, size), context = layer.getContext('2d');
  context.translate(sticker.x * size, sticker.y * size); context.rotate((sticker.rotation || 0) * Math.PI / 180);
  if (effects.some(effect => effect.type === 'glow')) { context.shadowColor = effects.find(effect => effect.type === 'glow').color || '#fff'; context.shadowBlur = size * .025; }
  if (sticker.kind === 'mascot') {
    const image = await imageFor(`/app/assets/mascot/${sticker.text}.png`);
    const dimension = Math.max(16, (sticker.size || 42) * size / 512) * 2;
    if (image) context.drawImage(image, -dimension / 2, -dimension / 2, dimension, dimension);
  } else {
    const fontSize = Math.max(8, (sticker.size || 42) * size / 512);
    context.font = `700 ${fontSize}px system-ui, sans-serif`;
    context.textAlign = sticker.align || 'center'; context.textBaseline = 'middle'; context.fillStyle = sticker.color || '#fff';
    const lines = stickerLines(sticker.text);
    const offsets = stickerLineOffsets(lines.length);
    lines.forEach((line, index) => context.fillText(line, 0, offsets[index] * fontSize, size * .9));
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  for (const effect of effects.filter(effect => effect.type !== 'glow')) {
    const painted = canvasOf(size, size), paint = painted.getContext('2d');
    paint.drawImage(layer, 0, 0); effectPaint(paint, effect, size, angle, time);
    paint.globalCompositeOperation = 'destination-in'; paint.drawImage(layer, 0, 0);
    context.clearRect(0, 0, size, size); context.drawImage(painted, 0, 0);
  }
  return layer;
}

/** project.parallax.strokes의 전경(1)/배경(0) 마스크 캔버스. 획이 바뀌지 않으면 다시 만들지 않는다. */
/**
 * strokes(사진 0..1 좌표)로 width×height 마스크 캔버스를 만든다. 호출부가 "사진 고유 치수"(photo.width/height)를
 * 넘겨야 한다 — 출력 캔버스 크기(size)를 넘기면 정사각이 아니거나 확대·이동된 사진에서 칠한 자리와 실제로
 * 움직이는 자리가 어긋난다(PR #310 리뷰 P2: cropTransform과 같은 변환으로 출력에 얹어야 한다).
 */
function strokeMaskFor(strokes, width, height) {
  const key = `${width}x${height}:${JSON.stringify(strokes)}`;
  const cached = strokeMaskCache.get(key); if (cached) return cached;
  const alpha = strokeAlpha(strokes, width, height);
  const canvas = canvasOf(width, height), context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let index = 0; index < alpha.length; index++) {
    image.data[index * 4] = image.data[index * 4 + 1] = image.data[index * 4 + 2] = 255;
    image.data[index * 4 + 3] = alpha[index];
  }
  context.putImageData(image, 0, 0);
  return boundedSet(strokeMaskCache, key, canvas, 24);
}

/**
 * living 항목(sway/bob/steam/blink) 하나를 size×size 캔버스(그 외는 투명) 위에 phase(0..1) 시점으로 그린다.
 * region 대상은 (사진 ∩ 획 마스크)를 변형한 사본을, 스티커 대상은 그 스티커 레이어를 변형해 다시 그린다.
 * 각도는 항상 0(게시 스프라이트·정지 포즈 기준, ponytail: 패럴랙스는 living 오버레이에 적용하지 않는다 — 알려진
 * 한계, 설계 문서 "위험" 항목). amplitude는 sway 6°, bob 3% 상한.
 */
async function paintLivingItem(context, project, item, gradeId, size, phase, photo) {
  const amplitude = Math.max(0, Math.min(100, item.amplitude ?? 0)) / 100;
  const pivot = { x: (item.pivot?.x ?? .5) * size, y: (item.pivot?.y ?? .5) * size };
  const wave = Math.sin(phase * Math.PI * 2);
  if (item.target === 'region') {
    if (!photo) return;
    const photoLayer = canvasOf(size, size), photoContext = photoLayer.getContext('2d');
    const transform = cropTransform(project, size, size);
    photoContext.drawImage(photo, transform.x, transform.y, transform.width, transform.height);
    // 패럴랙스와 같은 이유로 마스크는 사진 고유 치수에서 만들고 같은 cropTransform으로 얹는다(PR #310 리뷰 P2).
    const mask = strokeMaskFor([{ tool: 'fg', size: .1, points: item.strokes ?? [] }], photo.width, photo.height);
    photoContext.globalCompositeOperation = 'destination-in'; photoContext.drawImage(mask, transform.x, transform.y, transform.width, transform.height); photoContext.globalCompositeOperation = 'source-over';
    if (item.kind === 'steam') {
      context.save(); context.globalAlpha = .35 * (1 - phase);
      for (let puff = 0; puff < 3; puff++) {
        const puffPhase = (phase + puff / 3) % 1;
        context.beginPath(); context.fillStyle = '#f4f6fa';
        context.arc(pivot.x, pivot.y - puffPhase * size * .22, size * .03 * (1 - puffPhase * .5), 0, Math.PI * 2); context.fill();
      }
      context.restore();
      context.drawImage(photoLayer, 0, 0);
      return;
    }
    context.save();
    context.translate(pivot.x, pivot.y);
    if (item.kind === 'sway') context.rotate(wave * amplitude * 6 * Math.PI / 180);
    if (item.kind === 'bob') context.translate(0, wave * amplitude * .03 * size);
    context.translate(-pivot.x, -pivot.y);
    context.drawImage(photoLayer, 0, 0);
    context.restore();
    return;
  }
  const sticker = project.stickers.find((candidate) => candidate.id === item.target);
  if (!sticker) return;
  const resolved = resolveSticker(sticker, gradeId);
  const blinking = item.kind === 'blink' && (phase * (project.living?.periodMs ?? 2400)) % (project.living?.periodMs ?? 2400) < 160;
  const pose = blinking && resolved.kind === 'mascot' && MASCOT_BLINK.includes(resolved.text) ? { ...resolved, text: `${resolved.text}-blink` } : resolved;
  const layer = await stickerLayer(pose, size, [], 0, 0);
  context.save();
  const anchor = { x: resolved.x * size, y: resolved.y * size };
  context.translate(anchor.x, anchor.y);
  if (item.kind === 'sway') context.rotate(wave * amplitude * 6 * Math.PI / 180);
  if (item.kind === 'bob') context.translate(0, wave * amplitude * .03 * size);
  context.translate(-anchor.x, -anchor.y);
  context.drawImage(layer, 0, 0);
  context.restore();
}

/** 이 등급의 living 항목을 전부 phase 시점으로 합성한 size×size 투명 오버레이. 항목이 없으면 null. */
export async function livingOverlayFor(project, gradeId, size, phase) {
  const items = (project.living?.items ?? []).filter((item) => item.gradeIds?.includes(gradeId));
  if (!items.length) return null;
  const canvas = canvasOf(size, size), context = canvas.getContext('2d');
  const photo = await photoFor(project);
  for (const item of items) await paintLivingItem(context, project, item, gradeId, size, phase, photo);
  return canvas;
}

async function frontFor(project, gradeId, size, angle, time, applyEffects = true, excludeStickerIds) {
  const exclude = excludeStickerIds ?? new Set();
  const canvas = canvasOf(size, size), context = canvas.getContext('2d');
  traceShape(context, project.shape, size, size); context.clip();
  context.fillStyle = project.baseColor || '#c7974e'; context.fillRect(0, 0, size, size);
  const photo = await photoFor(project);
  const parallaxStrength = Math.max(0, Math.min(100, project.parallax?.strength ?? 0));
  const parallaxStrokes = project.parallax?.strokes ?? [];
  const hasParallax = applyEffects && parallaxStrength > 0 && parallaxStrokes.length > 0;
  // 배경은 -s/2, 전경은 +s, 스티커는 +1.2s로 벌어진다(설계 문서 "패럴랙스" 항목). strength 0이거나 획이 없으면 s=0.
  const s = hasParallax ? parallaxOffset(angle, parallaxStrength, size) : 0;
  if (photo) {
    const photoLayer = canvasOf(size, size), photoContext = photoLayer.getContext('2d');
    const transform = cropTransform(project, size, size);
    photoContext.drawImage(photo, transform.x, transform.y, transform.width, transform.height);
    if (applyEffects) {
      const photoMask = canvasOf(size, size); photoMask.getContext('2d').drawImage(photoLayer, 0, 0);
      for (const effect of effectsForGrade(project, gradeId, 'photo')) effectPaint(photoContext, effect, size, angle, time, project.shape);
      photoContext.globalCompositeOperation = 'destination-in'; photoContext.drawImage(photoMask, 0, 0); photoContext.globalCompositeOperation = 'source-over';
    }
    if (hasParallax) {
      const bgScale = 1 + .08 * parallaxStrength / 100;
      context.save(); context.translate(size / 2 - s / 2, size / 2); context.scale(bgScale, bgScale); context.translate(-size / 2, -size / 2);
      context.drawImage(photoLayer, 0, 0); context.restore();
      // 마스크는 사진 고유 치수로 만들고, photoLayer를 그릴 때와 같은 cropTransform으로 얹는다(비정사각 사진·확대·
      // 이동에서도 칠한 자리와 실제로 튀어나오는 자리가 일치해야 한다, PR #310 리뷰 P2).
      const mask = strokeMaskFor(parallaxStrokes, photo.width, photo.height);
      const fgLayer = canvasOf(size, size), fgContext = fgLayer.getContext('2d');
      fgContext.drawImage(photoLayer, 0, 0);
      fgContext.globalCompositeOperation = 'destination-in'; fgContext.drawImage(mask, transform.x, transform.y, transform.width, transform.height); fgContext.globalCompositeOperation = 'source-over';
      context.drawImage(fgLayer, s, 0);
    } else {
      context.drawImage(photoLayer, 0, 0);
    }
  }
  if (applyEffects) for (const effect of effectsForGrade(project, gradeId, 'surface')) effectPaint(context, effect, size, angle, time, project.shape);
  for (const sticker of [...(project.stickers || [])].sort((a, b) => a.order - b.order)) {
    if (exclude.has(sticker.id)) continue;
    const layer = await stickerLayer(resolveSticker(sticker, gradeId), size, applyEffects ? effectsForGrade(project, gradeId, sticker.id) : [], angle, time);
    context.drawImage(layer, hasParallax ? s * 1.2 : 0, 0);
  }
  const border = canvasOf(size, size), borderContext = border.getContext('2d');
  traceShape(borderContext, project.shape, size * .97, size * .97, size * .015, size * .015);
  borderContext.strokeStyle = project.baseColor || '#c7974e'; borderContext.lineWidth = size * .055; borderContext.stroke();
  for (const effect of applyEffects ? effectsForGrade(project, gradeId, 'border') : []) {
    const overlay = canvasOf(size, size), overlayContext = overlay.getContext('2d');
    overlayContext.drawImage(border, 0, 0); effectPaint(overlayContext, effect, size, angle, time, project.shape);
    overlayContext.globalCompositeOperation = 'destination-in'; overlayContext.drawImage(border, 0, 0);
    borderContext.clearRect(0, 0, size, size); borderContext.drawImage(overlay, 0, 0);
  }
  context.drawImage(border, 0, 0);
  traceShape(context, project.shape, size * .975, size * .975, size * .0125, size * .0125);
  context.strokeStyle = 'rgba(255,255,255,.55)'; context.lineWidth = size * .006; context.stroke();
  return canvas;
}
/**
 * 뒷면. 기본: 바탕색·안쪽 테두리·가게 이름·수집품 이름·등급·마스코트 도장. 커스텀: 뒷면색 + 뒷면 스티커(효과 없음, 앞면 전용 유지).
 */
export async function backFor(project, gradeId, size, merchantName = '') {
  const canvas = canvasOf(size, size), context = canvas.getContext('2d');
  traceShape(context, project.shape, size, size); context.clip();
  const back = project.back || { mode: 'default', color: project.baseColor, stickers: [] };
  context.fillStyle = back.color || project.baseColor || '#c7974e'; context.fillRect(0, 0, size, size);
  if (back.mode === 'custom') {
    for (const sticker of [...(back.stickers || [])].sort((a, b) => a.order - b.order)) {
      context.drawImage(await stickerLayer(sticker, size, [], 0, 0), 0, 0);
    }
  } else {
    traceShape(context, project.shape, size * .86, size * .86, size * .07, size * .07);
    context.strokeStyle = 'rgba(255,255,255,.55)'; context.lineWidth = size * .012; context.stroke();
    const grade = project.grades.find(item => item.id === gradeId);
    context.textAlign = 'center'; context.fillStyle = '#fff6e6';
    context.font = `700 ${size * .06}px system-ui, sans-serif`; context.fillText(merchantName || '', size / 2, size * .3, size * .7);
    context.font = `700 ${size * .05}px system-ui, sans-serif`; context.fillText(project.name || '', size / 2, size * .42, size * .7);
    context.font = `400 ${size * .04}px system-ui, sans-serif`; context.fillText(grade?.name || '', size / 2, size * .5, size * .7);
    const mascot = await imageFor('/app/assets/mascot/stamp.png');
    if (mascot) context.drawImage(mascot, size * .35, size * .56, size * .3, size * .3);
  }
  const border = canvasOf(size, size), borderContext = border.getContext('2d');
  traceShape(borderContext, project.shape, size * .97, size * .97, size * .015, size * .015);
  borderContext.strokeStyle = back.color || project.baseColor || '#c7974e'; borderContext.lineWidth = size * .055; borderContext.stroke();
  context.drawImage(border, 0, 0);
  return canvas;
}
function drawVolume(canvas, front, project, options = {}) {
  const context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  context.clearRect(0, 0, width, height);
  const motion = options.animation || 'still';
  const playback = options.playback || 'loop';
  // 'once' 재생은 ONCE_MS만큼 진행한 뒤 그 지점에서 멈춘다(무한 반복하지 않음). 경계값에서 modulo가 0으로
  // 되감기지 않게 1ms 여유를 둔다.
  const duration = ONCE_MS[motion];
  const rawTime = options.staticFrame ? 0 : (options.time || 0);
  const time = playback === 'once' && duration ? Math.min(rawTime, duration - 1) : rawTime;
  const manualAngle = options.angle ?? project.angle ?? 0;
  const angle = motion === 'rotate' ? manualAngle + time / 75 : manualAngle;
  const radians = angle * Math.PI / 180;
  let scale = 1, yOffset = 0;
  if (motion === 'float') yOffset = Math.sin(time / 800) * height * .025;
  if (motion === 'stamp') scale = 1 + Math.max(0, 1 - (time % 3500) / 500) * .18;
  if (motion === 'pulse') scale = 1 + Math.sin(time / 900) * .025;
  const size = Math.min(width, height) * .78 * scale;
  const horizontal = Math.max(.025, Math.abs(Math.cos(radians)));
  const depth = Math.abs(Math.sin(radians)) * (project.thickness || 8) * size / 512;
  const grade = String(options.gradeId || project.gradeId || '').toLowerCase();
  const metal = /prism|special/.test(grade) ? ['#6e6e9d', '#eeffff', '#af74d7']
    : /gold/.test(grade) ? ['#76501e', '#ffebaa', '#b47b22']
      : /silver/.test(grade) ? ['#61798c', '#f0f8ff', '#8da7ba']
        : ['#70482f', '#eac09a', '#a76c44'];
  const sideLight = context.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
  sideLight.addColorStop(0, metal[0]); sideLight.addColorStop(.48, metal[1]); sideLight.addColorStop(1, metal[2]);
  context.save(); context.translate(width / 2, height / 2 + yOffset);
  context.shadowColor = 'rgba(12,27,35,.25)'; context.shadowBlur = size * .045; context.shadowOffsetY = size * .045;
  for (let offset = Math.ceil(depth); offset >= 0; offset--) {
    context.save(); context.translate(offset - depth / 2, 0); context.scale(horizontal, 1);
    traceShape(context, project.shape, size, size, -size / 2, -size / 2);
    context.fillStyle = offset % 3 ? sideLight : metal[1]; context.fill(); context.restore();
  }
  context.shadowBlur = 0; context.shadowOffsetY = 0;
  context.translate(-depth / 2, 0); context.scale(horizontal, 1);
  if (Math.cos(radians) < 0) {
    traceShape(context, project.shape, size, size, -size / 2, -size / 2);
    if (options.back) { context.save(); context.clip(); context.drawImage(options.back, -size / 2, -size / 2, size, size); context.restore(); }
    else {
      context.fillStyle = project.baseColor || '#c7974e'; context.fill();
      context.fillStyle = '#39281d'; context.font = `700 ${size * .075}px system-ui`; context.textAlign = 'center'; context.fillText(project.name || '가게 수집품', 0, 0, size * .72);
    }
  } else {
    context.drawImage(front, -size / 2, -size / 2, size, size);
    if (motion === 'shine' || motion === 'sparkle') {
      traceShape(context, project.shape, size, size, -size / 2, -size / 2); context.clip();
      const sweep = ((time % 3500) / 3500) * size * 2 - size;
      const light = context.createLinearGradient(sweep - size * .12, 0, sweep + size * .12, 0);
      light.addColorStop(0, 'rgba(255,255,255,0)'); light.addColorStop(.5, 'rgba(255,255,255,.5)'); light.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = light; context.fillRect(-size / 2, -size / 2, size, size);
    }
  }
  // A narrow lit bevel connects the face art to the volume and follows the same edge material.
  traceShape(context, project.shape, size * .97, size * .97, -size * .485, -size * .485);
  context.strokeStyle = sideLight; context.lineWidth = size * .012; context.stroke();
  traceShape(context, project.shape, size * .94, size * .94, -size * .47, -size * .47);
  context.strokeStyle = 'rgba(255,255,255,.32)'; context.lineWidth = size * .004; context.stroke();
  context.restore();
  const confettiPhase = playback === 'once' ? time : time % 5000;
  if (motion === 'confetti' && confettiPhase < 2000) {
    const phase = confettiPhase / 2000;
    for (let index = 0; index < 20; index++) {
      const point = particleAt(options.particle || 'confetti', index, phase);
      context.fillStyle = point.color;
      context.fillRect(width / 2 + point.x * size, height / 2 + point.y * size, width * .01, width * .016);
    }
  }
}
export async function renderCollectible(canvas, project, gradeId, options = {}) {
  project = cloneProject(project);
  const size = Math.min(options.textureSize || 640, 1024);
  const motion = (project.motion || []).find(item => item.gradeIds.includes(gradeId));
  const animation = options.staticFrame ? 'still' : (options.animation || motion?.type || 'still');
  const playback = options.playback ?? motion?.playback ?? 'loop';
  const particle = options.particle ?? motion?.particle;
  const angle = options.angle ?? project.angle ?? 0;
  // PR #310 리뷰 2차 P2: living이 가져다 쓰는 스티커는 정지 포즈로 frontFor가 또 그리면, 아래서 합성하는
  // living 오버레이와 겹쳐 이중으로 보인다(발행 경로의 angleFramesFor·livingStickerTargets와 같은 규칙).
  let front = await frontFor(project, gradeId, size, angle + (animation === 'rotate' ? (options.time || 0) / 75 : 0), options.time, true, livingStickerTargets(project, gradeId));
  // 편집기 미리보기도 living 항목(sway/bob/steam/blink)을 시간에 맞춰 보여준다(PR #310 리뷰 P2: 전에는 게시된
  // 스프라이트를 뷰어만 그리고 편집 중에는 미리 볼 방법이 없었다). 카드 전체 동작(staticFrame, "지금 재생 중인가")과는
  // 독립적인 시계(livingTime)와 깃발(reducedMotion, "동작 줄이기인가")을 따로 받는다 — 재생 중이 아니어도 living은
  // 계속 움직이고, 동작 줄이기일 때만 정지 포즈(phase 0)로 고정한다.
  const livingOverlay = await livingOverlayFor(project, gradeId, size, options.reducedMotion ? 0 : livingPhaseAt(options.livingTime ?? options.time ?? 0, project.living?.periodMs ?? 2400));
  if (livingOverlay) { const composed = canvasOf(size, size), context = composed.getContext('2d'); context.drawImage(front, 0, 0); context.drawImage(livingOverlay, 0, 0); front = composed; }
  const back = await backFor(project, gradeId, size, options.merchantName || '');
  drawVolume(canvas, front, project, { ...options, gradeId, animation, playback, particle, back });
}
/** angleFrames 스프라이트의 i번째 칸(4×side 그리드)만 잘라낸 side×side 캔버스. */
async function angleFrameCell(angleFrames, index) {
  const sprite = await imageFor(angleFrames.dataUrl); if (!sprite) return null;
  const side = angleFrames.side, cell = canvasOf(side, side);
  cell.getContext('2d').drawImage(sprite, (index % 4) * side, Math.floor(index / 4) * side, side, side, 0, 0, side, side);
  return cell;
}
/** 지금 각도의 가장 가까운 두 칸을 섞은 정면 캔버스. |각도|>90(뒷면)이면 null(뒷면은 backImageDataUrl이 따로 맡는다). */
async function angleFrameFront(angleFrames, angle) {
  const position = angleFrameIndex(angle);
  if (position.back) return null;
  const a = await angleFrameCell(angleFrames, position.index); if (!a) return null;
  if (position.blend <= 0) return a;
  const b = await angleFrameCell(angleFrames, position.next); if (!b) return a;
  const out = canvasOf(angleFrames.side, angleFrames.side), context = out.getContext('2d');
  context.drawImage(a, 0, 0);
  if (position.blend >= 1) { context.clearRect(0, 0, out.width, out.height); context.drawImage(b, 0, 0); return out; }
  context.globalAlpha = position.blend; context.drawImage(b, 0, 0); context.globalAlpha = 1;
  return out;
}
/** living 스프라이트에서 시간 t(ms)에 맞는 한 칸을 잘라낸다(cellWidth×cellHeight). */
async function livingOverlayCell(living, t) {
  const sprite = await imageFor(living.dataUrl); if (!sprite) return null;
  const index = livingFrameAt(t, living.periodMs, living.count);
  const column = index % living.columns, row = Math.floor(index / living.columns);
  const cell = canvasOf(living.cellWidth, living.cellHeight);
  cell.getContext('2d').drawImage(sprite, column * living.cellWidth, row * living.cellHeight, living.cellWidth, living.cellHeight, 0, 0, living.cellWidth, living.cellHeight);
  return cell;
}
export async function renderPublishedCollectible(canvas, snapshot, options = {}) {
  const angle = (options.angle ?? snapshot.angle ?? 0) + (!options.staticFrame && snapshot.animation === 'rotate' ? (options.time || 0) / 75 : 0);
  let front = snapshot.angleFrames ? await angleFrameFront(snapshot.angleFrames, angle) : null;
  if (!front) front = await imageFor(snapshot.baseDataUrl || snapshot.imageDataUrl || snapshot.thumbnailDataUrl);
  if (!front) return;
  // angleFrames가 있으면 각도·효과가 이미 그 안에 구워져 있어 base+mask 재합성은 건너뛴다(이중 적용 방지).
  if (!snapshot.angleFrames && snapshot.baseDataUrl && snapshot.effectMasks) {
    const painted = canvasOf(front.naturalWidth || front.width, front.naturalHeight || front.height), context = painted.getContext('2d');
    context.drawImage(front, 0, 0);
    for (const effect of snapshot.effects || []) {
      const mask = await imageFor(snapshot.effectMasks[effect.target]); if (!mask) continue;
      const overlay = canvasOf(painted.width, painted.height), paint = overlay.getContext('2d'); paint.drawImage(painted, 0, 0);
      effectPaint(paint, effect, painted.width, angle, options.time, snapshot.shape);
      paint.globalCompositeOperation = 'destination-in'; paint.drawImage(mask, 0, 0, painted.width, painted.height);
      // Clear the affected material first so translucent glass stays translucent.
      context.globalCompositeOperation = 'destination-out'; context.drawImage(mask, 0, 0, painted.width, painted.height);
      context.globalCompositeOperation = 'source-over'; context.drawImage(overlay, 0, 0);
    }
    front = painted;
  }
  // living 오버레이는 시간으로 움직이는 칸을 정면 위 박스 자리에 얹는다(동작 줄이기면 t=0 칸). 카드 전체 동작
  // (staticFrame)과는 독립적인 시계(livingTime)를 쓴다 — 회전·반복 모션이 꺼져 있어도 living은 계속 움직인다
  // (PR #310 리뷰 P2: "aminiation:'still'인 living 전용 프로젝트가 자동재생 안 됨" 수정).
  if (snapshot.living) {
    const overlay = await livingOverlayCell(snapshot.living, options.reducedMotion ? 0 : (options.livingTime ?? options.time ?? 0));
    if (overlay) {
      const width = front.naturalWidth || front.width, height = front.naturalHeight || front.height;
      const composed = canvasOf(width, height), context = composed.getContext('2d');
      context.drawImage(front, 0, 0, width, height);
      const box = snapshot.living.box;
      context.drawImage(overlay, box.x * width, box.y * height, box.w * width, box.h * height);
      front = composed;
    }
  }
  // v1 발행본·뒷면 미생성본은 backImageDataUrl이 없어 drawVolume이 오늘의 모습(바탕색+이름)으로 대체한다.
  const back = snapshot.backImageDataUrl ? await imageFor(snapshot.backImageDataUrl) : null;
  // 호출자가 특정 동작(예: once 모션 "다시 보기")을 명시하면 그 값을, 아니면 게시된 기본(loop 또는 still) 동작을 쓴다.
  const animation = options.staticFrame ? 'still' : (options.animation ?? snapshot.animation ?? 'still');
  drawVolume(canvas, front, snapshot, { ...options, gradeId: snapshot.gradeId, animation, back });
}
// 게시용 이미지는 WebP(품질 0.9)로 저장해 크기를 줄인다(서버 완성본 1 MiB·썸네일 128 KiB·본문 8 MiB 상한 안에 넣기 위함).
// WebP 인코딩을 지원하지 않는 브라우저는 toDataURL이 PNG를 돌려주므로 그대로 PNG를 쓴다.
export function encodeImage(canvas, quality = .9) {
  const webp = canvas.toDataURL('image/webp', quality);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
// PR #293 리뷰 후속 P2(a): 효과 마스크도 등급별 스티커 배치(resolveSticker)를 따라야 한다. 전에는 기본 배치로만
// 마스크를 구워, "이 등급만 따로 배치"로 스티커를 옮기면 효과가 옛 자리에 남는 불일치가 있었다.
async function maskFor(project, gradeId, target, size) {
  const canvas = canvasOf(size, size), context = canvas.getContext('2d');
  traceShape(context, project.shape, size, size); context.clip();
  if (target === 'surface') { context.fillStyle = '#fff'; context.fillRect(0, 0, size, size); }
  else if (target === 'photo') {
    const photo = await photoFor(project); if (photo) { const transform = cropTransform(project, size, size); context.drawImage(photo, transform.x, transform.y, transform.width, transform.height); }
  } else if (target === 'border') {
    traceShape(context, project.shape, size * .97, size * .97, size * .015, size * .015); context.strokeStyle = '#fff'; context.lineWidth = size * .055; context.stroke();
  } else {
    const sticker = project.stickers.find(item => item.id === target); if (sticker) context.drawImage(await stickerLayer(resolveSticker(sticker, gradeId), size, [], 0, 0), 0, 0);
  }
  if (target === 'photo' || target === 'surface') {
    // Photo/surface effects are under the independently editable sticker/border
    // layers, so their published masks keep those elements intact as well.
    context.globalCompositeOperation = 'destination-out';
    for (const sticker of project.stickers) context.drawImage(await stickerLayer(resolveSticker(sticker, gradeId), size, [], 0, 0), 0, 0);
    traceShape(context, project.shape, size * .97, size * .97, size * .015, size * .015); context.lineWidth = size * .055; context.strokeStyle = '#fff'; context.stroke();
  }
  context.globalCompositeOperation = 'source-in'; context.fillStyle = '#fff'; context.fillRect(0, 0, size, size);
  return canvas.toDataURL('image/png');
}

// metallic·hologram·pearl만 각도를 쓴다(설계 문서 근거 사실 5). 패럴랙스도 각도마다 전/배경이 벌어지는 모양이
// 바뀌므로 각도 프레임이 있어야 한다.
const ANGLE_MATERIALS = Object.freeze(['metallic', 'hologram', 'pearl']);
function gradeNeedsAngleFrames(project, gradeId) {
  const hasMaterial = (project.effects ?? []).some((effect) => effect.gradeIds.includes(gradeId) && ANGLE_MATERIALS.includes(effect.type));
  const hasParallax = (project.parallax?.strength ?? 0) > 0 && (project.parallax?.strokes?.length ?? 0) > 0;
  return hasMaterial || hasParallax;
}
/** 이 등급에서 living이 가져다 쓰는 앞면 스티커 id(각도 프레임에서 뺀다, 설계 문서 "각도 프레임" 항목). */
function livingStickerTargets(project, gradeId) {
  return new Set((project.living?.items ?? []).filter((item) => item.target !== 'region' && item.gradeIds?.includes(gradeId)).map((item) => item.target));
}
async function angleFramesFor(project, gradeId, side, quality, excludeStickerIds) {
  const sprite = canvasOf(side * 4, side * 3), context = sprite.getContext('2d');
  for (let index = 0; index < 12; index++) {
    const angle = -82.5 + 15 * index;
    const frame = await frontFor(project, gradeId, side, angle, 0, true, excludeStickerIds);
    context.drawImage(frame, (index % 4) * side, Math.floor(index / 4) * side);
  }
  return { dataUrl: encodeImage(sprite, quality), side, count: 12, columns: 4, stepDegrees: 15 };
}
async function livingSpriteFor(project, gradeId, side, quality) {
  const box = livingBoundingBox(project, gradeId); if (!box) return undefined;
  const periodMs = project.living?.periodMs ?? 2400;
  const count = livingSpriteCount(periodMs);
  const cellWidth = Math.max(16, Math.min(512, Math.round(box.w * side)));
  const cellHeight = Math.max(16, Math.min(512, Math.round(box.h * side)));
  const grid = livingSpriteGrid(count, cellWidth, cellHeight); if (!grid) return undefined;
  const sprite = canvasOf(grid.width, grid.height), context = sprite.getContext('2d');
  for (let index = 0; index < count; index++) {
    const overlay = await livingOverlayFor(project, gradeId, side, index / count); if (!overlay) continue;
    const column = index % grid.columns, row = Math.floor(index / grid.columns);
    context.drawImage(overlay, box.x * side, box.y * side, box.w * side, box.h * side, column * cellWidth, row * cellHeight, cellWidth, cellHeight);
  }
  return { dataUrl: encodeImage(sprite, quality), count, columns: grid.columns, cellWidth, cellHeight, periodMs, box };
}
/**
 * 연결된 등급(campaignId와 무관하게 rewardGrades가 가리키는 등급)만 게시용으로 굽는다(설계 문서 "서버 검증" 3번
 * 근거: 연결되지 않은 등급까지 구우면 본문 용량을 낭비한다). extraGradeId는 편집기 미리보기용으로 지금 보는
 * 등급도 함께 구울 때 쓴다. base·effectMasks는 웹 뷰어가 각도별로 효과를 다시 합성하는 데 여전히 필요해
 * 연결된 등급에 한해 만든다(PR #293 P2: WP2에서 한 번 뺐다가 되살림).
 * angleSide·spriteQuality는 게시 크기 사다리(editor.mjs publishSizeProblem 루프)가 바꿔 가며 다시 부르는 값이다.
 */
export async function serializeDerived(project, { extraGradeId, merchantName = '', angleSide = 448, spriteQuality = .85 } = {}) {
  const linked = new Set(Object.values(project.rewardGrades || {}));
  if (extraGradeId) linked.add(extraGradeId);
  const derived = {};
  for (const grade of project.grades.filter(item => item.enabled !== false && linked.has(item.id))) {
    const front = await frontFor(project, grade.id, 512, 0, 0);
    const base = await frontFor(project, grade.id, 512, 0, 0, false);
    const back = await backFor(project, grade.id, 512, merchantName);
    const thumbnail = canvasOf(160, 160); thumbnail.getContext('2d').drawImage(front, 0, 0, 160, 160);
    const effectMasks = {};
    for (const target of new Set(effectsForGrade(project, grade.id).map(effect => effect.target))) effectMasks[target] = await maskFor(project, grade.id, target, 512);
    derived[grade.id] = { imageDataUrl: encodeImage(front), thumbnailDataUrl: encodeImage(thumbnail), baseDataUrl: encodeImage(base), backImageDataUrl: encodeImage(back), effectMasks };
    const livingStickers = livingStickerTargets(project, grade.id);
    // PR #310 리뷰 P2: living 스티커만 있고(재질·패럴랙스 없음) 각도 프레임이 없던 등급은, 위 imageDataUrl의
    // 정지 포즈 스티커 위에 뷰어의 living 오버레이가 겹쳐 그려져(유령처럼 둘 다 보임) 이중으로 보였다.
    // 재질·패럴랙스가 없어도 living 스티커가 있으면 그 스티커만 뺀 각도 프레임을 만들어(각도 차이는 없지만
    // 뷰어가 angleFrames를 우선해 쓰면서 정지 포즈를 가린다) 오버레이가 그 자리를 대신하게 한다.
    if (gradeNeedsAngleFrames(project, grade.id) || livingStickers.size > 0) {
      derived[grade.id].angleFrames = await angleFramesFor(project, grade.id, angleSide, spriteQuality, livingStickers);
    }
    const living = await livingSpriteFor(project, grade.id, angleSide, spriteQuality);
    if (living) derived[grade.id].living = living;
  }
  return derived;
}
export function validateStory(story) {
  if (!story || story.type === 'none') return '';
  const required = { zoom: 0, wide: 1, follow: 2, event: 3 }[story.type];
  if (required === undefined) return '가게 이야기 유형을 골라 주세요.';
  if ((story.frames || []).length < required) return `${{ wide: '넓은 가게 사진 1장', follow: '이동할 장면 사진 2장', event: '시작·행동·결과 사진 3장' }[story.type]}을 추가해 주세요. 사진 밖의 공간은 자동으로 복원되지 않아요.`;
  return '';
}
/** Rasterized public scene frames contain no EXIF or original camera metadata. */
export async function serializeStoryFrames(story) {
  const frames = [];
  for (const frame of story.frames || []) {
    const image = await imageFor(frame.dataUrl);
    const canvas = canvasOf(512, 320), context = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(512 / image.naturalWidth, 320 / image.naturalHeight);
    context.drawImage(image, (512 - image.naturalWidth * scale) / 2, (320 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
    if (story.cartoon) {
      const pixels = context.getImageData(0, 0, 512, 320); pixels.data.set(processPhotoPixels(pixels.data, 512, 320, { cartoon: story.cartoon })); context.putImageData(pixels, 0, 0);
    }
    frames.push({ ...frame, previewDataUrl: encodeImage(canvas) });
  }
  return frames;
}
export async function renderStory(canvas, project, { time = 0, reducedMotion = false } = {}) {
  const story = project.story || { type: 'none', frames: [] };
  const context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  const progress = reducedMotion ? .7 : Math.min(1, time / 6000);
  const primary = project.photo?.originalDataUrl || project.imageDataUrl;
  const frames = story.frames || [];
  let source = primary, zoom = 1, pan = 0;
  if (story.type === 'zoom') zoom = 1 + progress * .55;
  else if (story.type === 'wide') { source = frames[0]?.dataUrl || primary; zoom = 1.55 - progress * .55; }
  else if (story.type === 'follow') { source = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))]?.dataUrl || primary; pan = Math.sin(progress * Math.PI) * .07; }
  else if (story.type === 'event') source = frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))]?.dataUrl || primary;
  const image = await imageFor(source);
  if (!image) return;
  const ratio = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const layer = canvasOf(width, height), layerContext = layer.getContext('2d', { willReadFrequently: true });
  layerContext.drawImage(image, (width - image.naturalWidth * ratio) / 2 + pan * width, (height - image.naturalHeight * ratio) / 2, image.naturalWidth * ratio, image.naturalHeight * ratio);
  if (story.cartoon) {
    const pixels = layerContext.getImageData(0, 0, width, height);
    pixels.data.set(processPhotoPixels(pixels.data, width, height, { cartoon: story.cartoon })); layerContext.putImageData(pixels, 0, 0);
  }
  context.clearRect(0, 0, width, height); context.drawImage(layer, 0, 0);
  if (story.type === 'follow') {
    const mascot = await imageFor('/app/assets/mascot-stamp.png');
    if (mascot) context.drawImage(mascot, width * (.1 + progress * .65), height * .68 + Math.sin(progress * Math.PI * 12) * 4, width * .15, width * .15);
  }
}
