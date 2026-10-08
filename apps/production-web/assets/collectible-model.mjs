/**
 * 사진 제작기의 편집 계약. 서버 식별자·작성자·버전은 이 객체 밖에 둔다.
 * 등급은 수집품의 외형이며 방문 메달·보상 조건·NFT 상태와 연결하지 않는다.
 * 원본과 편집 좌표를 보관하고 공개 결과를 derived에 별도로 만든다.
 */
export const SCHEMA_VERSION = 2;
export const SHAPES = Object.freeze(['circle', 'stamp', 'serrated']);
export const PHOTO_STYLES = Object.freeze(['original', 'incised', 'raised']);
export const GRADE_KINDS = Object.freeze(['basic', 'special']);
export const STICKER_KINDS = Object.freeze(['text', 'emoji', 'mascot']);
export const STICKER_ALIGNS = Object.freeze(['left', 'center', 'right']);
export const BRUSH_TOOLS = Object.freeze(['clean', 'erase', 'restore', 'color']);
export const EFFECT_TYPES = Object.freeze(['metallic', 'hologram', 'pearl', 'matte', 'glow', 'enamel', 'glass']);
export const MOTION_TYPES = Object.freeze(['still', 'rotate', 'shine', 'float', 'stamp', 'sparkle', 'pulse', 'confetti']);
export const MOTION_PLAYBACKS = Object.freeze(['once', 'loop']);
export const PARTICLE_KINDS = Object.freeze(['confetti', 'snow', 'petals', 'sparkles']);
export const BACK_MODES = Object.freeze(['default', 'custom']);
export const PARALLAX_TOOLS = Object.freeze(['fg', 'bg']);
export const LIVING_KINDS = Object.freeze(['sway', 'bob', 'steam', 'blink']);
/** 두께 3단계(Issue #329). 저장 값은 그대로 1~24 정수이고, 이 표는 화면 이름만 정한다. */
export const THICKNESS_PRESETS = Object.freeze([Object.freeze([4, '얇게']), Object.freeze([8, '보통']), Object.freeze([14, '두껍게'])]);
export function thicknessPresetLabel(value) { return THICKNESS_PRESETS.find(([preset]) => preset === value)?.[1] ?? null; }
export const STORY_TYPES = Object.freeze(['none', 'zoom', 'wide', 'follow', 'event']);
// 등급별 프레임 없이 각도만 재생하는 once 재생의 표시 시간(ms). 'still'은 재생이 없어 없다.
export const ONCE_MS = Object.freeze({ rotate: 4000, shine: 3500, sparkle: 3500, stamp: 3500, float: 2400, pulse: 2400, confetti: 2000 });
// 얼굴 스티커로 쓸 수 있는 마스코트 포즈(apps/mobile/assets/images/mascot/v2/*.png 파일 stem). 승인된 그림만 추가한다.
export const MASCOT_POSES = Object.freeze(['cheer', 'explore-map', 'friends', 'gift', 'logo-badge', 'puzzled', 'search', 'sky-town-header', 'sleep', 'stamp', 'town-map', 'wave']);
// 눈 감은 프레임(apps/production-web/assets/mascot/<pose>-blink.png)이 있는 포즈. 그림이 없으면 living의
// blink 항목이 그 포즈를 쓸 수 없다. apps/api/src/collectible-project-rules.ts의 mascotBlink와 값을 맞춘다.
export const MASCOT_BLINK = Object.freeze(['cheer', 'explore-map', 'friends', 'gift', 'logo-badge', 'puzzled', 'search', 'stamp', 'wave']);
export const STANDARD_VISIT_GOALS = Object.freeze([1, 3, 5]);
export const STANDARD_VISIT_REWARD_GRADES = Object.freeze({ 1: 'bronze', 3: 'silver', 5: 'gold' });
export const STANDARD_VISIT_REWARD_LABELS = Object.freeze([
  Object.freeze({ count: 1, gradeId: 'bronze', label: '1회', gradeName: '브론즈' }),
  Object.freeze({ count: 3, gradeId: 'silver', label: '3회', gradeName: '실버' }),
  Object.freeze({ count: 5, gradeId: 'gold', label: '5회', gradeName: '골드' }),
]);

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
 * rewardGrades는 방문 보상 게시 때 표준 1·3·5회 보상 외형으로 고정된다.
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
    back: { mode: 'default', color: '#bf8149', stickers: [] },
    grades: DEFAULT_GRADES.map((grade) => ({ ...grade })),
    effects: [],
    motion: [],
    thickness: 8,
    angle: 0,
    greeting: '',
    greetingOverrides: [],
    audio: null,
    story: { type: 'none', frames: [], cartoon: 0, strength: 50 },
    parallax: { strength: 0, strokes: [] },
    living: { periodMs: 2400, items: [] },
    derived: {},
    rewardGrades: {},
  };
}

