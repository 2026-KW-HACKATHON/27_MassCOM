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
export function createCollectibleStudio(container, { effectNames }) {
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
  const create = action('', 'new', undefined, 'ce-create-card'); create.append(node('span', 'ce-camera-icon', '＋'), node('strong', '', '새 수집품 만들기'), node('span', '', '사진으로 쉽게 시작해요 →'));
  const mascot = node('img', 'ce-hero-mascot'); mascot.src = '/assets/mascot-stamp.png'; mascot.alt = ''; mascot.width = 140; mascot.height = 140;
  hero.append(heroText, mascot, create); home.append(hero);
  const resume = node('div', 'ce-resume'); resume.hidden = true;
  const resumeText = node('p', 'ce-resume-text'); resume.append(resumeText, action('이어서 편집하기 →', 'resume', undefined, 'ce-resume-button')); home.append(resume);
  const saved = section('나의 제작물', '저장한 초안과 게시 버전을 다시 열어 이어서 만들 수 있어요.');
  const savedHeading = node('div', 'ce-section-heading'); savedHeading.append(saved.querySelector('h3'), action('목록 새로 보기', 'refresh', undefined, 'ce-text-button')); saved.prepend(savedHeading);
  const gallery = node('div', 'ce-project-gallery'); gallery.dataset.view = 'project-gallery'; saved.append(gallery); home.append(saved);
  const season = section('시즌 테마', '새로 만들 수집품의 테마를 골라 주세요. 등급과 보상 조건은 그대로예요.');
  const homeThemes = seasonTiles('season'); season.append(homeThemes);
  const customField = node('label', 'ce-field', '자유 입력 테마'); customField.hidden = true;
  const custom = node('input'); custom.type = 'text'; custom.maxLength = 80; custom.placeholder = '예: 우리 동네 생일 축제'; custom.dataset.control = 'home-theme'; customField.append(custom); season.append(customField); home.append(season);
  let homeTheme = '기본', currentStep = 1, hasCurrent = false;
  const workspace = node('div', 'ce-workspace'); workspace.hidden = true; workspace.dataset.view = 'workspace'; workspace.dataset.step = '1';
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
  const photoStage = node('div', 'ce-photo-stage'); photoStage.append(node('p', 'ce-photo-instruction', '사진을 움직여 원하는 모양에 맞춰 주세요.'), crop, cropZoom, cropMoves, cropActions);
  const cropSlots = [node('div', 'ce-crop-slot'), node('div', 'ce-crop-slot')]; cropSlots[0].append(photoStage);
  shape.hidden = true;
  const shapes = section('모양', '사진의 위치와 확대는 모양을 바꿔도 유지돼요.'); shapes.append(shape, choices('shape', [['circle', '원형'], ['stamp', '우표'], ['serrated', '톱니']], '모양', 'shape'));
  panels[0].append(field('name'), photo, photoHelp, shapes, cropSlots[0]);
  const style = field('style'); style.hidden = true;
  const styles = section('표현 스타일', '원본 색, 음각, 양각을 직접 비교해 보세요.'); styles.append(style, choices('style', [['original', '원본'], ['incised', '음각'], ['raised', '양각']], '표현 스타일', 'style')); panels[1].append(styles);
  const gradesDetail = view('grade-manager').closest('details'), gradeContent = gradesDetail.querySelector('.ce-detail');
  const gradePanel = section('내가 만드는 등급', '등급 이름과 사용 여부를 바꿀 수 있어요. 이름이 특정 재질을 강제하지 않아요.');
  const gradeManager = view('grade-manager'), gradeNew = field('grade-name').parentElement, gradeAdd = container.querySelector('[data-action="grade-add"]'); gradePanel.append(gradeManager, gradeNew, gradeAdd); panels[1].append(gradePanel);
  const motionDetail = view('templates').closest('details'), thickness = field('thickness'), thicknessReset = container.querySelector('[data-action="thickness-reset"]'), thicknessHelp = thicknessReset.nextElementSibling;
  const volume = section('수집품 두께', '화면에 보이는 측면 깊이예요. 실물 제작 치수가 아니에요.'); volume.append(thickness, thicknessReset, thicknessHelp); panels[1].append(volume);
  const photoDetail = control('brush').closest('details'), stickerDetail = control('sticker-kind').closest('details');
  photoDetail.open = true; stickerDetail.open = true;
  const brush = field('brush'); brush.hidden = true;
  const brushes = choices('brush', [['move', '사진 이동'], ['clean', '잡티'], ['erase', '투명'], ['restore', '복원'], ['color', '색 통일']], '붓 도구', 'brush');
  photoDetail.querySelector('.ce-detail').prepend(brushes);
  panels[2].append(action('다른 사진 선택', 'photo-choose', undefined, 'ce-photo-change'), cropSlots[1], photoDetail, stickerDetail);
  const materials = section('효과 스튜디오', '지금 보는 등급 한 개와 효과를 적용할 여러 등급은 따로 골라요.');
  const effectControls = field('effect-type').parentElement; field('effect-type').hidden = true; field('effect-target').hidden = true;
  const materialsChoices = choices('effect-type', Object.entries(effectNames), '재질 효과', 'material');
  const targets = node('div', 'ce-target-chips'); targets.dataset.view = 'effect-target-chips'; targets.setAttribute('role', 'group'); targets.setAttribute('aria-label', '새 효과의 적용 대상');
  materials.append(materialsChoices, node('h4', '', '효과 대상'), targets, effectControls, container.querySelector('[data-action="effect-add"]'), view('effects'));
  gradeContent.replaceChildren(); gradesDetail.remove();
  const voice = control('greeting').closest('details'), story = control('story-type').closest('details'), rewards = control('theme').closest('details');
  motionDetail.open = true; voice.open = true; rewards.open = true;
  rewards.querySelector('.ce-detail').prepend(seasonTiles('theme'));
  panels[3].append(motionDetail, materials, voice, story, rewards);
  controls.replaceChildren(...panels);
  const footer = node('div', 'ce-stage-footer'); footer.append(action('← 이전 단계', 'previous-step'), action('다음 단계 →', 'next-step', undefined, 'primary')); workspace.append(footer, grid.querySelector('.ce-publish'));
  let targetSignature = '';
  function syncChoices() {
    for (const tile of container.querySelectorAll('[data-action="choice"]')) tile.setAttribute('aria-pressed', String(control(tile.dataset.controlFor)?.value === tile.dataset.id));
    const targetControl = control('effect-target'), signature = [...targetControl.options].map(item => `${item.value}:${item.textContent}`).join('|');
    if (signature !== targetSignature) {
      targetSignature = signature; targets.replaceChildren();
      for (const item of targetControl.options) { const tile = action(item.textContent, 'choice', item.value, 'ce-target-chip'); tile.dataset.controlFor = 'effect-target'; targets.append(tile); }
    }
    for (const tile of targets.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === targetControl.value));
  }
  function showStep(step, focus = true) {
    currentStep = Math.max(1, Math.min(4, Number(step) || 1)); home.hidden = true; workspace.hidden = false; hasCurrent = true;
    workspace.dataset.step = String(currentStep); title.textContent = steps[currentStep - 1]; workspace.querySelector('.ce-step-count').textContent = `${currentStep} / 4`;
    for (const panel of panels) panel.hidden = Number(panel.dataset.stepPanel) !== currentStep;
    for (const tile of navigation.children) { if (Number(tile.dataset.id) === currentStep) tile.setAttribute('aria-current', 'step'); else tile.removeAttribute('aria-current'); }
    cropSlots[currentStep === 3 ? 1 : 0].append(photoStage);
    grid.querySelector('.ce-preview').hidden = currentStep === 1;
    footer.querySelector('[data-action="previous-step"]').hidden = currentStep === 1;
    footer.querySelector('[data-action="next-step"]').hidden = currentStep === 4;
    if (focus) { title.focus({ preventScroll: true }); title.scrollIntoView({ block: 'start', behavior: 'instant' }); }
    syncChoices();
  }
  function showHome(focus = true) {
    workspace.hidden = true; home.hidden = false; resume.hidden = !hasCurrent;
    if (focus) { const heading = home.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  }
  function renderProjects(projects, selectedId = '') {
    gallery.replaceChildren();
    if (!projects.length) { const empty = node('div', 'ce-empty-projects'); empty.append(shapeIcon('stamp'), node('strong', '', '첫 수집품을 만들어 보세요'), node('p', '', '초안을 저장하면 여기에 나타나요.')); gallery.append(empty); return; }
    for (const item of projects) {
      const tile = action('', 'open-project', item.id, 'ce-project-card'); tile.setAttribute('aria-pressed', String(selectedId === item.id));
      const art = node('span', 'ce-project-card-art'); art.append(shapeIcon(item.shape || item.project?.shape || 'stamp'), node('span', 'ce-project-status', item.status === 'PUBLISHED' ? '게시됨' : '초안'));
      tile.append(art, node('strong', '', item.name || item.project?.name || '수집품'), node('span', 'ce-project-version', `저장 버전 ${item.version}`)); gallery.append(tile);
    }
  }
  function setBusy(value) {
    for (const tile of container.querySelectorAll('[data-action="home"],[data-action="step"],[data-action="resume"],[data-action="open-project"],[data-action="previous-step"],[data-action="next-step"],[data-action="season"],[data-action="theme"]')) tile.disabled = value;
  }
  return {
    showStep, showHome, renderProjects, setBusy,
    get step() { return currentStep; },
    get isHome() { return !home.hidden; },
    get newTheme() { return homeTheme === 'custom' ? custom.value.trim() || '기본' : homeTheme; },
    selectHomeTheme(value) {
      homeTheme = value; customField.hidden = value !== 'custom';
      for (const tile of homeThemes.children) tile.setAttribute('aria-pressed', String(tile.dataset.id === value));
      if (value === 'custom') custom.focus();
    },
    sync(project, { dirty, wrapper } = {}) {
      resumeText.textContent = `${project.name} · ${dirty ? '저장하지 않은 편집을 이어서 할 수 있어요' : wrapper ? `저장 버전 ${wrapper.version}` : '현재 초안을 이어서 만들 수 있어요'}`;
      for (const tile of workspace.querySelectorAll('[data-action="theme"]')) tile.setAttribute('aria-pressed', String(tile.dataset.id === project.theme.name || tile.dataset.id === 'custom' && !seasons.some(([value]) => value === project.theme.name)));
      syncChoices();
    },
  };
}
