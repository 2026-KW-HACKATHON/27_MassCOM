import { THICKNESS_PRESETS, thicknessPresetLabel } from './collectible-model.mjs';
import { collectibleMetalColors } from './collectible-renderer.mjs';
const steps = ['사진 배치', '사진 편집', '코인 만들기', '결과·방문 보상'];
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
const toolIcon = (button, path, label) => {
  button.setAttribute('aria-label', label); button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span>`;
  return button;
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
  const heroText = node('div', 'ce-hero-copy'); heroText.append(node('span', 'ce-eyebrow', '사진으로 만드는 방문 보상'), node('h3', '', '들를 때마다,\n하나씩 모으는 즐거움'), node('p', '', '가게 사진이나 준비한 그림으로\n우리 가게의 코인을 만들어 보세요.'));
  const create = node('div', 'ce-entry-options');
  const aiEntry = action('', 'ai-start', undefined, 'ce-create-card');
  aiEntry.append(node('strong', '', 'AI로 초안 생성 후 스튜디오 하기'), node('span', '', '가게 이름으로 그림을 만들고 골라요 →'));
  const photoEntry = action('', 'prepared-photo', undefined, 'ce-create-card');
  photoEntry.append(node('strong', '', '미리 준비한 이미지 넣어서 스튜디오 가기'), node('span', '', '사진·그림을 직접 골라 바로 편집해요 →'));
  create.append(aiEntry, photoEntry);
  const mascot = node('img', 'ce-hero-mascot'); mascot.src = '/assets/mascot-stamp.png'; mascot.alt = ''; mascot.width = 140; mascot.height = 140;
  hero.append(heroText, mascot, create); home.append(hero);
  const aiPanel = section('AI 초안 고르기', '가게 이름으로 시작해요. 메뉴 등록은 필요 없어요. 사진과 음성은 AI에 보내지 않아요.');
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
    const options = [['store', merchantName || '우리 가게', merchantArtUrl ? '가게 그림' : '사진 추가', '1회 브론즈 · 3회 실버 · 5회 골드']];
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
    starters.append(choices); homeOptions.append(disclosure('가게 그림으로 시작하기', starters));
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
  // 사진 배치·사진 편집·선택적인 living 영역 칠하기는 같은 캔버스를 옮겨 쓴다.
  const cropSlots = [node('div', 'ce-crop-slot'), node('div', 'ce-crop-slot'), node('div', 'ce-crop-slot')]; cropSlots[0].append(crop);
  const photoStage = node('div', 'ce-photo-stage');
  photoStage.append(node('p', 'ce-photo-instruction', '사진을 움직여 원하는 모양에 맞춰 주세요.'), cropSlots[0], zoomRow, disclosure('더 보기 · 위치 미세 조정', cropMoves, cropActions));
  shape.hidden = true;
  const shapes = section('모양'); shapes.append(shape, choices('shape', [['circle', '원형'], ['stamp', '우표'], ['serrated', '톱니']], '모양', 'shape'));
  const identity = section('코인 이름', '먼저 이름을 정하고 사진을 배치해 주세요.');
  identity.append(field('name'));
  panels[0].append(identity);
  panels[0].append(photo);
  if (merchantArtUrl) panels[0].append(action('가게 그림으로 시작', 'art-photo', undefined, 'ce-text-button'));
  panels[0].append(shapes, photoStage, disclosure('사진 규격·보관 안내', photoHelp));
  const style = field('style'); style.hidden = true;
  const styles = section('표현 스타일', '원본·흑백·음각·양각을 고르고 움직임을 더해 보세요.');
  styles.append(style, choices('style', [['original', '원본'], ['monochrome', '흑백'], ['incised', '음각'], ['raised', '양각']], '표현 스타일', 'style'), field('relief'), view('fixed-back'));
  panels[2].append(styles);
  const thickness = field('thickness'), thicknessReset = container.querySelector('[data-action="thickness-reset"]'), thicknessHelp = thicknessReset.nextElementSibling;
  const thicknessCustom = node('p', 'ce-thickness-custom'); thicknessCustom.hidden = true;
  const volume = section('수집품 두께', '화면에 보이는 측면 깊이예요. 실물 제작 치수가 아니에요.');
  volume.append(choices('thickness', THICKNESS_PRESETS.map(([value, label]) => [String(value), label]), '두께', 'thickness'), thicknessCustom, thickness, thicknessReset, thicknessHelp);
  panels[2].append(volume);
  const gradesDetail = view('grade-manager').closest('details'), gradeContent = gradesDetail.querySelector('.ce-detail');
  const gradeManager = view('grade-manager'), gradeNew = field('grade-name').parentElement, gradeAdd = container.querySelector('[data-action="grade-add"]');
  panels[2].append(disclosure('더 보기 · 등급 관리', gradeManager, gradeNew, gradeAdd));
  const background = section('코인 배경색', '사진 아래의 바탕색이에요. 음각·양각 금속색은 선택한 등급을 따라가요.');
  const backgroundPicker = field('base-color');
  const backgroundInputs = node('div', 'ce-background-inputs');
  for (const [name, label] of [['hex', 'HEX'], ['r', 'R'], ['g', 'G'], ['b', 'B']]) {
    const inputField = node('label', 'ce-field', label), input = node('input');
    input.dataset.control = `background-${name}`; input.type = name === 'hex' ? 'text' : 'number';
    if (name === 'hex') { input.maxLength = 7; input.placeholder = '#163D32'; input.setAttribute('aria-label', '배경 HEX 색상'); }
    else { input.min = '0'; input.max = '255'; input.step = '1'; input.setAttribute('aria-label', `배경 ${label} 값`); }
    inputField.append(input); backgroundInputs.append(inputField);
  }
  const swatches = node('div', 'ce-background-swatches'); swatches.setAttribute('role', 'group'); swatches.setAttribute('aria-label', '배경색 추천');
  for (const [color, label] of [['#163d32', '포레스트'], ['#123452', '네이비'], ['#f4eee3', '크림'], ['#292933', '차콜'], ['#783f52', '버건디'], ['#bf8149', '브론즈']]) {
    const swatch = action('', 'background-color', color, 'ce-color-swatch'); swatch.title = label; swatch.setAttribute('aria-label', `${label} 배경색`); swatch.setAttribute('aria-pressed', 'false'); swatches.append(swatch);
  }
  background.append(backgroundPicker, swatches, backgroundInputs, disclosure('사진 색 반영', field('photo-color'))); panels[2].insertBefore(background, volume);
  const motionDetail = view('templates').closest('details');
  const photoDetail = control('brush').closest('details'), stickerDetail = control('sticker-kind').closest('details');
  photoDetail.open = true; stickerDetail.open = true; photoDetail.classList.add('ce-more');
  photoDetail.querySelector('summary').textContent = '밝기·대비·패럴랙스';
  const brush = field('brush'); brush.hidden = true;
  const tools = node('div', 'ce-step-tools');
  // undo·redo는 1단계 "위치 미세 조정" 접힘(cropActions)이 이미 container 밖의 panels[0]으로 옮겨 가 container에서는 찾을 수 없다.
  const undo = toolIcon(cropActions.querySelector('[data-action="undo"]'), 'M9 5 3 11l6 6 M3 11h11a6 6 0 0 1 0 12', '실행 취소'); undo.title = '실행 취소 · Ctrl/Cmd+Z';
  const redo = toolIcon(cropActions.querySelector('[data-action="redo"]'), 'm15 5 6 6-6 6 M21 11H10a6 6 0 0 0 0 12', '다시 실행'); redo.title = '다시 실행 · Ctrl/Cmd+Shift+Z';
  const compare = toolIcon(container.querySelector('[data-action="compare"]'), 'M12 3v18 M4 5h16v14H4z', '원본 비교');
  tools.append(undo, redo, compare);
  const photoEditor = node('div', 'ce-photo-editor'); photoEditor.append(tools, cropSlots[1]);
  const brushChoices = choices('brush', [['move', '이동'], ['clean', '잡티 제거'], ['erase', '지우개'], ['restore', '복원'], ['color', '칠하기']], '사진 도구', 'brush');
  const brushIcons = { move: 'M12 3v18 M3 12h18 m-12-6 3-3 3 3 m-6 12 3 3 3-3 M6 9l-3 3 3 3 m12-6 3 3-3 3', clean: 'm4 20 12-12 4 4-12 12 M15 3v4 m-2-2h4 M5 3v6 M2 6h6', erase: 'm4 14 9-9a2 2 0 0 1 3 0l5 5-10 10H9z M8 10l7 7 M11 20h11', restore: 'M5 8v-5 M5 8h5 M5 8a8 8 0 1 1-1 8', color: 'm14 3 7 7 M3 21l3-7L17 3l4 4L10 18z M4 20l5-1' };
  for (const tile of brushChoices.children) { toolIcon(tile, brushIcons[tile.dataset.id], tile.textContent); tile.dataset.editPanel = 'brush'; }
  const editorTabs = node('div', 'ce-photo-toolbar'); editorTabs.setAttribute('role', 'group'); editorTabs.setAttribute('aria-label', '사진 편집 도구');
  editorTabs.append(...brushChoices.children);
  for (const [name, label, path] of [['filter', '필터', 'M4 5h16 M8 12h8 M10 19h4'], ['adjust', '보정', 'M4 7h16 M4 17h16 M8 3v8 M16 13v8'], ['sticker', '텍스트·스티커', 'M4 5h16 M12 5v15 M8 20h8']]) {
    const tile = toolIcon(node('button', 'ce-choice'), path, label); tile.type = 'button'; tile.dataset.editPanel = name; tile.setAttribute('aria-pressed', 'false'); editorTabs.append(tile);
  }
  const brushPanel = section('사진 도구');
  const brushSize = field('brush-size'), brushColor = field('brush-color'), brushHardness = field('brush-hardness');
  brushPanel.append(brush, node('p', 'ce-help', '도구를 고른 뒤 사진 위를 드래그하세요. 경도가 낮으면 붓 끝이 부드러워져요.'), brushSize, brushHardness, brushColor);
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
  const editOptions = new Map([['brush', brushPanel], ['filter', filterPanel], ['adjust', photoDetail], ['sticker', stickerDetail]]);
  for (const [name, panel] of editOptions) panel.dataset.editOptions = name;
  let editPanel = 'brush';
  const syncEditTools = () => {
    for (const [name, panel] of editOptions) panel.hidden = name !== editPanel;
    for (const tile of editorTabs.children) tile.setAttribute('aria-pressed', String(tile.dataset.editPanel === editPanel && (editPanel !== 'brush' || tile.dataset.id === control('brush').value)));
    brushSize.hidden = control('brush').value === 'move'; brushHardness.hidden = brushSize.hidden; brushColor.hidden = control('brush').value !== 'color';
  };
  const selectEditPanel = name => { if (!editOptions.has(name)) return; editPanel = name; syncEditTools(); };
  editorTabs.addEventListener('click', event => { const tile = event.target.closest('[data-edit-panel]'); if (tile) { if (tile.dataset.editPanel === 'brush') control('brush').value = tile.dataset.id; selectEditPanel(tile.dataset.editPanel); } });
  const editorZoomRow = node('div', 'ce-editor-zoom'), editorZoomLabel = node('label', 'ce-field', '편집 화면 확대 '), editorZoomValue = node('output', '', '100%'), editorZoom = node('input');
  editorZoom.type = 'range'; editorZoom.min = '1'; editorZoom.max = '3'; editorZoom.step = '.5'; editorZoom.value = '1'; editorZoom.dataset.control = 'editor-zoom'; editorZoom.setAttribute('aria-label', '편집 화면 확대'); editorZoomLabel.append(editorZoomValue, editorZoom);
  const editorZoomReset = action('화면 맞춤', 'editor-zoom-reset');
  const syncEditorZoom = () => { photoEditor.style.setProperty('--ce-editor-zoom', editorZoom.value); editorZoomValue.textContent = `${Math.round(Number(editorZoom.value) * 100)}%`; };
  editorZoom.addEventListener('input', syncEditorZoom); editorZoomReset.addEventListener('click', () => { editorZoom.value = '1'; syncEditorZoom(); cropSlots[1].scrollTop = cropSlots[1].scrollLeft = 0; });
  editorZoomRow.append(editorZoomLabel, editorZoomReset);
  photoEditor.replaceChildren(tools, editorTabs, editorZoomRow, cropSlots[1], ...editOptions.values()); panels[1].append(photoEditor);
  const materials = section('재질 효과', '효과를 누르면 지금 보는 등급에 바로 적용돼요. 같은 효과를 다시 누르면 꺼져요.');
  const effectControls = field('effect-type').parentElement; field('effect-type').hidden = true; field('effect-target').hidden = true;
  const materialsChoices = choices('effect-type', Object.entries(effectNames).filter(([type]) => type !== 'flame'), '재질 효과', 'material');
  for (const tile of materialsChoices.children) tile.dataset.action = 'material-toggle';
  const targets = node('div', 'ce-target-chips'); targets.dataset.view = 'effect-target-chips'; targets.setAttribute('role', 'group'); targets.setAttribute('aria-label', '새 효과의 적용 대상');
  materials.append(materialsChoices, node('h4', '', '효과 대상'), targets, effectControls, container.querySelector('[data-action="effect-add"]'), view('effects'));
  const aura = section('오라', '코인 바깥에서 이글이글 올라오는 불꽃이에요. 색·강도·속도를 정하고 재생해 보세요.');
  const auraToggle = action('불꽃 오라', 'aura-toggle'); auraToggle.setAttribute('aria-pressed', 'false');
  const auras = node('div'); auras.dataset.view = 'auras'; aura.append(auraToggle, auras);
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
  rewards.querySelector('summary').textContent = '자동 방문 보상';
  const rewardsBody = rewards.querySelector('.ce-detail');
  identity.append(disclosure('시즌 설정', seasonTiles('theme'), field('theme'), container.querySelector('[data-action="copy"]')));
  const result = section('완성된 코인', '코인을 저장하거나 방문 보상으로 게시하세요.');
  const resultSummary = node('p', 'ce-result-summary'); resultSummary.dataset.view = 'result-summary'; result.append(resultSummary, action('코인 이미지 저장', 'export-image', undefined, 'ce-export-button'));
  const rotation = section('회전', '회전 속도와 시작 각도를 정하세요. 움직임은 옆 탭에서 따로 고를 수 있어요.');
  const rotationTemplates = node('div', 'ce-templates'), rotationGrades = node('div'), rotationSettings = node('div');
  rotationTemplates.dataset.view = 'rotation-templates'; rotationGrades.dataset.view = 'rotation-grades'; rotationSettings.dataset.view = 'rotation-settings';
  rotation.append(field('rotation-speed'), container.querySelector('[data-action="angle-reset"]'), rotationTemplates, rotationGrades, rotationSettings);
  const extras = section('애니메이션과 효과', '회전·움직임·재질 효과·오라를 고르고 바로 재생해 보세요.');
  extras.classList.add('ce-animation-panel');
  const extraTabs = node('div', 'ce-extra-tabs'); extraTabs.setAttribute('role', 'group'); extraTabs.setAttribute('aria-label', '추가 꾸미기');
  const extraOptions = new Map([['rotation', rotation], ['motion', motionDetail], ['materials', materials], ['aura', aura], ['voice', voice], ['living', livingDetail], ['story', story]]);
  for (const [name, label] of [['rotation', '회전'], ['motion', '움직임'], ['materials', '재질 효과'], ['aura', '오라'], ['voice', '목소리'], ['living', '살아 있는 그림'], ['story', '가게 이야기']]) {
    const tile = node('button', '', label); tile.type = 'button'; tile.dataset.extraPanel = name; tile.setAttribute('aria-pressed', 'false'); extraTabs.append(tile);
    const panel = extraOptions.get(name); panel.dataset.extraOptions = name; panel.hidden = true;
  }
  const selectExtraPanel = name => {
    for (const [key, panel] of extraOptions) { panel.hidden = key !== name; if (key === name && panel.tagName === 'DETAILS') panel.open = true; }
    for (const tile of extraTabs.children) tile.setAttribute('aria-pressed', String(tile.dataset.extraPanel === name));
  };
  extraTabs.addEventListener('click', event => { const tile = event.target.closest('[data-extra-panel]'); if (tile) selectExtraPanel(tile.dataset.extraPanel); });
  extras.append(extraTabs, ...extraOptions.values());
  selectExtraPanel('rotation');
  panels[2].insertBefore(extras, styles.nextElementSibling);
  panels[3].append(result, rewards);
  controls.replaceChildren(...panels);
  const preview = grid.querySelector('.ce-preview'), publishBox = grid.querySelector('.ce-publish');
  const previewActions = field('angle').nextElementSibling;
  const iconize = (button, icon) => { button.setAttribute('aria-label', button.textContent); button.textContent = icon; button.classList.add('ce-icon-button'); return button; };
  const play = iconize(previewActions.querySelector('[data-action="play"]'), '▶');
  const previewRow = node('div', 'ce-preview-row'); previewRow.append(play, field('angle'));
  const previewMore = disclosure('미리보기 옵션', previewActions.querySelector('[data-action="replay"]'), control('reduce-motion').closest('label'), view('preview-caption'), view('greeting'));
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
  let targetSignature = '', effectsProject = null, previewGrade = 'bronze';
  function syncChoices() {
    for (const tile of container.querySelectorAll('[data-action="choice"]')) tile.setAttribute('aria-pressed', String(control(tile.dataset.controlFor)?.value === tile.dataset.id));
    const targetControl = control('effect-target'), signature = [...targetControl.options].map(item => `${item.value}:${item.textContent}`).join('|');
    if (signature !== targetSignature) {
      targetSignature = signature; targets.replaceChildren();
      for (const item of targetControl.options) { const tile = action(item.textContent, 'choice', item.value, 'ce-target-chip'); tile.dataset.controlFor = 'effect-target'; targets.append(tile); }
    }
    for (const tile of targets.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === targetControl.value));
    for (const tile of materialsChoices.children) tile.setAttribute('aria-pressed', String(effectsProject?.effects.some(effect => effect.type === tile.dataset.id && effect.target === targetControl.value && effect.gradeIds.includes(previewGrade)) ?? false));
    auraToggle.setAttribute('aria-pressed', String(effectsProject?.effects.some(effect => effect.type === 'flame' && effect.gradeIds.includes(previewGrade)) ?? false));
    const thicknessValue = Number(control('thickness').value);
    thicknessCustom.hidden = thicknessPresetLabel(thicknessValue) !== null; thicknessCustom.textContent = `직접 지정 ${thicknessValue}`;
    syncEditTools();
  }
  function showStep(step, focus = true) {
    const entering = workspace.hidden;
    const next = Math.max(1, Math.min(4, Number(step) || 1));
    // 단계 이동마다 붓과 대상을 되돌려 사진 배치에서 지우거나 영역 점을 찍지 않게 한다.
    if (workspace.hidden || next !== currentStep) {
      control('brush').value = 'move';
      const brushTarget = control('brush-target');
      if (brushTarget.value !== 'photo') { brushTarget.value = 'photo'; brushTarget.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    currentStep = next; home.hidden = true; workspace.hidden = false; hasCurrent = true;
    const cropSlot = cropSlots[currentStep === 2 ? 1 : currentStep === 3 ? 2 : 0];
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
    showStep, showHome, renderProjects, setBusy, selectEditPanel, selectExtraPanel, dispose: restoreBackground,
    setPreviewGrade(id, name) {
      previewGrade = id; syncChoices();
      const tint = collectibleMetalColors(id, name)[1];
      workspace.dataset.previewGrade = ['bronze', 'silver', 'gold', 'prism'].find(grade => collectibleMetalColors(grade)[1] === tint) || 'bronze';
    },
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
      effectsProject = project;
      syncFilter(project);
      const color = project.baseColor.toLowerCase();
      for (const [name, value] of [['hex', color], ['r', parseInt(color.slice(1, 3), 16)], ['g', parseInt(color.slice(3, 5), 16)], ['b', parseInt(color.slice(5, 7), 16)]]) {
        const input = control(`background-${name}`); if (input.value !== String(value)) input.value = String(value);
      }
      control('base-color').value = color;
      for (const tile of swatches.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === color));
      resultSummary.textContent = `${project.name} · ${project.grades.filter(grade => grade.enabled).length}개 등급 · ${project.theme.name}`;
      resumeText.textContent = `${project.name} · ${dirty ? '저장하지 않은 편집을 이어서 할 수 있어요' : wrapper ? `저장 버전 ${wrapper.version}` : '현재 초안을 이어서 만들 수 있어요'}`;
      for (const tile of workspace.querySelectorAll('[data-action="theme"]')) tile.setAttribute('aria-pressed', String(tile.dataset.id === project.theme.name || tile.dataset.id === 'custom' && !seasons.some(([value]) => value === project.theme.name)));
      syncChoices();
    },
  };
}