export function standardVisitRewardGrades() {
  return { ...STANDARD_VISIT_REWARD_GRADES };
}

export function isStandardVisitCampaign(campaign) {
  return Boolean(campaign?.id) &&
    (!campaign.status || campaign.status === 'ACTIVE') &&
    Array.isArray(campaign.goals) &&
    campaign.goals.length === STANDARD_VISIT_GOALS.length &&
    [...campaign.goals].sort((a, b) => a - b).every((goal, index) => goal === STANDARD_VISIT_GOALS[index]);
}

export function applyStandardVisitRewards(project) {
  project.rewardGrades = standardVisitRewardGrades();
  // 제작·저장 등급은 네 기본 등급을 모두 유지한다. 방문 지급 조건은 위의 세 연결만 쓴다.
  // 이전 초안의 비활성 기본 등급을 복구해도 이름·효과·특수등급 식별자는 바꾸지 않는다.
  for (const preset of DEFAULT_GRADES) {
    const grade = project.grades.find(item => item.id === preset.id);
    if (grade) grade.enabled = true;
    else project.grades.push({ ...preset });
  }
  return project;
}

/** 새 점포 수집품은 기존 방문 목표의 외형을 미리 연결한다. 저장한 프로젝트에는 적용하지 않는다. */
export function createMerchantStarterProject({ merchantName = '', menuName = '', suggested = false, campaigns = [], preferredCampaignId = '' } = {}) {
  const eligible = campaigns.filter(isStandardVisitCampaign);
  const campaignId = eligible.find(campaign => campaign.id === preferredCampaignId)?.id ??
    (eligible.length === 1 ? eligible[0].id : '');
  const store = merchantName.trim() || '우리 가게';
  const menu = typeof menuName === 'string' ? menuName.trim().slice(0, 40) : '';
  const project = createProject({ name: `${menu || store} 방문 수집품`, campaignId });
  applyStandardVisitRewards(project);
  if (!suggested) return project;
  const motifs = [
    { text: '⌂', color: '#58331f', layouts: { bronze: [.3, .29, 110], silver: [.2, .18, 20], gold: [.2, .18, 20] } },
    { text: '◯', color: '#173c50', layouts: { bronze: [.82, .82, 8], silver: [.72, .7, 110], gold: [.72, .7, 24] } },
    { text: '✦', color: '#7d3700', layouts: { bronze: [.85, .18, 8], silver: [.84, .18, 8], gold: [.73, .26, 120] } },
  ];
  for (const [order, motif] of motifs.entries()) {
    const layouts = Object.fromEntries(Object.entries(motif.layouts).map(([grade, [x, y, size]]) => [grade, { x, y, size, rotation: 0 }]));
    project.stickers.push({ id: createId('sticker'), kind: 'text', text: motif.text, x: .5, y: .5, size: 8,
      rotation: 0, color: motif.color, order, align: 'center', layouts });
  }
  if (menu) project.stickers.push({ id: createId('sticker'), kind: 'text', text: menu, x: .5, y: .81,
    size: 24, rotation: 0, color: '#ffffff', order: motifs.length, align: 'center', layouts: {} });
  for (const [gradeId, type, target, color, motion] of [
    ['bronze', 'matte', 'surface', '#ac7044', 'stamp'],
    ['silver', 'pearl', 'surface', '#dceaf1', 'float'],
    ['gold', 'metallic', 'border', '#f4c957', 'shine'],
  ]) {
    project.effects.push({ id: createId('effect'), type, target, gradeIds: [gradeId], strength: 55, color, roughness: 25 });
    project.motion.push({ id: createId('motion'), type: motion, gradeIds: [gradeId], playback: 'once' });
  }
  return project;
}

