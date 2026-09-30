import { createProject, createGrade, createId, cloneProject, cropTransform, clamp } from './collectible-model.mjs';
import { renderCollectible, renderCrop, renderStory, serializeDerived, serializeStoryFrames, validateStory, clearCollectibleRenderCache } from './collectible-renderer.mjs';
import { createCollectibleStudio } from './collectible-studio.mjs';
import { collectibleErrorMessage, localError } from './collectible-errors.mjs';

const effectNames = { metallic: '메탈릭', hologram: '홀로그램', pearl: '펄', matte: '무광', enamel: '에나멜', glass: '유리', glow: '발광' };
const motionNames = { still: '정지', rotate: '천천히 회전', shine: '빛 지나가기', float: '살짝 떠오르기', stamp: '도장 찍기', sparkle: '반짝임 한 번', pulse: '부드러운 맥동', confetti: '작은 축하 입자' };
const storyNames = { none: '사용하지 않음', zoom: '안으로 들어가기 · 사진 한 장 확대', wide: '바깥 공간 공개 · 넓은 사진', follow: '마스코트 따라가기 · 이동 장면', event: '짧은 사건 · 시작·행동·결과' };
const element = (tag, text, attributes = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attributes)) if (name === 'className') node.className = value; else node.setAttribute(name, String(value));
  return node;
};
const button = (text, action, attributes = {}) => element('button', text, { type: 'button', 'data-action': action, ...attributes });
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
export function mountCollectibleEditor(container, { merchantId, merchantName = '', campaigns: initialCampaigns = [], loadCampaigns, request, onNotice = () => {}, confirm = message => globalThis.confirm?.(message) === true }) {
  if (!container || typeof request !== 'function') return () => {};
  let campaigns = initialCampaigns;
  let campaignSequence = 0;
  const base = `/api/web/merchant/merchants/${encodeURIComponent(merchantId)}/collectible-projects`;
  const controller = new AbortController();
  const signal = controller.signal;
  let project = createProject({ name: `${merchantName || '우리 가게'} 수집품` });
  let wrapper = null, selectedGrade = project.grades[0].id, selectedSticker = '', selectedTemplate = 'rotate';
  let active = true, playing = false, storyPlaying = false, frame = 0, renderSequence = 0, cropSequence = 0, previewQueued = false;
  let start = performance.now(), lastFrame = 0, recorder = null, recordingStream = null, recordingTimer = 0;
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
      <div class="ce-actions"><button type="button" data-action="crop-reset">틀 채우기</button><button type="button" data-action="crop-apply">자르기 적용</button><button type="button" data-action="undo">되돌리기</button><button type="button" data-action="redo">다시 실행</button></div>
      <label class="ce-field">빠른 스타일<select data-control="style"><option value="original">원본 색 유지</option><option value="incised">단색 음각 · 안으로 파인 명암</option><option value="raised">단색 양각 · 올라온 명암</option></select></label>
      <details><summary>사진 세부 조정</summary><div class="ce-detail">
        <label class="ce-field">붓 도구<select data-control="brush"><option value="move">사진 이동</option><option value="clean">잡티 정리 · 주변색으로 정리</option><option value="erase">투명 처리</option><option value="restore">원본 복원</option><option value="color">영역 색 일관화</option></select></label>
        <label class="ce-field">붓 크기<input data-control="brush-size" type="range" min="0.01" max="0.2" step="0.01" value="0.05"></label>
        <label class="ce-field">영역 색<input data-control="brush-color" type="color" value="#c69b71"></label>
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
      <details><summary>텍스트와 이모티콘 스티커</summary><div class="ce-detail">
        <div class="ce-row"><label class="ce-field">종류<select data-control="sticker-kind"><option value="text">텍스트</option><option value="emoji">이모티콘</option></select></label><label class="ce-field">내용<input data-control="sticker-new" maxlength="80" placeholder="어서오세요 또는 ☕"></label></div>
        <button type="button" data-action="sticker-add">스티커 추가</button>
        <label class="ce-field">편집할 스티커<select data-control="sticker-list"></select></label>
        <label class="ce-field">스티커 내용<input data-sticker="text" maxlength="80"></label>
        <div class="ce-row"><label class="ce-field">가로 위치<input data-sticker="x" type="range" min="0" max="1" step="0.01"></label><label class="ce-field">세로 위치<input data-sticker="y" type="range" min="0" max="1" step="0.01"></label></div>
        <label class="ce-field">글자 크기<input data-sticker="size" type="range" min="10" max="120" step="1"></label>
        <label class="ce-field">스티커 회전<input data-sticker="rotation" type="range" min="-180" max="180"></label>
        <label class="ce-field">글자 색<input data-sticker="color" type="color"></label>
        <div class="ce-actions"><button type="button" data-action="sticker-front">앞으로</button><button type="button" data-action="sticker-back">뒤로</button><button type="button" data-action="sticker-delete">스티커 삭제</button></div>
        <p class="ce-help">완성 미리보기의 스티커를 드래그해 옮길 수도 있어요. 글자와 사진은 따로 저장돼요.</p>
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
        <div data-view="templates" class="ce-templates"></div><div data-view="motion-grades"></div>
        <p class="ce-help">살아 있는 그림은 분리된 그림과 반복 동작 자료가 필요해요. 현재 공통 템플릿은 전체 수집품의 움직임이에요.</p>
        <label class="ce-field">두께 <output data-value="thickness"></output><input data-control="thickness" type="range" min="1" max="24" step="1" value="8"></label><button type="button" data-action="thickness-reset">기본 두께로</button>
        <p class="ce-help">각도와 두께는 놓으면 완성 미리보기가 갱신돼요.</p>
      </div></details>
      <details><summary>인사말과 음성</summary><div class="ce-detail">
        <label class="ce-field">사장님 인사말<textarea data-control="greeting" maxlength="300" rows="3" placeholder="들러 주셔서 고마워요"></textarea></label>
        <label class="ce-field">MP3 음성 · 30초, 1 MB까지<input data-control="audio" type="file" accept="audio/mpeg,.mp3"></label>
        <div class="ce-actions"><button type="button" data-action="record">직접 녹음 / 다시 녹음</button><button type="button" data-action="record-stop" disabled>녹음 종료</button><button type="button" data-action="audio-delete">음성 삭제</button></div>
        <audio data-view="audio" controls preload="metadata" aria-label="사장님 음성 미리 듣기"></audio>
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
  const previewCanvas = view('preview'), cropCanvas = view('crop'), storyCanvas = view('story');
  for (const [name, label] of [['zoom', '사진 확대'], ['angle', '회전 각도'], ['thickness', '두께']]) control(name).setAttribute('aria-label', label);
  const notice = (text, error = false) => { if (!active) return; view('notice').textContent = text; view('notice').classList.toggle('ce-error', error); onNotice(text); };
  function remember() { if (restoring) return; undo.push(cloneProject(project)); if (undo.length > 12) undo.shift(); redo = []; }
  function changed() { dirty = true; editSerial++; project.derived = {}; view('save-state').textContent = '편집한 내용이 있어요. 초안 저장 또는 게시를 눌러 보관하세요.'; previewQueued = true; studio.sync(project, { dirty, wrapper }); }
  function mutate(fn) { remember(); fn(); changed(); schedulePreview(); }
  const listen = (target, name, handler) => target.addEventListener(name, handler, { signal });
  function syncValues() {
    renderCampaignOptions();
    const values = { name: project.name, shape: project.shape, style: project.style, zoom: project.crop.zoom, 'crop-x': project.crop.x, 'crop-y': project.crop.y, 'base-color': project.baseColor, 'photo-color': project.photoColor, relief: project.relief, angle: project.angle, thickness: project.thickness, greeting: project.greeting, theme: project.theme.name, campaign: project.campaignId, 'story-type': project.story.type, 'story-cartoon': project.story.cartoon };
    for (const [name, value] of Object.entries(values)) control(name).value = value;
    for (const input of container.querySelectorAll('[data-edit]')) input.value = project.photoEdits[input.dataset.edit];
    output('zoom').textContent = `${project.crop.zoom.toFixed(2)}배`;
    output('angle').textContent = `${project.angle}°`; output('thickness').textContent = `${project.thickness}`;
    view('greeting').textContent = project.greeting;
    const audio = view('audio'); audio.pause(); audio.src = project.audio?.dataUrl || ''; audio.hidden = !project.audio;
    renderGrades(); renderStickers(); renderEffects(); renderMotionGrades(); renderStoryFrames();
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
  async function refreshCampaigns() {
    if (!loadCampaigns) return true;
    const sequence = ++campaignSequence;
    try {
      const loaded = await loadCampaigns();
      if (!active || sequence !== campaignSequence) return true;
      campaigns = loaded; renderCampaignOptions(); renderRewardGrades(); renderProjectList();
      return true;
    } catch (error) {
      if (active && sequence === campaignSequence) notice(`게시할 캠페인 목록을 불러오지 못했어요. ${collectibleErrorMessage(error, '편집은 계속할 수 있어요. 저장 목록 새로 보기를 눌러 다시 시도해 주세요.')}`, true);
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
  function renderStickers() {
    const select = control('sticker-list'); select.replaceChildren();
    if (!project.stickers.some(sticker => sticker.id === selectedSticker)) selectedSticker = project.stickers.at(-1)?.id || '';
    for (const sticker of [...project.stickers].sort((a, b) => a.order - b.order)) option(select, sticker.text, sticker.id);
    select.value = selectedSticker;
    const sticker = project.stickers.find(item => item.id === selectedSticker);
    for (const input of container.querySelectorAll('[data-sticker]')) { input.disabled = !sticker; if (sticker) input.value = sticker[input.dataset.sticker]; }
    const targets = control('effect-target'), previous = targets.value; targets.replaceChildren();
    for (const [id, name] of [['surface', '전체 표면'], ['photo', '사진'], ['border', '테두리'], ...project.stickers.map(item => [item.id, `스티커 · ${item.text}`])]) option(targets, name, id);
    if ([...targets.options].some(item => item.value === previous)) targets.value = previous;
    studio.sync(project, { dirty, wrapper });
  }
  function gradeChecks(parent, selected, attributes) {
    const group = element('div', undefined, { className: 'ce-grade-checks', role: 'group', 'aria-label': attributes['data-motion-grade'] ? '동작을 적용할 등급 여러 개 선택' : '효과를 적용할 등급 여러 개 선택' });
    for (const grade of project.grades) {
      const label = element('label', undefined, { className: 'ce-check' });
      const checkbox = element('input', undefined, { type: 'checkbox', ...attributes, 'data-grade': grade.id }); checkbox.checked = selected.includes(grade.id); checkbox.disabled = !grade.enabled;
      label.append(checkbox, document.createTextNode(grade.name)); group.append(label);
    }
    parent.append(group);
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
  async function drawPreview(time = 0) {
    const sequence = ++renderSequence;
    const copy = cloneProject(project);
    const buffer = document.createElement('canvas'); buffer.width = previewCanvas.width; buffer.height = previewCanvas.height;
    try {
      await renderCollectible(buffer, copy, selectedGrade, { angle: copy.angle, time, staticFrame: !playing || control('reduce-motion').checked });
      if (!active || sequence !== renderSequence) return;
      previewCanvas.getContext('2d').clearRect(0, 0, 512, 512); previewCanvas.getContext('2d').drawImage(buffer, 0, 0);
      const grade = project.grades.find(item => item.id === selectedGrade);
      view('preview-caption').textContent = `${project.name} · ${grade?.name || ''} · ${project.theme.name} · ${project.thickness} 두께`;
    } catch (error) { notice(error.message || '미리보기를 만들지 못했어요. 입력은 유지했어요. 자르기 적용을 눌러 다시 시도해 주세요.', true); }
  }
  function schedulePreview() {
    previewQueued = true;
    if (!frame) frame = requestAnimationFrame(tick);
  }
  async function drawCrop() {
    const sequence = ++cropSequence, buffer = document.createElement('canvas'); buffer.width = 512; buffer.height = 512;
    try { await renderCrop(buffer, project); if (active && sequence === cropSequence) { cropCanvas.getContext('2d').clearRect(0, 0, 512, 512); cropCanvas.getContext('2d').drawImage(buffer, 0, 0); } } catch (error) { notice(error.message, true); }
  }
  async function tick(now) {
    frame = 0;
    if (!active || document.hidden || !visible || studio.isHome) return;
    const allowMotion = !control('reduce-motion').checked;
    if (previewQueued || (playing && allowMotion && now - lastFrame >= 65)) {
      previewQueued = false; lastFrame = now; await drawPreview(now - start);
    }
    if (playing && allowMotion) {
      const tile = view('templates').querySelector(`[data-id="${selectedTemplate}"] canvas`);
      if (tile) try { await renderCollectible(tile, demoProject, 'bronze', { animation: selectedTemplate, time: now - start, textureSize: 120 }); } catch { playing = false; notice('애니메이션을 준비하지 못했어요. 정지 미리보기로 계속 편집할 수 있어요.', true); }
    }
    if (storyPlaying) {
      try { await renderStory(storyCanvas, project, { time: now - start, reducedMotion: !allowMotion }); } catch (error) { storyPlaying = false; notice(error.message || '이야기를 재생하지 못했어요. 장면 사진을 확인하고 다시 시도해 주세요.', true); }
      if (now - start >= 6000 || !allowMotion) storyPlaying = false;
    }
    if (active && visible && !document.hidden && (playing && allowMotion || storyPlaying || previewQueued)) frame = requestAnimationFrame(tick);
  }
  function mediaPending() { return recordingPending || recorder?.state === 'recording' || [...pendingFiles].some(item => item.project === project); }
  function updateMediaLocks() {
    if (!active) return;
    for (const item of container.querySelectorAll('[data-action="draft"],[data-action="publish"]')) item.disabled = busy || mediaPending();
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
    } catch (error) { notice(collectibleErrorMessage(error, '저장 목록을 불러오지 못했어요. 편집은 계속할 수 있고, 저장 목록 새로 보기를 눌러 다시 시도할 수 있어요.'), true); }
  }
  async function save(publish = false) {
    if (busy) return;
    if (mediaPending()) { notice('사진·음성을 불러오거나 녹음을 처리하고 있어요. 처리가 끝난 뒤 저장해 주세요.'); return; }
    if (!project.name.trim()) { navigateStep(1); notice('수집품 이름을 입력해 주세요.', true); control('name').focus(); return; }
    if (!project.theme.name.trim()) { navigateStep(4); notice('시즌 테마를 입력하거나 기본으로 적어 주세요.', true); control('theme').focus(); return; }
    if (project.stickers.some(item => !item.text.trim())) { navigateStep(3); notice('내용이 비어 있는 스티커를 채우거나 삭제해 주세요.', true); return; }
    if (publish) {
      setBusy(true); const refreshed = await refreshCampaigns(); setBusy(false);
      if (!active || !refreshed) return;
      const reason = validatePublish(project, campaigns); if (reason) { navigateStep(!project.photo.originalDataUrl ? 1 : 4); if (project.story.type !== 'none') control('story-type').closest('details').open = true; notice(reason, true); return; } }
    setBusy(true); notice(publish ? '등급별 게시 이미지를 준비하고 있어요…' : '초안을 저장하고 있어요…');
    const revision = cloneProject(project), savedSerial = editSerial;
    try {
      // Final raster assets are generated once for publication; all originals,
      // strokes, stable sticker IDs and grade assignments remain in the draft.
      if (publish) {
        revision.derived = await serializeDerived(revision);
        revision.story.frames = await serializeStoryFrames(revision.story);
        for (const assets of Object.values(revision.derived)) for (const name of ['imageDataUrl', 'baseDataUrl', 'thumbnailDataUrl']) {
          const max = name === 'thumbnailDataUrl' ? 256 * 1024 : 1024 * 1024;
          if ((assets[name].split(',')[1].length * 3 / 4) > max) throw localError('완성 이미지가 너무 커요. 작은 사진이나 단순한 보정으로 다시 시도해 주세요. 원본과 입력은 유지했어요.');
        }
      }
      if (new TextEncoder().encode(JSON.stringify(revision)).length > 16 * 1024 * 1024 - 2048) throw localError('프로젝트가 16 MB를 넘었어요. 작은 사진·음성으로 교체하거나 사용하지 않는 등급과 장면을 줄여 다시 저장해 주세요.');
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
        project = cloneProject(wrapper.project || revision);
        clearCollectibleRenderCache(); syncValues(); drawCrop(); schedulePreview();
      } else studio.sync(project, { dirty, wrapper });
      syncPublishState();
      view('save-state').textContent = `${publish ? '게시한 버전을 보존했어요' : '초안을 저장했어요'} · v${wrapper.version}${dirty ? ' · 저장 중 새로 편집한 내용은 한 번 더 저장해 주세요.' : ''}`;
      notice(publish ? '게시했어요. 이후 방문 보상부터 이 버전을 사용해요. 이미 얻은 수집품은 그대로 보존돼요.' : '초안을 저장했어요. 목록에서 다시 열어 이어서 만들 수 있어요.');
      await refreshList();
    } catch (error) { notice(collectibleErrorMessage(error), true); }
    finally { setBusy(false); }
  }
  async function loadProject(id) {
    if (!id || busy) return;
    setBusy(true);
    loading = true;
    for (const input of container.querySelectorAll('input,select,textarea,button')) { loadingInputs.set(input, input.disabled); input.disabled = true; }
    notice('저장한 프로젝트를 불러오는 중이에요…');
    try {
      const result = await request(`${base}/${encodeURIComponent(id)}`, { method: 'GET' });
      if (!active) return;
      const previous = cloneProject(project);
      wrapper = result.project?.id ? result.project : result; project = cloneProject(wrapper.project);
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
          view('audio').src = dataUrl; view('audio').hidden = false; notice('녹음을 저장할 준비가 됐어요. 미리 듣고, 초안 저장 또는 게시를 눌러 보관하세요.');
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
      resetToNewDraft(); studio.showHome();
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
      control(name).value = id; control(name).dispatchEvent(new Event('change', { bubbles: true })); studio.sync(project, { dirty, wrapper }); return;
    }
    if (action === 'photo-choose') { control('photo').click(); return; }
    if (action === 'draft' || action === 'publish') { await save(action === 'publish'); return; }
    if (action === 'refresh') { await Promise.all([refreshList(), refreshCampaigns()]); return; }
    if (action === 'new') { resetToNewDraft(); studio.showStep(1); await drawCrop(); schedulePreview(); notice('새 초안을 시작했어요.'); return; }
    if (action === 'unpublish') { await unpublish(); return; }
    if (action === 'delete') { await deleteProject(); return; }
    if (action === 'undo' || action === 'redo') {
      const source = action === 'undo' ? undo : redo, destination = action === 'undo' ? redo : undo;
      if (!source.length) { notice(action === 'undo' ? '되돌릴 편집이 아직 없어요.' : '다시 실행할 편집이 없어요.'); return; }
      destination.push(cloneProject(project)); project = source.pop(); restoring = true; syncValues(); restoring = false; changed(); await drawCrop(); schedulePreview(); return;
    }
    if (action === 'grade-preview') { selectedGrade = id; renderGrades(); [...view('grade-tabs').querySelectorAll('button')].find(tile => tile.dataset.id === id)?.focus({ preventScroll: true }); schedulePreview(); return; }
    if (action === 'crop-reset') { mutate(() => { project.crop = { x: 0, y: 0, zoom: 1 }; }); syncValues(); await drawCrop(); return; }
    if (action === 'crop-apply') { schedulePreview(); notice('자르기를 반영했어요. 원본 사진은 그대로 보관돼요.'); return; }
    if (action === 'compare') { const copy = cloneProject(project); copy.photoEdits = { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] }; await renderCrop(cropCanvas, copy); notice('원본을 보여 주고 있어요. 사진을 움직이거나 자르기 적용을 누르면 편집 결과로 돌아와요.'); return; }
    if (action === 'edits-reset') { mutate(() => { project.photoEdits = createProject().photoEdits; }); syncValues(); await drawCrop(); return; }
    if (action === 'sticker-add') {
      const text = control('sticker-new').value.trim(); if (!text) { notice('스티커 내용을 입력해 주세요.', true); return; }
      if (project.stickers.length >= 24) { notice('스티커는 24개까지 만들 수 있어요.', true); return; }
      mutate(() => { const sticker = { id: createId('sticker'), kind: control('sticker-kind').value, text, x: .5, y: .7, size: 42, rotation: 0, color: '#ffffff', order: project.stickers.length }; project.stickers.push(sticker); selectedSticker = sticker.id; }); control('sticker-new').value = ''; renderStickers(); return;
    }
    if (action.startsWith('sticker-')) {
      const sticker = project.stickers.find(item => item.id === selectedSticker); if (!sticker) return;
      mutate(() => {
        if (action === 'sticker-delete') { project.stickers = project.stickers.filter(item => item.id !== sticker.id); project.effects = project.effects.filter(item => item.target !== sticker.id); }
        else { const ordered = [...project.stickers].sort((a, b) => a.order - b.order); const index = ordered.indexOf(sticker), other = ordered[index + (action === 'sticker-front' ? 1 : -1)]; if (other) [other.order, sticker.order] = [sticker.order, other.order]; }
      }); renderStickers(); renderEffects(); return;
    }
    if (action === 'grade-add') {
      const name = control('grade-name').value.trim(); if (!name) { notice('새 등급의 이름을 입력해 주세요.', true); return; }
      if (project.grades.length >= 16) { notice('등급은 16개까지 만들 수 있어요.', true); return; }
      mutate(() => {
        const grade = createGrade(name); project.grades.push(grade); const source = control('grade-copy').value;
        if (source) for (const item of [...project.effects, ...project.motion]) if (item.gradeIds.includes(source)) item.gradeIds.push(grade.id);
        selectedGrade = grade.id;
      }); control('grade-name').value = ''; renderGrades(); renderEffects(); renderMotionGrades(); return;
    }
    if (action === 'effect-add') {
      if (project.effects.length >= 64) { notice('효과는 64개까지 만들 수 있어요.', true); return; }
      mutate(() => project.effects.push({ id: createId('effect'), type: control('effect-type').value, target: control('effect-target').value, gradeIds: [], strength: 45, color: project.baseColor, roughness: 25 })); renderEffects(); return;
    }
    if (action === 'effect-delete') { mutate(() => { project.effects = project.effects.filter(item => item.id !== id); }); renderEffects(); return; }
    if (action === 'template') { selectedTemplate = id; playing = true; start = performance.now(); renderMotionGrades(); schedulePreview(); return; }
    if (action === 'play' || action === 'replay') { playing = true; if (action === 'replay') start = performance.now(); schedulePreview(); return; }
    if (action === 'angle-reset') { mutate(() => { project.angle = 0; }); control('angle').value = 0; output('angle').textContent = '0°'; return; }
    if (action === 'thickness-reset') { mutate(() => { project.thickness = 8; }); control('thickness').value = 8; output('thickness').textContent = '8'; return; }
    if (action === 'record') { await record(); return; }
    if (action === 'audio-delete') { audioImportSequence++; stopRecording(true); recordingStream?.getTracks().forEach(track => track.stop()); recordingStream = null; mutate(() => { project.audio = null; }); view('audio').pause(); view('audio').src = ''; view('audio').hidden = true; return; }
    if (action === 'story-frame-delete') { mutate(() => { project.story.frames.splice(Number(id), 1); }); renderStoryFrames(); return; }
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
      const sticker = project.stickers.find(item => item.id === selectedSticker); if (!sticker) return;
      sticker[target.dataset.sticker] = ['text', 'color'].includes(target.dataset.sticker) ? target.value : Number(target.value); changed(); schedulePreview(); return;
    }
    const field = target.dataset.control;
    if (['zoom', 'crop-x', 'crop-y'].includes(field)) {
      project.crop[field === 'zoom' ? 'zoom' : field.slice(-1)] = Number(target.value); output('zoom').textContent = `${project.crop.zoom.toFixed(2)}배`; changed(); drawCrop(); schedulePreview();
    } else if (field === 'angle' || field === 'thickness') {
      playing = false; output(field).textContent = `${target.value}${field === 'angle' ? '°' : ''}`;
      // The value changes immediately. The expensive final is generated on release.
    } else if (['name', 'greeting', 'theme'].includes(field)) {
      if (field === 'theme') project.theme.name = target.value; else project[field] = target.value;
      view('greeting').textContent = project.greeting; changed();
    } else if (['base-color', 'photo-color', 'relief'].includes(field)) {
      project[{ 'base-color': 'baseColor', 'photo-color': 'photoColor', relief: 'relief' }[field]] = field === 'base-color' ? target.value : Number(target.value); changed(); schedulePreview();
    } else if (field === 'story-cartoon') { project.story.cartoon = Number(target.value); changed(); }
    for (const [attribute, property] of [['effectStrength', 'strength'], ['effectRoughness', 'roughness'], ['effectColor', 'color']]) if (target.dataset[attribute]) {
      const effect = project.effects.find(item => item.id === target.dataset[attribute]); effect[property] = property === 'color' ? target.value : Number(target.value); changed(); schedulePreview();
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
        mutate(() => { project.audio = { dataUrl, mimeType: 'audio/mpeg', durationSeconds }; }); view('audio').src = dataUrl; view('audio').hidden = false; notice('MP3를 불러왔어요. 재생 버튼으로 미리 들어 보세요.'); return;
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
          if (!grade.enabled) for (const count of Object.keys(project.rewardGrades)) if (project.rewardGrades[count] === grade.id) { delete project.rewardGrades[count]; removed = true; }
        });
        if (removed) notice('끄신 등급의 방문 목표 연결도 해제했어요. 게시할 때 다른 등급을 선택해 주세요.');
        if (!grade.enabled && selectedGrade === grade.id) selectedGrade = project.grades.find(item => item.enabled).id; renderGrades(); renderEffects(); renderMotionGrades(); return;
      }
      if (target.dataset.effectGrade) {
        mutate(() => {
          const effect = project.effects.find(item => item.id === target.dataset.effectGrade), grade = target.dataset.grade;
          effect.gradeIds = target.checked ? [...new Set([...effect.gradeIds, grade])] : effect.gradeIds.filter(item => item !== grade);
          if (target.checked && ['matte', 'enamel', 'glass'].includes(effect.type)) {
            let replaced = false;
            for (const other of project.effects) if (other.id !== effect.id && other.target === effect.target && ['matte', 'enamel', 'glass'].includes(other.type) && other.gradeIds.includes(grade)) { other.gradeIds = other.gradeIds.filter(item => item !== grade); replaced = true; }
            if (replaced) notice('같은 영역에서 무광·에나멜·유리는 한 재질을 써요. 이 등급의 이전 기본 재질을 새 선택으로 바꿨어요.');
          }
        }); renderEffects(); return;
      }
      if (target.dataset.motionGrade) {
        mutate(() => {
          const type = target.dataset.motionGrade, grade = target.dataset.grade;
          let motion = project.motion.find(item => item.type === type);
          if (!motion) { motion = { id: createId('motion'), type, gradeIds: [] }; project.motion.push(motion); }
          for (const other of project.motion) other.gradeIds = other.gradeIds.filter(item => item !== grade);
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
    remember(); cropCanvas.setPointerCapture(event.pointerId); const mode = control('brush').value;
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
    } else if (pointer.stroke.points.length < 512) pointer.stroke.points.push(pointOnPhoto(event));
    changed(); drawCrop(); schedulePreview();
  });
  const endPointer = () => { pointer = null; schedulePreview(); };
  listen(cropCanvas, 'pointerup', endPointer); listen(cropCanvas, 'pointercancel', endPointer);
  listen(previewCanvas, 'pointerdown', event => {
    if (loading) return;
    const point = pointOn(previewCanvas, event), x = (point.x - 512 * .11) / (512 * .78), y = (point.y - 512 * .11) / (512 * .78);
    if (Math.abs(project.angle) > 15 || playing) { notice('스티커를 드래그하려면 정면 보기와 정지를 눌러 주세요. 위치 조절바는 어느 각도에서도 사용할 수 있어요.'); return; }
    const candidate = [...project.stickers].sort((a, b) => b.order - a.order).find(sticker => Math.hypot((sticker.x - x) * 512, (sticker.y - y) * 512) < Math.max(25, sticker.size));
    if (!candidate) return; remember(); selectedSticker = candidate.id; renderStickers(); previewCanvas.setPointerCapture(event.pointerId); pointer = { type: 'sticker', sticker: candidate, start: { x, y }, x: candidate.x, y: candidate.y };
  });
  listen(previewCanvas, 'pointermove', event => {
    if (pointer?.type !== 'sticker') return;
    const point = pointOn(previewCanvas, event); pointer.sticker.x = clamp(pointer.x + (point.x - 512 * .11) / (512 * .78) - pointer.start.x, 0, 1); pointer.sticker.y = clamp(pointer.y + (point.y - 512 * .11) / (512 * .78) - pointer.start.y, 0, 1);
    changed(); renderStickers(); schedulePreview();
  });
  listen(previewCanvas, 'pointerup', endPointer); listen(previewCanvas, 'pointercancel', endPointer);
  listen(document, 'visibilitychange', () => { if (document.hidden) stopHiddenMedia(); else { start = performance.now(); if (!studio.isHome) schedulePreview(); } });
  listen(window, 'beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  for (const [value, name] of Object.entries(effectNames)) option(control('effect-type'), name, value);
  for (const [value, name] of Object.entries(storyNames)) option(control('story-type'), name, value);
  for (const [id, name] of Object.entries(motionNames)) {
    const tile = button(name, 'template', { 'data-id': id, 'aria-pressed': String(id === selectedTemplate) }); const canvas = element('canvas', undefined, { width: 96, height: 96, 'aria-hidden': 'true' }); tile.prepend(canvas); view('templates').append(tile);
    renderCollectible(canvas, demoProject, 'bronze', { animation: id, staticFrame: true, textureSize: 120 }).catch(() => {});
  }
  control('reduce-motion').checked = reducedMotion.matches;
  const preferenceChanged = event => { control('reduce-motion').checked = event.matches; if (event.matches) playing = false; schedulePreview(); };
  reducedMotion.addEventListener('change', preferenceChanged);
  const intersection = globalThis.IntersectionObserver ? new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) schedulePreview(); else { if (frame) cancelAnimationFrame(frame); frame = 0; } }) : null;
  intersection?.observe(container);
  syncValues(); drawCrop(); schedulePreview(); refreshList(); refreshCampaigns();
  return () => {
    active = false; controller.abort(); intersection?.disconnect(); if (frame) cancelAnimationFrame(frame); clearTimeout(recordingTimer);
    if (recorder?.state === 'recording') recorder.stop(); recordingStream?.getTracks().forEach(track => track.stop());
    view('audio').pause(); view('audio').removeAttribute('src'); reducedMotion.removeEventListener('change', preferenceChanged);
    clearCollectibleRenderCache(); container.replaceChildren();
  };
}
