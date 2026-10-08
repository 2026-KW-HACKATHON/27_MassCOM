import { renderPublishedCollectible, renderStory, clearCollectibleRenderCache } from './collectible-renderer.mjs';
import { ONCE_MS, rotationAngleAt } from './collectible-model.mjs';

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
  let stopTilt = () => {};
  let tiltToggleEl = null;
  const shutdown = () => {
    if (!active) return;
    active = false;
    controller.abort();
    doc.defaultView.cancelAnimationFrame(frame);
    audio?.pause();
    if (audio) { audio.removeAttribute('src'); audio.load(); }
    stopTilt();
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
    // living은 카드 전체 동작(회전·once/loop)과 독립된 시계로 돈다(PR #310 리뷰 P2): animation이 'still'이고
    // 카드 동작이 하나도 없어도(또는 재생을 멈춰도) living은 연 순간부터 계속 움직인다. 이 값은 pause()에서도
    // 리셋하지 않는다.
    const livingStarted = doc.defaultView.performance.now();
    let storyStarted;
    // PR #310 리뷰 2차 P2: 애니메이션 루프가 지금 돌고 있는지 하나의 깃발로 추적한다. 동작 줄이기를 끄거나
    // 숨겨진 탭이 다시 보일 때 새 루프를 거듭 걸면(겹친 rAF 체인) draw가 중복으로 돈다. 이 깃발로 "이미 돌고
    // 있으면 또 걸지 않는다"를 모든 시작 지점(재생, 다시 보기, 탭 복귀, 동작 줄이기 해제)에서 보장한다.
    let looping = false;
    let effectElapsed = 0, effectTick = doc.defaultView.performance.now();
    const advanceEffects = (now = doc.defaultView.performance.now()) => {
      if ((playing || onceMotion) && !reduce.checked && !doc.hidden) {
        const elapsed = Math.max(0, now - effectTick);
        effectElapsed += elapsed;
        angle = rotationAngleAt(angle, elapsed, snapshot.rotationSpeed) % 360;
        rotation.value = String((Math.round(angle) + 360) % 360); angleValue.textContent = `${rotation.value}°`;
      }
      effectTick = now;
    };
    const draw = async () => {
      if (!active) return;
      if (rendering) { dirty = true; return; }
      rendering = true;
      const now = doc.defaultView.performance.now();
      advanceEffects(now);
      const livingTime = now - livingStarted, reducedMotion = reduce.checked;
      try {
        if (storyStarted !== undefined) {
          await renderStory(canvas, { ...snapshot, photo: { originalDataUrl: snapshot.imageDataUrl }, story: snapshot.story }, { time: now - storyStarted, reducedMotion });
          if (now - storyStarted >= 6000 || reduce.checked) { storyStarted = undefined; dirty = true; }
        } else if (onceMotion) {
          const duration = ONCE_MS[onceMotion.type] ?? 2000;
          await renderPublishedCollectible(canvas, { ...snapshot, animation: onceMotion.type }, { angle, rotationTime: 0, time: now - started, effectTime: effectElapsed, livingTime, reducedMotion, playback: 'once', particle: onceMotion.particle, staticFrame: reduce.checked });
          if (now - started > duration + 50 || reduce.checked) {
            onceMotion = reduce.checked ? null : (onceQueue.shift() || null);
            started = now; dirty = true;
          }
        } else {
          // loop 모션의 particle(snow/petals/sparkles)을 넘기지 않으면 drawVolume이 기본값 confetti로 그린다.
          const loopParticle = playing ? (snapshot.motions || []).find(item => item.playback === 'loop' && item.type === snapshot.animation)?.particle : undefined;
          // living이 있으면 아무 모션도 안 걸린 등급(animation:'still')에 재생을 눌러도 뜬금없는 전체 회전으로
          // 대신하지 않는다 — living이 이미 움직임을 보여 준다.
          const fallbackAnimation = snapshot.animation === 'still' && !snapshot.living ? 'rotate' : snapshot.animation;
          await renderPublishedCollectible(canvas, playing ? { ...snapshot, animation: fallbackAnimation } : snapshot, { angle, rotationTime: 0, time: now - started, effectTime: effectElapsed, livingTime, reducedMotion, particle: loopParticle, staticFrame: !playing || reduce.checked });
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
      if (!active || doc.hidden || reduce.checked) { looping = false; return; }
      if (!playing && !onceMotion && storyStarted === undefined && !snapshot.living) { looping = false; return; }
      void draw();
      frame = doc.defaultView.requestAnimationFrame(loop);
    };
    // 이미 돌고 있으면 또 걸지 않는다(위 looping 깃발). living만 있어도(재생 중이 아니어도) 돌 수 있다.
    const ensureLoop = () => {
      if (looping || !active || doc.hidden || reduce.checked) return;
      if (!playing && !onceMotion && storyStarted === undefined && !snapshot.living) return;
      looping = true; frame = doc.defaultView.requestAnimationFrame(loop);
    };
    const pause = () => {
      advanceEffects();
      playing = false; onceMotion = null; onceQueue = []; doc.defaultView.cancelAnimationFrame(frame); looping = false; play.textContent = '동작 재생';
      // 카드 전체 동작만 멈춘다. living이 있으면(그리고 동작 줄이기가 아니면) 독립된 시계로 계속 돌아야 하므로
      // 다시 돌린다(loop 자체는 숨김·동작 줄이기면 스스로 멈춘다).
      ensureLoop();
    };
    play.addEventListener('click', () => {
      if (playing) pause();
      else if (!reduce.checked) { advanceEffects(); playing = true; onceMotion = null; onceQueue = []; storyStarted = undefined; started = doc.defaultView.performance.now(); play.textContent = '동작 정지'; void draw(); ensureLoop(); }
      else status.textContent = '움직임 줄이기를 끄면 동작을 재생할 수 있어요.';
    });
    rotation.addEventListener('input', () => {
      const selectedAngle = Number(rotation.value);
      pause(); angle = selectedAngle; rotation.value = String(selectedAngle);
      angleValue.textContent = `${selectedAngle}°`;
    });
    rotation.addEventListener('change', () => { angle = Number(rotation.value); void draw(); });
    reduce.addEventListener('change', () => {
      if (reduce.checked) {
        pause(); storyStarted = undefined;
        // PR #310 리뷰 P2: 기울임이 켜진 채로 동작 줄이기를 켜면 센서 리스너·회전이 그대로 남아 있었다. 끄고,
        // 다시 켜질 때까지 토글을 눌러도 반응하지 않게 막는다(토글 자체는 그대로 두되 눌러도 안 켜진다).
        stopTilt();
      }
      if (tiltToggleEl) tiltToggleEl.disabled = reduce.checked;
      void draw();
      // PR #310 리뷰 2차 P2: 동작 줄이기를 끄면 living(독립 시계) 재생이 저절로 다시 돌아야 한다. 이미 돌고
      // 있으면 ensureLoop가 그대로 넘긴다(중복 루프 없음).
      if (!reduce.checked) ensureLoop();
    });
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
      replay.addEventListener('click', () => { pause(); audio?.pause(); storyStarted = doc.defaultView.performance.now(); void draw(); ensureLoop(); });
      // looping을 안 내리면 이야기를 건너뛴 뒤 living이 있어도 다시 걸리지 않는다(이 틀의 looping 불변식).
      skip.addEventListener('click', () => { storyStarted = undefined; doc.defaultView.cancelAnimationFrame(frame); looping = false; void draw(); ensureLoop(); });
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
        void draw(); ensureLoop();
      });
      onceControls.append(replayOnce);
      dialog.insertBefore(onceControls, close);
    }
    // 웹 기울임(설계 문서 "웹 기울임" 항목): deviceorientation 감마, 켤 때 잡은 값을 0점으로 저역통과(.2)해 ±30°로
    // 쓴다. 미지원이거나 동작 줄이기면 토글을 보이지 않는다(토글을 연 뒤 동작 줄이기를 켜는 경우는 ponytail: 다음
    // draw에서 반영, 토글 자체는 그대로 둔다 — 드문 경로라 지금은 숨기지 않는다). iOS는 토글 클릭에서 바로
    // requestPermission()을 불러야 허용 창이 뜬다.
    const Orientation = doc.defaultView.DeviceOrientationEvent;
    if (Orientation && !reduce.checked) {
      let tiltActive = false, tiltOffset = 0, tiltSmoothed = angle;
      const onTilt = event => {
        if (typeof event.gamma !== 'number') return;
        const relative = Math.max(-30, Math.min(30, event.gamma - tiltOffset));
        tiltSmoothed += .2 * (relative - tiltSmoothed);
        angle = tiltSmoothed; rotation.value = String((Math.round(angle) + 360) % 360); angleValue.textContent = `${rotation.value}°`;
        void draw();
      };
      const firstSample = event => {
        doc.defaultView.removeEventListener('deviceorientation', firstSample);
        if (typeof event.gamma === 'number') tiltOffset = event.gamma;
        doc.defaultView.addEventListener('deviceorientation', onTilt);
      };
      stopTilt = () => {
        if (!tiltActive) return;
        tiltActive = false;
        doc.defaultView.removeEventListener('deviceorientation', firstSample);
        doc.defaultView.removeEventListener('deviceorientation', onTilt);
        tiltToggle.setAttribute('aria-pressed', 'false'); tiltToggle.textContent = '기울여서 보기';
      };
      const tiltControls = element(doc, 'div', undefined, 'collectible-controls');
      const tiltToggle = element(doc, 'button', '기울여서 보기', 'collection-action');
      tiltToggle.type = 'button'; tiltToggle.setAttribute('aria-pressed', 'false');
      tiltToggleEl = tiltToggle;
      tiltToggle.addEventListener('click', () => {
        if (reduce.checked) return; // 동작 줄이기 중에는 토글을 눌러도 켜지지 않는다(disabled로도 막지만 방어적으로 한 번 더).
        if (tiltActive) { stopTilt(); return; }
        const begin = () => { pause(); tiltActive = true; tiltOffset = 0; tiltSmoothed = angle; tiltToggle.setAttribute('aria-pressed', 'true'); tiltToggle.textContent = '기울임 끄기'; doc.defaultView.addEventListener('deviceorientation', firstSample); };
        if (typeof Orientation.requestPermission === 'function') {
          Orientation.requestPermission().then(state => {
            // PR #310 리뷰 P2: iOS 권한 창이 열려 있는 동안 뷰어가 닫히거나(active=false) 숨겨지거나 그 사이
            // 동작 줄이기가 켜지면, 허용이 뒤늦게 와도 죽은 세션에 리스너를 다시 달지 않는다.
            if (!active || doc.hidden || reduce.checked) return;
            if (state === 'granted') begin(); else status.textContent = '기울임 권한이 없어 수동 회전만 쓸 수 있어요.';
          }).catch(() => {});
        } else begin();
      });
      tiltControls.append(tiltToggle); dialog.insertBefore(tiltControls, close);
    }
    // PR #310 리뷰 2차 P2: 숨겨졌던 탭이 다시 보이면 living(독립 시계) 재생을 다시 건다(동작 줄이기가 아닐 때만).
    onVisibility = () => { if (doc.hidden) { pause(); audio?.pause(); storyStarted = undefined; stopTilt(); } else ensureLoop(); };
    doc.addEventListener('visibilitychange', onVisibility);
    // loop 모션(반복 재생)이 있으면 손님이 따로 누르지 않아도 바로 보여 준다. 동작 줄이기면 정지 화면을 유지한다.
    if (snapshot.animation && snapshot.animation !== 'still' && !reduce.checked) { playing = true; started = doc.defaultView.performance.now(); play.textContent = '동작 정지'; }
    await draw();
    ensureLoop();
  } catch {
    if (active) status.textContent = '수집품을 불러오지 못했어요. 도감으로 돌아가 다시 열어 주세요. 받은 수집품은 그대로 보관돼요.';
  }
}