/**
 * v1 프로젝트를 v2로 올린다. 순수 함수이며 이미 v2면 그대로(깊은 복사만) 돌려줘 멱등이다.
 * 서버의 collectible-project-rules.ts upgradeCollectibleProject와 값이 같아야 하며, 같은 골든 픽스처로 함께 시험한다.
 */
export function upgradeProject(project) {
  if (!project || typeof project !== 'object') throw new TypeError('프로젝트 객체가 필요합니다.');
  if (project.schemaVersion === 2) return structuredClone(project);
  if (project.schemaVersion !== 1) throw new TypeError('지원하지 않는 프로젝트 버전입니다.');
  const upgraded = structuredClone(project);
  upgraded.schemaVersion = 2;
  upgraded.stickers = upgraded.stickers.map((sticker) => ({
    ...sticker,
    text: typeof sticker.text === 'string' ? sticker.text.replace(/[\r\n\t]+/g, ' ') : sticker.text,
    align: 'center',
    layouts: {},
  }));
  upgraded.back = { mode: 'default', color: upgraded.baseColor, stickers: [] };
  upgraded.motion = upgraded.motion.map((motion) => ({
    ...motion,
    playback: 'loop',
    ...(motion.type === 'confetti' ? { particle: 'confetti' } : {}),
  }));
  upgraded.greetingOverrides = [];
  upgraded.parallax = { strength: 0, strokes: [] };
  upgraded.living = { periodMs: 2400, items: [] };
  return upgraded;
}

/** 스티커의 기본 배치에 해당 등급 전용 layouts를 얹는다. 없으면 기본값 그대로다. */
export function resolveSticker(sticker, gradeId) {
  const layout = sticker.layouts?.[gradeId];
  if (!layout) return sticker;
  return { ...sticker, x: layout.x ?? sticker.x, y: layout.y ?? sticker.y, size: layout.size ?? sticker.size, rotation: layout.rotation ?? sticker.rotation };
}

/** 스티커 텍스트를 최대 4줄로 나눈다. 서버(rules.ts parseSticker)도 같은 4줄 상한을 쓴다. */
export function stickerLines(text) {
  return String(text ?? '').split('\n').slice(0, 4);
}

/** 줄 수에 따른 각 줄의 세로 오프셋(스티커 폰트 크기 1 단위, 1.2줄 간격, 블록 전체 중앙이 0). */
export function stickerLineOffsets(lineCount, lineHeight = 1.2) {
  if (!Number.isInteger(lineCount) || lineCount < 1) throw new TypeError('줄 수는 1 이상 정수여야 합니다.');
  const span = (lineCount - 1) * lineHeight;
  return Array.from({ length: lineCount }, (_, index) => index * lineHeight - span / 2);
}

/** 인사말 우선순위: 등급+테마 > 등급 > 테마 > 기본. 동점은 배열 순서(먼저 온 항목)가 이긴다. */
export function resolveGreeting(project, gradeId, themeName = project.theme?.name ?? '') {
  let best; let bestScore = -1;
  for (const override of project.greetingOverrides ?? []) {
    const gradeMatch = override.gradeIds.length === 0 || override.gradeIds.includes(gradeId);
    const themeMatch = override.themeName === '' || override.themeName === themeName;
    if (!gradeMatch || !themeMatch) continue;
    const score = (override.gradeIds.length > 0 ? 2 : 0) + (override.themeName !== '' ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = override; }
  }
  return best ? best.text : project.greeting;
}

