import { THICKNESS_PRESETS, thicknessPresetLabel } from './collectible-model.mjs';
const steps = ['사진 배치', '등급 미리보기', '세부 조정', '연출과 목소리'];
const seasons = [['기본', '기본'], ['여름축제', '여름축제'], ['겨울방학', '겨울방학'], ['custom', '자유 입력']];
const node = (tag, className, text) => {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
};
const action = (label, name, id, className = '') => {
  const value = node('button', className, label); value.type = 'button'; value.dataset.action = name;
  if (id !== undefined) value.dataset.id = id;
  return value;
};
const section = (title, text) => {
  const value = node('section', 'ce-panel'); value.append(node('h3', '', title));
  if (text) value.append(node('p', 'ce-help', text));
  return value;
};
/** "더 보기"처럼 접어 두는 묶음. 지우지 않고 옮긴 컨트롤만 담는다. */
const disclosure = (summary, ...children) => {
  const value = node('details', 'ce-more'), body = node('div', 'ce-detail');
  body.append(...children); value.append(node('summary', '', summary), body);
  return value;
};
function shapeIcon(shape) {
  const icon = node('span', `ce-shape-icon ce-shape-${shape}`); icon.setAttribute('aria-hidden', 'true');
  if (shape === 'circle') icon.innerHTML = '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="28"/></svg>';
  else if (shape === 'stamp') icon.innerHTML = '<svg viewBox="0 0 80 80"><path d="M17 12 Q21 22 25 12 Q29 22 33 12 Q37 22 41 12 Q45 22 49 12 Q53 22 57 12 L63 12 Q53 17 63 22 Q53 27 63 32 Q53 37 63 42 Q53 47 63 52 Q53 57 63 62 L63 68 Q59 58 55 68 Q51 58 47 68 Q43 58 39 68 Q35 58 31 68 Q27 58 23 68 L17 68 Q27 63 17 58 Q27 53 17 48 Q27 43 17 38 Q27 33 17 28 Q27 23 17 18 Z"/></svg>';
  else {
    const points = Array.from({ length: 48 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI / 24, radius = index % 2 ? 24 : 32;
      return `${40 + Math.cos(angle) * radius},${40 + Math.sin(angle) * radius}`;
    }).join(' ');
    icon.innerHTML = `<svg viewBox="0 0 80 80"><polygon points="${points}"/></svg>`;
  }
  return icon;
}
function choices(control, values, labels, kind) {
  const group = node('div', `ce-choice-grid ce-${kind}-choices`); group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `${labels} 선택`);
  for (const [value, title] of values) {
    const tile = action('', 'choice', value, `ce-choice ce-choice-${kind}`); tile.dataset.controlFor = control;
    tile.setAttribute('aria-pressed', 'false');
    if (kind === 'shape') tile.append(shapeIcon(value));
    else if (kind === 'material') { const swatch = node('span', `ce-material-swatch ce-material-${value}`); swatch.setAttribute('aria-hidden', 'true'); tile.append(swatch); }
    else if (kind === 'style') { const swatch = node('span', `ce-style-swatch ce-style-${value}`, '月'); swatch.setAttribute('aria-hidden', 'true'); tile.append(swatch); }
    tile.append(node('span', 'ce-choice-label', title)); group.append(tile);
  }
  return group;
}
function seasonTiles(name) {
  const group = node('div', 'ce-season-grid'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', name === 'season' ? '새 수집품 시즌 선택' : '현재 수집품 시즌 선택');
  for (const [value, label] of seasons) {
    const tile = action('', name, value, `ce-season-card ce-season-${value === 'custom' ? 'custom' : value === '여름축제' ? 'summer' : value === '겨울방학' ? 'winter' : 'basic'}`);
    tile.setAttribute('aria-pressed', String(value === '기본')); tile.append(node('span', 'ce-season-art', value === 'custom' ? '+' : value === '여름축제' ? '✦' : value === '겨울방학' ? '❄' : '⌂'), node('span', '', label)); group.append(tile);
  }
  return group;
}

/** Reuses the editor's controls and canvases; navigation never copies project state. */
export function createCollectibleStudio(container, { effectNames, listen, merchantArtUrl = '', merchantName = '', menuNames = [] }) {
  const controlsByName = new Map([...container.querySelectorAll('[data-control]')].map(value => [value.dataset.control, value]));
  const viewsByName = new Map([...container.querySelectorAll('[data-view]')].map(value => [value.dataset.view, value]));
  const control = name => controlsByName.get(name) || container.querySelector(`[data-control="${name}"]`);
  const view = name => viewsByName.get(name) || container.querySelector(`[data-view="${name}"]`);
  const field = name => control(name).closest('label');
  const controls = container.querySelector('.ce-controls'), grid = container.querySelector('.ce-grid');
  const heading = container.querySelector('.ce-heading');
  heading.querySelector('h2').textContent = '가게 수집품 스튜디오';
  heading.querySelector('p').textContent = '사진 한 장에서 시작하는 우리 가게의 작은 기념품';
  heading.querySelector('[data-action="new"]').textContent = '새 수집품';
  const projectList = field('project-list'); projectList.hidden = true;
  const home = node('div', 'ce-studio-home'); home.dataset.view = 'studio-home';
  const hero = node('section', 'ce-studio-hero');
  const heroText = node('div', 'ce-hero-copy'); heroText.append(node('span', 'ce-eyebrow', '사진으로 만드는 우리 가게의 이야기'), node('h3', '', '들를 때마다,\n하나씩 모으는 즐거움'), node('p', '', '가게, 메뉴, 간판, 그림도 좋아요.\n사진 한 장으로 쉽게 시작하세요.'));
  const create = node('div', 'ce-entry-options');
  const aiEntry = action('', 'ai-start', undefined, 'ce-create-card');
  aiEntry.append(node('strong', '', 'AI로 초안 생성 후 스튜디오 하기'), node('span', '', '가게 이름과 메뉴로 그림을 만들고 골라요 →'));
  const photoEntry = action('', 'prepared-photo', undefined, 'ce-create-card');
  photoEntry.append(node('strong', '', '미리 준비한 이미지 넣어서 스튜디오 가기'), node('span', '', '사진·그림을 직접 골라 바로 편집해요 →'));
  create.append(aiEntry, photoEntry);
  const mascot = node('img', 'ce-hero-mascot'); mascot.src = '/assets/mascot-stamp.png'; mascot.alt = ''; mascot.width = 140; mascot.height = 140;
  hero.append(heroText, mascot, create); home.append(hero);
  const aiPanel = section('AI 초안 고르기', '가게 이름과 등록된 메뉴로 만들어요. 사진과 음성은 AI에 보내지 않아요. 고른 그림은 스튜디오 초안에만 들어가요.');
  aiPanel.dataset.view = 'ai-panel'; aiPanel.hidden = true;
  const aiStatus = node('p', 'ce-help'); aiStatus.setAttribute('role', 'status'); aiStatus.dataset.view = 'ai-status';
  const aiDrafts = node('div', 'ce-ai-drafts'); aiDrafts.dataset.view = 'ai-drafts';
  aiPanel.append(action('← 시작 방식 선택', 'ai-back', undefined, 'ce-text-button'), aiStatus, aiDrafts, action('생성 상태 다시 확인', 'ai-start', undefined, 'ce-text-button'), action('AI 새 초안 만들기', 'ai-create', undefined, 'ce-text-button'), action('준비한 이미지로 스튜디오 가기', 'prepared-photo', undefined, 'ce-text-button'));
  home.append(aiPanel);
  const latestPhoto = action('최근 등록한 가게 사진으로 시작', 'latest-photo', undefined, 'ce-text-button'); home.append(latestPhoto);
  const homeOptions = node('div', 'ce-home-options'); home.append(homeOptions);
  {
    const starters = section('가게에서 시작하기');
    const choices = node('div', 'ce-starter-grid');
    const options = [['store', merchantName || '우리 가게', merchantArtUrl ? '가게 그림' : '사진 추가', '1회 브론즈 · 3회 실버 · 5회 골드'],
      ...menuNames.map((name, index) => [String(index), name, '등록된 메뉴', '가게 그림 또는 직접 올린 사진으로 시작'])];
    for (const [id, title, source, detail] of options) {
      const tile = action('', 'starter', id, 'ce-starter-choice');
      const visual = node('span', 'ce-starter-visual');
      if (id === 'store' && merchantArtUrl) { const art = node('img'); art.src = merchantArtUrl; art.alt = ''; art.loading = 'lazy'; visual.append(art); }
      else visual.append(node('span', 'ce-starter-menu-title', id === 'store' ? merchantName || '우리 가게' : title));
      const stages = node('span', 'ce-starter-stages');
      for (const [grade, label] of [['bronze', '1회'], ['silver', '3회'], ['gold', '5회']]) stages.append(node('span', `ce-starter-${grade}`, label));
      visual.append(stages);
      tile.append(visual, node('span', 'ce-starter-source', source), node('strong', '', title), node('span', 'ce-starter-detail', detail));
      choices.append(tile);
    }
    starters.append(choices); homeOptions.append(disclosure('가게·메뉴에서 시작하기', starters));
  }
  const resume = node('div', 'ce-resume'); resume.hidden = true;
  const resumeText = node('p', 'ce-resume-text'); resume.append(resumeText, action('이어서 편집하기 →', 'resume', undefined, 'ce-resume-button')); home.append(resume);
  const saved = section('나의 제작물', '저장한 초안과 게시 버전을 다시 열어 이어서 만들 수 있어요.');
  const savedHeading = node('div', 'ce-section-heading'); savedHeading.append(saved.querySelector('h3'), action('목록 새로 보기', 'refresh', undefined, 'ce-text-button')); saved.prepend(savedHeading);
  const gallery = node('div', 'ce-project-gallery'); gallery.dataset.view = 'project-gallery'; saved.append(gallery); homeOptions.append(disclosure('저장한 제작물 보기', saved));
  const season = section('시즌 테마', '새로 만들 수집품의 테마를 골라 주세요. 등급과 보상 조건은 그대로예요.');
  const homeThemes = seasonTiles('season'); season.append(homeThemes);
  const customField = node('label', 'ce-field', '자유 입력 테마'); customField.hidden = true;
  const custom = node('input'); custom.type = 'text'; custom.maxLength = 80; custom.placeholder = '예: 우리 동네 생일 축제'; custom.dataset.control = 'home-theme'; customField.append(custom); season.append(customField); homeOptions.append(disclosure('새 수집품의 시즌 설정', season));
  let homeTheme = '기본', currentStep = 1, hasCurrent = false;
  let historyEntry = window.history?.state?.collectibleWorkspace === true, pendingBack = false;
  const workspace = node('div', 'ce-workspace'); workspace.hidden = true; workspace.dataset.view = 'workspace'; workspace.dataset.step = '1';
  const phoneLayout = window.matchMedia?.('(max-width: 820px)');
  const inertBackground = new Map();
  function restoreBackground() {
    for (const [target, previous] of inertBackground) target.inert = workspace.contains(target) ? false : previous;
    inertBackground.clear();
  }
  function syncBackground() {
    restoreBackground();
    // 열린 native dialog가 배경을 이미 잠그므로 내부의 운영 화면 복귀 버튼까지 잠그지 않는다.
    if (workspace.hidden || !phoneLayout?.matches || container.closest('dialog')?.open) return;
    // 작업 영역의 조상은 그대로 두고 형제만 잠근다.
    for (let current = workspace; current !== document.body && current.parentElement; current = current.parentElement) {
      for (const sibling of current.parentElement.children) {
        if (sibling === current || sibling.inert) continue;
        inertBackground.set(sibling, Boolean(sibling.inert)); sibling.inert = true;
      }
    }
  }
  if (phoneLayout?.addEventListener) listen(phoneLayout, 'change', syncBackground);
  const workspaceHeading = node('div', 'ce-workspace-heading');
  const title = node('h3', 'ce-step-title'); title.tabIndex = -1; title.id = `collectible-step-${Math.random().toString(36).slice(2, 9)}`;
  workspaceHeading.append(action('← 스튜디오', 'home', undefined, 'ce-home-button'), title, node('span', 'ce-step-count', '1 / 4')); workspace.append(workspaceHeading);
  const navigation = node('nav', 'ce-step-nav'); navigation.setAttribute('aria-label', '제작 단계 자유롭게 이동');
  for (const [index, label] of steps.entries()) { const tile = action('', 'step', String(index + 1)); tile.append(node('span', 'ce-step-number', String(index + 1).padStart(2, '0')), node('span', '', label)); navigation.append(tile); }
  workspace.append(navigation, grid);
  container.append(home, workspace);
  const panels = steps.map((_, index) => { const panel = node('section', 'ce-step-panel'); panel.dataset.stepPanel = String(index + 1); panel.setAttribute('aria-labelledby', title.id); return panel; });
  const photo = field('photo'), photoHelp = photo.nextElementSibling, shape = field('shape'), crop = view('crop');
  const cropZoom = field('zoom'), cropMoves = field('crop-x').parentElement, cropActions = cropMoves.nextElementSibling;
  const zoomOut = action('−', 'zoom-step', '-0.25', 'ce-icon-button'), zoomIn = action('+', 'zoom-step', '0.25', 'ce-icon-button');
  zoomOut.setAttribute('aria-label', '사진 0.25배 축소'); zoomIn.setAttribute('aria-label', '사진 0.25배 확대');
  const zoomRow = node('div', 'ce-zoom-row'); zoomRow.append(zoomOut, cropZoom, zoomIn);
  // 붓·패럴랙스·living 점·"원본과 비교"는 사진 캔버스(crop)에만 그려지므로 3단계에도 같은 캔버스가 있어야 한다.
  // 4단계 "살아 있는 그림"의 "이 영역 칠하기"도 같은 캔버스에 칠하므로 4단계에도 칸이 있다.
  // 캔버스만 1·3·4단계 칸 사이에서 옮기고(2단계는 1단계 칸에 숨겨 둔다), 확대 줄·모양·자르기 동작은 1단계에만 둔다(showStep).
  const cropSlots = [node('div', 'ce-crop-slot'), node('div', 'ce-crop-slot'), node('div', 'ce-crop-slot')]; cropSlots[0].append(crop);
  const photoStage = node('div', 'ce-photo-stage');
  photoStage.append(node('p', 'ce-photo-instruction', '사진을 움직여 원하는 모양에 맞춰 주세요.'), cropSlots[0], zoomRow, disclosure('더 보기 · 위치 미세 조정', cropMoves, cropActions));
  shape.hidden = true;
  const shapes = section('모양', '사진의 위치와 확대는 모양을 바꿔도 유지돼요.'); shapes.append(shape, choices('shape', [['circle', '원형'], ['stamp', '우표'], ['serrated', '톱니']], '모양', 'shape'));
  panels[0].append(photo);
  if (merchantArtUrl) panels[0].append(action('가게 그림으로 시작', 'art-photo', undefined, 'ce-text-button'));
  panels[0].append(photoHelp, shapes, photoStage);
  const style = field('style'); style.hidden = true;
  const styles = section('표현 스타일', '원본 색, 음각, 양각을 직접 비교해 보세요.');
  styles.append(style, choices('style', [['original', '원본'], ['incised', '음각'], ['raised', '양각']], '표현 스타일', 'style'), field('relief'), view('fixed-back'));
  panels[1].append(styles);
  const thickness = field('thickness'), thicknessReset = container.querySelector('[data-action="thickness-reset"]'), thicknessHelp = thicknessReset.nextElementSibling;
  const thicknessCustom = node('p', 'ce-thickness-custom'); thicknessCustom.hidden = true;
  const volume = section('수집품 두께', '화면에 보이는 측면 깊이예요. 실물 제작 치수가 아니에요.');
  volume.append(choices('thickness', THICKNESS_PRESETS.map(([value, label]) => [String(value), label]), '두께', 'thickness'), thicknessCustom, disclosure('더 보기 · 두께 세밀하게', thickness, thicknessReset, thicknessHelp));
  panels[1].append(volume);
  const gradesDetail = view('grade-manager').closest('details'), gradeContent = gradesDetail.querySelector('.ce-detail');
  const gradeManager = view('grade-manager'), gradeNew = field('grade-name').parentElement, gradeAdd = container.querySelector('[data-action="grade-add"]');
  panels[1].append(disclosure('더 보기 · 등급 관리(이름·사용·특수 등급)', node('p', 'ce-help', '등급 이름과 사용 여부를 바꿀 수 있어요. 이름이 특정 재질을 강제하지 않아요.'), gradeManager, gradeNew, gradeAdd));
  const motionDetail = view('templates').closest('details');
  const photoDetail = control('brush').closest('details'), stickerDetail = control('sticker-kind').closest('details');
  photoDetail.open = false; stickerDetail.open = true; photoDetail.classList.add('ce-more');
  photoDetail.querySelector('summary').textContent = '더 보기 · 밝기·바탕·패럴랙스';
  const brush = field('brush'); brush.hidden = true;
  const tools = node('div', 'ce-step-tools');
  // undo·redo는 1단계 "위치 미세 조정" 접힘(cropActions)이 이미 container 밖의 panels[0]으로 옮겨 가 container에서는 찾을 수 없다.
  tools.append(cropActions.querySelector('[data-action="undo"]'), cropActions.querySelector('[data-action="redo"]'), container.querySelector('[data-action="compare"]'));
  const brushPanel = section('붓 도구');
  brushPanel.append(cropSlots[1], brush, choices('brush', [['move', '사진 이동'], ['clean', '잡티'], ['erase', '투명'], ['restore', '복원'], ['color', '색 통일']], '붓 도구', 'brush'), field('brush-size'), field('brush-color'));
  const FILTERS = [['merge', '색 합치기'], ['simplify', '단순화'], ['cartoon', '만화풍']];
  const filterSliders = new Map(FILTERS.map(([name]) => [name, container.querySelector(`[data-edit="${name}"]`).closest('label')]));
  const filterTiles = node('div', 'ce-choice-grid ce-filter-choices'); filterTiles.setAttribute('role', 'group'); filterTiles.setAttribute('aria-label', '필터 선택');
  for (const [name, label] of FILTERS) {
    const tile = node('button', 'ce-choice ce-choice-filter', label); tile.type = 'button'; tile.dataset.filter = name; tile.setAttribute('aria-pressed', 'false'); filterTiles.append(tile);
  }
  const showFilter = name => {
    for (const tile of filterTiles.children) tile.setAttribute('aria-pressed', String(tile.dataset.filter === name));
    for (const [filter, label] of filterSliders) label.hidden = filter !== name;
  };
  filterTiles.addEventListener('click', event => { const tile = event.target.closest('[data-filter]'); if (tile) showFilter(tile.dataset.filter); });
  let filterProject = null;
  const syncFilter = project => {
    if (project === filterProject) return;
    filterProject = project;
    showFilter(FILTERS.map(([name]) => name).find(name => Number(project.photoEdits?.[name] || 0) !== 0) ?? 'cartoon');
  };
  const filterPanel = section('필터', '고른 필터의 강도만 보여요. 세 값은 함께 저장돼요.');
  filterPanel.append(filterTiles, ...filterSliders.values());
  panels[2].append(action('사진 바꾸기·자르기는 1단계에서 →', 'step', '1', 'ce-link-step'), tools, brushPanel, filterPanel, stickerDetail, photoDetail);
  const materials = section('효과 스튜디오', '지금 보는 등급 한 개와 효과를 적용할 여러 등급은 따로 골라요.');
  const effectControls = field('effect-type').parentElement; field('effect-type').hidden = true; field('effect-target').hidden = true;
  const materialsChoices = choices('effect-type', Object.entries(effectNames), '재질 효과', 'material');
  const targets = node('div', 'ce-target-chips'); targets.dataset.view = 'effect-target-chips'; targets.setAttribute('role', 'group'); targets.setAttribute('aria-label', '새 효과의 적용 대상');
  materials.append(materialsChoices, node('h4', '', '효과 대상'), targets, effectControls, container.querySelector('[data-action="effect-add"]'), view('effects'));
  gradeContent.replaceChildren(); gradesDetail.remove();
  // Issue #284 WP3: "살아 있는 그림"은 motionDetail과 별개인 <details>라 여기서 명시적으로 모아 주지 않으면
  // 아래 controls.replaceChildren(...panels)가 panels에 없는 요소를 전부 버려 고아가 된다(브러시 대상 select가
  // 동작 중인 사진 세부 조정 안에 있는 패럴랙스 컨트롤은 photoDetail에 이미 포함돼 있어 따로 손댈 필요가 없다).
  const livingDetail = control('living-kind').closest('details');
  const voice = control('greeting').closest('details'), story = control('story-type').closest('details'), rewards = control('theme').closest('details');
  motionDetail.open = true; voice.open = true; rewards.open = true; livingDetail.open = false; story.open = false;
  livingDetail.classList.add('ce-more'); story.classList.add('ce-more');
  livingDetail.querySelector('.ce-detail').prepend(cropSlots[2]);
  motionDetail.querySelector('summary').textContent = '움직임';
  livingDetail.querySelector('summary').textContent = '더 보기 · 살아 있는 그림';
  story.querySelector('summary').textContent = '더 보기 · 가게 이야기';
  rewards.querySelector('summary').textContent = '게시 정보 · 이름·시즌·캠페인';
  const rewardsBody = rewards.querySelector('.ce-detail');
  rewardsBody.prepend(seasonTiles('theme')); rewardsBody.prepend(field('name'));
  panels[3].append(motionDetail, materials, voice, rewards, livingDetail, story);
  controls.replaceChildren(...panels);
  const preview = grid.querySelector('.ce-preview'), publishBox = grid.querySelector('.ce-publish');
  const previewActions = field('angle').nextElementSibling;
  const iconize = (button, icon) => { button.setAttribute('aria-label', button.textContent); button.textContent = icon; button.classList.add('ce-icon-button'); return button; };
  const play = iconize(previewActions.querySelector('[data-action="play"]'), '▶'), pause = iconize(previewActions.querySelector('[data-action="pause"]'), '❚❚');
  const previewRow = node('div', 'ce-preview-row'); previewRow.append(play, pause, field('angle'));
  const previewMore = disclosure('미리보기 옵션', previewActions.querySelector('[data-action="replay"]'), previewActions.querySelector('[data-action="angle-reset"]'), control('reduce-motion').closest('label'), view('preview-caption'), view('greeting'));
  previewMore.classList.add('ce-preview-more');
  previewActions.remove();
  // 예전 게시 묶음(.ce-publish)은 해체한다: 초안·게시 중지·삭제는 ⋯ 메뉴로, 게시는 하단 바로, 안내·배포 상태는 4단계 게시 정보로, 저장 상태는 알림 줄로 옮긴다. 복제하지 않고 옮기기만 한다.
  const draft = container.querySelector('[data-action="draft"]'), publish = container.querySelector('[data-action="publish"]');
  const unpublish = container.querySelector('[data-action="unpublish"]'), remove = container.querySelector('[data-action="delete"]');
  rewardsBody.append(publishBox.querySelector('.ce-help'), view('distribution'));
  const statusLine = node('div', 'ce-status-line'); statusLine.append(view('save-state'));
  publishBox.remove();
  preview.append(previewRow, previewMore);
  publish.textContent = '게시하기';
  const previous = action('← 이전', 'previous-step'), nextButton = action('다음 →', 'next-step', undefined, 'primary'), fullPreview = action('전체 미리보기', 'replay', undefined, 'ce-full-preview');
  const footer = node('div', 'ce-stage-footer'); footer.append(previous, fullPreview, nextButton, publish);
  const menu = node('div', 'ce-menu'); menu.id = `${title.id}-menu`; menu.hidden = true; menu.append(draft, unpublish, remove);
  const menuToggle = node('button', 'ce-menu-button', '⋯'); menuToggle.type = 'button';
  menuToggle.setAttribute('aria-label', '더 많은 작업'); menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-controls', menu.id);
  // 메뉴를 닫을 때 초점을 ⋯로 돌리는 것은 Esc와 메뉴 동작 뒤뿐이다(단계·홈 이동은 자기 초점 규칙을 따른다).
  const setMenu = (open, returnFocus = false) => {
    menu.hidden = !open; menuToggle.setAttribute('aria-expanded', String(open));
    if (!open && returnFocus) menuToggle.focus();
  };
  menuToggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', event => { if (event.target.closest('[data-action]')) setMenu(false, true); });
  // 메뉴 밖을 누르거나 Esc를 누르면 닫는다. ⋯와 메뉴 자체의 클릭은 위 두 처리기가 맡는다.
  workspace.addEventListener('click', event => { if (!menu.hidden && !event.target.closest('.ce-menu') && !event.target.closest('.ce-menu-button')) setMenu(false); });
  workspace.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) setMenu(false, true); });
  workspaceHeading.append(menuToggle, menu);
  // 알림 줄(알림·저장 상태)과 하단 바는 한 고정 묶음이라 스크롤 위치와 상관없이 항상 하단 바 바로 위에서 보인다.
  const bottom = node('div', 'ce-stage-bottom'); bottom.append(statusLine, footer);
  workspace.append(bottom);
  // 알림은 작업 영역에서는 하단 바 위 알림 줄, 스튜디오 홈에서는 홈 맨 위에 둔다(showStep·showHome이 옮긴다).
  const noticeView = view('notice');
  let targetSignature = '';
  function syncChoices() {
    for (const tile of container.querySelectorAll('[data-action="choice"]')) tile.setAttribute('aria-pressed', String(control(tile.dataset.controlFor)?.value === tile.dataset.id));
    const targetControl = control('effect-target'), signature = [...targetControl.options].map(item => `${item.value}:${item.textContent}`).join('|');
    if (signature !== targetSignature) {
      targetSignature = signature; targets.replaceChildren();
      for (const item of targetControl.options) { const tile = action(item.textContent, 'choice', item.value, 'ce-target-chip'); tile.dataset.controlFor = 'effect-target'; targets.append(tile); }
    }
    for (const tile of targets.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === targetControl.value));
    const thicknessValue = Number(control('thickness').value);
    thicknessCustom.hidden = thicknessPresetLabel(thicknessValue) !== null; thicknessCustom.textContent = `직접 지정 ${thicknessValue}`;
  }
  function showStep(step, focus = true) {
    const entering = workspace.hidden;
    const next = Math.max(1, Math.min(4, Number(step) || 1));
    // 붓(지우개 등)과 붓 대상(패럴랙스·living 영역)은 칠하는 단계(3·4단계) 안에서만 쓴다. 단계가 바뀌거나 홈에서 들어올 때마다 "사진 이동"·"사진 보정"으로 되돌려
    // 1단계 끌기가 사진을 옮기는 대신 지우거나 점을 찍지 않게 한다. 붓 값은 편집기가 pointerdown에서 읽기만 하고, 붓 대상은 편집기의 change 처리가
    // 상태와 화면을 맞춘다(4단계 "이 영역 칠하기"는 눌렀을 때 대상을 직접 정한다). 둘 다 되돌리기 기록은 만들지 않는다.
    if (workspace.hidden || next !== currentStep) {
      control('brush').value = 'move';
      const brushTarget = control('brush-target');
      if (brushTarget.value !== 'photo') { brushTarget.value = 'photo'; brushTarget.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    currentStep = next; home.hidden = true; workspace.hidden = false; hasCurrent = true;
    const cropSlot = cropSlots[currentStep === 3 ? 1 : currentStep === 4 ? 2 : 0];
    if (crop.parentElement !== cropSlot) cropSlot.append(crop);
    workspace.dataset.step = String(currentStep); title.textContent = steps[currentStep - 1]; workspace.querySelector('.ce-step-count').textContent = `${currentStep} / 4`;
    for (const panel of panels) panel.hidden = Number(panel.dataset.stepPanel) !== currentStep;
    for (const tile of navigation.children) { if (Number(tile.dataset.id) === currentStep) tile.setAttribute('aria-current', 'step'); else tile.removeAttribute('aria-current'); }
    grid.querySelector('.ce-preview').hidden = currentStep === 1;
    previous.hidden = currentStep === 1; nextButton.hidden = currentStep === 4;
    fullPreview.hidden = currentStep !== 4; publish.hidden = currentStep !== 4;
    statusLine.prepend(noticeView); syncBackground(); setMenu(false);
    if (focus) {
      title.focus({ preventScroll: true });
      if (container.closest('dialog')) container.scrollTop = 0;
      else title.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    grid.scrollTop = 0;
    // 폰에서는 .ce-workspace가 스크롤 칸이고 제목은 고정 머리 안이라 scrollIntoView가 위치를 되돌리지 못하고 1px쯤 밀기도 한다. 마지막에 맨 위로 맞춘다.
    workspace.scrollTop = 0;
    syncChoices();
    if (entering && !historyEntry && window.history?.pushState) { window.history.pushState({ collectibleWorkspace: true }, ''); historyEntry = true; }
  }
  function showHome(focus = true, { fromHistory = false } = {}) {
    if (historyEntry) { historyEntry = false; if (!fromHistory && window.history?.back) { pendingBack = true; window.history.back(); } }
    restoreBackground();
    workspace.hidden = true; home.hidden = false; resume.hidden = !hasCurrent; home.prepend(noticeView); setMenu(false);
    if (focus) {
      const heading = home.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true });
      if (container.closest('dialog')) container.scrollTop = 0;
      else heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
  function renderProjects(projects, selectedId = '') {
    gallery.replaceChildren();
    if (!projects.length) { const empty = node('div', 'ce-empty-projects'); empty.append(shapeIcon('stamp'), node('strong', '', '첫 수집품을 만들어 보세요'), node('p', '', '초안을 저장하면 여기에 나타나요.')); gallery.append(empty); return; }
    for (const item of projects) {
      const tile = action('', 'open-project', item.id, 'ce-project-card'); tile.setAttribute('aria-pressed', String(selectedId === item.id));
      const art = node('span', 'ce-project-card-art'); art.append(shapeIcon(item.shape || item.project?.shape || 'stamp'), node('span', 'ce-project-status', item.status === 'PUBLISHED' ? '게시됨' : '초안'));
      tile.append(art, node('strong', '', item.name || item.project?.name || '수집품'), node('span', 'ce-project-version', `저장 버전 ${item.version}`));
      if (item.distributionLabel) tile.append(node('span', 'ce-project-distribution', item.distributionLabel));
      gallery.append(tile);
    }
  }
  function setBusy(value) {
    for (const tile of container.querySelectorAll('[data-action="home"],[data-action="step"],[data-action="resume"],[data-action="open-project"],[data-action="previous-step"],[data-action="next-step"],[data-action="season"],[data-action="theme"],[data-action="prepared-photo"],[data-action="latest-photo"],[data-action="ai-start"],[data-action="ai-create"],[data-action="ai-use"]')) tile.disabled = value;
  }
  return {
    showStep, showHome, renderProjects, setBusy, dispose: restoreBackground,
    showAi(message, drafts = []) {
      const entering = aiPanel.hidden;
      hero.hidden = true; latestPhoto.hidden = true; homeOptions.hidden = true; resume.hidden = true;
      aiPanel.hidden = false; aiStatus.textContent = message; aiDrafts.replaceChildren();
      for (const draft of drafts) {
        const tile = action('', 'ai-use', String(draft.index), 'ce-ai-draft');
        const image = node('img'); image.src = draft.imageDataUrl; image.alt = `${draft.label} AI 초안`;
        tile.append(image, node('strong', '', draft.label), node('span', '', '이 그림으로 스튜디오 가기 →')); aiDrafts.append(tile);
      }
      if (entering) { const heading = aiPanel.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); if (container.closest('dialog')) container.scrollTop = 0; }
    },
    hideAi() { aiPanel.hidden = true; aiDrafts.replaceChildren(); hero.hidden = false; latestPhoto.hidden = false; homeOptions.hidden = false; resume.hidden = !hasCurrent; },
    setHistoryEntry(value) { historyEntry = value; },
    // 홈 버튼의 늦은 기록 이동은 재진입한 작업 영역을 닫지 않는다.
    consumePendingBack() { const pending = pendingBack; pendingBack = false; return pending; },
    get step() { return currentStep; },
    get isHome() { return !home.hidden; },
    get newTheme() { return homeTheme === 'custom' ? custom.value.trim() || '기본' : homeTheme; },
    selectHomeTheme(value) {
      homeTheme = value; customField.hidden = value !== 'custom';
      for (const tile of homeThemes.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === value));
      if (value === 'custom') custom.focus();
    },
    sync(project, { dirty, wrapper } = {}) {
      syncFilter(project);
      resumeText.textContent = `${project.name} · ${dirty ? '저장하지 않은 편집을 이어서 할 수 있어요' : wrapper ? `저장 버전 ${wrapper.version}` : '현재 초안을 이어서 만들 수 있어요'}`;
      for (const tile of workspace.querySelectorAll('[data-action="theme"]')) tile.setAttribute('aria-pressed', String(tile.dataset.id === project.theme.name || tile.dataset.id === 'custom' && !seasons.some(([value]) => value === project.theme.name)));
      syncChoices();
    },
  };
}
