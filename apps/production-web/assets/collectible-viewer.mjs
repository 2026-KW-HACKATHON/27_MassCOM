import { renderPublishedCollectible, renderStory, clearCollectibleRenderCache } from './collectible-renderer.mjs';
import { ONCE_MS } from './collectible-model.mjs';

const sessions = new WeakMap();
const imagePattern = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const isCollectibleArtwork = value => value && typeof value === 'object'
  && typeof value.publicationId === 'string' && typeof value.gradeId === 'string'
  && typeof value.name === 'string' && typeof value.gradeName === 'string'
  && typeof value.thumbnailDataUrl === 'string' && value.thumbnailDataUrl.length < 400000
  && imagePattern.test(value.thumbnailDataUrl);

export function clearCollectibleViewers(doc) {
  const session = sessions.get(doc);
  session?.close?.();
  sessions.delete(doc);
  clearCollectibleRenderCache();
}

function element(doc, tag, text, className) {
  const result = doc.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function appendCollectibleArtwork(doc, card, item, fetcher) {
  if (!isCollectibleArtwork(item.artwork)) return;
  const art = item.artwork;
  const image = element(doc, 'img', undefined, 'collectible-thumb');
  image.src = art.thumbnailDataUrl;
  image.alt = `${art.name} · ${art.gradeName}`;
  image.width = 192;
  image.height = 192;
  const open = element(doc, 'button', '수집품과 가게 이야기 보기', 'collection-action');
  open.type = 'button';
  open.addEventListener('click', () => void openCollectible(doc, item, fetcher, open));
  card.append(image, element(doc, 'p', `${art.name} · ${art.gradeName}${art.theme?.name ? ` · ${art.theme.name}` : ''}`), open);
}

export async function openCollectible(doc, item, fetcher, opener) {
  clearCollectibleViewers(doc);
  const dialog = element(doc, 'dialog', undefined, 'collectible-dialog');
  dialog.setAttribute('aria-label', '받은 가게 수집품');
  const heading = element(doc, 'h2', item.artwork.name);
  const status = element(doc, 'p', '수집품을 불러오는 중이에요.');
  status.setAttribute('role', 'status');
  const close = element(doc, 'button', '도감으로 돌아가기', 'collection-action');
  close.type = 'button';
  dialog.append(heading, status, close);
  doc.body.append(dialog);
  let active = true;
  let frame = 0;
  let audio;
  const controller = new AbortController();
  let onVisibility = () => {};
  const shutdown = () => {
    if (!active) return;
    active = false;
    controller.abort();
    doc.defaultView.cancelAnimationFrame(frame);
    audio?.pause();
    if (audio) { audio.removeAttribute('src'); audio.load(); }
    doc.removeEventListener('visibilitychange', onVisibility);
    dialog.close();
    dialog.remove();
    opener?.focus();
  };
  sessions.set(doc, { close: shutdown });
  close.addEventListener('click', shutdown);
  dialog.addEventListener('cancel', event => { event.preventDefault(); shutdown(); });
  dialog.showModal();
  close.focus();
  try {
    const response = await fetcher(`/api/web/collectibles/${encodeURIComponent(item.entitlementId)}`, {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new Error('detail unavailable');
    const value = await response.json();
    if (!active) return;
    const snapshot = value.collectible ?? value;
    if (snapshot.publicationId !== item.artwork.publicationId || !imagePattern.test(snapshot.imageDataUrl ?? '')) throw new Error('invalid detail');
    heading.textContent = `${snapshot.name} · ${snapshot.gradeName}`;
    status.textContent = `${item.merchantName}${snapshot.theme?.name ? ` · ${snapshot.theme.name}` : ''} · 획득한 게시 버전`;
    const canvas = element(doc, 'canvas', undefined, 'collectible-stage');
    canvas.width = canvas.height = 640;
    canvas.setAttribute('aria-label', `${snapshot.shape === 'stamp' ? '우표' : snapshot.shape === 'serrated' ? '뾰족한 톱니 수집품' : '원형 코인'} 미리보기`);
    const fallback = element(doc, 'img', undefined, 'collectible-thumb');
    fallback.src = snapshot.imageDataUrl;
    fallback.alt = snapshot.name;
    fallback.hidden = true;
    const controls = element(doc, 'div', undefined, 'collectible-controls');
    const play = element(doc, 'button', '동작 재생', 'collection-action');
    play.type = 'button';
    const reducedLabel = element(doc, 'label', undefined, 'collectible-preference');
    const reduce = element(doc, 'input');
    reduce.type = 'checkbox';
    reduce.checked = doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reducedLabel.append(reduce, element(doc, 'span', '움직임 줄이기'));
    const rotationLabel = element(doc, 'label', '회전 각도');
    const rotation = element(doc, 'input');
    rotation.type = 'range'; rotation.min = '0'; rotation.max = '360'; rotation.value = '0';
    rotation.setAttribute('aria-label', '수집품 회전 각도');
    const angleValue = element(doc, 'output', '0°');
    rotationLabel.append(rotation, angleValue);
    const greeting = element(doc, 'p', snapshot.greeting ?? '', 'collectible-greeting');
    dialog.insertBefore(canvas, close);
    dialog.insertBefore(fallback, close);
    controls.append(play, reducedLabel, rotationLabel);
    dialog.insertBefore(controls, close);
    dialog.insertBefore(greeting, close);
    let playing = false;
    // once 재생 "다시 보기" 중일 때만 채운다: {type, particle}. loop 모션(playing)과 동시에 켜지지 않는다.
    let onceMotion = null;
    // onceMotion이 끝나면 여기서 다음 once 모션을 꺼내 이어 재생한다(Android처럼 once 모션을 전부 순서대로 보여준 뒤 멈춘다).
    let onceQueue = [];
    let angle = Number(snapshot.angle) || 0;
    rotation.value = String((angle + 360) % 360);
    angleValue.textContent = `${rotation.value}°`;
    let rendering = false;
    let dirty = false;
    let started = 0;
    let storyStarted;
    const draw = async () => {
      if (!active) return;
      if (rendering) { dirty = true; return; }
      rendering = true;
      const now = doc.defaultView.performance.now();
      try {
        if (storyStarted !== undefined) {
          await renderStory(canvas, { ...snapshot, photo: { originalDataUrl: snapshot.imageDataUrl }, story: snapshot.story }, { time: now - storyStarted, reducedMotion: reduce.checked });
          if (now - storyStarted >= 6000 || reduce.checked) { storyStarted = undefined; dirty = true; }
        } else if (onceMotion) {
          const duration = ONCE_MS[onceMotion.type] ?? 2000;
          await renderPublishedCollectible(canvas, { ...snapshot, animation: onceMotion.type }, { angle, time: now - started, playback: 'once', particle: onceMotion.particle, staticFrame: reduce.checked });
          if (now - started > duration + 50 || reduce.checked) {
            onceMotion = reduce.checked ? null : (onceQueue.shift() || null);
            started = now; dirty = true;
          }
        } else {
          // loop 모션의 particle(snow/petals/sparkles)을 넘기지 않으면 drawVolume이 기본값 confetti로 그린다.
          const loopParticle = playing ? (snapshot.motions || []).find(item => item.playback === 'loop' && item.type === snapshot.animation)?.particle : undefined;
          await renderPublishedCollectible(canvas, playing ? { ...snapshot, animation: snapshot.animation === 'still' ? 'rotate' : snapshot.animation } : snapshot, { angle, time: now - started, particle: loopParticle, staticFrame: !playing || reduce.checked });
        }
      } catch {
        fallback.hidden = false; canvas.hidden = true;
        status.textContent = '입체 미리보기를 준비하지 못했어요. 저장된 수집품 사진은 볼 수 있어요.';
        playing = false; onceMotion = null; onceQueue = [];
      } finally {
        rendering = false;
        if (active && dirty) { dirty = false; void draw(); }
      }
    };
    const loop = now => {
      if (!active || doc.hidden || reduce.checked || (!playing && !onceMotion && storyStarted === undefined)) return;
      void draw();
      frame = doc.defaultView.requestAnimationFrame(loop);
    };
    const pause = () => { playing = false; onceMotion = null; onceQueue = []; doc.defaultView.cancelAnimationFrame(frame); play.textContent = '동작 재생'; };
    play.addEventListener('click', () => {
      if (playing) pause();
      else if (!reduce.checked) { playing = true; onceMotion = null; onceQueue = []; storyStarted = undefined; started = doc.defaultView.performance.now(); play.textContent = '동작 정지'; loop(started); }
      else status.textContent = '움직임 줄이기를 끄면 동작을 재생할 수 있어요.';
    });
    rotation.addEventListener('input', () => { pause(); angleValue.textContent = `${rotation.value}°`; });
    rotation.addEventListener('change', () => { angle = Number(rotation.value); void draw(); });
    reduce.addEventListener('change', () => { if (reduce.checked) { pause(); storyStarted = undefined; } void draw(); });
    if (snapshot.audio?.dataUrl) {
      audio = element(doc, 'audio'); audio.controls = true; audio.preload = 'none'; audio.src = snapshot.audio.dataUrl;
      audio.setAttribute('aria-label', '사장님 인사말 듣기');
      dialog.insertBefore(audio, close);
      dialog.insertBefore(element(doc, 'p', '소리는 직접 재생할 때만 나와요. 재생·중단·음량을 조절할 수 있어요.'), close);
    }
    if (snapshot.story?.type && snapshot.story.type !== 'none') {
      const storyControls = element(doc, 'div', undefined, 'collectible-controls');
      const replay = element(doc, 'button', '가게 이야기 다시 보기', 'collection-action');
      const skip = element(doc, 'button', '이야기 건너뛰기', 'collection-action secondary');
      replay.type = skip.type = 'button';
      replay.addEventListener('click', () => { pause(); audio?.pause(); storyStarted = doc.defaultView.performance.now(); void draw(); loop(storyStarted); });
      skip.addEventListener('click', () => { storyStarted = undefined; doc.defaultView.cancelAnimationFrame(frame); void draw(); });
      storyControls.append(replay, skip);
      dialog.insertBefore(storyControls, close);
    }
    // once 재생 모션(예: 획득할 때만 보이는 반짝임)은 자동재생하지 않고, 원할 때 다시 볼 수 있게 버튼으로만 둔다.
    // 이 등급에 once 모션이 여러 개면(Android와 같은 once→loop 순서) 전부 순서대로 이어 보여준다.
    const onceSources = (snapshot.motions || []).filter(item => item.playback === 'once');
    if (onceSources.length) {
      const onceControls = element(doc, 'div', undefined, 'collectible-controls');
      const replayOnce = element(doc, 'button', '획득 장면 다시 보기', 'collection-action');
      replayOnce.type = 'button';
      replayOnce.addEventListener('click', () => {
        if (reduce.checked) { status.textContent = '움직임 줄이기를 끄면 획득 장면을 다시 볼 수 있어요.'; return; }
        pause(); audio?.pause(); storyStarted = undefined;
        const [first, ...rest] = onceSources;
        onceQueue = rest.map(item => ({ type: item.type, particle: item.particle }));
        onceMotion = { type: first.type, particle: first.particle };
        started = doc.defaultView.performance.now();
        void draw(); loop(started);
      });
      onceControls.append(replayOnce);
      dialog.insertBefore(onceControls, close);
    }
    onVisibility = () => { if (doc.hidden) { pause(); audio?.pause(); storyStarted = undefined; } };
    doc.addEventListener('visibilitychange', onVisibility);
    // loop 모션(반복 재생)이 있으면 손님이 따로 누르지 않아도 바로 보여 준다. 동작 줄이기면 정지 화면을 유지한다.
    if (snapshot.animation && snapshot.animation !== 'still' && !reduce.checked) { playing = true; started = doc.defaultView.performance.now(); play.textContent = '동작 정지'; }
    await draw();
    if (playing) frame = doc.defaultView.requestAnimationFrame(loop);
  } catch {
    if (active) status.textContent = '수집품을 불러오지 못했어요. 도감으로 돌아가 다시 열어 주세요. 받은 수집품은 그대로 보관돼요.';
  }
}