const PARTICLE_COLORS = Object.freeze({
  confetti: Object.freeze(['#ffb165', '#8adcc0', '#da9fdd']),
  snow: Object.freeze(['#ffffff', '#eaf6ff', '#d7ecff']),
  petals: Object.freeze(['#f7b6c8', '#f49bc1', '#fcd5e4']),
  sparkles: Object.freeze(['#fff4c2', '#ffe98a', '#ffffff']),
});

/**
 * i번째 파티클의 상대 위치(중심 0,0 기준 -1..1 대략치)와 색을 phase(0..1) 기준으로 낸다. 화면 크기와 무관해
 * 웹 캔버스와 Android 뷰가 같은 수식을 각자 크기로 늘려 쓴다. confetti는 기존 렌더러 낙하 수식을 그대로 옮겼다.
 */
export function particleAt(kind, i, phase) {
  if (!PARTICLE_KINDS.includes(kind)) throw new TypeError('지원하지 않는 파티클 종류입니다.');
  if (!Number.isInteger(i) || i < 0) throw new TypeError('파티클 순번은 0 이상 정수여야 합니다.');
  const p = clamp(phase, 0, 1, 0);
  const colors = PARTICLE_COLORS[kind];
  const color = colors[i % colors.length];
  if (kind === 'confetti') return { x: Math.sin(i * 7) * p, y: Math.cos(i * 3) * p + p * p * 0.3, color };
  if (kind === 'snow') return { x: Math.sin(i * 5 + p * Math.PI * 2) * 0.4, y: p - 0.5, color };
  if (kind === 'petals') return { x: Math.sin(i * 3 + p * Math.PI) * 0.5, y: p - 0.5 + Math.sin(p * Math.PI * 2 + i) * 0.08, color };
  return { x: Math.cos(i * 11 + p * Math.PI * 2) * 0.4 * p, y: Math.sin(i * 13 + p * Math.PI * 2) * 0.4 * p, color };
}

// derived[g].angleFrames는 -82.5°부터 15° 간격 12칸(정면 -90..90 범위)만 갖는다. 그 바깥은 뒷면이다.
const ANGLE_FRAME_START = -82.5, ANGLE_FRAME_STEP = 15, ANGLE_FRAME_COUNT = 12;

/**
 * 회전각(도, 임의 범위)을 정면 프레임 두 칸과 섞음 비율로 낸다. |각도| > 90(정규화 후)이면 뒷면이라 프레임이 없다.
 * 범위 양 끝을 넘는 각도는 가장 가까운 칸에 고정한다(blend 0 또는 1).
 */
export function angleFrameIndex(angleDeg) {
  if (!Number.isFinite(angleDeg)) throw new TypeError('유한한 각도가 필요합니다.');
  const normalized = ((angleDeg % 360) + 540) % 360 - 180;
  if (Math.abs(normalized) > 90) return { back: true };
  const position = clamp((normalized - ANGLE_FRAME_START) / ANGLE_FRAME_STEP, 0, ANGLE_FRAME_COUNT - 1);
  const index = Math.min(ANGLE_FRAME_COUNT - 2, Math.floor(position));
  return { back: false, index, next: Math.min(ANGLE_FRAME_COUNT - 1, index + 1), blend: clamp(position - index, 0, 1) };
}

/**
 * 획 목록(순서대로 적용)에서 전경/배경 마스크를 낸다. tool:'fg'는 255(전경)를, 'bg'는 0(배경)을 그 자리에 찍는다
 * (processPhotoPixels의 원 찍기 수식을 그대로 옮겨 같은 붓 느낌을 공유한다). DOM 없이 순수 배열만 다뤄 node로
 * 바로 시험할 수 있다. 반환값은 길이 w*h인 Uint8ClampedArray(한 채널, 0 또는 255).
 */
