import { createProject, createGrade, createId, cloneProject, cropTransform, clamp, upgradeProject, resolveGreeting, MASCOT_POSES, strokeAlpha, LIVING_KINDS, MASCOT_BLINK, parallaxLivingPointTotal, PARALLAX_LIVING_POINT_BUDGET, thicknessPresetLabel } from './collectible-model.mjs';
import { renderCollectible, renderCrop, renderStory, serializeDerived, serializeStoryFrames, validateStory, clearCollectibleRenderCache } from './collectible-renderer.mjs';
import { createCollectibleStudio } from './collectible-studio.mjs';
import { attachWaveform } from './collectible-waveform.mjs';
import { collectibleErrorMessage, localError } from './collectible-errors.mjs';
import { draftStorageKey, draftEditsOnly, applyDraftEdits, findMaterialConflict, findMaterialConflicts, materialConflictQuestion, materialSwapNotice, faceFitCrop, centerFillCrop } from './collectible-assist.mjs';

const effectNames = { metallic: '메탈릭', hologram: '홀로그램', pearl: '펄', matte: '무광', enamel: '에나멜', glass: '유리', glow: '발광' };
const motionNames = { still: '정지', rotate: '천천히 회전', shine: '빛 지나가기', float: '살짝 떠오르기', stamp: '도장 찍기', sparkle: '반짝임 한 번', pulse: '부드러운 맥동', confetti: '작은 축하 입자' };
const mascotPoseNames = { cheer: '만세', 'explore-map': '지도 들기', friends: '하이파이브', gift: '선물 안기', 'logo-badge': '로고 배지', puzzled: '갸우뚱', search: '돋보기', 'sky-town-header': '하늘 동네', sleep: '잠자기', stamp: '도장 찍기', 'town-map': '동네 지도', wave: '손 흔들기' };
const particleNames = { confetti: '색종이', snow: '눈', petals: '꽃잎', sparkles: '반짝임' };
const storyNames = { none: '사용하지 않음', zoom: '안으로 들어가기 · 사진 한 장 확대', wide: '바깥 공간 공개 · 넓은 사진', follow: '마스코트 따라가기 · 이동 장면', event: '짧은 사건 · 시작·행동·결과' };
const element = (tag, text, attributes = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) if (name === 'className') node.className = value; else node.setAttribute(name, String(value));
  return node;
};
const button = (text, action, attributes = {}) => element('button', text, { type: 'button', 'data-action': action, ...attributes });
// 서버는 스티커 텍스트를 80자·4줄(개행 기준)까지만 받는다. maxlength=80은 글자 수만 막으므로, 줄 수는 여기서 직접 자른다.
const clampStickerLines = text => { const lines = text.split('\n'); return lines.length > 4 ? { text: lines.slice(0, 4).join('\n'), truncated: true } : { text, truncated: false }; };
export const normalizeMp3DataUrl = dataUrl => dataUrl.replace(/^data:[^;]*;base64,/, 'data:audio/mpeg;base64,');
export async function editableDraft(request, base, wrapper) {
  if (wrapper?.status !== 'PUBLISHED') return wrapper;
  const copied = await request(`${base}/${encodeURIComponent(wrapper.id)}/copy`, { method: 'POST', body: { expectedVersion: wrapper.version } });
  return copied.project?.id ? copied.project : copied;
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('파일을 읽지 못했어요. 다시 선택해 주세요.')); reader.readAsDataURL(file);
  });
}
async function inspectImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('사진 형식을 읽지 못했어요. JPG·PNG·WebP를 선택해 주세요.')); image.src = dataUrl;
  });
}
async function inspectAudio(dataUrl) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const timer = setTimeout(() => { audio.src = ''; reject(new Error('음성 길이를 읽지 못했어요. 다른 MP3 파일로 다시 시도해 주세요.')); }, 10000);
    audio.onloadedmetadata = () => { clearTimeout(timer); const duration = audio.duration; audio.src = ''; Number.isFinite(duration) ? resolve(duration) : reject(new Error('음성 길이를 읽지 못했어요.')); };
    audio.onerror = () => { clearTimeout(timer); audio.src = ''; reject(new Error('음성을 재생할 수 없어요. 다른 MP3 파일로 다시 시도해 주세요.')); };
    audio.src = dataUrl;
  });
}
// campaigns를 넘기면 서버가 돌려준 "지금 게시할 수 있는 캠페인" 목록과도 맞춰 본다(목록 밖 캠페인·캠페인에 없는 방문 목표는 게시 API가 409로 거절한다).
// 서버가 받는 크기 상한(docs/COLLECTIBLE_CREATOR.md "서버 계약"). 넘으면 보내기 전에 안내해 413을 받지 않게 한다.
const MiB = 1024 * 1024;
export const mediaLimits = { image: MiB, thumbnail: 128 * 1024, back: 256 * 1024, mask: 256 * 1024, scene: 512 * 1024, living: 512 * 1024, body: 8 * MiB - 4096, stickers: 30, backStickers: 10 };
// 크기 사다리(설계 문서 "서버 검증·스냅샷·상한·저장"): 프레임 한 변 448→384→320→256px, 화질 .85(앞 두 단계)→
// .7(나머지)로 angleFrames·living 스프라이트를 다시 구워 publishSizeProblem을 통과할 때까지 시도한다.
// 그래도 넘으면 가장 작은 단계 결과를 그대로 두고 기존 초과 안내로 넘어간다.
export const SPRITE_SIZE_LADDER = Object.freeze([
  Object.freeze({ side: 448, quality: .85 }),
  Object.freeze({ side: 384, quality: .85 }),
  Object.freeze({ side: 320, quality: .7 }),
  Object.freeze({ side: 256, quality: .7 }),
]);
const decodedBytes = dataUrl => { const data = dataUrl.slice(dataUrl.indexOf(',') + 1); return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0); };
export function publishSizeProblem(revision) {
  for (const assets of Object.values(revision.derived || {})) {
    for (const [name, max] of [['imageDataUrl', mediaLimits.image], ['baseDataUrl', mediaLimits.image], ['thumbnailDataUrl', mediaLimits.thumbnail], ['backImageDataUrl', mediaLimits.back]]) {
      if (assets[name] && decodedBytes(assets[name]) > max) return '완성 이미지가 너무 커요. 작은 사진이나 단순한 보정으로 다시 시도해 주세요. 원본과 입력은 유지했어요.';
    }
    if (Object.values(assets.effectMasks || {}).some(mask => decodedBytes(mask) > mediaLimits.mask)) return '효과 영역 이미지가 너무 커요. 효과 대상이나 스티커를 줄여 다시 시도해 주세요. 원본과 입력은 유지했어요.';
    if (assets.angleFrames && decodedBytes(assets.angleFrames.dataUrl) > mediaLimits.image) return '회전 각도 이미지가 너무 커요. 효과나 패럴랙스 강도를 줄여 다시 시도해 주세요. 원본과 입력은 유지했어요.';
    if (assets.living && decodedBytes(assets.living.dataUrl) > mediaLimits.living) return '살아있는 그림 이미지가 너무 커요. 움직이는 영역을 줄이거나 재생 주기를 조정해 다시 시도해 주세요. 원본과 입력은 유지했어요.';
  }
  if ((revision.story?.frames || []).some(frame => frame.previewDataUrl && decodedBytes(frame.previewDataUrl) > mediaLimits.scene)) return '이야기 장면 미리보기가 너무 커요. 더 단순한 장면 사진으로 바꿔 다시 시도해 주세요. 입력은 유지했어요.';
  const body = new TextEncoder().encode(JSON.stringify({ project: revision })).length;
  if (body > mediaLimits.body) return `수집품 전체가 ${(body / MiB).toFixed(1)} MB로 서버 한도 8 MB를 넘었어요. 작은 사진·음성으로 바꾸거나 쓰지 않는 장면 사진과 등급을 줄여 다시 저장해 주세요. 입력은 그대로 있어요.`;
  return '';
}

export function validatePublish(project, campaigns) {
  if (!project.name.trim()) return '수집품 이름을 입력해 주세요.';
  if (!project.photo.originalDataUrl) return '대표 사진 한 장을 올려 주세요.';
  if (!project.campaignId) return '수집품을 연결할 캠페인을 선택해 주세요.';
  if (!Object.values(project.rewardGrades).some(value => project.grades.some(grade => grade.id === value && grade.enabled))) return '기존 방문 목표 중 한 개 이상에 수집품 등급을 연결해 주세요.';
  if (Array.isArray(campaigns)) {
    const campaign = campaigns.find(item => item.id === project.campaignId);
    if (!campaign) return '선택한 캠페인은 지금 게시할 수 없어요. 저장 목록을 새로 보고 진행 중인 캠페인을 다시 골라 주세요.';
    const missing = Object.keys(project.rewardGrades).filter(goal => Array.isArray(campaign.goals) && !campaign.goals.includes(Number(goal)));
    if (missing.length) return `선택한 캠페인에 없는 방문 목표(${missing.join('·')}회)가 연결돼 있어요. 연결을 풀거나 다른 캠페인을 골라 주세요.`;
  }
  return validateStory(project.story);
}

