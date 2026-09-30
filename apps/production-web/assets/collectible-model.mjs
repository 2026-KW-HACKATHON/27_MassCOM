/**
 * 사진 제작기의 편집 계약. 서버 식별자·작성자·버전은 이 객체 밖에 둔다.
 * 등급은 수집품의 외형이며 방문 메달·보상 조건·NFT 상태와 연결하지 않는다.
 * 원본과 편집 좌표를 보관하고 공개 결과를 derived에 별도로 만든다.
 */
export const SCHEMA_VERSION = 1;
export const SHAPES = Object.freeze(['circle', 'stamp', 'serrated']);
export const PHOTO_STYLES = Object.freeze(['original', 'incised', 'raised']);
export const GRADE_KINDS = Object.freeze(['basic', 'special']);
export const STICKER_KINDS = Object.freeze(['text', 'emoji']);
export const BRUSH_TOOLS = Object.freeze(['clean', 'erase', 'restore', 'color']);
export const EFFECT_TYPES = Object.freeze(['metallic', 'hologram', 'pearl', 'matte', 'glow', 'enamel', 'glass']);
export const MOTION_TYPES = Object.freeze(['still', 'rotate', 'shine', 'float', 'stamp', 'sparkle', 'pulse', 'confetti']);
export const STORY_TYPES = Object.freeze(['none', 'zoom', 'wide', 'follow', 'event']);

export const DEFAULT_GRADES = Object.freeze([
  Object.freeze({ id: 'bronze', name: '브론즈', kind: 'basic', enabled: true }),
  Object.freeze({ id: 'silver', name: '실버', kind: 'basic', enabled: true }),
  Object.freeze({ id: 'gold', name: '골드', kind: 'basic', enabled: true }),
  Object.freeze({ id: 'prism', name: '프리즘', kind: 'basic', enabled: true }),
]);

let sequence = 0;

/** 표시 이름을 바꿔도 유지되는 요소 식별자. 암호·인증 용도로 사용하지 않는다. */
export function createId(prefix = 'element') {
  const random = globalThis.crypto?.randomUUID?.();
  sequence += 1;
  return `${prefix}-${random ?? `${Date.now().toString(36)}-${sequence.toString(36)}`}`;
}

/** 네 기본 등급 외의 등급도 같은 데이터 구조를 쓴다. 효과는 자동 상속하지 않는다. */
export function createGrade(name = '새 등급', { id = createId('grade'), kind = 'special' } = {}) {
  if (!GRADE_KINDS.includes(kind)) throw new TypeError('지원하지 않는 등급 종류입니다.');
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('등급 식별자가 필요합니다.');
  return { id, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : '새 등급', kind, enabled: true };
}

/**
 * 초안은 사진 없이도 저장할 수 있다. 게시에는 실제 사진과 파생 결과가 필요하다.
 * rewardGrades는 점주가 캠페인의 기존 1·3·5회 목표에 외형을 직접 연결하기 전까지 비어 있다.
 * 테마 변경·등급 추가는 보상 연결과 효과 적용을 자동 변경하지 않는다.
 */
export function createProject({ name = '새 수집품', campaignId = '' } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: typeof name === 'string' ? name.trim().slice(0, 80) || '새 수집품' : '새 수집품',
    theme: { name: '기본' },
    campaignId: typeof campaignId === 'string' ? campaignId : '',
    photo: { originalDataUrl: '', width: 0, height: 0 },
    shape: 'circle',
    crop: { x: 0, y: 0, zoom: 1 },
    photoEdits: { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] },
    style: 'original',
    baseColor: '#bf8149',
    photoColor: 100,
    relief: 45,
    stickers: [],
    grades: DEFAULT_GRADES.map((grade) => ({ ...grade })),
    effects: [],
    motion: [],
    thickness: 8,
    angle: 0,
    greeting: '',
    audio: null,
    story: { type: 'none', frames: [], cartoon: 0, strength: 50 },
    derived: {},
    rewardGrades: {},
  };
}

/** 서버 래퍼 없이 편집 객체만 복사한다. 원본 문자열은 다시 압축하지 않는다. */
export function cloneProject(project) {
  return structuredClone(project);
}