export function strokeAlpha(strokes, w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) throw new TypeError('양수인 정수 크기가 필요합니다.');
  const alpha = new Uint8ClampedArray(w * h);
  for (const stroke of strokes || []) {
    const radius = Math.max(1, clamp(stroke.size ?? .04, .01, .2, .04) * Math.min(w, h) / 2);
    const value = stroke.tool === 'bg' ? 0 : 255;
    const points = stroke.points || [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
      const first = points[Math.max(0, pointIndex - 1)], last = points[pointIndex];
      const distance = Math.hypot((last.x - first.x) * w, (last.y - first.y) * h);
      const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
      for (let step = 0; step <= steps; step++) {
        const cx = (first.x + (last.x - first.x) * step / steps) * w;
        const cy = (first.y + (last.y - first.y) * step / steps) * h;
        for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++) {
          for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
            if (Math.hypot(x - cx, y - cy) > radius) continue;
            alpha[y * w + x] = value;
          }
        }
      }
    }
  }
  return alpha;
}

// 서버(rules.ts:316-318)가 거절하는 패럴랙스 획 + living region 점의 전체 합 상한. 등급 연결 여부와 무관하게
// 프로젝트 전체에서 넘으면 저장·게시가 모두 거절된다(PR #310 리뷰 P1).
export const PARALLAX_LIVING_POINT_BUDGET = 20_000;

/** 패럴랙스 획과 living region 항목의 점을 모두 더한다(서버가 보는 것과 같은 전체 합). */
export function parallaxLivingPointTotal(project) {
  let total = 0;
  for (const stroke of project.parallax?.strokes ?? []) total += stroke.points?.length ?? 0;
  for (const item of project.living?.items ?? []) if (item.target === 'region') total += item.strokes?.length ?? 0;
  return total;
}

/**
 * 패럴랙스 전경/배경 레이어가 각도에 따라 벌어지는 거리(칸버스 size 기준 px). 배경은 이 값의 절반만큼 반대로,
 * 전경은 그대로, 스티커는 1.2배로 쓴다(renderer.mjs frontFor). strength 0이거나 획이 없으면 호출부가 0으로 둔다.
 */
export function parallaxOffset(angleDeg, strength, size = 1) {
  if (!Number.isFinite(angleDeg) || !Number.isFinite(strength) || !Number.isFinite(size)) throw new TypeError('유한한 값이 필요합니다.');
  return Math.sin(angleDeg * Math.PI / 180) * (clamp(strength, 0, 100, 0) / 100) * 0.04 * size;
}

/** t(ms)를 periodMs로 나눈 0..1 주기 phase. t=0과 t=periodMs는 같은 phase(0)다. */
export function livingPhaseAt(t, periodMs) {
  if (!Number.isFinite(t) || !Number.isFinite(periodMs) || periodMs <= 0) throw new TypeError('유한한 시간이 필요합니다.');
  return (((t % periodMs) + periodMs) % periodMs) / periodMs;
}

/** phase(0..1 또는 그 범위 밖의 t/periodMs)를 0..count-1 살아있는 그림 스프라이트 칸으로 접는다. */
export function livingFrameAt(t, periodMs, count) {
  if (!Number.isInteger(count) || count < 1) throw new TypeError('칸 수는 1 이상 정수여야 합니다.');
  return Math.min(count - 1, Math.floor(livingPhaseAt(t, periodMs) * count));
}

/** periodMs/100을 8..24칸으로 clamp한 정수 칸 수(설계 문서 "게시본" 항목). */
export function livingSpriteCount(periodMs) {
  return Math.round(clamp(Math.round(periodMs / 100), 8, 24));
}