/** Editing is local until the merchant explicitly saves or publishes a version. */
export function mountCollectibleEditor(container, { merchantId, merchantName = '', campaigns: initialCampaigns = [], loadCampaigns, request, onNotice = () => {}, onAccessDenied, confirm = message => globalThis.confirm?.(message) === true, accountScope = '', autosaveDelayMs = 1500 }) {
  if (!container || typeof request !== 'function') return () => {};
  let campaigns = initialCampaigns;
  let campaignSequence = 0;
  const base = `/api/web/merchant/merchants/${encodeURIComponent(merchantId)}/collectible-projects`;
  // 기기 보관 자동 저장 키. 계정 구분값이 없으면(로그아웃 상태에 가까운 호출 등) 자동 저장·복원 자체를 하지 않는다.
  const draftsEnabled = Boolean(accountScope);
  const draftKey = draftsEnabled ? draftStorageKey(merchantId, accountScope) : '';
  let autosaveTimer = 0;
  // 마운트할 때 이 키에 이미 로컬 보관본이 있으면, 복원할지 물어보기 전까지 자동 저장이 그 보관본을 덮어쓰지 못하게 막는다
  // (초기 저장 목록 조회 중 편집하면 결정 전에 자동 저장이 먼저 실행될 수 있다).
  let draftDecided = true;
  if (draftsEnabled) {
    try { const raw = window.localStorage?.getItem(draftKey); const existing = raw ? JSON.parse(raw) : null; if (existing?.merchantId === merchantId && existing?.accountMarker === accountScope) draftDecided = false; } catch { /* 못 읽으면 보호할 것도 없다 */ }
  }
  const controller = new AbortController();
  const signal = controller.signal;
  let project = createProject({ name: `${merchantName || '우리 가게'} 수집품` });
  let wrapper = null, selectedGrade = project.grades[0].id, selectedSticker = '', selectedTemplate = 'rotate', stickerSide = 'front';
  // 자르기 캔버스의 붓이 지금 어디에 칠하는지: 'photo'(사진 보정, 기존), 'parallax'(패럴랙스 전경/배경),
  // 'living:<id>'(그 living 항목의 영역). 설계 문서 "패럴랙스" 항목: 사진 브러시 포인터 코드를 그대로 재사용한다.
  let brushTarget = 'photo', selectedLivingId = '';
  let active = true, playing = false, storyPlaying = false, frame = 0, renderSequence = 0, cropSequence = 0, previewQueued = false;
  let start = performance.now(), lastFrame = 0, recorder = null, recordingStream = null, recordingTimer = 0;
  // living 미리보기 전용 시계(PR #310 리뷰 P2). start는 재생·단계 이동마다 리셋되지만(카드 전체 동작용), living은
  // "지금 보는 등급" 선택이 바뀌어도 계속 흐르는 시간이 필요해 따로 둔다.
  const livingStart = performance.now();
  let dirty = false, editSerial = 0, busy = false, restoring = false, pointer = null, visible = true, uploadSequence = 0;
  let audioImportSequence = 0, storyImportSequence = 0, recordSequence = 0, recordingPending = false;
  const pendingFiles = new Set();
  let listed = new Map();
  let loading = false;
  let studio, navigationSequence = 0, listSequence = 0;
  const loadingInputs = new Map();
  let undo = [], redo = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const demoProject = createProject({ name: '월계' });
  demoProject.stickers.push({ id: 'demo-letter', kind: 'text', text: '월계', x: .5, y: .5, size: 96, rotation: 0, color: '#fff4da', order: 0 });
  container.classList.add('collectible-editor');
  container.innerHTML = `
    <div class="ce-heading"><div><h2>사진으로 가게 수집품 만들기</h2><p>사진 한 장으로 시작하고, 더 꾸미고 싶은 항목만 펼쳐 보세요.</p></div><div class="ce-actions"><button type="button" data-action="new">새 초안</button><button type="button" data-action="refresh">저장 목록 새로 보기</button></div></div>
    <label class="ce-field">저장한 프로젝트<select data-control="project-list"><option value="">초안을 골라 다시 편집할 수 있어요</option></select></label>
    <p data-view="notice" class="ce-notice" role="status" aria-live="polite"></p>
    <div class="ce-grid"><div class="ce-controls">
      <label class="ce-field">수집품 이름<input data-control="name" maxlength="80" required></label>
      <label class="ce-field">대표 사진 · JPG, PNG, WebP<input data-control="photo" type="file" accept="image/jpeg,image/png,image/webp"></label>
      <p class="ce-help">가게·메뉴·간판·그림도 좋아요. 원본은 그대로 보관해 다시 자를 수 있어요. 사진은 3 MB, 한 변 4,096픽셀까지 지원해요. 게시한 사진·음성은 이미 받은 손님의 도감에 남을 수 있어요. 사용할 권한이 있는 자료를 골라 주세요.</p>
      <label class="ce-field">모양<select data-control="shape"><option value="circle">원형 동전</option><option value="stamp">우표</option><option value="serrated">뾰족한 톱니</option></select></label>
      <canvas data-view="crop" width="512" height="512" aria-label="사진 자르기와 붓 편집. 사진을 드래그해 옮기거나 아래 이동 조절을 이용하세요."></canvas>
      <label class="ce-field">사진 확대 <output data-value="zoom"></output><input data-control="zoom" type="range" min="1" max="8" step="0.05" value="1"></label>
      <div class="ce-row"><label class="ce-field">사진 가로 이동<input data-control="crop-x" type="range" min="-1" max="1" step="0.01" value="0"></label><label class="ce-field">사진 세로 이동<input data-control="crop-y" type="range" min="-1" max="1" step="0.01" value="0"></label></div>
      <div class="ce-actions"><button type="button" data-action="crop-reset">틀 채우기</button><button type="button" data-action="auto-fit">자동 맞춤</button><button type="button" data-action="crop-apply">자르기 적용</button><button type="button" data-action="undo">되돌리기</button><button type="button" data-action="redo">다시 실행</button></div>
      <label class="ce-field">빠른 스타일<select data-control="style"><option value="original">원본 색 유지</option><option value="incised">단색 음각 · 안으로 파인 명암</option><option value="raised">단색 양각 · 올라온 명암</option></select></label>
      <details><summary>사진 세부 조정</summary><div class="ce-detail">
        <label class="ce-field">붓 대상<select data-control="brush-target"><option value="photo">사진 보정</option><option value="parallax">패럴랙스 깊이</option></select></label>
        <label class="ce-field">붓 도구<select data-control="brush"><option value="move">사진 이동</option><option value="clean">잡티 정리 · 주변색으로 정리</option><option value="erase">투명 처리</option><option value="restore">원본 복원</option><option value="color">영역 색 일관화</option></select></label>
        <label class="ce-field">붓 크기<input data-control="brush-size" type="range" min="0.01" max="0.2" step="0.01" value="0.05"></label>
        <label class="ce-field">영역 색<input data-control="brush-color" type="color" value="#c69b71"></label>
        <div data-view="parallax-controls" hidden>
          <label class="ce-field">패럴랙스 강도<input data-control="parallax-strength" type="range" min="0" max="100" value="0"></label>
          <label class="ce-field">패럴랙스 붓<select data-control="parallax-tool"><option value="fg">전경(튀어나와 보임)</option><option value="bg">배경(물러나 보임)</option></select></label>
          <button type="button" data-action="parallax-clear">패럴랙스 획 지우기</button>
          <p class="ce-help">전경으로 칠한 부분은 기울이거나 회전할 때 더 튀어나와 보이고, 배경으로 칠한 부분은 반대로 물러나 보여요.</p>
        </div>
        <p class="ce-help">사진 위를 칠하면 바로 반영돼요. 투명한 영역의 체크무늬는 편집용이며, 완성품에는 바탕색이 비쳐요.</p>
        <button type="button" data-action="compare">원본과 비교</button><button type="button" data-action="edits-reset">사진 보정 초기화</button>
        <label class="ce-field">밝기<input data-edit="brightness" type="range" min="-100" max="100" value="0"></label>
        <label class="ce-field">대비<input data-edit="contrast" type="range" min="-100" max="100" value="0"></label>
        <label class="ce-field">비슷한 색 합치기<input data-edit="merge" type="range" min="0" max="100" value="0"></label>
        <label class="ce-field">작은 질감 단순화<input data-edit="simplify" type="range" min="0" max="100" value="0"></label>
        <label class="ce-field">만화 필터<input data-edit="cartoon" type="range" min="0" max="100" value="0"></label>
        <label class="ce-field">단색 바탕<input data-control="base-color" type="color" value="#bf8149"></label>
        <label class="ce-field">사진 원본 색 반영<input data-control="photo-color" type="range" min="0" max="100" value="100"></label>
        <label class="ce-field">음각·양각 깊이<input data-control="relief" type="range" min="0" max="100" value="45"></label>
      </div></details>
      <details><summary>앞면·뒷면 스티커</summary><div class="ce-detail">
        <label class="ce-field">꾸밀 면<select data-control="sticker-side"><option value="front">앞면</option><option value="back">뒷면</option></select></label>
        <div data-view="back-mode-row" hidden>
          <label class="ce-field">뒷면 모드<select data-control="back-mode"><option value="default">기본 · 가게 이름과 등급을 자동으로 보여요</option><option value="custom">커스텀 · 직접 꾸며요</option></select></label>
          <label class="ce-field">뒷면 바탕색<input data-control="back-color" type="color"></label>
        </div>
        <div data-view="sticker-form">
          <div class="ce-row">
            <label class="ce-field">종류<select data-control="sticker-kind"><option value="text">텍스트</option><option value="emoji">이모티콘</option><option value="mascot">마스코트</option></select></label>
            <label class="ce-field" data-view="sticker-new-text">내용 · 최대 4줄<textarea data-control="sticker-new" maxlength="80" rows="2" placeholder="어서오세요 또는 ☕"></textarea></label>
            <label class="ce-field" data-view="sticker-new-mascot" hidden>마스코트 포즈<select data-control="sticker-new-pose"></select></label>
          </div>
          <button type="button" data-action="sticker-add">스티커 추가</button>
          <label class="ce-field">편집할 스티커<select data-control="sticker-list"></select></label>
          <label class="ce-field" data-view="sticker-text-field">스티커 내용 · 최대 4줄<textarea data-sticker="text" maxlength="80" rows="2"></textarea></label>
          <label class="ce-field" data-view="sticker-pose-field" hidden>마스코트 포즈<select data-sticker="text" data-role="pose"></select></label>
          <label class="ce-field">정렬<select data-sticker="align"><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
          <div class="ce-row"><label class="ce-field">가로 위치<input data-sticker="x" type="range" min="0" max="1" step="0.01"></label><label class="ce-field">세로 위치<input data-sticker="y" type="range" min="0" max="1" step="0.01"></label></div>
          <label class="ce-field">글자 크기<input data-sticker="size" type="range" min="10" max="120" step="1"></label>
          <label class="ce-field">스티커 회전<input data-sticker="rotation" type="range" min="-180" max="180"></label>
          <label class="ce-field">글자 색<input data-sticker="color" type="color"></label>
          <label class="ce-check" data-view="sticker-layout-toggle"><input data-control="sticker-grade-only" type="checkbox"> 이 등급만 따로 배치</label>
          <button type="button" data-action="sticker-layout-reset">공통으로 되돌리기</button>
          <div class="ce-actions"><button type="button" data-action="sticker-front">앞으로</button><button type="button" data-action="sticker-back">뒤로</button><button type="button" data-action="sticker-delete">스티커 삭제</button></div>
          <p class="ce-help">완성 미리보기의 앞면 스티커를 드래그해 옮길 수도 있어요. 글자와 사진은 따로 저장돼요. 효과는 앞면에만 적용돼요.</p>
        </div>
      </div></details>
      <details><summary>등급과 재질 효과</summary><div class="ce-detail">
        <p class="ce-help">효과를 적용할 등급은 여러 개 선택해요. 오른쪽의 ‘지금 보는 등급’ 선택과 별개예요.</p>
        <div data-view="grade-manager"></div>
        <div class="ce-row"><label class="ce-field">새 특수등급 이름<input data-control="grade-name" maxlength="40" placeholder="축제한정"></label><label class="ce-field">설정 시작<select data-control="grade-copy"><option value="">효과 없이 새로 시작</option></select></label></div><button type="button" data-action="grade-add">특수등급 추가</button>
        <div class="ce-row"><label class="ce-field">새 효과<select data-control="effect-type"></select></label><label class="ce-field">효과 대상<select data-control="effect-target"></select></label></div><button type="button" data-action="effect-add">효과 추가</button>
        <div data-view="effects"></div>
      </div></details>
      <details><summary>움직임과 두께</summary><div class="ce-detail">
        <p class="ce-help">예시는 모두 같은 기본 동전이에요. 선택한 예시 한 개만 재생하고, 원하는 등급에 적용할 수 있어요.</p>
        <div data-view="templates" class="ce-templates"></div><div data-view="motion-grades"></div><div data-view="motion-settings"></div>
        <label class="ce-field">두께 <output data-value="thickness"></output><input data-control="thickness" type="range" min="1" max="24" step="1" value="8"></label><button type="button" data-action="thickness-reset">기본 두께로</button>
        <p class="ce-help">각도와 두께는 놓으면 완성 미리보기가 갱신돼요.</p>
      </div></details>
      <details><summary>살아 있는 그림</summary><div class="ce-detail">
        <p class="ce-help">사진 속 일부가 가만히 있는 포즈 위에서 살짝 움직여요. sway·bob은 영역(칠한 점)이나 앞면 스티커를 흔들고, steam은 영역에서 김이 올라요. blink는 눈 감은 그림이 있는 마스코트 스티커만 눈을 감았다 떠요.</p>
        <label class="ce-field">반복 주기(ms) <output data-value="living-period"></output><input data-control="living-period" type="range" min="1000" max="4000" step="100" value="2400"></label>
        <div data-view="living-items"></div>
        <div class="ce-row">
          <label class="ce-field">새 항목 종류<select data-control="living-kind"></select></label>
          <label class="ce-field">대상<select data-control="living-target"><option value="region">칠한 영역</option></select></label>
        </div>
        <button type="button" data-action="living-add">살아 있는 그림 항목 추가</button>
      </div></details>
      <details><summary>인사말과 음성</summary><div class="ce-detail">
        <label class="ce-field">사장님 인사말 · 기본값<textarea data-control="greeting" maxlength="300" rows="3" placeholder="들러 주셔서 고마워요"></textarea></label>
        <p class="ce-help">특정 등급이나 시즌 테마에서만 다른 인사말을 보여 주고 싶으면 아래에 규칙을 추가하세요. 더 구체적인 규칙(등급+테마)이 우선해요.</p>
        <div data-view="greeting-overrides"></div>
        <div class="ce-row"><label class="ce-field">새 인사말 규칙<input data-control="greeting-override-text" maxlength="300" placeholder="단골에게만 보일 인사말"></label></div>
        <button type="button" data-action="greeting-override-add">인사말 규칙 추가</button>
        <label class="ce-field">MP3 음성 · 30초, 1 MB까지<input data-control="audio" type="file" accept="audio/mpeg,.mp3"></label>
        <div class="ce-actions"><button type="button" data-action="record">직접 녹음 / 다시 녹음</button><button type="button" data-action="record-stop" disabled>녹음 종료</button><button type="button" data-action="audio-delete">음성 삭제</button></div>
        <audio data-view="audio" controls preload="metadata" aria-label="사장님 음성 미리 듣기"></audio>
        <canvas data-view="waveform" width="320" height="56" aria-hidden="true" hidden></canvas>
        <p class="ce-help">녹음은 최대 30초예요. 마이크 권한을 거절해도 텍스트 인사말로 계속 만들 수 있어요. 소리는 재생 버튼을 누를 때 나와요.</p>
      </div></details>
      <details><summary>가게 이야기</summary><div class="ce-detail">
        <label class="ce-field">이야기 유형<select data-control="story-type"></select></label>
        <p data-view="story-help" class="ce-help"></p>
        <label class="ce-field">추가 장면 사진 · 한 장 512 KB, 순서대로 최대 5장<input data-control="story-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div data-view="story-frames"></div>
        <label class="ce-field">가게 사진 만화 필터<input data-control="story-cartoon" type="range" min="0" max="100" value="0"></label>
        <div class="ce-actions"><button type="button" data-action="story-test">가게 이야기 시험</button><button type="button" data-action="story-stop">이야기 건너뛰기</button></div>
        <canvas data-view="story" width="512" height="320" aria-label="추가 사진을 이용한 가게 이야기 미리보기" hidden></canvas>
      </div></details>
      <details><summary>시즌과 기존 방문 보상 연결</summary><div class="ce-detail">
        <label class="ce-field">시즌 테마<input data-control="theme" maxlength="80" placeholder="여름축제 또는 겨울방학"></label>
        <p class="ce-help">테마를 바꿔도 등급이나 보상 조건이 자동으로 바뀌지 않아요.</p>
        <label class="ce-field">연결할 캠페인<select data-control="campaign"><option value="">게시할 캠페인을 골라 주세요</option></select></label>
        <div data-view="reward-grades"></div>
        <button type="button" data-action="copy">현재 프로젝트를 시즌 초안으로 복사</button>
      </div></details>
    </div><div class="ce-preview">
      <h3>지금 보는 등급</h3><div data-view="grade-tabs" class="ce-grade-tabs" role="group" aria-label="완성 미리보기 등급 한 개 선택"></div>
      <canvas data-view="preview" width="512" height="512" aria-label="선택된 등급의 완성 수집품 미리보기"></canvas>
      <label class="ce-field">회전 각도 <output data-value="angle"></output><input data-control="angle" type="range" min="-180" max="180" value="0"></label>
      <div class="ce-actions"><button type="button" data-action="play">재생</button><button type="button" data-action="pause">정지</button><button type="button" data-action="replay">다시 보기</button><button type="button" data-action="angle-reset">정면 보기</button></div>
      <label class="ce-check"><input data-control="reduce-motion" type="checkbox"> 움직임 줄이기</label>
      <p data-view="preview-caption" class="ce-help"></p><p data-view="greeting" class="ce-greeting"></p>
      <div class="ce-publish"><button type="button" data-action="draft">초안 저장</button><button type="button" data-action="publish" class="primary">이 결과 게시</button><button type="button" data-action="unpublish">게시 중지</button><button type="button" data-action="delete" class="ce-danger">삭제</button><p class="ce-help">게시한 버전은 보존하고, 다음 편집은 새 버전으로 게시해요. 이미 얻은 수집품은 기존 모습과 음성을 유지해요.</p><p data-view="distribution" class="ce-distribution" role="status"></p><p data-view="save-state" class="ce-help"></p></div>
    </div></div>`;
  const control = name => container.querySelector(`[data-control="${name}"]`);
  const view = name => container.querySelector(`[data-view="${name}"]`);
  const output = name => container.querySelector(`[data-value="${name}"]`);
  studio = createCollectibleStudio(container, { effectNames });
  const waveform = attachWaveform(view('audio'), view('waveform'), { signal });
  const previewCanvas = view('preview'), cropCanvas = view('crop'), storyCanvas = view('story');
  for (const [name, label] of [['zoom', '사진 확대'], ['angle', '회전 각도'], ['thickness', '두께']]) control(name).setAttribute('aria-label', label);
  const notice = (text, error = false) => { if (!active) return; view('notice').textContent = text; view('notice').classList.toggle('ce-error', error); onNotice(text); };
  function remember() { if (restoring) return; undo.push(cloneProject(project)); if (undo.length > 12) undo.shift(); redo = []; }
  // 15.1 인사말 미리보기: 지금 보는 등급·시즌 테마에 맞는 가장 구체적인 규칙을 보여 준다(서버 resolveGreeting과 같은 우선순위).
  function syncGreetingPreview() { view('greeting').textContent = resolveGreeting(project, selectedGrade); }
  function changed() { const wasDirty = dirty; dirty = true; editSerial++; if (!wasDirty) updateMediaLocks(); project.derived = {}; view('save-state').textContent = '편집한 내용이 있어요. 초안 저장 또는 게시를 눌러 보관하세요.'; previewQueued = true; syncGreetingPreview(); studio.sync(project, { dirty, wrapper }); scheduleAutosave(); }
  function mutate(fn) { remember(); fn(); changed(); schedulePreview(); }
  // 14.3 자동 저장: 서버 저장을 대신하지 않는 기기 안 임시 보관이다. 이미 서버에 저장된 프로젝트(wrapper id가 있는)만
  // 대상으로, 편집이 멈추면(약 1.5초) 사진·음성·이야기 장면·파생 이미지 같은 미디어는 빼고 편집 값만 조용히 기록한다
  // (공유 PC 개인정보 보호). 새로 시작해 아직 한 번도 저장하지 않은 초안은 beforeunload 경고로만 보호한다.
  // 저장·게시·삭제·명시적 새로 시작을 마치면 지운다. 저장 공간 접근은 모두 try/catch로 감싸 실패해도 편집이 끊기지 않는다.
  function clearDraftStorage() { if (!draftsEnabled) return; try { window.localStorage?.removeItem(draftKey); } catch { /* 저장 공간이 없어도 편집은 계속한다 */ } }
  function saveDraftLocally() {
    if (!draftsEnabled || !active || !dirty || !draftDecided || !wrapper?.id) return;
    try {
      const payload = { merchantId, accountMarker: accountScope, wrapperId: wrapper.id, wrapperVersion: wrapper.version ?? 0, savedAt: Date.now(), edits: draftEditsOnly(project) };
      window.localStorage?.setItem(draftKey, JSON.stringify(payload));
    } catch { /* 사생활 보호 모드·용량 초과라도 편집 자체는 계속한다 */ }
  }
  function scheduleAutosave() { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(saveDraftLocally, autosaveDelayMs); }
  function readDraftStorage() {
    if (!draftsEnabled) return null;
    try { const raw = window.localStorage?.getItem(draftKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  // 저장 목록을 성공적으로 읽은 뒤에만 부른다(목록을 못 읽으면 서버 버전을 0으로 잘못 가정하지 않고, 다음에 성공할 때 다시 시도한다).
  // 같은 점포·계정의 로컬 보관본이 서버와 같은 버전일 때만(더 새 서버 버전이면 조용히 지운다) 이어서 할지 물어본다.
  // 수락하면 그 프로젝트의 최신 서버본(사진·음성 포함)을 다시 받아 그 위에 편집 값만 겹친다.
  async function checkLocalDraft() {
    const draft = readDraftStorage();
    if (!active) return;
    if (!draft || draft.merchantId !== merchantId || draft.accountMarker !== accountScope || !draft.wrapperId) { draftDecided = true; return; }
    const serverVersion = listed.get(draft.wrapperId)?.version;
    if (serverVersion === undefined || serverVersion > draft.wrapperVersion) { clearDraftStorage(); draftDecided = true; return; }
    // 목록 조회를 기다리는 동안 이미 편집을 시작했으면(초기 경합), 지금 입력을 조용히 덮어쓰지 않는다. 결정하지
    // 않은 채 두어(지금 편집은 서버에 없는 새 초안이라 덮어쓸 자동 저장도 없다) 다음 새로고침에서 다시 판단한다.
    if (dirty) return;
    if (!confirm('저장하지 않은 편집을 이어서 할까요?')) { clearDraftStorage(); draftDecided = true; return; }
    draftDecided = true;
    // 복원 응답을 기다리는 동안 새로 편집하거나 다른 프로젝트로 바꿨으면 그 편집을 덮지 않는다.
    const startProject = project, startSerial = editSerial;
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.wrapperId)}`, { method: 'GET' });
      // 기다리는 동안 저장을 시작했어도 복원을 얹지 않는다(저장이 만든 새 프로젝트에 다른 초안의 편집이 붙지 않게).
      if (!active || busy || project !== startProject || editSerial !== startSerial) return;
      const serverWrapper = result.project?.id ? result.project : result;
      // 목록을 본 뒤 다른 탭이 새 버전을 저장했으면, 옛 편집을 새 버전 위에 얹지 않고 보관본을 버린다.
      if (serverWrapper.version !== draft.wrapperVersion) { clearDraftStorage(); notice('다른 곳에서 더 새로 저장된 버전이 있어 보관한 편집은 버렸어요.'); return; }
      restoring = true;
      // 기기 보관본은 pre-v2 편집기가 남긴 것일 수 있다. applyDraftEdits는 더 이상 서버의 schemaVersion을
      // 편집 값으로 덮지 않지만, 혹시 섞인 v1 모양 전체를 바로잡도록 항상 upgradeProject를 한 번 더 거친다(PR #293 P1).
      project = upgradeProject(applyDraftEdits(cloneProject(serverWrapper.project), draft.edits));
      wrapper = serverWrapper;
      selectedGrade = project.grades.find(item => item.enabled)?.id || project.grades[0].id;
      restoring = false; dirty = true; editSerial++;
      clearCollectibleRenderCache(); syncValues(); drawCrop(); schedulePreview();
      notice('저장하지 않은 편집을 이어서 열었어요. 사진·목소리는 마지막으로 저장한 것을 써요.');
    } catch (error) {
      // 이 GET 실패를 "결정됨"으로 남기면 다음 목록 새로 고침이 다시 시도하지 않아, 네트워크가 돌아와도
      // 영영 복원 기회가 없다(PR #289 후속). 기기 보관본은 그대로 두고 다음 성공한 목록 새로 고침이 다시 묻게 한다.
      if (active) { draftDecided = false; notice(collectibleErrorMessage(error, '저장하지 않은 편집을 이어서 열지 못했어요. 저장 목록을 새로 고치면 다시 시도해요.'), true); }
    }
  }
  const listen = (target, name, handler) => target.addEventListener(name, handler, { signal });
  function syncValues() {
    renderCampaignOptions();
    const values = { name: project.name, shape: project.shape, style: project.style, zoom: project.crop.zoom, 'crop-x': project.crop.x, 'crop-y': project.crop.y, 'base-color': project.baseColor, 'photo-color': project.photoColor, relief: project.relief, angle: project.angle, thickness: project.thickness, greeting: project.greeting, theme: project.theme.name, campaign: project.campaignId, 'story-type': project.story.type, 'story-cartoon': project.story.cartoon, 'parallax-strength': project.parallax.strength, 'living-period': project.living.periodMs };
    for (const [name, value] of Object.entries(values)) control(name).value = value;
    for (const input of container.querySelectorAll('[data-edit]')) input.value = project.photoEdits[input.dataset.edit];
    output('zoom').textContent = `${project.crop.zoom.toFixed(2)}배`;
    output('angle').textContent = `${project.angle}°`; output('thickness').textContent = `${project.thickness}`;
    output('living-period').textContent = `${project.living.periodMs}ms`;
    syncGreetingPreview();
    const audio = view('audio'); audio.pause(); audio.src = project.audio?.dataUrl || ''; audio.hidden = !project.audio; waveform.refresh();
    renderGrades(); renderStickers(); renderEffects(); renderMotionGrades(); renderGreetingOverrides(); renderStoryFrames(); renderLivingItems(); renderBrushTargetOptions();
    studio.sync(project, { dirty, wrapper }); syncPublishState();
  }
  function option(select, text, value) { select.append(element('option', text, { value })); }
  function renderGrades() {
    view('grade-tabs').replaceChildren(); view('grade-manager').replaceChildren();
    control('grade-copy').replaceChildren(element('option', '효과 없이 새로 시작', { value: '' }));
    for (const grade of project.grades) {
      const tab = button(grade.name, 'grade-preview', { 'data-id': grade.id, 'aria-pressed': String(selectedGrade === grade.id) });
      const thumbnail = element('canvas', undefined, { width: 80, height: 80, 'aria-hidden': 'true' }); tab.prepend(thumbnail);
      tab.disabled = !grade.enabled; view('grade-tabs').append(tab);
      // Comparison thumbnails remain static, including when one main preview plays.
      renderCollectible(thumbnail, project, grade.id, { staticFrame: true, angle: 0, textureSize: 240 }).catch(() => {});
      option(control('grade-copy'), grade.name, grade.id);
      const row = element('div', undefined, { className: 'ce-grade-row' });
      const name = element('input', undefined, { value: grade.name, maxlength: 40, 'aria-label': `${grade.name} 표시 이름`, 'data-grade-name': grade.id });
      const enabled = element('input', undefined, { type: 'checkbox', 'data-grade-enabled': grade.id }); enabled.checked = grade.enabled;
      const label = element('label', undefined, { className: 'ce-check' }); label.append(enabled, document.createTextNode(' 사용')); row.append(name, label); view('grade-manager').append(row);
    }
    renderRewardGrades();
  }
  // 선택한 캠페인에 실제로 있는 방문 목표만 보여 준다(없는 목표를 연결하면 게시가 409로 거절된다). 캠페인을 아직 모르면 기존 1·3·5를 모두 보인다.
  const goalsFor = campaignId => campaigns.find(item => item.id === campaignId)?.goals ?? [1, 3, 5];
  function campaignLabel(campaign) {
    const other = campaign.publication && campaign.publication.projectId !== wrapper?.id;
    return `${campaign.title || campaign.id}${other ? ' · 지금 다른 수집품이 나가는 중 (게시하면 교체돼요)' : ''}`;
  }
  function renderCampaignOptions() {
    const select = control('campaign');
    select.replaceChildren(element('option', '게시할 캠페인을 골라 주세요', { value: '' }));
    for (const campaign of campaigns) if (campaign?.id && (!campaign.status || campaign.status === 'ACTIVE')) option(select, campaignLabel(campaign), campaign.id);
    select.value = project.campaignId;
  }
  async function refreshCampaigns({ quiet = false } = {}) {
    if (!loadCampaigns) return true;
    const sequence = ++campaignSequence;
    try {
      const loaded = await loadCampaigns();
      if (!active || sequence !== campaignSequence) return true;
      campaigns = loaded; renderCampaignOptions(); renderRewardGrades(); renderProjectList();
      return true;
    } catch (error) {
      if (active && error?.status === 403 && onAccessDenied) onAccessDenied(error);
      else if (active && !quiet && sequence === campaignSequence) notice(`게시할 캠페인 목록을 불러오지 못했어요. ${collectibleErrorMessage(error, '편집은 계속할 수 있어요. 저장 목록 새로 보기를 눌러 다시 시도해 주세요.')}`, true);
      return false;
    }
  }
  function renderRewardGrades() {
    const host = view('reward-grades'); host.replaceChildren();
    for (const count of goalsFor(project.campaignId)) {
      const label = element('label', `${count}회 방문 목표의 수집품 외형`, { className: 'ce-field' });
      const select = element('select', undefined, { 'data-reward-count': count }); option(select, '연결하지 않음', '');
      for (const grade of project.grades.filter(item => item.enabled)) option(select, grade.name, grade.id);
      select.value = project.rewardGrades[String(count)] || ''; label.append(select); host.append(label);
    }
    host.append(element('p', '방문 조건·쿠폰·NFT 규칙은 현재 캠페인을 따르고, 여기서는 기존 목표에 보이는 사진 수집품만 연결해요.', { className: 'ce-help' }));
  }
  // 꾸밀 면(앞/뒤)에 맞는 스티커 배열. 뒷면은 layouts가 없고 효과 대상도 될 수 없다(서버·설계 문서, 앞면 전용 유지).
  function activeStickers() { return stickerSide === 'back' ? project.back.stickers : project.stickers; }
  // 선택한 스티커가 "이 등급만 따로 배치" 중이면 x·y·size·rotation은 그 등급의 layouts를, 아니면 스티커 자체를 읽고 쓴다.
  function stickerPositionTarget(sticker) {
    if (stickerSide === 'front' && sticker.layouts?.[selectedGrade]) return sticker.layouts[selectedGrade];
    return sticker;
  }
  function stickerLabel(sticker) { return sticker.kind === 'mascot' ? `마스코트 · ${mascotPoseNames[sticker.text] || sticker.text}` : sticker.text; }
  function renderStickers() {
    control('sticker-side').value = stickerSide;
    view('back-mode-row').hidden = stickerSide !== 'back';
    if (stickerSide === 'back') { control('back-mode').value = project.back.mode; control('back-color').value = project.back.color; }
    view('sticker-form').hidden = stickerSide === 'back' && project.back.mode !== 'custom';
    const list = activeStickers();
    const select = control('sticker-list'); select.replaceChildren();
    if (!list.some(sticker => sticker.id === selectedSticker)) selectedSticker = list.at(-1)?.id || '';
    for (const sticker of [...list].sort((a, b) => a.order - b.order)) option(select, stickerLabel(sticker), sticker.id);
    select.value = selectedSticker;
    const sticker = list.find(item => item.id === selectedSticker);
    const isMascot = sticker?.kind === 'mascot';
    view('sticker-text-field').hidden = !sticker || isMascot;
    view('sticker-pose-field').hidden = !sticker || !isMascot;
    const poseSelect = container.querySelector('[data-sticker="text"][data-role="pose"]');
    for (const input of container.querySelectorAll('[data-sticker]')) {
      input.disabled = !sticker;
      if (!sticker) continue;
      if (input === poseSelect) { input.value = sticker.text; continue; }
      if (input.dataset.sticker === 'text' && isMascot) continue; // textarea는 마스코트일 때 숨고 값도 건드리지 않는다.
      input.value = ['x', 'y', 'size', 'rotation'].includes(input.dataset.sticker) ? stickerPositionTarget(sticker)[input.dataset.sticker] : sticker[input.dataset.sticker];
    }
    view('sticker-layout-toggle').hidden = stickerSide !== 'front' || !sticker;
    const hasLayout = Boolean(sticker?.layouts?.[selectedGrade]);
    if (sticker && stickerSide === 'front') control('sticker-grade-only').checked = hasLayout;
    container.querySelector('[data-action="sticker-layout-reset"]').hidden = stickerSide !== 'front' || !hasLayout;
    const targets = control('effect-target'), previous = targets.value; targets.replaceChildren();
    for (const [id, name] of [['surface', '전체 표면'], ['photo', '사진'], ['border', '테두리'], ...project.stickers.map(item => [item.id, `스티커 · ${stickerLabel(item)}`])]) option(targets, name, id);
    if ([...targets.options].some(item => item.value === previous)) targets.value = previous;
    studio.sync(project, { dirty, wrapper });
  }
  // 추가 폼의 "내용"(텍스트/이모티콘) 또는 "마스코트 포즈" 중 고른 종류에 맞는 칸만 보인다.
  function syncStickerKindVisibility() {
    const mascot = control('sticker-kind').value === 'mascot';
    view('sticker-new-text').hidden = mascot;
    view('sticker-new-mascot').hidden = !mascot;
  }
  function gradeChecks(parent, selected, attributes) {
    const motion = attributes['data-motion-grade'];
    const override = attributes['data-override-grade'];
    const living = attributes['data-living-grade'];
    const kind = motion ? 'motion' : override ? 'greeting' : living ? 'living' : 'effect';
    const group = element('div', undefined, { className: 'ce-grade-checks', role: 'group', 'aria-label': { motion: '동작을 적용할 등급 여러 개 선택', greeting: '이 인사말 규칙을 적용할 등급 여러 개 선택', living: '이 living 항목을 적용할 등급 여러 개 선택', effect: '효과를 적용할 등급 여러 개 선택' }[kind] });
    for (const grade of project.grades) {
      const label = element('label', undefined, { className: 'ce-check' });
      const checkbox = element('input', undefined, { type: 'checkbox', ...attributes, 'data-grade': grade.id }); checkbox.checked = selected.includes(grade.id); checkbox.disabled = !grade.enabled;
      label.append(checkbox, document.createTextNode(grade.name)); group.append(label);
    }
    parent.append(group);
    if (kind === 'greeting') return; // 인사말 규칙은 몇 개 없어 전체 선택·해제 없이 하나씩 고른다.
    // 8.1 등급 전체 선택·해제. 미리보기 등급(selectedGrade)은 건드리지 않는다.
    const id = motion || living || attributes['data-effect-grade'];
    const bulk = element('div', undefined, { className: 'ce-grade-bulk' });
    const allAction = motion ? 'motion-grade-all' : living ? 'living-grade-all' : 'effect-grade-all';
    const noneAction = motion ? 'motion-grade-none' : living ? 'living-grade-none' : 'effect-grade-none';
    bulk.append(button('전체 선택', allAction, { 'data-id': id }), button('전체 해제', noneAction, { 'data-id': id }));
    parent.append(bulk);
  }
  const livingKindNames = { sway: '좌우로 살짝 흔들림(sway)', bob: '위아래로 살짝 흔들림(bob)', steam: '김 오르기(steam)', blink: '눈 감았다 뜨기(blink, 마스코트만)' };
  // blink는 마스코트 스티커(눈 감은 그림이 있는 포즈)만 대상으로 고를 수 있다(설계 문서 "living picture" 항목, 서버 rules.ts와 같은 규칙).
  function renderLivingTargetOptions() {
    const select = control('living-target'), previous = select.value; select.replaceChildren();
    option(select, '칠한 영역', 'region');
    for (const sticker of project.stickers) option(select, `스티커 · ${stickerLabel(sticker)}`, sticker.id);
    if ([...select.options].some(item => item.value === previous)) select.value = previous;
  }
  function livingTargetLabel(item) {
    if (item.target === 'region') return '칠한 영역';
    const sticker = project.stickers.find(candidate => candidate.id === item.target);
    return sticker ? `스티커 · ${stickerLabel(sticker)}` : '(삭제된 스티커)';
  }
  function renderLivingItems() {
    renderLivingTargetOptions();
    const host = view('living-items'); host.replaceChildren();
    for (const item of project.living.items) {
      const row = element('fieldset', undefined, { className: 'ce-living-item' });
      row.append(element('legend', `${livingKindNames[item.kind] || item.kind} · ${livingTargetLabel(item)}`));
      gradeChecks(row, item.gradeIds, { 'data-living-grade': item.id });
      const amplitude = element('label', '움직임 크기', { className: 'ce-field' });
      amplitude.append(element('input', undefined, { type: 'range', min: 0, max: 100, value: item.amplitude, 'data-living-amplitude': item.id }));
      row.append(amplitude);
      if (item.target === 'region') {
        row.append(element('p', `칠한 점 ${item.strokes?.length ?? 0}/20개`, { className: 'ce-help' }));
        row.append(button(brushTarget === `living:${item.id}` ? '지금 이 영역을 칠하는 중' : '이 영역 칠하기', 'living-paint', { 'data-id': item.id, 'aria-pressed': String(brushTarget === `living:${item.id}`) }));
        row.append(button('점 지우기', 'living-clear', { 'data-id': item.id }));
      }
      row.append(button('항목 삭제', 'living-delete', { 'data-id': item.id })); host.append(row);
    }
  }
  function renderBrushTargetOptions() {
    const select = control('brush-target'), previous = brushTarget;
    select.replaceChildren(element('option', '사진 보정', { value: 'photo' }), element('option', '패럴랙스 깊이', { value: 'parallax' }));
    for (const item of project.living.items.filter(candidate => candidate.target === 'region')) option(select, `living 영역 · ${livingKindNames[item.kind] || item.kind}`, `living:${item.id}`);
    if (![...select.options].some(item => item.value === previous)) brushTarget = 'photo';
    select.value = brushTarget;
    view('parallax-controls').hidden = brushTarget !== 'parallax';
  }
  function renderEffects() {
    const previousFocus = document.activeElement;
    const host = view('effects'); host.replaceChildren();
    for (const effect of project.effects) {
      const row = element('fieldset', undefined, { className: 'ce-effect' });
      const targetName = { surface: '전체 표면', photo: '사진', border: '테두리' }[effect.target] || project.stickers.find(item => item.id === effect.target)?.text || '스티커';
      row.append(element('legend', `${effectNames[effect.type]} · ${targetName}`));
      gradeChecks(row, effect.gradeIds, { 'data-effect-grade': effect.id });
      if (!effect.gradeIds.length) row.append(element('p', '현재 어느 등급에도 적용하지 않아요.', { className: 'ce-help' }));
      const label = element('label', '효과 강도', { className: 'ce-field' }); label.append(element('input', undefined, { type: 'range', min: 0, max: 100, value: effect.strength, 'data-effect-strength': effect.id })); row.append(label);
      const color = element('label', '재질 색', { className: 'ce-field' }); color.append(element('input', undefined, { type: 'color', value: effect.color, 'data-effect-color': effect.id })); row.append(color);
      if (effect.type === 'metallic') { const rough = element('label', '표면 거칠기', { className: 'ce-field' }); rough.append(element('input', undefined, { type: 'range', min: 0, max: 100, value: effect.roughness, 'data-effect-roughness': effect.id })); row.append(rough); }
      row.append(button('효과 삭제', 'effect-delete', { 'data-id': effect.id })); host.append(row);
    }
    refocusGrade(host, previousFocus, 'effectGrade');
  }
  function refocusGrade(host, previousFocus, attribute) {
    if (!previousFocus?.dataset[attribute]) return;
    [...host.querySelectorAll('input')].find(input => input.dataset[attribute] === previousFocus.dataset[attribute] && input.dataset.grade === previousFocus.dataset.grade)?.focus({ preventScroll: true });
  }
  function renderMotionGrades() {
    const previousFocus = document.activeElement;
    const host = view('motion-grades'); host.replaceChildren(element('p', `${motionNames[selectedTemplate]} · 적용할 등급`, { className: 'ce-help' }));
    const selected = project.motion.find(item => item.type === selectedTemplate)?.gradeIds || [];
    gradeChecks(host, selected, { 'data-motion-grade': selectedTemplate });
    for (const tile of view('templates').querySelectorAll('button')) tile.setAttribute('aria-pressed', String(tile.dataset.id === selectedTemplate));
    refocusGrade(host, previousFocus, 'motionGrade');
    renderMotionSettings();
  }
  // 재생 방식(once/loop) 라디오와, confetti 템플릿일 때만 보이는 파티클 종류 select. 지금 고른 예시(selectedTemplate)
  // 기준이며, 등급 체크와 별개로 그 템플릿의 motion 항목에 저장된다(아직 어느 등급에도 적용하지 않았어도 선호를 남긴다).
  function renderMotionSettings() {
    const host = view('motion-settings'); host.replaceChildren();
    if (selectedTemplate === 'still') return;
    const motion = project.motion.find(item => item.type === selectedTemplate);
    const playback = motion?.playback ?? 'loop';
    host.append(element('p', '재생 방식', { className: 'ce-help' }));
    const group = element('div', undefined, { className: 'ce-radio-group', role: 'radiogroup', 'aria-label': `${motionNames[selectedTemplate]} 재생 방식` });
    for (const [value, label] of [['loop', '반복 재생'], ['once', '한 번만 재생']]) {
      const id = `motion-playback-${value}`;
      const input = element('input', undefined, { type: 'radio', name: 'motion-playback', id, value, 'data-control': 'motion-playback' });
      input.checked = playback === value;
      const labelEl = element('label', undefined, { for: id, className: 'ce-check' });
      labelEl.append(input, document.createTextNode(label));
      group.append(labelEl);
    }
    host.append(group);
    if (selectedTemplate === 'confetti') {
      const field = element('label', '파티클 종류', { className: 'ce-field' });
      const select = element('select', undefined, { 'data-control': 'motion-particle', 'aria-label': '파티클 종류' });
      for (const [value, label] of Object.entries(particleNames)) option(select, label, value);
      select.value = motion?.particle ?? 'confetti';
      field.append(select); host.append(field);
    }
  }
  function renderStoryFrames() {
    view('story-help').textContent = {
      none: '이야기는 선택 기능이에요. 추가 자료 없이 수집품을 완성할 수 있어요.', zoom: '대표 사진 한 장을 확대해요. 새 공간을 자동으로 복원하지 않아요.',
      wide: '가게 전체가 보이는 넓은 사진 1장이 필요해요. 추가 사진을 향해 카메라가 물러나요.',
      follow: '이동할 장면 사진 2장 이상이 필요해요. 준비된 장면 사이로 월계 마스코트가 이동하고 카메라가 이동해요.',
      event: '시작·행동·결과 사진을 차례로 3장 이상 올려 주세요. 준비한 장면으로 사건의 순서를 보여 줘요.',
    }[project.story.type];
    const host = view('story-frames'); host.replaceChildren();
    project.story.frames.forEach((item, index) => {
      const row = element('div', undefined, { className: 'ce-story-frame' }); row.append(element('img', undefined, { src: item.dataUrl, alt: `${index + 1}번째 이야기 장면`, width: 72, height: 48 }), element('span', `${index + 1}번째 장면`), button('삭제', 'story-frame-delete', { 'data-id': index })); host.append(row);
    });
  }
  // 등급·시즌 테마별 인사말 규칙 목록. 더 구체적인 규칙(등급+테마)이 우선한다(resolveGreeting과 같은 순서).
  function renderGreetingOverrides() {
    const host = view('greeting-overrides'); host.replaceChildren();
    for (const override of project.greetingOverrides) {
      const row = element('fieldset', undefined, { className: 'ce-override' });
      row.append(element('legend', '인사말 규칙'));
      gradeChecks(row, override.gradeIds, { 'data-override-grade': override.id });
      const theme = element('label', '시즌 테마 · 비우면 모든 테마', { className: 'ce-field' });
      theme.append(element('input', undefined, { value: override.themeName, maxlength: 80, placeholder: '예: 여름축제', 'data-override-theme': override.id }));
      row.append(theme);
      const text = element('label', '이 규칙의 인사말', { className: 'ce-field' });
      const textInput = element('textarea', undefined, { maxlength: 300, rows: 2, 'data-override-text': override.id });
      textInput.value = override.text; // textarea의 "value" 속성은 실제 브라우저에 없으므로 속성이 아니라 프로퍼티로 설정한다.
      text.append(textInput);
      row.append(text);
      if (!override.gradeIds.length && !override.themeName) row.append(element('p', '등급이나 테마를 하나 이상 골라야 저장할 수 있어요.', { className: 'ce-help' }));
      row.append(button('규칙 삭제', 'greeting-override-delete', { 'data-id': override.id }));
      host.append(row);
    }
    syncGreetingPreview();
  }
  async function drawPreview(time = 0, livingTime = 0) {
    const sequence = ++renderSequence;
    const copy = cloneProject(project);
    const buffer = document.createElement('canvas'); buffer.width = previewCanvas.width; buffer.height = previewCanvas.height;
    try {
      const reducedMotion = control('reduce-motion').checked;
      await renderCollectible(buffer, copy, selectedGrade, { angle: copy.angle, time, livingTime, reducedMotion, staticFrame: !playing || reducedMotion, merchantName });
      if (!active || sequence !== renderSequence) return;
      previewCanvas.getContext('2d').clearRect(0, 0, 512, 512); previewCanvas.getContext('2d').drawImage(buffer, 0, 0);
      const grade = project.grades.find(item => item.id === selectedGrade);
      view('preview-caption').textContent = `${project.name} · ${grade?.name || ''} · ${project.theme.name} · 두께 ${thicknessPresetLabel(project.thickness) ?? project.thickness}`;
    } catch (error) { notice(error.message || '미리보기를 만들지 못했어요. 입력은 유지했어요. 자르기 적용을 눌러 다시 시도해 주세요.', true); }
  }
  function schedulePreview() {
    previewQueued = true;
    if (!frame) frame = requestAnimationFrame(tick);
  }
  // 패럴랙스/living 영역을 칠하는 동안 자르기 캔버스에 색 오버레이로 지금까지 칠한 자리를 보여 준다(설계 문서
  // "패럴랙스" 항목: 사진 브러시 포인터 코드를 틴트 오버레이와 함께 재사용). 128×128 저해상도 마스크로 충분하다.
  function paintBrushTint(context) {
    if (brushTarget === 'photo') return;
    const strokes = brushTarget === 'parallax' ? project.parallax.strokes
      : [{ tool: 'fg', size: .1, points: project.living.items.find(item => item.id === brushTarget.slice(7))?.strokes ?? [] }];
    const maskSize = 128, alpha = strokeAlpha(strokes, maskSize, maskSize);
    const tint = document.createElement('canvas'); tint.width = maskSize; tint.height = maskSize;
    const tintContext = tint.getContext('2d'), image = tintContext.createImageData(maskSize, maskSize);
    const [r, g, b] = brushTarget === 'parallax' ? [255, 90, 90] : [90, 190, 255];
    for (let index = 0; index < alpha.length; index++) {
      image.data[index * 4] = r; image.data[index * 4 + 1] = g; image.data[index * 4 + 2] = b;
      image.data[index * 4 + 3] = alpha[index] ? 140 : 0;
    }
    tintContext.putImageData(image, 0, 0);
    const transform = cropTransform(project, 512, 512);
    context.drawImage(tint, transform.x, transform.y, transform.width, transform.height);
  }
  async function drawCrop() {
    const sequence = ++cropSequence, buffer = document.createElement('canvas'); buffer.width = 512; buffer.height = 512;
    try {
      await renderCrop(buffer, project);
      if (!active || sequence !== cropSequence) return;
      const context = cropCanvas.getContext('2d');
      context.clearRect(0, 0, 512, 512); context.drawImage(buffer, 0, 0);
      paintBrushTint(context);
    } catch (error) { notice(error.message, true); }
  }
  function loadPhotoElement(dataUrl) {
    return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('사진을 불러오지 못했어요.')); image.src = dataUrl; });
  }
  // 4.2 자동 맞춤: 결과를 강제하지 않고(버튼을 눌러야만) 얼굴 감지가 되면 얼굴을, 안 되면 가운데를 기준으로 맞춘다. 한 번의 되돌리기 단계로 남긴다.
  async function autoFit() {
    if (!project.photo.originalDataUrl) { notice('먼저 사진을 올려 주세요.', true); return; }
    // 감지가 끝나기 전에 사진을 바꾸거나 손으로 자르기를 조정했으면(둘 다 project 교체나 editSerial 증가로 나타난다)
    // 낡은 결과를 덮어쓰지 않고 버린다.
    const sourceProject = project, startSerial = editSerial, startDataUrl = project.photo.originalDataUrl;
    const stillCurrent = () => active && project === sourceProject && editSerial === startSerial && project.photo.originalDataUrl === startDataUrl;
    let crop = null;
    if (globalThis.FaceDetector) {
      try {
        const detector = new FaceDetector();
        const image = await loadPhotoElement(project.photo.originalDataUrl);
        if (!stillCurrent()) return;
        const faces = await detector.detect(image);
        if (!stillCurrent()) return;
        const largest = [...faces].map(item => item.boundingBox).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (largest) crop = faceFitCrop(project.photo.width, project.photo.height, largest);
      } catch { /* 감지에 실패하면 가운데 맞춤으로 물러난다 */ }
    }
    if (!stillCurrent()) return;
    crop ??= centerFillCrop();
    mutate(() => { project.crop = { x: crop.x, y: crop.y, zoom: crop.zoom }; });
    syncValues(); await drawCrop();
    notice(crop.method === 'face' ? '얼굴 기준으로 맞췄어요.' : '가운데로 맞췄어요.');
  }
  async function tick(now) {
    frame = 0;
    if (!active || document.hidden || !visible || studio.isHome) return;
    const allowMotion = !control('reduce-motion').checked;
    // living은 재생 버튼과 무관하게 "지금 보는 등급"에 걸려 있으면 계속 움직여야 한다(PR #310 리뷰 P2).
    const hasLiving = allowMotion && project.living.items.some(item => item.gradeIds.includes(selectedGrade));
    if (previewQueued || ((playing || hasLiving) && allowMotion && now - lastFrame >= 65)) {
      previewQueued = false; lastFrame = now; await drawPreview(now - start, now - livingStart);
    }
    if (playing && allowMotion) {
      const tile = view('templates').querySelector(`[data-id="${selectedTemplate}"] canvas`);
      if (tile) try { await renderCollectible(tile, demoProject, 'bronze', { animation: selectedTemplate, time: now - start, textureSize: 120 }); } catch { playing = false; notice('애니메이션을 준비하지 못했어요. 정지 미리보기로 계속 편집할 수 있어요.', true); }
    }
    if (storyPlaying) {
      try { await renderStory(storyCanvas, project, { time: now - start, reducedMotion: !allowMotion }); } catch (error) { storyPlaying = false; notice(error.message || '이야기를 재생하지 못했어요. 장면 사진을 확인하고 다시 시도해 주세요.', true); }
      if (now - start >= 6000 || !allowMotion) storyPlaying = false;
    }
    if (active && visible && !document.hidden && (playing && allowMotion || storyPlaying || previewQueued || hasLiving)) frame = requestAnimationFrame(tick);
  }
  function mediaPending() { return recordingPending || recorder?.state === 'recording' || [...pendingFiles].some(item => item.project === project); }
  function updateMediaLocks() {
    if (!active) return;
    const blocked = busy || mediaPending();
    container.querySelectorAll('[data-action="draft"]').forEach(item => { item.disabled = blocked; });
    // 이미 게시했고 고친 것이 없으면 다시 게시해도 같은 내용의 게시 버전만 늘어난다(게시 횟수 낭비).
    const republish = wrapper?.status === 'PUBLISHED' && !dirty;
    container.querySelectorAll('[data-action="publish"]').forEach(item => {
      item.disabled = blocked || republish;
      item.title = republish ? '이미 게시한 버전이에요. 고치면 새 버전으로 게시할 수 있어요.' : '';
    });
  }
  function setBusy(value) { busy = value; if (!active) return; for (const item of container.querySelectorAll('[data-action="draft"],[data-action="publish"],[data-action="copy"],[data-action="new"],[data-control="project-list"],[data-control="photo"],[data-control="audio"],[data-control="story-files"],[data-action="photo-choose"],[data-action="record"]')) item.disabled = value; studio.setBusy(value); updateMediaLocks(); syncPublishState(); }
  const campaignTitle = id => id ? campaigns.find(item => item.id === id)?.title || '다른 캠페인' : '';
  // 이 게시 버전이 지금 새 손님에게 나가는 캠페인. 게시한 프로젝트가 아니거나 목록을 아직 못 받았으면 빈 문자열이다.
  function distributionLabel(item) {
    if (item?.status !== 'PUBLISHED') return '';
    return item.distributingCampaignId ? `“${campaignTitle(item.distributingCampaignId)}” 캠페인에 게시 중` : '새 손님에게는 나가지 않아요 (게시 중지 또는 교체됨)';
  }
  function syncPublishState() {
    if (!active) return;
    const item = wrapper ? listed.get(wrapper.id) : undefined, published = wrapper?.status === 'PUBLISHED';
    view('distribution').textContent = !wrapper ? '아직 저장하지 않은 새 초안이에요.'
      : !published ? `초안 · 저장 버전 ${wrapper.version} · 아직 손님에게 나가지 않아요.`
      : `게시한 버전 · 저장 버전 ${wrapper.version}${item ? ` · ${distributionLabel(item)}` : ''}`;
    // 목록으로 이미 나가지 않는 것을 아는 버전은 중지할 것이 없다. 목록을 못 받았으면 서버가 판단한다.
    container.querySelector('[data-action="unpublish"]').disabled = busy || !published || (item ? !item.distributingCampaignId : false);
    container.querySelector('[data-action="delete"]').disabled = busy || !wrapper;
    updateMediaLocks();
  }
  // 목록 응답과 캠페인 목록은 따로 도착하므로, 어느 쪽이 나중에 와도 캠페인 이름이 붙은 목록을 다시 그린다.
  function renderProjectList() {
    const select = control('project-list'); select.replaceChildren(element('option', '초안을 골라 다시 편집할 수 있어요', { value: '' }));
    const items = [...listed.values()].map(item => ({ ...item, distributionLabel: distributionLabel(item) }));
    for (const item of items) option(select, `${item.name || item.project?.name || '수집품'} · ${item.status === 'PUBLISHED' ? '게시' : '초안'} · v${item.version}${item.distributionLabel ? ` · ${item.distributionLabel}` : ''}`, item.id);
    select.value = wrapper?.id || '';
    studio.renderProjects(items, wrapper?.id || ''); studio.setBusy(busy || loading); syncPublishState();
  }
  async function refreshList() {
    const sequence = ++listSequence;
    try {
      const result = await request(base, { method: 'GET' });
      if (!active || sequence !== listSequence) return;
      listed = new Map((result.projects || []).map(item => [item.id, item]));
      renderProjectList();
      // 목록을 성공적으로 읽은 뒤에만 로컬 보관본 복원 여부를 결정한다(실패한 조회는 서버 버전 0으로 잘못 가정하지 않는다).
      if (!draftDecided) await checkLocalDraft();
    } catch (error) {
      // 권한이 없는 계정(예: 직원)은 제작기를 열어 둘 이유가 없다. 호출한 쪽이 제작기를 닫고 이유를 알린다.
      if (active && error?.status === 403 && onAccessDenied) onAccessDenied(error);
      else notice(collectibleErrorMessage(error, '저장 목록을 불러오지 못했어요. 편집은 계속할 수 있고, 저장 목록 새로 보기를 눌러 다시 시도할 수 있어요.'), true);
    }
  }
  async function save(publish = false) {
    if (busy) return;
    if (mediaPending()) { notice('사진·음성을 불러오거나 녹음을 처리하고 있어요. 처리가 끝난 뒤 저장해 주세요.'); return; }
    if (!project.name.trim()) { navigateStep(1); notice('수집품 이름을 입력해 주세요.', true); control('name').focus(); return; }
    if (!project.theme.name.trim()) { navigateStep(4); notice('시즌 테마를 입력하거나 기본으로 적어 주세요.', true); control('theme').focus(); return; }
    if (project.stickers.some(item => !item.text.trim()) || project.back.stickers.some(item => !item.text.trim())) { navigateStep(3); notice('내용이 비어 있는 스티커를 채우거나 삭제해 주세요.', true); return; }
    if (project.stickers.some(item => item.text.split('\n').length > 4) || project.back.stickers.some(item => item.text.split('\n').length > 4)) { navigateStep(3); notice('스티커 내용은 4줄까지만 가능해요. 넘는 줄을 지워 주세요.', true); return; }
    if (project.greetingOverrides.some(item => !item.gradeIds.length && !item.themeName.trim())) { navigateStep(4); notice('등급이나 시즌 테마를 고르지 않은 인사말 규칙이 있어요. 하나를 고르거나 규칙을 삭제해 주세요.', true); return; }
    // PR #310 리뷰(P1): region 대상 living 항목은 서버가 점 1~20개를 요구한다(rules.ts parseLivingItem). 칠한
    // 점을 전부 지운(또는 아직 칠하지 않은) 항목을 그대로 저장하면 그 등급을 쓰지 않아도 COLLECTIBLE_INVALID_PROJECT로
    // 초안 저장조차 거절된다(validateCollectibleProject는 등급 연결 여부와 무관하게 구조 전체를 검사한다).
    if (project.living.items.some(item => item.target === 'region' && (!item.strokes || item.strokes.length === 0))) {
      navigateStep(4); notice('칠한 점이 없는 living 영역이 있어요. 영역을 칠하거나 그 항목을 삭제해 주세요.', true); return;
    }
    if (publish) {
      setBusy(true); const refreshed = await refreshCampaigns(); setBusy(false);
      if (!active || !refreshed) return;
      const reason = validatePublish(project, campaigns); if (reason) { navigateStep(!project.photo.originalDataUrl ? 1 : 4); if (project.story.type !== 'none') control('story-type').closest('details').open = true; notice(reason, true); return; } }
    setBusy(true); notice(publish ? '등급별 게시 이미지를 준비하고 있어요…' : '초안을 저장하고 있어요…');
    // 복원·업그레이드 경로에 놓친 곳이 있어도 서버로 나가는 프로젝트는 항상 v2여야 한다(PR #293 P1 방어선).
    const revision = upgradeProject(cloneProject(project)), savedSerial = editSerial;
    try {
      // Final raster assets are generated once for publication; all originals,
      // strokes, stable sticker IDs and grade assignments remain in the draft.
      if (publish) {
        revision.story.frames = await serializeStoryFrames(revision.story);
        for (const rung of SPRITE_SIZE_LADDER) {
          revision.derived = await serializeDerived(revision, { extraGradeId: selectedGrade, merchantName, angleSide: rung.side, spriteQuality: rung.quality });
          if (!publishSizeProblem(revision)) break;
        }
      }
      const sizeProblem = publishSizeProblem(revision);
      if (sizeProblem) throw localError(sizeProblem);
      if (wrapper?.status === 'PUBLISHED') {
        const copied = await editableDraft(request, base, wrapper);
        if (!active) return;
        wrapper = copied;
      }
      const saved = wrapper ? await request(`${base}/${encodeURIComponent(wrapper.id)}`, { method: 'PUT', body: { expectedVersion: wrapper.version, project: revision } }) : await request(base, { method: 'POST', body: { project: revision } });
      if (!active) return;
      wrapper = saved.project?.schemaVersion ? { ...saved, project: saved.project } : (saved.project?.id ? saved.project : saved);
      if (publish) {
        const result = await request(`${base}/${encodeURIComponent(wrapper.id)}/publish`, { method: 'POST', body: { expectedVersion: wrapper.version, campaignId: revision.campaignId } });
        if (!active) return; wrapper = result.project || result;
      }
      // 서버가 돌려준 project(이미지 메타데이터 제거·MP3 길이 재계산·게시 때 만든 파생 이미지)가 새 기준값이다.
      // 저장 중 새로 편집한 내용이 없으면 그 값으로 바꿔 "저장하지 않은 변경"이 남지 않게 하고, 있으면 편집 내용을 지키고 한 번 더 저장하게 한다.
      dirty = editSerial !== savedSerial;
      if (!dirty) {
        clearDraftStorage();
        project = cloneProject(wrapper.project || revision);
        clearCollectibleRenderCache(); syncValues(); drawCrop(); schedulePreview();
      } else { studio.sync(project, { dirty, wrapper }); saveDraftLocally(); }
      syncPublishState();
      view('save-state').textContent = `${publish ? '게시한 버전을 보존했어요' : '초안을 저장했어요'} · v${wrapper.version}${dirty ? ' · 저장 중 새로 편집한 내용은 한 번 더 저장해 주세요.' : ''}`;
      notice(publish ? '게시했어요. 이후 방문 보상부터 이 버전을 사용해요. 이미 얻은 수집품은 그대로 보존돼요.' : '초안을 저장했어요. 목록에서 다시 열어 이어서 만들 수 있어요.');
      // 게시하면 그 캠페인의 배포 연결이 바뀌므로(교체된 수집품 표시 등) 캠페인 목록도 새로 읽는다. 실패해도 저장 결과 안내를 덮지 않는다.
      await Promise.all([refreshList(), publish ? refreshCampaigns({ quiet: true }) : undefined]);
    } catch (error) { notice(collectibleErrorMessage(error), true); }
    finally { setBusy(false); }
  }
  async function loadProject(id) {
    if (!id || busy) return;
    // 거절하면 목록 선택도 지금 편집 중인 프로젝트로 되돌린다. 브라우저는 change 전에 이미 값을 바꿔 둔다.
    if (!confirmDiscardIfDirty()) { control('project-list').value = wrapper?.id || ''; return; }
    setBusy(true);
    loading = true;
    for (const input of container.querySelectorAll('input,select,textarea,button')) { loadingInputs.set(input, input.disabled); input.disabled = true; }
    notice('저장한 프로젝트를 불러오는 중이에요…');
    try {
      const result = await request(`${base}/${encodeURIComponent(id)}`, { method: 'GET' });
      if (!active) return;
      const previous = cloneProject(project);
      wrapper = result.project?.id ? result.project : result; project = upgradeProject(cloneProject(wrapper.project));
      selectedGrade = project.grades.find(item => item.enabled)?.id || project.grades[0].id; undo = dirty ? [previous] : []; redo = []; dirty = false; playing = false;
      clearCollectibleRenderCache(); syncValues(); await drawCrop(); schedulePreview(); notice(`저장한 ${project.name}을 열었어요. 게시 후 수정은 새 게시 버전을 만들어요.`);
      studio.showStep(1);
    } catch (error) { notice(collectibleErrorMessage(error, '초안을 열지 못했어요. 현재 입력은 유지했어요. 저장 목록을 새로 불러와 다시 시도해 주세요.'), true); }
    finally {
      loading = false;
      for (const [input, disabled] of loadingInputs) if (container.contains(input)) input.disabled = disabled;
      loadingInputs.clear();
      setBusy(false);
    }
  }
  function stopRecording(discard = false) {
    if (discard) { recordSequence++; recordingPending = false; }
    else if (recorder?.state === 'recording') recordingPending = true;
    if (recorder?.state === 'recording') recorder.stop();
    clearTimeout(recordingTimer); controlButtonsRecording(false);
    updateMediaLocks();
  }
  function controlButtonsRecording(value) { if (!active) return; container.querySelector('[data-action="record"]').disabled = value; container.querySelector('[data-action="record-stop"]').disabled = !value; }
  async function record() {
    if (studio.isHome || studio.step !== 4 || recorder?.state === 'recording' || recordingPending) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { notice('이 브라우저는 직접 녹음을 지원하지 않아요. MP3를 올리거나 텍스트 인사말로 계속해 주세요.', true); return; }
    const sourceProject = project;
    const sourceNavigation = navigationSequence;
    const sequence = ++audioImportSequence;
    const recordingGeneration = ++recordSequence;
    let localStream = null;
    recordingPending = true;
    updateMediaLocks();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active || sequence !== audioImportSequence || recordingGeneration !== recordSequence || document.hidden || studio.isHome || studio.step !== 4 || navigationSequence !== sourceNavigation || project !== sourceProject) { localStream.getTracks().forEach(track => track.stop()); return; }
      recordingStream = localStream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { recordingStream.getTracks().forEach(track => track.stop()); recordingStream = null; notice('이 브라우저의 녹음 형식을 아직 지원하지 않아요. MP3를 올리거나 텍스트 인사말로 계속해 주세요.', true); return; }
      recorder = new MediaRecorder(recordingStream, { mimeType });
      const currentRecorder = recorder, currentStream = recordingStream;
      const startedAt = performance.now();
      const chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        currentStream.getTracks().forEach(track => track.stop());
        if (recordingStream === currentStream) recordingStream = null;
        if (recorder === currentRecorder && sequence === audioImportSequence && recordingGeneration === recordSequence) controlButtonsRecording(false);
        const blob = new Blob(chunks, { type: currentRecorder.mimeType.split(';')[0] });
        if (!active || sequence !== audioImportSequence || recordingGeneration !== recordSequence || recorder !== currentRecorder || project !== sourceProject) return;
        recordingPending = true;
        updateMediaLocks();
        try {
          if (blob.size > 1024 * 1024) throw new Error('녹음 파일이 1 MB를 넘었어요. 짧게 다시 녹음해 주세요.');
          const durationSeconds = Math.min(30, (performance.now() - startedAt) / 1000);
          if (durationSeconds < .1 || !blob.size) throw new Error('녹음이 너무 짧아요. 인사말을 말한 뒤 종료를 눌러 주세요.');
          const dataUrl = await readFile(blob);
          if (!active || sequence !== audioImportSequence || recordingGeneration !== recordSequence || recorder !== currentRecorder || project !== sourceProject) return;
          mutate(() => { project.audio = { dataUrl, mimeType: blob.type.split(';')[0], durationSeconds }; });
          view('audio').src = dataUrl; view('audio').hidden = false; waveform.refresh(); notice('녹음을 저장할 준비가 됐어요. 미리 듣고, 초안 저장 또는 게시를 눌러 보관하세요.');
        } catch (error) { if (sequence === audioImportSequence && recordingGeneration === recordSequence && project === sourceProject) notice(error.message, true); }
        finally { if (sequence === audioImportSequence && recordingGeneration === recordSequence) recordingPending = false; updateMediaLocks(); }
      };
      recorder.start(); controlButtonsRecording(true); recordingTimer = setTimeout(() => { if (recorder === currentRecorder && sequence === audioImportSequence && recordingGeneration === recordSequence) stopRecording(); }, 30000); notice('녹음 중이에요. 종료를 누르면 미리 들을 수 있어요.');
    } catch { localStream?.getTracks().forEach(track => track.stop()); if (recordingStream === localStream) recordingStream = null; if (active && sequence === audioImportSequence && recordingGeneration === recordSequence && project === sourceProject) notice('마이크를 사용할 수 없어요. 브라우저 권한을 확인하거나 MP3·텍스트 인사말로 계속해 주세요.', true); }
    finally { if (sequence === audioImportSequence && recordingGeneration === recordSequence) recordingPending = false; updateMediaLocks(); }
  }
  async function importImage(file, maxBytes) {
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG·PNG·WebP 사진을 선택해 주세요.');
    if (file.size > maxBytes) throw new Error(`사진은 ${maxBytes / 1024 / 1024} MB 이하로 선택해 주세요.`);
    const dataUrl = await readFile(file), dimensions = await inspectImage(dataUrl);
    if (Math.max(dimensions.width, dimensions.height) > 4096) throw new Error('사진은 한 변 4,096픽셀 이하로 선택해 주세요.');
    return { dataUrl, ...dimensions };
  }
  function stopHiddenMedia() {
    navigationSequence++;
    playing = false; storyPlaying = false; pointer = null;
    renderSequence++; cropSequence++;
    if (frame) cancelAnimationFrame(frame); frame = 0;
    view('audio').pause(); storyCanvas.hidden = true;
    stopRecording(true); recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null;
  }
  function navigateStep(step) {
    stopHiddenMedia(); studio.showStep(step); start = performance.now();
    if (studio.step === 1 || studio.step === 3) drawCrop();
    if (studio.step !== 1) schedulePreview();
  }
  // 저장하지 않은 편집이 있으면 새로 시작하거나 다른 프로젝트를 열기 전에 묻는다. 거절하면 지금 프로젝트를 그대로 둔다.
  const newProjectDiscardMessage = '저장하지 않은 편집이 있어요. 지금 새로 시작하거나 다른 프로젝트를 열면 사라져요. 계속할까요?';
  function confirmDiscardIfDirty() {
    if (!dirty) return true;
    const accepted = confirm(newProjectDiscardMessage);
    if (accepted) clearDraftStorage();
    return accepted;
  }
  function resetToNewDraft() {
    stopHiddenMedia(); project = createProject({ name: `${merchantName || '우리 가게'} 수집품` }); project.theme.name = studio.newTheme;
    wrapper = null; undo = []; redo = []; selectedGrade = 'bronze'; dirty = false; playing = false; clearCollectibleRenderCache(); syncValues();
  }
  // 게시 중지: 새 손님에게 나가는 것만 멈춘다. 게시 버전과 이미 받은 손님의 수집품은 그대로다.
  async function unpublish() {
    if (!wrapper || wrapper.status !== 'PUBLISHED') return;
    const title = campaignTitle(listed.get(wrapper.id)?.distributingCampaignId);
    if (!confirm(`“${project.name}”의 게시를 멈출까요? ${title ? `“${title}” 캠페인을 새로 방문하는 손님에게` : '새로 방문하는 손님에게'} 더 이상 나가지 않아요. 이미 받은 손님의 수집품은 그대로 남아요.`)) return;
    setBusy(true); notice('게시를 멈추고 있어요…');
    try {
      const result = await request(`${base}/${encodeURIComponent(wrapper.id)}/unpublish`, { method: 'POST', body: { expectedVersion: wrapper.version } });
      if (!active) return;
      await Promise.all([refreshList(), refreshCampaigns()]);
      notice(result.unlinkedCampaignId ? `게시를 멈췄어요. “${campaignTitle(result.unlinkedCampaignId)}” 캠페인을 새로 방문하는 손님부터 이 수집품이 나가지 않아요. 이미 받은 손님의 수집품은 그대로예요.` : '이 수집품은 이미 새 손님에게 나가지 않는 상태였어요.');
    } catch (error) { notice(collectibleErrorMessage(error, '게시를 멈추지 못했어요. 입력은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.'), true); }
    finally { setBusy(false); }
  }
  // 삭제: 초안은 지우고, 게시한 프로젝트는 게시를 멈추고 비공개 원본·편집 자료를 지운다. 이미 받은 손님의 수집품은 남는다.
  async function deleteProject() {
    if (!wrapper) return;
    const published = wrapper.status === 'PUBLISHED';
    const warning = published
      ? '새로 방문하는 손님에게 나가는 것을 멈추고, 저장해 둔 원본 사진과 편집 자료를 지워요. 이미 받은 손님의 수집품은 그대로 남아요.'
      : '삭제한 초안은 되돌릴 수 없어요.';
    if (!confirm(`“${project.name}” ${published ? '게시 프로젝트를' : '초안을'} 삭제할까요? ${warning}${dirty ? ' 저장하지 않은 편집도 함께 사라져요.' : ''}`)) return;
    setBusy(true); notice('삭제하고 있어요…');
    try {
      const result = await request(`${base}/${encodeURIComponent(wrapper.id)}/delete`, { method: 'POST', body: { expectedVersion: wrapper.version } });
      if (!active) return;
      const title = campaignTitle(result.unlinkedCampaignId);
      clearDraftStorage(); resetToNewDraft(); studio.showHome();
      await Promise.all([refreshList(), refreshCampaigns()]);
      notice(published ? `삭제했어요. ${title ? `“${title}” 캠페인을 새로 방문하는 손님부터 이 수집품이 나가지 않아요. ` : ''}이미 받은 손님의 수집품은 그대로 남아요.` : '초안을 삭제했어요.');
    } catch (error) { notice(collectibleErrorMessage(error, '삭제하지 못했어요. 입력은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.'), true); }
    finally { setBusy(false); }
  }
  async function act(action, id, source) {
    if (action === 'record-stop') { stopRecording(); return; }
    if (action === 'pause') { playing = false; schedulePreview(); return; }
    if (action === 'story-stop') { storyPlaying = false; storyCanvas.hidden = true; return; }
    if (busy || loading) return;
    if (action === 'home') { stopHiddenMedia(); studio.sync(project, { dirty, wrapper }); studio.showHome(); return; }
    if (action === 'resume') { navigateStep(studio.step); return; }
    if (action === 'step' || action === 'previous-step' || action === 'next-step') { navigateStep(action === 'step' ? id : studio.step + (action === 'next-step' ? 1 : -1)); return; }
    if (action === 'open-project') { stopHiddenMedia(); await loadProject(id); return; }
    if (action === 'season') { studio.selectHomeTheme(id); return; }
    if (action === 'theme') { if (id === 'custom') { control('theme').focus(); control('theme').select(); return; } mutate(() => { project.theme.name = id; }); control('theme').value = id; return; }
    if (action === 'choice') {
      const name = source?.dataset.controlFor;
      if (!name) return;
      // 두께 버튼은 슬라이더와 달리 pointerdown이 없어 되돌리기 기록과 숫자 표시를 여기서 맡는다(모양·스타일은 mutate()가 기록한다).
      if (name === 'thickness' && control(name).value !== id) { remember(); output('thickness').textContent = id; }
      control(name).value = id; control(name).dispatchEvent(new Event('change', { bubbles: true })); studio.sync(project, { dirty, wrapper }); return;
    }
    if (action === 'zoom-step') {
      const input = control('zoom'), current = Number(input.value), next = clamp(current + Number(id), Number(input.getAttribute('min')), Number(input.getAttribute('max')));
      if (next === current) return;
      remember(); input.value = String(next); input.dispatchEvent(new Event('input', { bubbles: true })); return;
    }
    if (action === 'photo-choose') { control('photo').click(); return; }
    if (action === 'draft' || action === 'publish') { await save(action === 'publish'); return; }
    if (action === 'refresh') { await Promise.all([refreshList(), refreshCampaigns()]); return; }
    if (action === 'new') { if (!confirmDiscardIfDirty()) return; resetToNewDraft(); studio.showStep(1); await drawCrop(); schedulePreview(); notice('새 초안을 시작했어요.'); return; }
    if (action === 'unpublish') { await unpublish(); return; }
    if (action === 'delete') { await deleteProject(); return; }
    if (action === 'undo' || action === 'redo') {
      const source = action === 'undo' ? undo : redo, destination = action === 'undo' ? redo : undo;
      if (!source.length) { notice(action === 'undo' ? '되돌릴 편집이 아직 없어요.' : '다시 실행할 편집이 없어요.'); return; }
      destination.push(cloneProject(project)); project = source.pop(); restoring = true; syncValues(); restoring = false; changed(); await drawCrop(); schedulePreview(); return;
    }
    if (action === 'grade-preview') { selectedGrade = id; renderGrades(); renderStickers(); syncGreetingPreview(); [...view('grade-tabs').querySelectorAll('button')].find(tile => tile.dataset.id === id)?.focus({ preventScroll: true }); schedulePreview(); return; }
    if (action === 'crop-reset') { mutate(() => { project.crop = { x: 0, y: 0, zoom: 1 }; }); syncValues(); await drawCrop(); return; }
    if (action === 'auto-fit') { await autoFit(); return; }
    if (action === 'crop-apply') { schedulePreview(); notice('자르기를 반영했어요. 원본 사진은 그대로 보관돼요.'); return; }
    if (action === 'compare') { const copy = cloneProject(project); copy.photoEdits = { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] }; await renderCrop(cropCanvas, copy); notice('원본을 보여 주고 있어요. 사진을 움직이거나 자르기 적용을 누르면 편집 결과로 돌아와요.'); return; }
    if (action === 'edits-reset') { mutate(() => { project.photoEdits = createProject().photoEdits; }); syncValues(); await drawCrop(); return; }
    if (action === 'sticker-add') {
      const kind = control('sticker-kind').value;
      let text = kind === 'mascot' ? control('sticker-new-pose').value : control('sticker-new').value.trim();
      if (!text) { notice('스티커 내용을 입력해 주세요.', true); return; }
      if (kind !== 'mascot') {
        const clamped = clampStickerLines(text); text = clamped.text;
        if (clamped.truncated) notice('스티커 내용은 4줄까지만 가능해요. 넘는 줄은 지웠어요.', true);
      }
      const list = activeStickers(), cap = stickerSide === 'back' ? mediaLimits.backStickers : mediaLimits.stickers;
      if (list.length >= cap) { notice(`스티커는 ${cap}개까지 만들 수 있어요.`, true); return; }
      mutate(() => {
        const sticker = { id: createId('sticker'), kind, text, x: .5, y: .7, size: 42, rotation: 0, color: '#ffffff', order: list.length, align: 'center', ...(stickerSide === 'front' ? { layouts: {} } : {}) };
        list.push(sticker); selectedSticker = sticker.id;
      });
      control('sticker-new').value = '';
      // PR #310 리뷰 2차 P2: 추가한 스티커가 바로 living 대상 목록(앞면 스티커만)에 보여야 블링크 등으로 고를 수 있다.
      renderStickers(); renderLivingItems(); return;
    }
    if (action === 'sticker-layout-reset') {
      const sticker = activeStickers().find(item => item.id === selectedSticker); if (!sticker) return;
      mutate(() => { delete sticker.layouts[selectedGrade]; }); renderStickers(); return;
    }
    if (action.startsWith('sticker-') && action !== 'sticker-side') {
      const list = activeStickers();
      const sticker = list.find(item => item.id === selectedSticker); if (!sticker) return;
      mutate(() => {
        if (action === 'sticker-delete') {
          const filtered = list.filter(item => item.id !== sticker.id);
          if (stickerSide === 'back') project.back.stickers = filtered;
          else { project.stickers = filtered; project.effects = project.effects.filter(item => item.target !== sticker.id); project.living.items = project.living.items.filter(item => item.target !== sticker.id); }
        } else { const ordered = [...list].sort((a, b) => a.order - b.order); const index = ordered.indexOf(sticker), other = ordered[index + (action === 'sticker-front' ? 1 : -1)]; if (other) [other.order, sticker.order] = [sticker.order, other.order]; }
      }); renderStickers(); renderEffects(); renderLivingItems(); renderBrushTargetOptions(); return;
    }
    if (action === 'grade-add') {
      const name = control('grade-name').value.trim(); if (!name) { notice('새 등급의 이름을 입력해 주세요.', true); return; }
      if (project.grades.length >= 16) { notice('등급은 16개까지 만들 수 있어요.', true); return; }
      mutate(() => {
        const grade = createGrade(name); project.grades.push(grade); const source = control('grade-copy').value;
        if (source) for (const item of [...project.effects, ...project.motion]) if (item.gradeIds.includes(source)) item.gradeIds.push(grade.id);
        selectedGrade = grade.id;
      }); control('grade-name').value = ''; renderGrades(); renderEffects(); renderMotionGrades(); renderStickers(); return;
    }
    if (action === 'effect-add') {
      if (project.effects.length >= 64) { notice('효과는 64개까지 만들 수 있어요.', true); return; }
      mutate(() => project.effects.push({ id: createId('effect'), type: control('effect-type').value, target: control('effect-target').value, gradeIds: [], strength: 45, color: project.baseColor, roughness: 25 })); renderEffects(); return;
    }
    if (action === 'effect-delete') { mutate(() => { project.effects = project.effects.filter(item => item.id !== id); }); renderEffects(); return; }
    if (action === 'effect-grade-all' || action === 'effect-grade-none') {
      const effect = project.effects.find(item => item.id === id); if (!effect) return;
      let skipped = 0;
      mutate(() => {
        if (action === 'effect-grade-none') { effect.gradeIds = []; return; }
        const gradeIds = [];
        for (const grade of project.grades.filter(item => item.enabled)) {
          if (findMaterialConflict(project.effects, effect.target, grade.id, effect.type, effect.id)) { skipped++; continue; }
          gradeIds.push(grade.id);
        }
        effect.gradeIds = gradeIds;
      });
      if (skipped) notice(`${skipped}개 등급은 이미 다른 바탕 재질이 있어 적용하지 못했어요.`);
      renderEffects(); return;
    }
    if (action === 'motion-grade-all' || action === 'motion-grade-none') {
      mutate(() => {
        let motion = project.motion.find(item => item.type === id);
        if (action === 'motion-grade-none') { if (motion) motion.gradeIds = []; return; }
        if (!motion) { motion = { id: createId('motion'), type: id, gradeIds: [] }; project.motion.push(motion); }
        const gradeIds = project.grades.filter(item => item.enabled).map(item => item.id);
        // 단일 토글과 같은 규칙: loop끼리만 등급당 하나로 배타적이다. once 연결은 전체 선택에도 그대로 둔다.
        const loop = (motion.playback ?? 'loop') === 'loop';
        if (loop) for (const other of project.motion) if (other !== motion && (other.playback ?? 'loop') === 'loop') other.gradeIds = other.gradeIds.filter(item => !gradeIds.includes(item));
        motion.gradeIds = gradeIds;
      });
      renderMotionGrades(); return;
    }
    if (action === 'living-add') {
      if (project.living.items.length >= 4) { notice('living 항목은 4개까지 만들 수 있어요.', true); return; }
      const kind = control('living-kind').value, targetValue = control('living-target').value;
      if (kind === 'blink') {
        const sticker = project.stickers.find(item => item.id === targetValue);
        if (!sticker || sticker.kind !== 'mascot' || !MASCOT_BLINK.includes(sticker.text)) { notice('blink는 눈 감은 그림이 있는 마스코트 스티커에서만 쓸 수 있어요.', true); return; }
      }
      mutate(() => {
        const item = { id: createId('living'), kind, target: targetValue, gradeIds: [], amplitude: 50, pivot: { x: .5, y: .5 } };
        if (targetValue === 'region') item.strokes = [];
        project.living.items.push(item);
      });
      renderLivingItems(); renderBrushTargetOptions(); return;
    }
    if (action === 'living-delete') {
      mutate(() => { project.living.items = project.living.items.filter(item => item.id !== id); });
      if (brushTarget === `living:${id}`) brushTarget = 'photo';
      renderLivingItems(); renderBrushTargetOptions(); drawCrop(); return;
    }
    if (action === 'living-clear') {
      const item = project.living.items.find(candidate => candidate.id === id); if (!item) return;
      mutate(() => { item.strokes = []; }); renderLivingItems(); drawCrop(); return;
    }
    if (action === 'living-paint') {
      brushTarget = brushTarget === `living:${id}` ? 'photo' : `living:${id}`;
      renderBrushTargetOptions(); renderLivingItems(); drawCrop(); return;
    }
    if (action === 'living-grade-all' || action === 'living-grade-none') {
      const item = project.living.items.find(candidate => candidate.id === id); if (!item) return;
      mutate(() => { item.gradeIds = action === 'living-grade-none' ? [] : project.grades.filter(grade => grade.enabled).map(grade => grade.id); });
      renderLivingItems(); return;
    }
    if (action === 'parallax-clear') {
      mutate(() => { project.parallax.strokes = []; }); drawCrop(); return;
    }
    if (action === 'template') { selectedTemplate = id; playing = true; start = performance.now(); renderMotionGrades(); schedulePreview(); return; }
    if (action === 'play' || action === 'replay') { playing = true; if (action === 'replay') start = performance.now(); schedulePreview(); return; }
    if (action === 'angle-reset') { mutate(() => { project.angle = 0; }); control('angle').value = 0; output('angle').textContent = '0°'; return; }
    if (action === 'thickness-reset') { mutate(() => { project.thickness = 8; }); control('thickness').value = 8; output('thickness').textContent = '8'; studio.sync(project, { dirty, wrapper }); return; }
    if (action === 'record') { await record(); return; }
    if (action === 'audio-delete') { audioImportSequence++; stopRecording(true); recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null; mutate(() => { project.audio = null; }); view('audio').pause(); view('audio').src = ''; view('audio').hidden = true; waveform.refresh(); return; }
    if (action === 'story-frame-delete') { mutate(() => { project.story.frames.splice(Number(id), 1); }); renderStoryFrames(); return; }
    if (action === 'greeting-override-add') {
      const text = control('greeting-override-text').value.trim();
      if (!text) { notice('추가할 인사말을 입력해 주세요.', true); return; }
      if (project.greetingOverrides.length >= 16) { notice('인사말 규칙은 16개까지 만들 수 있어요.', true); return; }
      mutate(() => { project.greetingOverrides.push({ id: createId('greeting'), gradeIds: [], themeName: '', text }); });
      control('greeting-override-text').value = '';
      renderGreetingOverrides();
      notice('인사말 규칙을 추가했어요. 적용할 등급이나 시즌 테마를 하나 이상 골라야 저장할 수 있어요.');
      return;
    }
    if (action === 'greeting-override-delete') { mutate(() => { project.greetingOverrides = project.greetingOverrides.filter(item => item.id !== id); }); renderGreetingOverrides(); return; }
    if (action === 'story-test') { const error = validateStory(project.story); if (error) { notice(error, true); return; } if (project.story.type === 'none') { notice('이야기 유형을 골라 주세요.'); return; } storyPlaying = true; start = performance.now(); storyCanvas.hidden = false; schedulePreview(); return; }
    if (action === 'copy') {
      if (wrapper) {
        if (busy) return; setBusy(true);
        try { const saved = await request(`${base}/${encodeURIComponent(wrapper.id)}/copy`, { method: 'POST', body: { expectedVersion: wrapper.version } }); wrapper = saved.project?.id ? saved.project : saved; const current = cloneProject(project); project = { ...current, name: `${current.name} · 시즌 복사`.slice(0, 80), derived: {}, campaignId: '', rewardGrades: {} }; await refreshList(); }
        catch (error) { notice(collectibleErrorMessage(error, '시즌 초안을 복사하지 못했어요. 현재 입력을 유지했어요. 다시 시도해 주세요.'), true); return; }
        finally { setBusy(false); }
      } else { project = { ...cloneProject(project), name: `${project.name} · 시즌 복사`.slice(0, 80), derived: {}, campaignId: '', rewardGrades: {} }; }
      undo = []; redo = []; changed(); syncValues(); schedulePreview(); notice('현재 편집 내용을 별도 시즌 초안으로 복사했어요. 테마와 캠페인을 고른 뒤 초안을 저장해 주세요.');
    }
  }
  listen(container, 'click', event => { const target = event.target.closest('[data-action]'); if (target && container.contains(target)) act(target.dataset.action, target.dataset.id, target).catch(error => notice(collectibleErrorMessage(error, error.status ? undefined : error.message || '처리하지 못했어요. 다시 시도해 주세요.'), true)); });
  listen(container, 'pointerdown', event => { if (event.target.matches('input[type="range"],input[type="color"]')) remember(); });
  listen(container, 'focusin', event => { if (event.target.matches('textarea,input:not([type]),input[type="text"]')) remember(); });
  listen(container, 'keydown', event => { if (event.target.matches('input[type="range"]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) remember(); });
  listen(container, 'input', event => {
    const target = event.target;
    if (target.dataset.edit) { project.photoEdits[target.dataset.edit] = Number(target.value); changed(); drawCrop(); schedulePreview(); return; }
    if (target.dataset.sticker) {
      const sticker = activeStickers().find(item => item.id === selectedSticker); if (!sticker) return;
      const key = target.dataset.sticker;
      if (key === 'text') {
        const clamped = clampStickerLines(target.value); sticker.text = clamped.text;
        if (clamped.truncated) { target.value = clamped.text; notice('스티커 내용은 4줄까지만 가능해요. 넘는 줄은 지웠어요.', true); }
      } else if (key === 'color' || key === 'align') sticker[key] = target.value;
      else stickerPositionTarget(sticker)[key] = Number(target.value);
      changed(); schedulePreview(); return;
    }
    const field = target.dataset.control;
    if (field === 'back-color') { project.back.color = target.value; changed(); schedulePreview(); return; }
    if (['zoom', 'crop-x', 'crop-y'].includes(field)) {
      project.crop[field === 'zoom' ? 'zoom' : field.slice(-1)] = Number(target.value); output('zoom').textContent = `${project.crop.zoom.toFixed(2)}배`; changed(); drawCrop(); schedulePreview();
    } else if (field === 'angle' || field === 'thickness') {
      playing = false; output(field).textContent = `${target.value}${field === 'angle' ? '°' : ''}`;
      // The value changes immediately. The expensive final is generated on release.
    } else if (['name', 'greeting', 'theme'].includes(field)) {
      if (field === 'theme') project.theme.name = target.value; else project[field] = target.value;
      changed();
    } else if (target.dataset.overrideTheme) {
      const override = project.greetingOverrides.find(item => item.id === target.dataset.overrideTheme);
      if (override) { override.themeName = target.value; changed(); }
    } else if (target.dataset.overrideText) {
      const override = project.greetingOverrides.find(item => item.id === target.dataset.overrideText);
      if (override) { override.text = target.value; changed(); }
    } else if (['base-color', 'photo-color', 'relief'].includes(field)) {
      project[{ 'base-color': 'baseColor', 'photo-color': 'photoColor', relief: 'relief' }[field]] = field === 'base-color' ? target.value : Number(target.value); changed(); schedulePreview();
    } else if (field === 'story-cartoon') { project.story.cartoon = Number(target.value); changed(); }
    else if (field === 'parallax-strength') { project.parallax.strength = Number(target.value); changed(); drawCrop(); schedulePreview(); }
    else if (field === 'living-period') { project.living.periodMs = Number(target.value); output('living-period').textContent = `${target.value}ms`; changed(); }
    for (const [attribute, property] of [['effectStrength', 'strength'], ['effectRoughness', 'roughness'], ['effectColor', 'color']]) if (target.dataset[attribute]) {
      const effect = project.effects.find(item => item.id === target.dataset[attribute]); effect[property] = property === 'color' ? target.value : Number(target.value); changed(); schedulePreview();
    }
    if (target.dataset.livingAmplitude) {
      const item = project.living.items.find(candidate => candidate.id === target.dataset.livingAmplitude);
      if (item) { item.amplitude = Number(target.value); changed(); schedulePreview(); }
    }
  });
  listen(container, 'change', async event => {
    const target = event.target, field = target.dataset.control;
    const pendingFile = ['photo', 'audio', 'story-files'].includes(field) && target.files?.length ? { project } : null;
    if (pendingFile) { pendingFiles.add(pendingFile); updateMediaLocks(); }
    try {
      if (field === 'project-list') { await loadProject(target.value); return; }
      if (field === 'photo') {
        if (!target.files[0]) return; const sequence = ++uploadSequence, sourceProject = project;
        const image = await importImage(target.files[0], 3 * 1024 * 1024); if (!active || sequence !== uploadSequence || project !== sourceProject) return;
        mutate(() => { project.photo = { originalDataUrl: image.dataUrl, width: image.width, height: image.height }; project.crop = { x: 0, y: 0, zoom: 1 }; project.photoEdits.strokes = []; }); clearCollectibleRenderCache(); syncValues(); await drawCrop(); schedulePreview(); notice('사진을 올렸어요. 드래그와 확대 조절로 위치를 맞춰 주세요.'); return;
      }
      if (field === 'audio') {
        const file = target.files[0]; if (!file) return;
        stopRecording(true); recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null;
        const sequence = ++audioImportSequence, sourceProject = project;
        if (file.size > 1024 * 1024 || !(/\.mp3$/i.test(file.name) && ['audio/mpeg', 'audio/mp3', ''].includes(file.type))) throw new Error('1 MB 이하의 MP3 파일을 선택해 주세요.');
        const dataUrl = normalizeMp3DataUrl(await readFile(file)), durationSeconds = await inspectAudio(dataUrl);
        if (!active || sequence !== audioImportSequence || project !== sourceProject) return;
        if (durationSeconds > 30) throw new Error('음성은 30초 이하로 선택해 주세요.');
        mutate(() => { project.audio = { dataUrl, mimeType: 'audio/mpeg', durationSeconds }; }); view('audio').src = dataUrl; view('audio').hidden = false; waveform.refresh(); notice('MP3를 불러왔어요. 재생 버튼으로 미리 들어 보세요.'); return;
      }
      if (field === 'story-files') {
        const sequence = ++storyImportSequence, sourceProject = project;
        if (project.story.frames.length + target.files.length > 5) throw new Error('이야기 장면은 5장까지 올릴 수 있어요.');
        const frames = []; for (const file of target.files) frames.push(await importImage(file, 512 * 1024));
        if (!active || sequence !== storyImportSequence || project !== sourceProject) return;
        if (project.story.frames.length + frames.length > 5) throw new Error('이야기 장면은 5장까지 올릴 수 있어요.');
        mutate(() => project.story.frames.push(...frames)); renderStoryFrames(); return;
      }
      if (field === 'shape' || field === 'style') { mutate(() => { project[field] = target.value; if (field === 'style' && target.value !== 'original') project.photoColor = 0; }); control('photo-color').value = project.photoColor; await drawCrop(); return; }
      if (field === 'angle' || field === 'thickness') { project[field] = Number(target.value); changed(); schedulePreview(); return; }
      if (field === 'sticker-list') { selectedSticker = target.value; renderStickers(); return; }
      if (field === 'sticker-side') { stickerSide = target.value; selectedSticker = ''; renderStickers(); return; }
      if (field === 'sticker-kind') { syncStickerKindVisibility(); return; }
      if (field === 'back-mode') { mutate(() => { project.back.mode = target.value; }); renderStickers(); return; }
      if (field === 'brush-target') { brushTarget = target.value; renderBrushTargetOptions(); renderLivingItems(); drawCrop(); return; }
      if (field === 'sticker-grade-only') {
        const sticker = activeStickers().find(item => item.id === selectedSticker); if (!sticker) return;
        mutate(() => {
          if (target.checked) sticker.layouts[selectedGrade] = { x: sticker.x, y: sticker.y, size: sticker.size, rotation: sticker.rotation };
          else delete sticker.layouts[selectedGrade];
        });
        renderStickers(); return;
      }
      if (field === 'motion-playback' || field === 'motion-particle') {
        mutate(() => {
          let motion = project.motion.find(item => item.type === selectedTemplate);
          if (!motion) { motion = { id: createId('motion'), type: selectedTemplate, gradeIds: [] }; project.motion.push(motion); }
          if (field === 'motion-playback') {
            motion.playback = target.value;
            // PR #293 후속 P2(b): once→loop로 바꾸면 반복끼리의 등급당 하나 배타 규칙(9.14 근처 motionGrade
            // 토글과 같은 규칙)을 다시 적용해야 한다. 안 그러면 이 모션과 겹치는 등급에 걸린 다른 loop 모션이
            // 그대로 남아 같은 등급에 loop 둘이 걸린다. 겹치는 등급만 다른 loop에서 뗀다.
            if (target.value === 'loop') {
              for (const other of project.motion) if (other !== motion && (other.playback ?? 'loop') === 'loop') other.gradeIds = other.gradeIds.filter(id => !motion.gradeIds.includes(id));
            }
          } else motion.particle = target.value;
        });
        renderMotionGrades(); return;
      }
      if (target.dataset.sticker === 'text' && target.dataset.role === 'pose') {
        const sticker = activeStickers().find(item => item.id === selectedSticker); if (!sticker) return;
        let droppedBlink = false;
        mutate(() => {
          sticker.text = target.value;
          // PR #310 리뷰 2차 P1: blink living 항목은 추가할 때만 포즈를 확인했다. 이미 연결된 뒤 포즈를 바꿔
          // (예: 손 흔들기→잠자기) MASCOT_BLINK 밖으로 나가면, 그 등급에 안 걸려 있어도 실제 서버 검증이
          // 거절한다(rules.ts: region 빈 strokes와 같은 무조건 거절). 안 맞게 된 블링크 링크를 바로 지운다.
          if (!MASCOT_BLINK.includes(target.value)) {
            const before = project.living.items.length;
            project.living.items = project.living.items.filter(item => !(item.kind === 'blink' && item.target === sticker.id));
            droppedBlink = project.living.items.length !== before;
          }
        });
        if (droppedBlink) { notice('포즈를 바꿔 눈 감은 그림이 없어져 그 블링크(blink) living 항목을 지웠어요.', true); renderLivingItems(); renderBrushTargetOptions(); }
        return;
      }
      if (target.dataset.overrideGrade) {
        const override = project.greetingOverrides.find(item => item.id === target.dataset.overrideGrade), grade = target.dataset.grade;
        mutate(() => { override.gradeIds = target.checked ? [...new Set([...override.gradeIds, grade])] : override.gradeIds.filter(item => item !== grade); });
        renderGreetingOverrides(); return;
      }
      // PR #310 리뷰 2차 P2: living 항목의 등급 체크박스(gradeChecks의 data-living-grade)는 change 처리기가 없어
      // 체크해도 저장된 gradeIds가 그대로였다. 효과·인사말 규칙과 같은 방식으로 mutate를 거친다.
      if (target.dataset.livingGrade) {
        const item = project.living.items.find(candidate => candidate.id === target.dataset.livingGrade), grade = target.dataset.grade;
        if (!item) return;
        mutate(() => { item.gradeIds = target.checked ? [...new Set([...item.gradeIds, grade])] : item.gradeIds.filter(id => id !== grade); });
        renderLivingItems(); return;
      }
      if (field === 'campaign') {
        const dropped = [];
        mutate(() => {
          project.campaignId = target.value; const goals = goalsFor(target.value);
          for (const goal of Object.keys(project.rewardGrades)) if (!goals.includes(Number(goal))) { dropped.push(goal); delete project.rewardGrades[goal]; }
        });
        renderRewardGrades();
        if (dropped.length) notice(`선택한 캠페인에 없는 방문 목표(${dropped.join('·')}회)의 수집품 연결은 풀었어요. 게시 전에 연결을 확인해 주세요.`);
        return;
      }
      if (field === 'story-type') { mutate(() => { project.story.type = target.value; }); renderStoryFrames(); return; }
      if (field === 'reduce-motion') { if (target.checked) { playing = false; storyPlaying = false; } schedulePreview(); return; }
      if (target.dataset.rewardCount) { mutate(() => { if (target.value) project.rewardGrades[target.dataset.rewardCount] = target.value; else delete project.rewardGrades[target.dataset.rewardCount]; }); return; }
      if (target.dataset.gradeName) { mutate(() => { project.grades.find(item => item.id === target.dataset.gradeName).name = target.value.trim() || '새 등급'; }); renderGrades(); renderEffects(); return; }
      if (target.dataset.gradeEnabled) {
        const grade = project.grades.find(item => item.id === target.dataset.gradeEnabled);
        if (!target.checked && project.grades.filter(item => item.enabled).length === 1) { target.checked = true; notice('미리 볼 등급을 한 개 이상 남겨 주세요.', true); return; }
        let removed = false;
        mutate(() => {
          grade.enabled = target.checked;
          if (!grade.enabled) {
            for (const count of Object.keys(project.rewardGrades)) if (project.rewardGrades[count] === grade.id) { delete project.rewardGrades[count]; removed = true; }
            // 끈 등급의 전용 배치·동작·인사말 참조를 지운다(다시 켜면 공통 설정으로 보인다).
            for (const sticker of project.stickers) if (sticker.layouts) delete sticker.layouts[grade.id];
            for (const motion of project.motion) motion.gradeIds = motion.gradeIds.filter(id => id !== grade.id);
            for (const override of project.greetingOverrides) override.gradeIds = override.gradeIds.filter(id => id !== grade.id);
            for (const item of project.living.items) item.gradeIds = item.gradeIds.filter(id => id !== grade.id);
            // 등급 참조가 모두 사라지고 테마 조건도 없는 인사말 규칙은(둘 다 비면 서버가 거절한다) 함께 지운다.
            project.greetingOverrides = project.greetingOverrides.filter(item => item.gradeIds.length > 0 || item.themeName !== '');
          }
        });
        if (removed) notice('끄신 등급의 방문 목표 연결도 해제했어요. 게시할 때 다른 등급을 선택해 주세요.');
        if (!grade.enabled && selectedGrade === grade.id) selectedGrade = project.grades.find(item => item.enabled).id;
        renderGrades(); renderEffects(); renderMotionGrades(); renderStickers(); renderGreetingOverrides(); renderLivingItems(); return;
      }
      if (target.dataset.effectGrade) {
        const effect = project.effects.find(item => item.id === target.dataset.effectGrade), grade = target.dataset.grade;
        // 9.14 재질 충돌 안내: 같은 대상·등급의 배타 재질(무광·에나멜·유리)을 조용히 섞지 않고 이유와 대안을 확인받는다.
        if (target.checked) {
          const conflicts = findMaterialConflicts(project.effects, effect.target, grade, effect.type, effect.id);
          if (conflicts.length) {
            const conflict = conflicts[0];
            if (!confirm(materialConflictQuestion(conflict.type, effect.type))) { target.checked = false; notice('다른 등급에 적용하거나 먼저 기존 재질을 꺼 주세요.'); return; }
            // 같은 대상·등급에 같은 재질군이 중복 등록됐어도(예: 무광 효과 두 개) 전부 끈다.
            mutate(() => { for (const other of conflicts) other.gradeIds = other.gradeIds.filter(item => item !== grade); effect.gradeIds = [...new Set([...effect.gradeIds, grade])]; });
            notice(materialSwapNotice(conflict.type, effect.type));
            renderEffects(); return;
          }
        }
        mutate(() => { effect.gradeIds = target.checked ? [...new Set([...effect.gradeIds, grade])] : effect.gradeIds.filter(item => item !== grade); });
        renderEffects(); return;
      }
      if (target.dataset.motionGrade) {
        mutate(() => {
          const type = target.dataset.motionGrade, grade = target.dataset.grade;
          let motion = project.motion.find(item => item.type === type);
          if (!motion) { motion = { id: createId('motion'), type, gradeIds: [] }; project.motion.push(motion); }
          // 반복(loop) 재생끼리만 등급당 하나로 배타적이다(동시에 두 개가 돌면 어느 쪽인지 알 수 없다).
          // 한 번만(once) 재생은 서로, 또 loop와도 겹칠 수 있어 다른 예시의 once 연결을 건드리지 않는다.
          const loop = (motion.playback ?? 'loop') === 'loop';
          for (const other of project.motion) if (other === motion || (loop && (other.playback ?? 'loop') === 'loop')) other.gradeIds = other.gradeIds.filter(item => item !== grade);
          if (target.checked) motion.gradeIds.push(grade);
        }); renderMotionGrades(); return;
      }
      if (target.matches('input:not([type="range"]):not([type="file"]),textarea')) schedulePreview();
    } catch (error) { if (active && (!pendingFile || pendingFile.project === project)) notice(error.message || '파일을 불러오지 못했어요. 편집 내용은 유지했어요.', true); }
    finally { if (pendingFile) { pendingFiles.delete(pendingFile); updateMediaLocks(); } }
  });
  function pointOn(canvas, event) { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) / bounds.width * canvas.width, y: (event.clientY - bounds.top) / bounds.height * canvas.height }; }
  function pointOnPhoto(event) {
    const point = pointOn(cropCanvas, event), transform = cropTransform(project, 512, 512);
    return { x: clamp((point.x - transform.x) / transform.width, 0, 1), y: clamp((point.y - transform.y) / transform.height, 0, 1) };
  }
  listen(cropCanvas, 'pointerdown', event => {
    if (loading) return;
    if (!project.photo.originalDataUrl) return;
    remember(); cropCanvas.setPointerCapture(event.pointerId);
    // 패럴랙스 획과 living region 점은 서버에서 전체 합 20,000개 상한을 같이 쓴다(개별 상한만으로는 둘을 섞어
    // 넘길 수 있다, PR #310 리뷰 P1). 둘 중 어느 붓이든 이 예산을 먼저 확인한다.
    if ((brushTarget === 'parallax' || brushTarget.startsWith('living:')) && parallaxLivingPointTotal(project) >= PARALLAX_LIVING_POINT_BUDGET) {
      notice('패럴랙스·living 점을 전체 20,000개까지 다 썼어요. 기존 점을 지우고 다시 칠해 주세요.', true); return;
    }
    if (brushTarget === 'parallax') {
      if (project.parallax.strokes.length >= 100) { notice('패럴랙스 획은 100개까지 보관해요. 지우고 다시 칠해 주세요.', true); return; }
      const stroke = { tool: control('parallax-tool').value, size: Number(control('brush-size').value), points: [pointOnPhoto(event)] };
      project.parallax.strokes.push(stroke); pointer = { type: 'parallax', stroke }; changed(); drawCrop(); return;
    }
    if (brushTarget.startsWith('living:')) {
      const item = project.living.items.find(candidate => candidate.id === brushTarget.slice(7));
      if (!item || item.target !== 'region') return;
      if (!item.strokes) item.strokes = [];
      if (item.strokes.length >= 20) { notice('living 영역은 점 20개까지 찍을 수 있어요. 점을 지우고 다시 찍어 주세요.', true); return; }
      item.strokes.push(pointOnPhoto(event)); pointer = { type: 'living', item }; changed(); drawCrop(); renderLivingItems(); return;
    }
    const mode = control('brush').value;
    if (mode === 'move') pointer = { type: 'crop', start: pointOn(cropCanvas, event), crop: { ...project.crop } };
    else {
      if (project.photoEdits.strokes.length >= 100) { notice('붓 획은 100개까지 보관해요. 되돌리거나 초기화 후 다시 편집해 주세요.', true); return; }
      const stroke = { tool: mode, size: Number(control('brush-size').value), color: control('brush-color').value, points: [pointOnPhoto(event)] }; project.photoEdits.strokes.push(stroke); pointer = { type: 'brush', stroke }; changed(); drawCrop();
    }
  });
  listen(cropCanvas, 'pointermove', event => {
    if (!pointer) return;
    if (pointer.type === 'crop') {
      const point = pointOn(cropCanvas, event), transform = cropTransform(project, 512, 512);
      project.crop.x = clamp(pointer.crop.x + (point.x - pointer.start.x) / Math.max(1, (transform.width - 512) / 2), -1, 1);
      project.crop.y = clamp(pointer.crop.y + (point.y - pointer.start.y) / Math.max(1, (transform.height - 512) / 2), -1, 1);
      control('crop-x').value = project.crop.x; control('crop-y').value = project.crop.y;
    } else if (pointer.type === 'living') {
      if (pointer.item.strokes.length < 20 && parallaxLivingPointTotal(project) < PARALLAX_LIVING_POINT_BUDGET) pointer.item.strokes.push(pointOnPhoto(event));
    } else if (pointer.type === 'parallax') {
      if (pointer.stroke.points.length < 512 && parallaxLivingPointTotal(project) < PARALLAX_LIVING_POINT_BUDGET) pointer.stroke.points.push(pointOnPhoto(event));
    } else if (pointer.stroke.points.length < 512) pointer.stroke.points.push(pointOnPhoto(event));
    changed(); drawCrop(); schedulePreview();
  });
  const endPointer = () => { pointer = null; schedulePreview(); };
  listen(cropCanvas, 'pointerup', endPointer); listen(cropCanvas, 'pointercancel', endPointer);
  listen(previewCanvas, 'pointerdown', event => {
    if (loading) return;
    const point = pointOn(previewCanvas, event), x = (point.x - 512 * .11) / (512 * .78), y = (point.y - 512 * .11) / (512 * .78);
    if (Math.abs(project.angle) > 15 || playing) { notice('스티커를 드래그하려면 정면 보기와 정지를 눌러 주세요. 위치 조절바는 어느 각도에서도 사용할 수 있어요.'); return; }
    // 등급별 배치 중인 스티커는 그 등급의 좌표(stickerPositionTarget)로 맞아야 보이는 자리와 드래그 판정이 일치한다.
    const candidate = [...project.stickers].sort((a, b) => b.order - a.order).find(sticker => { const pos = stickerPositionTarget(sticker); return Math.hypot((pos.x - x) * 512, (pos.y - y) * 512) < Math.max(25, pos.size); });
    if (!candidate) return; remember(); selectedSticker = candidate.id; renderStickers(); previewCanvas.setPointerCapture(event.pointerId);
    const pos = stickerPositionTarget(candidate);
    pointer = { type: 'sticker', target: pos, start: { x, y }, x: pos.x, y: pos.y };
  });
  listen(previewCanvas, 'pointermove', event => {
    if (pointer?.type !== 'sticker') return;
    const point = pointOn(previewCanvas, event); pointer.target.x = clamp(pointer.x + (point.x - 512 * .11) / (512 * .78) - pointer.start.x, 0, 1); pointer.target.y = clamp(pointer.y + (point.y - 512 * .11) / (512 * .78) - pointer.start.y, 0, 1);
    changed(); renderStickers(); schedulePreview();
  });
  listen(previewCanvas, 'pointerup', endPointer); listen(previewCanvas, 'pointercancel', endPointer);
  listen(document, 'visibilitychange', () => { if (document.hidden) stopHiddenMedia(); else { start = performance.now(); if (!studio.isHome) schedulePreview(); } });
  listen(window, 'beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  for (const [value, name] of Object.entries(effectNames)) option(control('effect-type'), name, value);
  for (const [value, name] of Object.entries(storyNames)) option(control('story-type'), name, value);
  for (const kind of LIVING_KINDS) option(control('living-kind'), livingKindNames[kind] || kind, kind);
  for (const pose of MASCOT_POSES) option(control('sticker-new-pose'), mascotPoseNames[pose] || pose, pose);
  for (const pose of MASCOT_POSES) option(container.querySelector('[data-sticker="text"][data-role="pose"]'), mascotPoseNames[pose] || pose, pose);
  syncStickerKindVisibility();
  for (const [id, name] of Object.entries(motionNames)) {
    const tile = button(name, 'template', { 'data-id': id, 'aria-pressed': String(id === selectedTemplate) }); const canvas = element('canvas', undefined, { width: 96, height: 96, 'aria-hidden': 'true' }); tile.prepend(canvas); view('templates').append(tile);
    renderCollectible(canvas, demoProject, 'bronze', { animation: id, staticFrame: true, textureSize: 120 }).catch(() => {});
  }
  control('reduce-motion').checked = reducedMotion.matches;
  const preferenceChanged = event => { control('reduce-motion').checked = event.matches; if (event.matches) playing = false; schedulePreview(); };
  reducedMotion.addEventListener('change', preferenceChanged);
  const intersection = globalThis.IntersectionObserver ? new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) schedulePreview(); else { if (frame) cancelAnimationFrame(frame); frame = 0; } }) : null;
  intersection?.observe(container);
  syncValues(); drawCrop(); schedulePreview();
  refreshList();
  refreshCampaigns();
  // reason: 'navigate'(기본, 평범한 이동·탭 닫기) → 지금 편집을 기기에 남긴다(미디어는 빼므로 남겨도 괜찮다).
  // 'discard' → 사용자가 명시적으로 버리기로 한 이 초안만 지운다. 로그아웃·계정 전환으로 그 계정의 모든 점포
  // 보관본을 지우는 일은 제작기가 열려 있지 않아도 일어나야 하므로 merchant.mjs가 clearCollectibleDrafts로 직접 한다.
  const dispose = (reason = 'navigate') => {
    clearTimeout(autosaveTimer);
    if (reason === 'discard') clearDraftStorage();
    else saveDraftLocally();
    active = false; controller.abort(); intersection?.disconnect(); if (frame) cancelAnimationFrame(frame); clearTimeout(recordingTimer);
    if (recorder?.state === 'recording') recorder.stop(); recordingStream?.getTracks().forEach(track => track.stop());
    view('audio').pause(); view('audio').removeAttribute('src'); reducedMotion.removeEventListener('change', preferenceChanged);
    clearCollectibleRenderCache(); container.replaceChildren();
  };
  // 점주 웹이 제작기를 닫거나 다른 점포로 바꾸기 전에 저장하지 않은 편집을 물어볼 수 있게 한다.
  dispose.isDirty = () => dirty;
  return dispose;
}
