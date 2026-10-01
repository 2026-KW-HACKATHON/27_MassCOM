// 제작기 제작 부담을 줄이는 보조 로직(Issue #282). DOM에 닿지 않는 순수 함수만 둔다. clearCollectibleDrafts만
// 예외로, 기기 저장소를 주입받아(시험 대역 포함) 지우고, 생략하면 전역 저장소를 기본값으로 쓴다(merchant.mjs가
// "localStorage" 문구 없이 로그아웃·계정 전환에서 그대로 부를 수 있게 한다 — 점주 쿠폰 화면 시험이 그 문구를 금지한다).
// collectible-model.mjs는 다른 브랜치(schema v2)가 편집 중이라 건드리지 않고, clamp만 그대로 재사용한다.
import { clamp } from './collectible-model.mjs';

const DJB2_SEED = 5381;
/** 계정 식별자가 없을 때 세션 마커를 짧은 문자열로 접는다. 암호·인증 용도가 아니다. */
export function hashMarker(text) {
  let hash = DJB2_SEED;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index++) hash = ((hash * 33) ^ value.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

const DRAFT_PREFIX = 'masscom:collectible-draft:';
/** 점포·계정마다 다른 로컬 저장 키. 다른 점포·계정의 기기 보관본을 절대 섞지 않는다. */
export function draftStorageKey(merchantId, accountMarker) {
  return `${DRAFT_PREFIX}${merchantId}:${hashMarker(accountMarker)}`;
}

/**
 * 로그아웃·계정 전환처럼 같은 기기를 다른 사람이 이어 쓸 수 있는 상황에서, 그 계정이 어떤 점포를 열었었는지와
 * 관계없이 그 계정 몫의 기기 보관본을 전부 지운다(공유 PC에 사진이 남지 않게). 표준 Storage(length·key(i))
 * 인터페이스만 있으면 되므로 실제 localStorage와 시험용 대역 모두에 쓸 수 있다.
 */
export function clearCollectibleDrafts(storage = globalThis.window?.localStorage, accountScope) {
  if (!storage) return;
  const suffix = `:${hashMarker(accountScope)}`;
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && key.startsWith(DRAFT_PREFIX) && key.endsWith(suffix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/**
 * 기기 보관 자동 저장에는 미디어가 아닌 편집 값만 남긴다(사진 원본·이야기 장면 자료·음성·완성 파생 이미지는 공유 PC에
 * 남으면 안 되는 미디어라 절대 기기에 쓰지 않는다). 입력 project는 바꾸지 않는다.
 */
export function draftEditsOnly(project) {
  const { photo, audio, story, derived, ...edits } = project;
  return { ...edits, story: { ...story, frames: [] } };
}

/**
 * draftEditsOnly의 역함수. 서버에서 받은 최신 프로젝트(사진·음성·이야기 장면·파생 이미지 포함)에 기기에 남아 있던
 * 편집 값만 겹쳐 쓴다. 서버가 가진 미디어는 절대 지우지 않는다.
 */
export function applyDraftEdits(serverProject, edits) {
  return { ...serverProject, ...edits, story: { ...edits.story, frames: serverProject.story.frames } };
}

// 렌더러(collectible-renderer.mjs effectPaint)의 무광·에나멜·유리는 셋 다 같은 표면 전체를 덮어 칠하는
// 합성(soft-light·overlay+screen·destination-in+source-atop)이라 같이 켜면 결과를 예측할 수 없다.
// 메탈릭·펄·홀로그램·발광은 그라디언트/테두리 레이어라 같은 등급에 여럿 켜도 조합된다.
export const EXCLUSIVE_MATERIAL_GROUP = Object.freeze(['matte', 'enamel', 'glass']);
export const MATERIAL_LABELS = Object.freeze({ matte: '무광', enamel: '에나멜', glass: '유리' });

/** target+grade에 새 효과 type을 켤 때 이미 그 자리를 차지한 배타 재질 효과를 모두 돌려준다(중복 등록도 놓치지 않는다). */
export function findMaterialConflicts(effects, target, gradeId, type, excludeEffectId) {
  if (!EXCLUSIVE_MATERIAL_GROUP.includes(type)) return [];
  return effects.filter(effect => effect.id !== excludeEffectId && effect.target === target
    && EXCLUSIVE_MATERIAL_GROUP.includes(effect.type) && effect.type !== type && effect.gradeIds.includes(gradeId));
}

/** 첫 번째 충돌만 필요할 때(안내 문구용) 쓰는 편의 함수. */
export function findMaterialConflict(effects, target, gradeId, type, excludeEffectId) {
  return findMaterialConflicts(effects, target, gradeId, type, excludeEffectId)[0] ?? null;
}

const hasBatchim = word => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};
const particle = (word, withBatchim, withoutBatchim) => hasBatchim(word) ? withBatchim : withoutBatchim;

/** 조용히 섞지 않고 이유와 대안(끄고 바꾸기)을 보여 주는 확인 문구. */
export function materialConflictQuestion(existingType, newType) {
  const existing = MATERIAL_LABELS[existingType], added = MATERIAL_LABELS[newType];
  return `${added}${particle(added, '과', '와')} ${existing}${particle(existing, '은', '는')} 같은 곳에 함께 쓸 수 없어요. `
    + `${existing}${particle(existing, '을', '를')} 끄고 ${added}${particle(added, '을', '를')} 켤까요?`;
}

/** 확인을 수락해 재질을 바꾼 뒤 알리는 문구. */
export function materialSwapNotice(existingType, newType) {
  const existing = MATERIAL_LABELS[existingType], added = MATERIAL_LABELS[newType];
  return `${added} 재질로 바꿨어요. 같은 곳의 ${existing}${particle(existing, '은', '는')} 껐어요.`;
}

// 사진 자르기 안내에서 쓰는 세이프 영역 관례(스티커 배치 좌표 계산과 같은 512*.78 기준).
export const SAFE_AREA_RATIO = 0.78;
const TARGET_FACE_RATIO = 0.45;

/**
 * 원본 사진 픽셀 기준 얼굴 상자를 프레임 중앙·세이프 영역의 45% 크기로 맞추는 crop 값을 계산한다.
 * project.crop과 같은 모양({ x, y, zoom })을 돌려주며 cropTransform의 fit-cover 공식을 거꾸로 푼다.
 */
export function faceFitCrop(photoWidth, photoHeight, face, outputSize = 512) {
  if (!(photoWidth > 0) || !(photoHeight > 0) || !face || !(face.width > 0) || !(face.height > 0)) return null;
  const baseScale = Math.max(outputSize / photoWidth, outputSize / photoHeight);
  const faceCenterX = face.x + face.width / 2, faceCenterY = face.y + face.height / 2;
  const desiredFaceSize = Math.max(face.width, face.height);
  const desiredScale = (TARGET_FACE_RATIO * outputSize * SAFE_AREA_RATIO) / desiredFaceSize;
  const zoom = clamp(desiredScale / baseScale, 1, 8, 1);
  const scale = baseScale * zoom;
  const width = photoWidth * scale, height = photoHeight * scale;
  const targetX = outputSize / 2 - faceCenterX * scale, targetY = outputSize / 2 - faceCenterY * scale;
  const spanX = (width - outputSize) / 2, spanY = (height - outputSize) / 2;
  const x = spanX > 0 ? clamp((targetX - (outputSize - width) / 2) / spanX, -1, 1, 0) : 0;
  const y = spanY > 0 ? clamp((targetY - (outputSize - height) / 2) / spanY, -1, 1, 0) : 0;
  return { x, y, zoom, method: 'face' };
}

/** 얼굴 감지를 쓸 수 없을 때의 기본값: 확대 없이 가운데로 채운다(fit-cover). */
export function centerFillCrop() {
  return { x: 0, y: 0, zoom: 1, method: 'center' };
}