/**
 * count칸을 cellWidth×cellHeight로 maxSide(기본 4096px) 안에 배치할 열 수를 고른다. 서버(rules.ts)·Android
 * 파서가 columns를 1..8로 제한하므로 maxColumns도 그만큼 cap한다. 가능한 많은 열을 써서 세로를 줄이되, 그래도
 * 한 변이 넘치면 undefined(호출부가 더 작은 크기 사다리 단계로 다시 시도해야 한다).
 */
export function livingSpriteGrid(count, cellWidth, cellHeight, maxSide = 4096, maxColumns = 8) {
  if (!Number.isInteger(count) || count < 1 || cellWidth <= 0 || cellHeight <= 0) throw new TypeError('칸 수·칸 크기가 올바르지 않습니다.');
  let columns = Math.max(1, Math.min(count, maxColumns, Math.floor(maxSide / cellWidth)));
  while (columns > 1 && Math.ceil(count / columns) * cellHeight > maxSide) columns -= 1;
  const rows = Math.ceil(count / columns);
  const width = columns * cellWidth, height = rows * cellHeight;
  if (width > maxSide || height > maxSide) return undefined;
  return { columns, rows, width, height };
}

/**
 * living 항목(등급 기준)의 패딩된 합집합 박스(0..1, 사진/스티커 좌표). region은 칠한 점들의 min/max, 스티커
 * 대상은 그 스티커의 등급별 배치(resolveSticker) 둘레를 쓴다. 비어 있으면 undefined(그 등급엔 living 스프라이트가 없다).
 */
/**
 * 스티커의 (대략) 좌/우/상/하 반경(0..1, size=512 기준). model.mjs는 DOM이 없어 실제 measureText를 못 쓰므로
 * 가장 긴 줄의 글자 수 × 넉넉한 em 폭으로 추정한다(모자라서 잘리기보다 넘치게, PR #310 리뷰 P2). align에 따라
 * 글자 블록이 x를 기준으로 한쪽으로만 뻗는 것도 반영한다(stickerLayer의 textAlign과 같은 규칙).
 */
function stickerHalfExtent(resolved) {
  const fontSize = clamp(resolved.size ?? 42, 8, 120, 42);
  if (resolved.kind === 'mascot') { const half = fontSize / 512; return { left: half, right: half, top: half, bottom: half }; }
  const lines = stickerLines(resolved.text ?? '');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const width = (longest * fontSize * .95) / 512;
  const height = (lines.length * fontSize * 1.2) / 512;
  const align = resolved.align || 'center';
  const left = align === 'left' ? 0 : align === 'right' ? width : width / 2;
  const right = align === 'left' ? width : align === 'right' ? 0 : width / 2;
  return { left, right, top: height / 2, bottom: height / 2 };
}

/** 가로·세로 반경을 rotationDeg만큼 돌렸을 때의 축 정렬 바운딩 반경. */
function rotatedHalfExtent(halfW, halfH, rotationDeg) {
  const r = rotationDeg * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { halfW: halfW * c + halfH * s, halfH: halfW * s + halfH * c };
}