/** 단일 미리보기 선택과 별개인 복수 등급 토글. 입력을 바꾸지 않는다. */
export function toggleEffectGrade(effect, gradeId) {
  if (typeof gradeId !== 'string' || !gradeId) throw new TypeError('등급 식별자가 필요합니다.');
  const current = [...new Set(effect.gradeIds ?? [])];
  return {
    ...effect,
    gradeIds: current.includes(gradeId) ? current.filter((id) => id !== gradeId) : [...current, gradeId],
  };
}

/** target은 surface/photo/border 또는 특정 스티커 식별자다. */
export function effectsForGrade(project, gradeId, target) {
  if (!project.grades.some((grade) => grade.id === gradeId && grade.enabled)) return [];
  return project.effects.filter((effect) => effect.gradeIds.includes(gradeId)
    && (target === undefined || effect.target === target));
}

export function motionForGrade(project, gradeId) {
  if (!project.grades.some((grade) => grade.id === gradeId && grade.enabled)) return [];
  return project.motion.filter((motion) => motion.gradeIds.includes(gradeId));
}

export function clamp(value, minimum, maximum, fallback = minimum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function dimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError('양수인 유한 화면 크기가 필요합니다.');
  }
}

/**
 * crop·완성 미리보기·테두리가 사용하는 단일 외곽. 경로 마지막은 호출자가 닫는다.
 * 톱니는 24개의 삼각 돌기가 하나의 닫힌 외곽에 이어진다.
 * 우표는 직사각형 가장자리의 안쪽 반원 구멍이며 꽃잎이나 분리된 광선이 아니다.
 */
export function shapePoints(shape, width = 512, height = 512) {
  if (!SHAPES.includes(shape)) throw new TypeError('지원하지 않는 수집품 모양입니다.');
  dimensions(width, height);
  if (shape === 'stamp') {
    const left = width * 0.09;
    const right = width * 0.91;
    const top = height * 0.04;
    const bottom = height * 0.96;
    const depth = Math.min(width, height) * 0.018;
    const points = [];
    const edge = (from, to, inward, count) => {
      for (let cell = 0; cell < count; cell += 1) {
        for (let step = 0; step < 8; step += 1) {
          const fraction = step / 8;
          const along = (cell + fraction) / count;
          const inset = Math.sin(Math.PI * fraction) * depth;
          points.push({
            x: from.x + (to.x - from.x) * along + inward.x * inset,
            y: from.y + (to.y - from.y) * along + inward.y * inset,
          });
        }
      }
    };
    edge({ x: left, y: top }, { x: right, y: top }, { x: 0, y: 1 }, 10);
    edge({ x: right, y: top }, { x: right, y: bottom }, { x: -1, y: 0 }, 12);
    edge({ x: right, y: bottom }, { x: left, y: bottom }, { x: 0, y: -1 }, 10);
    edge({ x: left, y: bottom }, { x: left, y: top }, { x: 1, y: 0 }, 12);
    return points;
  }
  const radius = Math.min(width, height) * 0.46;
  const count = shape === 'serrated' ? 48 : 96;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
    const distance = radius * (shape === 'serrated' && index % 2 !== 0 ? 0.8 : 1);
    return { x: width / 2 + Math.cos(angle) * distance, y: height / 2 + Math.sin(angle) * distance };
  });
}

export function shapePath(shape, width = 512, height = 512) {
  return `${shapePoints(shape, width, height).map((point, index) =>
    `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`;
}

/**
 * 원본 기준 fit-cover. crop.x/y는 가능한 이동 범위의 -1..1 비율, zoom은 1..8이다.
 * 반복해서 적용해도 원본 바이트·원본 크기·저장 좌표는 변경하지 않는다.
 */
export function cropTransform(project, outputWidth = 512, outputHeight = 512) {
  dimensions(outputWidth, outputHeight);
  const photo = project.photo;
  if (!photo || photo.width <= 0 || photo.height <= 0) return { x: 0, y: 0, width: outputWidth, height: outputHeight };
  dimensions(photo.width, photo.height);
  const zoom = clamp(project.crop.zoom, 1, 8, 1);
  const scale = Math.max(outputWidth / photo.width, outputHeight / photo.height) * zoom;
  const width = photo.width * scale;
  const height = photo.height * scale;
  return {
    x: (outputWidth - width) / 2 + clamp(project.crop.x, -1, 1, 0) * (width - outputWidth) / 2,
    y: (outputHeight - height) / 2 + clamp(project.crop.y, -1, 1, 0) * (height - outputHeight) / 2,
    width,
    height,
  };
}