export function livingBoundingBox(project, gradeId, padding = 0.1) {
  const items = (project.living?.items ?? []).filter((item) => item.gradeIds?.includes(gradeId));
  if (!items.length) return undefined;
  // region 점은 사진 안 비율(pointOnPhoto, cropTransform의 photo rect 기준)이라 사진이 정사각이 아니거나
  // 확대·이동됐으면 출력 캔버스 비율과 다르다. 출력 기준(스티커 쪽과 같은 좌표계)으로 옮긴 뒤 합집합을 낸다
  // (PR #310 리뷰 2차 P2: 이전 crop 보정이 렌더러에만 반영되고 이 박스에는 닿지 않아, 게시 후 움직이는 영역이
  // 잘리거나 어긋났다).
  const transform = cropTransform(project, 1, 1);
  const photo = project.photo;
  const photoScale = photo?.width > 0 && photo?.height > 0 ? transform.width / photo.width : 1;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const item of items) {
    if (item.target === 'region') {
      // 붓 반경(strokeAlpha·paintLivingItem의 고정 size .1과 같은 공식, 사진 고유 치수 기준)을 출력 반경으로 바꾼다.
      const brushRadius = photo?.width > 0 ? .1 * Math.min(photo.width, photo.height) / 2 * photoScale : 0;
      const swayRad = item.kind === 'sway' ? (clamp(item.amplitude, 0, 100, 0) / 100) * 6 * Math.PI / 180 : 0;
      const bobFrac = item.kind === 'bob' ? (clamp(item.amplitude, 0, 100, 0) / 100) * .03 : 0;
      const pivot = { x: (item.pivot?.x ?? .5), y: (item.pivot?.y ?? .5) };
      if (item.kind === 'steam') {
        // paintLivingItem draws three puffs up to .22 above the pivot, each at most .03 wide.
        minX = Math.min(minX, pivot.x - .03); maxX = Math.max(maxX, pivot.x + .03);
        minY = Math.min(minY, pivot.y - .22 - .03); maxY = Math.max(maxY, pivot.y + .03);
      }
      for (const point of item.strokes ?? []) {
        const x = transform.x + point.x * transform.width, y = transform.y + point.y * transform.height;
        // sway는 paintLivingItem처럼 pivot 둘레로 ±최대각까지 돌아간다. 두 극단만 보면 회전 중 지나가는 자리를 다 덮는다.
        for (const rad of swayRad ? [swayRad, -swayRad] : [0]) {
          const dx = x - pivot.x, dy = y - pivot.y;
          const rx = pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad);
          const ry = pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad);
          minX = Math.min(minX, rx - brushRadius); maxX = Math.max(maxX, rx + brushRadius);
          minY = Math.min(minY, ry - brushRadius - bobFrac); maxY = Math.max(maxY, ry + brushRadius + bobFrac);
        }
      }
    } else {
      const sticker = project.stickers.find((candidate) => candidate.id === item.target);
      if (!sticker) continue;
      const resolved = resolveSticker(sticker, gradeId);
      const extent = stickerHalfExtent(resolved);
      // sway/bob은 정지 자리보다 더 넓게 움직인다(각각 6°·3% 상한, renderer.mjs paintLivingItem과 같은 공식).
      // 이 범위까지 박스에 포함하지 않으면 애니메이션 중 스프라이트 칸 밖으로 잘린다.
      const swayDeg = item.kind === 'sway' ? (clamp(item.amplitude, 0, 100, 0) / 100) * 6 : 0;
      const bobFrac = item.kind === 'bob' ? (clamp(item.amplitude, 0, 100, 0) / 100) * .03 : 0;
      const rotationDeg = (resolved.rotation ?? 0) + swayDeg;
      let { left, right, top, bottom } = extent;
      if (rotationDeg) {
        // 회전이 있으면 비대칭 상자를 정확히 굴리는 대신 가장 넓은 변 기준으로 둥글게 넉넉히 잡는다.
        const rotated = rotatedHalfExtent(Math.max(left, right), Math.max(top, bottom), rotationDeg);
        left = right = rotated.halfW; top = bottom = rotated.halfH;
      }
      top += bobFrac; bottom += bobFrac;
      minX = Math.min(minX, resolved.x - left); minY = Math.min(minY, resolved.y - top);
      maxX = Math.max(maxX, resolved.x + right); maxY = Math.max(maxY, resolved.y + bottom);
    }
  }
  if (minX > maxX || minY > maxY) return undefined;
  const x = clamp(minX - padding, 0, 1, 0), y = clamp(minY - padding, 0, 1, 0);
  const w = Math.min(clamp(maxX + padding, 0, 1, 1) - x, 1 - x), h = Math.min(clamp(maxY + padding, 0, 1, 1) - y, 1 - y);
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
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
