# 점주 수집품 제작기 폰 개편 구현 계획 (Issue #329)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 있는 4단계 제작기를 폰 브라우저에서 시안처럼 한 단계씩 쓸 수 있게 화면 배치만 바꾼다.

**Architecture:** 편집기(`collectible-editor.mjs`)가 만든 컨트롤 노드를 스튜디오(`collectible-studio.mjs`)가 단계 패널로 옮겨 담는 지금 구조를 그대로 쓴다. 바꾸는 곳은 주로 스튜디오의 노드 배치와 CSS이고, 편집기에는 작은 동작(확대 −/+, 파형 연결, 뒤로가기)만 더한다. 데이터 모델·저장 형식·API·렌더러·12프레임 계약은 손대지 않는다.

**Tech Stack:** 프레임워크 없는 ES 모듈 + DOM, CSS, Node `node:test` + `tests/fixtures/mini-dom.mjs`(가짜 DOM), Web Audio `OfflineAudioContext`(파형 디코딩).

**Spec:** `docs/superpowers/specs/2026-10-03-creator-wizard-mobile-design.md`

## Global Constraints

- 작업 위치: worktree `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/329-creator-wizard`, 브랜치 `feat/329-creator-wizard-mobile`.
- 데이터 모델·저장 형식·서버 API·렌더러·회전 12프레임 4×3 계약은 바꾸지 않는다.
- 새 npm 의존성 금지. 고객 Android 앱(`apps/mobile`) 변경 금지.
- 컨트롤은 지우지 않고 옮긴다. 기존 `data-control`·`data-action`·`data-view`·`data-edit`·`data-sticker` 값은 그대로 둔다.
- 같은 `data-action`을 가진 버튼을 새로 복제하지 않는다. 예외는 하나뿐이다: 4단계 하단 바의 "전체 미리보기"는 `data-action="replay"`를 쓴다(미리보기 옵션의 "다시 보기"와 같은 동작).
- mini-dom이 지원하는 DOM API만 쓴다: `append`·`prepend`·`insertBefore`·`replaceChildren`·`remove`·`closest`·`querySelector(All)`·`nextElementSibling`·`classList`·`dataset`·`setAttribute`·`addEventListener`. `before()`/`after()`/`contains()` 새 사용 금지.
- `window.history`는 mini-dom에 없다. 쓰기 전에 항상 `window.history?.pushState` 존재를 확인한다.
- 모든 버튼 높이 44px 이상(기존 규칙). 사용자에게 보이는 문구는 한국어.
- 커밋은 한국어 의도 중심 제목 + Lore trailer(`Constraint:`·`Confidence:`·`Scope-risk:`·`Tested:`·`Not-tested:`). `Co-Authored-By`·생성 도구 서명 금지.
- 각 작업 끝 회귀 명령: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs` (worktree 루트에서).

## Review Focus

- 기존 초안의 두께가 4·8·14가 아닐 때(예: 11) 값이 바뀌지 않고 "직접 지정 11"로 보여야 한다 → Task 2 시험.
- 저장된 초안의 음성이 MP3가 아닌 녹음(webm/ogg)이거나 디코딩이 실패해도 재생은 그대로, 파형만 숨어야 한다 → Task 1 시험.
- 작업 영역에서 폰 뒤로가기를 누르면 페이지를 떠나지 않고 스튜디오 홈으로 가야 하고, "← 스튜디오" 버튼으로 돌아간 뒤 뒤로가기는 두 번 소비되지 않아야 한다 → Task 5 시험.
- 폰 편집 모드(고정 레이어)에서 저장·게시 알림이 가려지지 않아야 한다(알림 줄 이동) → Task 4 시험.
- 다른 초안을 열면 3단계 필터 선택이 그 초안 값 기준으로 다시 정해져야 한다(이전 초안 선택이 남지 않음) → Task 3 시험.

---

### Task 1: 녹음·MP3 파형

**Files:**
- Create: `apps/production-web/assets/collectible-waveform.mjs`
- Modify: `apps/production-web/assets/collectible-editor.mjs` (import, 템플릿 `<audio>` 뒤 캔버스, `attachWaveform` 연결, 음성이 바뀌는 네 곳에서 `refresh()`)
- Modify: `apps/production-web/server.mjs:21` (정적 자산 목록)
- Modify: `apps/production-web/assets/collectible-editor.css` (파형 캔버스 크기)
- Modify: `tests/site/collectible-viewer.test.mjs:50` (서빙 경로 목록)
- Test: `tests/site/collectible-waveform.test.mjs` (새 파일)

**Interfaces:**
- Produces: `peaks(samples: ArrayLike<number>, buckets: number): number[]`, `dataUrlBytes(dataUrl: string): ArrayBuffer | null`, `drawWaveform(canvas, values: number[], progress: number): void`, `attachWaveform(audio, canvas, { decode?, signal? }): { refresh(): Promise<void> }`

- [ ] **Step 1: 실패하는 시험 작성** — `tests/site/collectible-waveform.test.mjs`

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachWaveform, dataUrlBytes, peaks } from '../../apps/production-web/assets/collectible-waveform.mjs';

test('peaks는 구간마다 절댓값 최대치를 0~1로 돌려준다', () => {
  assert.deepEqual(peaks([0, 0, 0, 0], 2), [0, 0]);
  assert.deepEqual(peaks([0.1, -0.5, 0.25, -0.2], 2), [0.5, 0.25]);
  assert.deepEqual(peaks([2, -3], 1), [1], '1을 넘는 표본은 1로 자른다');
  assert.equal(peaks([0.2, 0.4, 0.6], 2).length, 2);
  assert.deepEqual(peaks([], 8), []);
  assert.deepEqual(peaks([0.3], 0), []);
});

test('dataUrlBytes는 base64 data URL만 바이트로 바꾼다', () => {
  const bytes = new Uint8Array(dataUrlBytes('data:audio/mpeg;base64,AQID'));
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(dataUrlBytes(''), null);
  assert.equal(dataUrlBytes('https://example.com/a.mp3'), null);
});

function fakeCanvas() {
  const calls = [];
  return { hidden: true, width: 320, height: 56, calls, getContext: () => ({ clearRect: () => calls.push('clear'), fillRect: () => calls.push('bar'), set fillStyle(value) { calls.push(value); } }) };
}
const fakeAudio = src => ({ src, currentTime: 0, duration: 4, getAttribute: () => src, addEventListener() {} });

test('디코딩에 성공하면 파형을 보이고 그린다', async () => {
  const canvas = fakeCanvas();
  const waveform = attachWaveform(fakeAudio('data:audio/mpeg;base64,AQID'), canvas, { decode: async () => new Float32Array([0.1, 0.9, -0.4, 0.2]) });
  await waveform.refresh();
  assert.equal(canvas.hidden, false);
  assert.ok(canvas.calls.includes('bar'));
});

test('디코딩이 실패하거나 음성이 없으면 파형만 숨긴다', async () => {
  const failed = fakeCanvas();
  await attachWaveform(fakeAudio('data:audio/webm;base64,AQID'), failed, { decode: async () => { throw new Error('EncodingError'); } }).refresh();
  assert.equal(failed.hidden, true);
  const empty = fakeCanvas(); empty.hidden = false;
  await attachWaveform(fakeAudio(''), empty, { decode: async () => new Float32Array([1]) }).refresh();
  assert.equal(empty.hidden, true);
});

test('더 늦게 시작한 refresh만 결과를 그린다', async () => {
  const canvas = fakeCanvas(); let release;
  const audio = fakeAudio('data:audio/mpeg;base64,AQID');
  const slow = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const waveform = attachWaveform(audio, canvas, { decode: () => (++calls === 1 ? slow : Promise.reject(new Error('second fails'))) });
  const first = waveform.refresh(); const second = waveform.refresh();
  release(new Float32Array([0.5])); await Promise.all([first, second]);
  assert.equal(canvas.hidden, true, '첫 refresh의 늦은 성공이 두 번째의 숨김을 덮으면 안 된다');
});
```

- [ ] **Step 2: 시험이 실패하는지 확인**

Run: `node --test tests/site/collectible-waveform.test.mjs`
Expected: FAIL — `Cannot find module .../collectible-waveform.mjs`

- [ ] **Step 3: 모듈 작성** — `apps/production-web/assets/collectible-waveform.mjs`

```js
/** 녹음·MP3 파형(Issue #329). 디코딩이 실패하면 파형만 숨기고 재생은 그대로 둔다. */
const BARS = 64;

export function peaks(samples, buckets) {
  if (!samples?.length || !(buckets >= 1)) return [];
  const size = Math.ceil(samples.length / buckets), values = [];
  for (let start = 0; start < samples.length; start += size) {
    let max = 0;
    for (let index = start, end = Math.min(samples.length, start + size); index < end; index++) max = Math.max(max, Math.abs(samples[index]));
    values.push(Math.min(1, max));
  }
  return values;
}

/** CSP connect-src 때문에 fetch(data:)를 쓰지 않고 base64를 직접 바이트로 바꾼다. */
export function dataUrlBytes(dataUrl) {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  const binary = atob(match[1]), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function drawWaveform(canvas, values, progress = 0) {
  const context = canvas.getContext?.('2d');
  if (!context || !values.length) return;
  const { width, height } = canvas, step = width / values.length, played = Math.round(values.length * Math.max(0, Math.min(1, progress)));
  context.clearRect(0, 0, width, height);
  for (const [index, value] of values.entries()) {
    const bar = Math.max(2, value * (height - 8));
    context.fillStyle = index < played ? '#075ee5' : '#b9cdec';
    context.fillRect(index * step + 1, (height - bar) / 2, Math.max(1, step - 2), bar);
  }
}

async function decodeSamples(buffer) {
  const Context = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Context) throw new Error('NO_AUDIO_DECODER');
  const decoded = await new Context(1, 1, 44100).decodeAudioData(buffer);
  return decoded.getChannelData(0);
}

export function attachWaveform(audio, canvas, { decode = decodeSamples, signal } = {}) {
  let values = [], sequence = 0;
  const redraw = () => drawWaveform(canvas, values, audio.duration ? audio.currentTime / audio.duration : 0);
  audio.addEventListener('timeupdate', redraw, { signal });
  audio.addEventListener('ended', redraw, { signal });
  return {
    async refresh() {
      const current = ++sequence;
      values = []; canvas.hidden = true;
      const buffer = dataUrlBytes(audio.getAttribute('src') || '');
      if (!buffer) return;
      try {
        const samples = await decode(buffer);
        if (current !== sequence) return;
        values = peaks(samples, BARS); canvas.hidden = values.length === 0; redraw();
      } catch {
        if (current === sequence) canvas.hidden = true;
      }
    },
  };
}
```

- [ ] **Step 4: 시험 통과 확인**

Run: `node --test tests/site/collectible-waveform.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: 편집기에 연결**
  1. `collectible-editor.mjs` 맨 위 import 줄들 뒤에 추가:
     ```js
     import { attachWaveform } from './collectible-waveform.mjs';
     ```
  2. 템플릿에서 `<audio data-view="audio" controls preload="metadata" aria-label="사장님 음성 미리 듣기"></audio>` 바로 뒤에 추가:
     ```html
     <canvas data-view="waveform" width="320" height="56" aria-hidden="true" hidden></canvas>
     ```
  3. `studio = createCollectibleStudio(container, { effectNames });` 줄 바로 다음에 추가(`listen`이 쓰는 같은 `signal`을 넘긴다):
     ```js
     const waveform = attachWaveform(view('audio'), view('waveform'), { signal });
     ```
  4. 음성이 바뀌는 네 곳에서 `view('audio').src`를 정한 **바로 다음**에 `waveform.refresh();`를 부른다:
     - `syncValues()` 안 `const audio = view('audio'); audio.pause(); audio.src = project.audio?.dataUrl || ''; audio.hidden = !project.audio;` 뒤
     - 녹음 완료 `view('audio').src = dataUrl; view('audio').hidden = false;` 뒤
     - MP3 불러오기 `view('audio').src = dataUrl; view('audio').hidden = false;` 뒤
     - `audio-delete` 처리의 `view('audio').src = ''; view('audio').hidden = true;` 뒤
- [ ] **Step 6: 서빙 목록·CSS·서빙 시험 갱신**
  - `apps/production-web/server.mjs:21` 배열의 `'collectible-studio.mjs',` 뒤에 `'collectible-waveform.mjs',`를 더한다.
  - `tests/site/collectible-viewer.test.mjs:50` 배열의 `'/merchant/assets/collectible-studio.mjs',` 뒤에 `'/merchant/assets/collectible-waveform.mjs',`를 더한다.
  - `collectible-editor.css`의 `.collectible-editor audio { ... }` 줄 뒤에 추가:
    ```css
    .collectible-editor canvas[data-view="waveform"] { aspect-ratio: auto; height: 56px; margin-top: .4rem; border-radius: .6rem; background: #f4f9ff; }
    ```
- [ ] **Step 7: 회귀 실행**

Run: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/production-web/assets/collectible-waveform.mjs apps/production-web/assets/collectible-editor.mjs apps/production-web/assets/collectible-editor.css apps/production-web/server.mjs tests/site/collectible-waveform.test.mjs tests/site/collectible-viewer.test.mjs
git commit -m "녹음·MP3 음성에 파형을 보인다 (#329)" -m "Constraint: CSP connect-src 때문에 fetch(data:)를 쓰지 않는다
Confidence: high
Scope-risk: narrow
Tested: node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs
Not-tested: 실제 브라우저 디코딩(Task 6)"
```

---

### Task 2: 1·2단계 재배치와 두께 3단계

**Files:**
- Modify: `apps/production-web/assets/collectible-model.mjs` (`THICKNESS_PRESETS`, `thicknessPresetLabel`)
- Modify: `apps/production-web/assets/collectible-studio.mjs:1-117` (import, `disclosure` 도우미, 1·2단계 배치, `syncChoices`)
- Modify: `apps/production-web/assets/collectible-editor.mjs` (`zoom-step` 동작, 미리보기 설명의 두께 문구)
- Modify: `apps/production-web/assets/collectible-editor.css`
- Test: `tests/site/collectible-model.test.mjs`(끝에 추가), `tests/site/collectible-studio-layout.test.mjs`(새 파일)

**Interfaces:**
- Produces: `THICKNESS_PRESETS: ReadonlyArray<[number, string]>` = `[[4,'얇게'],[8,'보통'],[14,'두껍게']]`, `thicknessPresetLabel(value: number): string | null`; 스튜디오 내부 도우미 `disclosure(summary: string, ...children: Node[]): HTMLDetailsElement`(클래스 `ce-more`, 닫힌 상태); 편집기 동작 `data-action="zoom-step"` + `data-id`(`"-0.25"`|`"0.25"`).
- Consumes: 없음

- [ ] **Step 1: 모델 시험 추가** — `tests/site/collectible-model.test.mjs` 끝에

```js
import { THICKNESS_PRESETS, thicknessPresetLabel } from '../../apps/production-web/assets/collectible-model.mjs';

test('두께 3단계는 4·8·14이고 그 밖의 값은 이름이 없다', () => {
  assert.deepEqual(THICKNESS_PRESETS.map(([value]) => value), [4, 8, 14]);
  assert.equal(thicknessPresetLabel(4), '얇게');
  assert.equal(thicknessPresetLabel(8), '보통');
  assert.equal(thicknessPresetLabel(14), '두껍게');
  assert.equal(thicknessPresetLabel(11), null);
  assert.equal(thicknessPresetLabel(NaN), null);
});
```
(파일 위쪽 import 묶음에 이미 같은 경로 import가 있으면 그 줄에 이름만 더한다.)

- [ ] **Step 2: 배치 시험 파일 작성** — `tests/site/collectible-studio-layout.test.mjs`

```js
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

let dom, cleanups;
beforeEach(() => { dom = installMiniDom(); cleanups = []; });
afterEach(() => { for (const cleanup of cleanups) cleanup(); dom.restore(); });

/** 스튜디오 배치 시험용: 편집기를 올리고 단계·노드 위치를 묻는 도우미를 돌려준다. */
export async function mountStudio() {
  const api = createFakeApi(), container = document.createElement('div');
  cleanups.push(mountCollectibleEditor(container, { merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {}, confirm: () => true }));
  await settle();
  const q = selector => container.querySelector(selector);
  const all = selector => [...container.querySelectorAll(selector)];
  const click = async node => { node.dispatchEvent({ type: 'click' }); await settle(); };
  const act = async (name, id) => click(all(`[data-action="${name}"]`).find(node => id === undefined || node.dataset.id === id));
  const stepOf = node => node?.closest('[data-step-panel]')?.dataset.stepPanel;
  const choice = (control, id) => all('[data-action="choice"]').find(node => node.dataset.controlFor === control && node.dataset.id === id);
  await act('new');
  return { api, container, q, all, click, act, stepOf, choice };
}

test('1단계에는 사진·모양·자르기만 펼치고 이름은 4단계로 간다', async () => {
  const ui = await mountStudio();
  assert.equal(ui.stepOf(ui.q('[data-control="photo"]')), '1');
  assert.equal(ui.stepOf(ui.choice('shape', 'stamp')), '1');
  assert.equal(ui.stepOf(ui.q('[data-view="crop"]')), '1');
  assert.notEqual(ui.stepOf(ui.q('[data-control="name"]')), '1');
  const fine = ui.q('[data-control="crop-x"]').closest('details');
  assert.ok(fine, '가로·세로 미세 조정은 접힌 더 보기 안에 있다');
  assert.equal(fine.open, false);
});

test('확대 −/+ 버튼은 0.25배씩 바꾸고 1~8배를 넘지 않는다', async () => {
  const ui = await mountStudio();
  const zoom = ui.q('[data-control="zoom"]');
  await ui.act('zoom-step', '0.25');
  assert.equal(Number(zoom.value), 1.25);
  await ui.act('zoom-step', '-0.25'); await ui.act('zoom-step', '-0.25');
  assert.equal(Number(zoom.value), 1, '1배 아래로 내려가지 않는다');
  zoom.value = '8'; await ui.act('zoom-step', '0.25');
  assert.equal(Number(zoom.value), 8, '8배를 넘지 않는다');
});

test('2단계에 표현 스타일·깊이·두께 3단계가 있고 등급 관리는 접혀 있다', async () => {
  const ui = await mountStudio();
  assert.equal(ui.stepOf(ui.choice('style', 'incised')), '2');
  assert.equal(ui.stepOf(ui.q('[data-control="relief"]')), '2');
  assert.equal(ui.stepOf(ui.choice('thickness', '14')), '2');
  const grades = ui.q('[data-view="grade-manager"]').closest('details');
  assert.equal(ui.stepOf(grades), '2'); assert.equal(grades.open, false);
});

test('두께 버튼은 값을 바꾸고, 다른 값은 직접 지정으로 보존한다', async () => {
  const ui = await mountStudio();
  const thickness = ui.q('[data-control="thickness"]');
  await ui.click(ui.choice('thickness', '14'));
  assert.equal(thickness.value, '14');
  assert.equal(ui.choice('thickness', '14').getAttribute('aria-pressed'), 'true');
  thickness.value = '11'; thickness.dispatchEvent({ type: 'change' }); await settle();
  assert.equal(thickness.value, '11', '직접 지정 값은 바뀌지 않는다');
  assert.ok(['4', '8', '14'].every(id => ui.choice('thickness', id).getAttribute('aria-pressed') === 'false'));
  const custom = ui.q('.ce-thickness-custom');
  assert.equal(custom.hidden, false); assert.equal(custom.textContent, '직접 지정 11');
});
```

- [ ] **Step 3: 시험 실패 확인**

Run: `node --test tests/site/collectible-model.test.mjs tests/site/collectible-studio-layout.test.mjs`
Expected: FAIL — `THICKNESS_PRESETS` export 없음, 배치 단언 실패

- [ ] **Step 4: 모델에 두께 3단계 추가** — `collectible-model.mjs`의 `LIVING_KINDS` 정의 줄 다음에

```js
/** 두께 3단계(Issue #329). 저장 값은 그대로 1~24 정수이고, 이 표는 화면 이름만 정한다. */
export const THICKNESS_PRESETS = Object.freeze([Object.freeze([4, '얇게']), Object.freeze([8, '보통']), Object.freeze([14, '두껍게'])]);
export function thicknessPresetLabel(value) { return THICKNESS_PRESETS.find(([preset]) => preset === value)?.[1] ?? null; }
```

- [ ] **Step 5: 편집기 동작 두 가지**
  1. `act()`의 `if (action === 'photo-choose') { control('photo').click(); return; }` 줄 바로 앞에:
     ```js
     if (action === 'zoom-step') { const input = control('zoom'); remember(); input.value = String(clamp(Number(input.value) + Number(id), Number(input.min), Number(input.max))); input.dispatchEvent(new Event('input', { bubbles: true })); return; }
     ```
  2. 미리보기 설명 줄 `view('preview-caption').textContent = \`${project.name} · ${grade?.name || ''} · ${project.theme.name} · ${project.thickness} 두께\`;`을 다음으로 바꾼다:
     ```js
     view('preview-caption').textContent = `${project.name} · ${grade?.name || ''} · ${project.theme.name} · 두께 ${thicknessPresetLabel(project.thickness) ?? project.thickness}`;
     ```
     그리고 편집기의 `collectible-model.mjs` import 목록에 `thicknessPresetLabel`을 더한다.

- [ ] **Step 6: 스튜디오 1·2단계 재배치** — `collectible-studio.mjs`
  1. 파일 맨 위에 import 추가:
     ```js
     import { THICKNESS_PRESETS, thicknessPresetLabel } from './collectible-model.mjs';
     ```
  2. `section` 도우미 정의 다음에 `disclosure` 도우미 추가:
     ```js
     /** "더 보기"처럼 접어 두는 묶음. 지우지 않고 옮긴 컨트롤만 담는다. */
     const disclosure = (summary, ...children) => {
       const value = node('details', 'ce-more'), body = node('div', 'ce-detail');
       body.append(...children); value.append(node('summary', '', summary), body);
       return value;
     };
     ```
  3. 지금의 92~105행(`const photo = field('photo') ...`부터 `panels[1].append(volume);`까지)을 아래로 바꾼다. 3단계용 `cropSlots`는 더 이상 만들지 않는다.
     ```js
     const photo = field('photo'), photoHelp = photo.nextElementSibling, shape = field('shape'), crop = view('crop');
     const cropZoom = field('zoom'), cropMoves = field('crop-x').parentElement, cropActions = cropMoves.nextElementSibling;
     const zoomOut = action('−', 'zoom-step', '-0.25', 'ce-icon-button'), zoomIn = action('+', 'zoom-step', '0.25', 'ce-icon-button');
     zoomOut.setAttribute('aria-label', '사진 축소'); zoomIn.setAttribute('aria-label', '사진 확대');
     const zoomRow = node('div', 'ce-zoom-row'); zoomRow.append(zoomOut, cropZoom, zoomIn);
     const photoStage = node('div', 'ce-photo-stage');
     photoStage.append(node('p', 'ce-photo-instruction', '사진을 움직여 원하는 모양에 맞춰 주세요.'), crop, zoomRow, disclosure('더 보기 · 위치 미세 조정', cropMoves, cropActions));
     shape.hidden = true;
     const shapes = section('모양', '사진의 위치와 확대는 모양을 바꿔도 유지돼요.'); shapes.append(shape, choices('shape', [['circle', '원형'], ['stamp', '우표'], ['serrated', '톱니']], '모양', 'shape'));
     panels[0].append(photo, photoHelp, shapes, photoStage);
     const style = field('style'); style.hidden = true;
     const styles = section('표현 스타일', '원본 색, 음각, 양각을 직접 비교해 보세요.');
     styles.append(style, choices('style', [['original', '원본'], ['incised', '음각'], ['raised', '양각']], '표현 스타일', 'style'), field('relief'));
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
     ```
  4. `showStep()`에서 `cropSlots[currentStep === 3 ? 1 : 0].append(photoStage);` 줄을 지운다. 3단계의 `cropSlots[1]`·`'photo-choose'` 버튼을 넣던 `panels[2].append(...)` 줄은 Task 3이 바꾸므로, 이 Task에서는 그 줄의 `cropSlots[1], `만 지운다.
  5. `syncChoices()` 끝(닫는 `}` 바로 앞)에 추가:
     ```js
     const thicknessValue = Number(control('thickness').value);
     thicknessCustom.hidden = thicknessPresetLabel(thicknessValue) !== null; thicknessCustom.textContent = `직접 지정 ${thicknessValue}`;
     ```
- [ ] **Step 7: CSS** — `collectible-editor.css`의 `.ce-material-choices { ... }` 줄 다음에

```css
.ce-zoom-row { display: flex; align-items: end; gap: .5rem; }
.ce-zoom-row .ce-field { flex: 1; margin-block: .4rem; }
.collectible-editor .ce-icon-button { min-width: 44px; padding-inline: .5rem; font-size: 1.1rem; line-height: 1; }
.ce-thickness-choices { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ce-thickness-custom { margin: .4rem 0 0; font-weight: 600; color: #0757c5; }
.collectible-editor details.ce-more { background: transparent; border-style: dashed; }
```

- [ ] **Step 8: 시험 통과 + 회귀**

Run: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs`
Expected: 전부 PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/production-web/assets/collectible-model.mjs apps/production-web/assets/collectible-studio.mjs apps/production-web/assets/collectible-editor.mjs apps/production-web/assets/collectible-editor.css tests/site/collectible-model.test.mjs tests/site/collectible-studio-layout.test.mjs
git commit -m "제작기 1·2단계를 핵심 조작만 펼치고 두께를 얇게·보통·두껍게로 고른다 (#329)" -m "Constraint: 저장 값은 1~24 정수 그대로, 다른 값은 직접 지정으로 보존
Confidence: high
Scope-risk: narrow
Tested: node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs"
```

---

### Task 3: 3·4단계 재배치와 필터 선택

**Files:**
- Modify: `apps/production-web/assets/collectible-studio.mjs` (3단계 묶음, 필터 선택, 4단계 묶음, `sync()`)
- Modify: `apps/production-web/assets/collectible-editor.css`
- Test: `tests/site/collectible-studio-layout.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 2의 `disclosure()`, `motionDetail`, `panels`.
- Produces: 스튜디오 지역 변수 `rewardsBody`(4단계 "게시 정보" 내용 요소; Task 4가 게시 안내·배포 상태를 여기에 더한다). 필터 타일은 `button.ce-choice-filter[data-filter="merge|simplify|cartoon"]`(편집기 `data-action` 없음).

- [ ] **Step 1: 시험 추가** — `tests/site/collectible-studio-layout.test.mjs` 끝에

```js
test('3단계는 자르기를 반복하지 않고 1단계로 가는 버튼·되돌리기·붓·필터·스티커를 보인다', async () => {
  const ui = await mountStudio();
  assert.notEqual(ui.stepOf(ui.q('[data-view="crop"]')), '3');
  const back = ui.all('[data-action="step"]').find(node => node.dataset.id === '1' && ui.stepOf(node) === '3');
  assert.ok(back, '3단계에 1단계로 가는 버튼이 있다');
  for (const name of ['undo', 'redo', 'compare']) assert.equal(ui.stepOf(ui.q(`[data-action="${name}"]`)), '3', name);
  assert.equal(ui.stepOf(ui.choice('brush', 'erase')), '3');
  assert.equal(ui.stepOf(ui.q('[data-control="brush-size"]')), '3');
  assert.equal(ui.stepOf(ui.q('[data-control="sticker-kind"]')), '3');
  const more = ui.q('[data-edit="brightness"]').closest('details');
  assert.equal(ui.stepOf(more), '3'); assert.equal(more.open, false);
});

test('필터 선택은 보이는 강도 슬라이더만 바꾸고 값은 그대로 둔다', async () => {
  const ui = await mountStudio();
  const slider = name => ui.q(`[data-edit="${name}"]`).closest('label');
  const tile = name => ui.q(`[data-filter="${name}"]`);
  assert.equal(slider('cartoon').hidden, false, '모두 0이면 만화풍을 보인다');
  assert.equal(slider('merge').hidden, true);
  const merge = ui.q('[data-edit="merge"]'); merge.value = '30'; merge.dispatchEvent({ type: 'input' }); await settle();
  await ui.click(tile('merge'));
  assert.equal(slider('merge').hidden, false); assert.equal(slider('cartoon').hidden, true);
  assert.equal(tile('merge').getAttribute('aria-pressed'), 'true');
  assert.equal(merge.value, '30', '선택을 바꿔도 값은 그대로다');
});

test('다른 초안을 열면 필터 선택을 그 초안 값으로 다시 정한다', async () => {
  const ui = await mountStudio();
  await ui.click(ui.q('[data-filter="simplify"]'));
  await ui.act('new');
  assert.equal(ui.q('[data-edit="cartoon"]').closest('label').hidden, false, '새 초안은 기본(만화풍)으로 돌아간다');
});

test('4단계에 움직임·효과·음성·게시 정보가 펼쳐져 있고 이야기·살아 있는 그림은 접혀 있다', async () => {
  const ui = await mountStudio();
  for (const selector of ['[data-view="templates"]', '[data-control="effect-type"]', '[data-control="greeting"]', '[data-view="waveform"]', '[data-control="name"]', '[data-control="campaign"]']) {
    assert.equal(ui.stepOf(ui.q(selector)), '4', selector);
  }
  for (const control of ['templates', 'greeting', 'campaign']) {
    const details = (ui.q(`[data-view="${control}"]`) || ui.q(`[data-control="${control}"]`)).closest('details');
    assert.equal(details.open, true, control);
  }
  for (const control of ['living-kind', 'story-type']) assert.equal(ui.q(`[data-control="${control}"]`).closest('details').open, false, control);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/site/collectible-studio-layout.test.mjs`
Expected: 새 4개 FAIL

- [ ] **Step 3: 3단계 재배치** — Task 2 이후의 `const photoDetail = control('brush').closest('details') ...`부터 `panels[2].append(...)` 줄까지를 아래로 바꾼다.

```js
const photoDetail = control('brush').closest('details'), stickerDetail = control('sticker-kind').closest('details');
photoDetail.open = false; stickerDetail.open = true;
photoDetail.querySelector('summary').textContent = '더 보기 · 밝기·바탕·패럴랙스';
const brush = field('brush'); brush.hidden = true;
const tools = node('div', 'ce-step-tools');
tools.append(container.querySelector('[data-action="undo"]'), container.querySelector('[data-action="redo"]'), container.querySelector('[data-action="compare"]'));
const brushPanel = section('붓 도구');
brushPanel.append(brush, choices('brush', [['move', '사진 이동'], ['clean', '잡티'], ['erase', '투명'], ['restore', '복원'], ['color', '색 통일']], '붓 도구', 'brush'), field('brush-size'), field('brush-color'));
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
```

- [ ] **Step 4: 4단계 재배치** — 지금의 `const livingDetail = ...`부터 `panels[3].append(...)` 줄까지를 아래로 바꾼다(앞의 `materials` 블록과 `gradeContent.replaceChildren(); gradesDetail.remove();`는 그대로 둔다).

```js
const livingDetail = control('living-kind').closest('details');
const voice = control('greeting').closest('details'), story = control('story-type').closest('details'), rewards = control('theme').closest('details');
motionDetail.open = true; voice.open = true; rewards.open = true; livingDetail.open = false; story.open = false;
motionDetail.querySelector('summary').textContent = '움직임';
livingDetail.querySelector('summary').textContent = '더 보기 · 살아 있는 그림';
story.querySelector('summary').textContent = '더 보기 · 가게 이야기';
rewards.querySelector('summary').textContent = '게시 정보 · 이름·시즌·캠페인';
const rewardsBody = rewards.querySelector('.ce-detail');
rewardsBody.prepend(seasonTiles('theme')); rewardsBody.prepend(field('name'));
panels[3].append(motionDetail, materials, voice, rewards, livingDetail, story);
```

- [ ] **Step 5: `sync()`에서 필터 선택 갱신** — 반환 객체의 `sync(project, ...)` 본문 첫 줄에 `syncFilter(project);`를 더한다.
- [ ] **Step 6: CSS** — Task 2에서 더한 줄들 다음에

```css
.ce-step-tools { display: flex; flex-wrap: wrap; gap: .5rem; margin-block: .6rem; }
.ce-filter-choices { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.collectible-editor .ce-link-step { width: 100%; background: transparent; border-style: dashed; }
```
그리고 `@media (max-width: 820px)` 안의 `.ce-workspace[data-step="3"] .ce-preview { grid-row: auto; }` 줄을 지운다(3단계도 미리보기를 위에 둔다).

- [ ] **Step 7: 시험 통과 + 회귀**

Run: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/production-web/assets/collectible-studio.mjs apps/production-web/assets/collectible-editor.css tests/site/collectible-studio-layout.test.mjs
git commit -m "제작기 3·4단계를 시안 순서로 묶고 필터는 고른 강도만 보인다 (#329)" -m "Constraint: 필터 세 값은 함께 저장, 선택은 화면만 바꾼다
Confidence: high
Scope-risk: narrow
Tested: node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs"
```

---

### Task 4: 화면 뼈대 — 미리보기 고정, 하단 바, ⋯ 메뉴, 알림 줄, 폰 전체 화면

**Files:**
- Modify: `apps/production-web/assets/collectible-studio.mjs` (미리보기 재구성, 게시 묶음 분해, 하단 바, 메뉴, `showStep`·`showHome`)
- Modify: `apps/production-web/assets/collectible-editor.css`
- Test: `tests/site/collectible-studio-layout.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 3의 `rewardsBody`, Task 2의 `disclosure()`.
- Produces: 하단 바 `.ce-stage-footer`(이전 `[data-action="previous-step"]`, 전체 미리보기 `.ce-full-preview[data-action="replay"]`, 다음 `[data-action="next-step"]`, 게시 `[data-action="publish"]`), 메뉴 토글 `.ce-menu-button`(`aria-expanded`·`aria-controls`), 메뉴 `.ce-menu`(초안 저장·게시 중지·삭제), 알림 줄 `.ce-status-line`.

- [ ] **Step 1: 시험 추가** — `tests/site/collectible-studio-layout.test.mjs` 끝에

```js
const visible = node => { for (let item = node; item; item = item.parentElement) if (item.hidden) return false; return true; };

test('하단 바: 1단계는 다음만, 2~3단계는 이전·다음, 4단계는 전체 미리보기·게시하기', async () => {
  const ui = await mountStudio();
  const footer = ui.q('.ce-stage-footer');
  const shown = () => ['previous-step', 'replay', 'next-step', 'publish'].filter(name => { const button = footer.querySelector(`[data-action="${name}"]`); return button && !button.hidden; });
  assert.deepEqual(shown(), ['next-step']);
  await ui.act('next-step'); assert.deepEqual(shown(), ['previous-step', 'next-step']);
  await ui.act('next-step'); assert.deepEqual(shown(), ['previous-step', 'next-step']);
  await ui.act('next-step'); assert.deepEqual(shown(), ['previous-step', 'replay', 'publish']);
  assert.equal(footer.querySelector('[data-action="publish"]').textContent, '게시하기');
});

test('초안 저장·게시 중지·삭제는 ⋯ 메뉴에만 있고 메뉴는 열고 닫힌다', async () => {
  const ui = await mountStudio();
  const menu = ui.q('.ce-menu'), toggle = ui.q('.ce-menu-button');
  for (const name of ['draft', 'unpublish', 'delete']) {
    assert.equal(ui.all(`[data-action="${name}"]`).length, 1, name);
    assert.ok(ui.q(`[data-action="${name}"]`).closest('.ce-menu'), name);
  }
  assert.equal(ui.all('[data-action="publish"]').length, 1);
  assert.equal(ui.q('.ce-publish'), null, '예전 게시 묶음은 없어졌다');
  assert.equal(menu.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await ui.click(toggle);
  assert.equal(menu.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), menu.id);
  await ui.act('step', '2');
  assert.equal(menu.hidden, true, '단계를 옮기면 메뉴가 닫힌다');
});

test('알림은 작업 영역에서는 하단 바 위, 스튜디오 홈에서는 홈 위에 있다', async () => {
  const ui = await mountStudio();
  const notice = ui.q('[data-view="notice"]');
  assert.ok(notice.closest('.ce-status-line'), '작업 영역의 알림 줄');
  assert.ok(ui.q('[data-view="save-state"]').closest('.ce-status-line'));
  await ui.act('home');
  assert.ok(notice.closest('[data-view="studio-home"]'), '홈으로 돌아오면 홈 위로');
  assert.equal(visible(notice), true);
});

test('미리보기는 등급·캔버스·재생/각도 줄만 펼치고 나머지는 미리보기 옵션에 접는다', async () => {
  const ui = await mountStudio();
  const preview = ui.q('.ce-preview');
  assert.ok(ui.q('[data-action="play"]').closest('.ce-preview-row'));
  assert.ok(ui.q('[data-control="angle"]').closest('.ce-preview-row'));
  assert.equal(ui.q('[data-action="play"]').getAttribute('aria-label'), '재생');
  const more = preview.querySelector('.ce-preview-more');
  assert.equal(more.open, false);
  for (const selector of ['[data-action="angle-reset"]', '[data-control="reduce-motion"]', '[data-view="preview-caption"]', '[data-view="greeting"]']) assert.ok(ui.q(selector).closest('.ce-preview-more'), selector);
  assert.ok(ui.q('[data-view="distribution"]').closest('details').querySelector('[data-control="campaign"]'), '배포 상태는 게시 정보 안');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/site/collectible-studio-layout.test.mjs`
Expected: 새 4개 FAIL

- [ ] **Step 3: 미리보기·게시 묶음·하단 바·메뉴 만들기** — `controls.replaceChildren(...panels);` 다음 줄(`const footer = node('div', 'ce-stage-footer'); footer.append(...); workspace.append(footer, grid.querySelector('.ce-publish'));`)을 아래로 바꾼다.

```js
const preview = grid.querySelector('.ce-preview'), publishBox = grid.querySelector('.ce-publish');
const previewActions = field('angle').nextElementSibling;
const iconize = (button, icon) => { button.setAttribute('aria-label', button.textContent); button.textContent = icon; button.classList.add('ce-icon-button'); return button; };
const play = iconize(previewActions.querySelector('[data-action="play"]'), '▶'), pause = iconize(previewActions.querySelector('[data-action="pause"]'), '❚❚');
const previewRow = node('div', 'ce-preview-row'); previewRow.append(play, pause, field('angle'));
const previewMore = disclosure('미리보기 옵션', previewActions.querySelector('[data-action="replay"]'), previewActions.querySelector('[data-action="angle-reset"]'), control('reduce-motion').closest('label'), view('preview-caption'), view('greeting'));
previewMore.classList.add('ce-preview-more');
previewActions.remove();
const draft = container.querySelector('[data-action="draft"]'), publish = container.querySelector('[data-action="publish"]');
const unpublish = container.querySelector('[data-action="unpublish"]'), remove = container.querySelector('[data-action="delete"]');
rewardsBody.append(publishBox.querySelector('.ce-help'), view('distribution'));
const statusLine = node('div', 'ce-status-line'); statusLine.append(view('save-state'));
publishBox.remove();
preview.append(previewRow, previewMore);
publish.textContent = '게시하기';
const previous = action('← 이전', 'previous-step'), next = action('다음 →', 'next-step', undefined, 'primary'), fullPreview = action('전체 미리보기', 'replay', undefined, 'ce-full-preview');
const footer = node('div', 'ce-stage-footer'); footer.append(previous, fullPreview, next, publish);
const menu = node('div', 'ce-menu'); menu.id = `${title.id}-menu`; menu.hidden = true; menu.append(draft, unpublish, remove);
const menuToggle = node('button', 'ce-menu-button', '⋯'); menuToggle.type = 'button';
menuToggle.setAttribute('aria-label', '더 많은 작업'); menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-controls', menu.id);
const setMenu = open => { menu.hidden = !open; menuToggle.setAttribute('aria-expanded', String(open)); };
menuToggle.addEventListener('click', () => setMenu(menu.hidden));
menu.addEventListener('click', event => { if (event.target.closest('[data-action]')) setMenu(false); });
workspaceHeading.append(menuToggle, menu);
workspace.append(statusLine, footer);
const noticeView = view('notice');
```
  `previewActions.querySelector(...)`로 꺼낸 "다시 보기"(`replay`)·"정면 보기"(`angle-reset`)는 `disclosure()`가 옮겨 담는다. `previewActions.remove()`는 그 뒤에 부른다.

- [ ] **Step 4: `showStep`·`showHome` 수정**
  - `showStep()`에서 Task 2 이후 남아 있는 `footer.querySelector('[data-action="previous-step"]').hidden = ...`·`footer.querySelector('[data-action="next-step"]').hidden = ...` 두 줄을 아래로 바꾸고, `syncChoices();` 바로 앞에 둔다.
    ```js
    previous.hidden = currentStep === 1; next.hidden = currentStep === 4;
    fullPreview.hidden = currentStep !== 4; publish.hidden = currentStep !== 4;
    statusLine.prepend(noticeView); setMenu(false);
    ```
  - `showHome()` 첫 줄 끝에 `home.prepend(noticeView); setMenu(false);`를 더한다.
- [ ] **Step 5: CSS — 공통** — `collectible-editor.css`
  - 1행 `.collectible-editor { ... }` 규칙 안 맨 앞에 `color-scheme: light;`를 더한다.
  - 지금의 `.ce-stage-footer { ... }`·`.ce-stage-footer button { ... }` 두 줄을 아래로 바꾸고, `.ce-publish ...` 세 줄은 지운다.
    ```css
    .ce-stage-footer { position: sticky; bottom: 0; z-index: 3; display: flex; justify-content: space-between; gap: .65rem; margin-top: .6rem; padding: .7rem 0 calc(.7rem + env(safe-area-inset-bottom)); border-top: 1px solid var(--ce-line); background: #fffffff2; }
    .ce-stage-footer button { flex: 1; max-width: 280px; }
    .ce-stage-footer [data-action="next-step"], .ce-stage-footer [data-action="publish"] { margin-left: auto; }
    .ce-status-line { margin-top: .8rem; }
    .ce-status-line .ce-help, .ce-status-line .ce-notice { margin-block: .3rem; }
    .ce-workspace-heading { position: relative; }
    .collectible-editor .ce-menu-button { min-width: 44px; padding-inline: .5rem; font-size: 1.3rem; line-height: 1; }
    .ce-menu { position: absolute; right: 0; top: calc(100% + .3rem); z-index: 6; display: grid; gap: .4rem; min-width: 12rem; padding: .6rem; background: #fff; border: 1px solid var(--ce-line); border-radius: .9rem; box-shadow: 0 10px 24px #14245b24; }
    .collectible-editor .ce-menu > .ce-danger { border-color: #b3261e; color: #8c1d18; background: #fff; }
    .ce-preview-row { display: flex; align-items: end; gap: .5rem; }
    .ce-preview-row .ce-field { flex: 1; margin-block: .4rem; }
    .collectible-editor details.ce-preview-more { margin-top: .5rem; }
    ```
- [ ] **Step 6: CSS — 폰 편집 모드** — `@media (max-width: 820px) { ... }` 안 끝에 추가

```css
  .ce-workspace:not([hidden]) { position: fixed; inset: 0; z-index: 60; overflow-y: auto; overscroll-behavior: contain; padding: 0 .8rem; background: linear-gradient(155deg, #f5fbff, #fff 48%, #edf5ff); }
  .ce-workspace-heading { position: sticky; top: 0; z-index: 4; margin: 0 -.8rem; padding: .5rem .8rem; background: #f5fbfff2; }
  .ce-workspace .ce-preview { position: sticky; top: 3.75rem; z-index: 2; max-height: none; overflow: visible; padding: .5rem .6rem; }
  .ce-workspace .ce-preview > h3 { display: none; }
  .ce-workspace .ce-grade-tabs { padding-bottom: .4rem; }
  .ce-workspace .ce-grade-tabs canvas { display: none; }
  .ce-workspace .ce-preview canvas[data-view="preview"] { width: auto; height: min(30svh, 260px); margin-inline: auto; }
  .ce-step-nav button > span:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ce-stage-footer { margin-inline: -.8rem; padding-inline: .8rem; }
```
  같은 블록 안의 기존 `.ce-preview { position: static; max-height: none; overflow: visible; grid-row: 1; padding: .8rem; }` 줄은 `.ce-preview { grid-row: 1; }`로 줄인다.

- [ ] **Step 7: 시험 통과 + 회귀**

Run: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs`
Expected: 전부 PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/production-web/assets/collectible-studio.mjs apps/production-web/assets/collectible-editor.css tests/site/collectible-studio-layout.test.mjs
git commit -m "제작기를 폰에서 전체 화면으로 열고 미리보기 고정·하단 바·⋯ 메뉴를 둔다 (#329)" -m "Constraint: 저장·게시 버튼은 복제하지 않고 옮긴다
Confidence: medium
Scope-risk: moderate
Tested: node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs
Not-tested: 실제 브라우저 화면(Task 6)"
```

---

### Task 5: 폰 뒤로가기로 스튜디오 홈 돌아가기

**Files:**
- Modify: `apps/production-web/assets/collectible-studio.mjs` (`showStep`·`showHome`의 기록 항목)
- Modify: `apps/production-web/assets/collectible-editor.mjs` (`popstate` 처리)
- Test: `tests/site/collectible-studio-layout.test.mjs`(추가)

**Interfaces:**
- Consumes: Task 4의 `showHome(focus)`.
- Produces: `studio.showHome(focus = true, { fromHistory = false } = {})`. 기록 상태 객체 `{ collectibleWorkspace: true }`.

- [ ] **Step 1: 시험 추가** — 파일 끝에

```js
test('작업 영역을 열면 기록을 하나 넣고, 뒤로가기는 페이지를 떠나지 않고 홈으로 간다', async () => {
  const pushes = []; let backs = 0;
  window.history = { pushState: (...args) => pushes.push(args), back: () => { backs++; } };
  try {
    const ui = await mountStudio();
    assert.equal(pushes.length, 1); assert.deepEqual(pushes[0][0], { collectibleWorkspace: true });
    await ui.act('next-step');
    assert.equal(pushes.length, 1, '단계 이동은 기록을 더 넣지 않는다');
    dom.window.dispatch({ type: 'popstate' }); await settle();
    assert.equal(ui.q('[data-view="studio-home"]').hidden, false);
    assert.equal(ui.q('[data-view="workspace"]').hidden, true);
    assert.equal(backs, 0, '뒤로가기로 온 홈 이동은 history.back()을 다시 부르지 않는다');
    await ui.act('resume');
    assert.equal(pushes.length, 2, '다시 들어가면 새 기록');
    await ui.act('home');
    assert.equal(backs, 1, '← 스튜디오 버튼은 넣었던 기록을 한 번 소비한다');
    dom.window.dispatch({ type: 'popstate' }); await settle();
    assert.equal(ui.q('[data-view="studio-home"]').hidden, false, '이미 홈이면 그대로');
  } finally { delete window.history; }
});

test('history가 없는 환경에서도 열고 닫힌다', async () => {
  const ui = await mountStudio();
  await ui.act('home');
  assert.equal(ui.q('[data-view="studio-home"]').hidden, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/site/collectible-studio-layout.test.mjs`
Expected: 첫 시험 FAIL(`pushes.length` 0)

- [ ] **Step 3: 스튜디오 수정**
  - `let homeTheme = '기본', currentStep = 1, hasCurrent = false;` 줄 끝에 `let historyEntry = false;`를 더한다.
  - `showStep()` 첫 줄 앞에 `const entering = workspace.hidden;`을 두고, 함수 끝(`syncChoices();` 다음)에:
    ```js
    if (entering && !historyEntry && window.history?.pushState) { window.history.pushState({ collectibleWorkspace: true }, ''); historyEntry = true; }
    ```
  - `showHome(focus = true)`를 `showHome(focus = true, { fromHistory = false } = {})`로 바꾸고 첫 줄 앞에:
    ```js
    if (historyEntry) { historyEntry = false; if (!fromHistory) window.history?.back?.(); }
    ```
- [ ] **Step 4: 편집기 수정** — `listen(window, 'beforeunload', ...)` 줄 다음에

```js
// Issue #329: 폰 제스처 뒤로가기는 페이지를 떠나지 않고 스튜디오 홈으로 돌아온다(편집 내용은 메모리에 남는다).
listen(window, 'popstate', () => { if (!active || studio.isHome) return; stopHiddenMedia(); studio.sync(project, { dirty, wrapper }); studio.showHome(true, { fromHistory: true }); });
```

- [ ] **Step 5: 시험 통과 + 회귀**

Run: `node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/production-web/assets/collectible-studio.mjs apps/production-web/assets/collectible-editor.mjs tests/site/collectible-studio-layout.test.mjs
git commit -m "폰 뒤로가기가 제작 중 페이지를 떠나지 않고 스튜디오로 돌아오게 한다 (#329)" -m "Confidence: high
Scope-risk: narrow
Tested: node --test tests/site/collectible-*.test.mjs tests/site/verify_production_web_test.mjs"
```

---

### Task 6: 화면 검수, 실기, 문서, PR

**Files:**
- Modify: `docs/COLLECTIBLE_CREATOR.md`, `README.md`, `docs/TEST_STATUS.md`, `docs/PROJECT_STATE.md`, `docs/HANDOFF.md`, `docs/AI_USAGE.md`
- Create: `docs/evidence/creator-wizard-mobile-2026-10-03/*.png` (스크린샷)

- [ ] **Step 1: 게이트**

Run: `bash tools/gate.sh` (worktree 루트, 백그라운드)
Expected: `로컬 빠른 검사 PASS`

- [ ] **Step 2: 브라우저 화면 검수** — `COLLECTIBLE_QA_PORT=4199 node tests/fixtures/collectible-qa-server.mjs`를 띄우고 `http://localhost:4199/merchant/`에서 "제작기 열기" → "새 수집품 만들기", 사진을 올린 뒤 360·390·412px와 데스크톱(1280px), 각각 라이트·다크에서 1~4단계를 연다. 단계마다 확인:
  - 미리보기(2~4단계)·핵심 조작·하단 바가 한 화면에 함께 보인다.
  - 버튼 글자가 잘리지 않고 겹치지 않는다. ⋯ 메뉴가 화면 밖으로 나가지 않는다.
  - 다크 페이지에서도 제작기가 밝은 작업면이고 입력창이 밝다.
  - 4단계에서 MP3를 올리면 파형이 보이고, 재생 중 진행 색이 찬다.
  스크린샷은 390px 라이트 4장, 390px 다크 1장, 데스크톱 1장을 `docs/evidence/creator-wizard-mobile-2026-10-03/`에 저장한다. 고칠 것이 나오면 해당 Task 파일을 고치고 그 Task의 시험·회귀를 다시 돌린 뒤 따로 커밋한다.
- [ ] **Step 3: 실기(Samsung 폰 Chrome)**

Run: `adb -s R3CX10PCWCW reverse tcp:4199 tcp:4199`
폰 Chrome에서 `http://localhost:4199/merchant/`를 열어 1~4단계 이동, 사진 드래그·확대 −/+, 두께 버튼, 필터 선택, 직접 녹음(마이크 권한 허용) 후 파형, 제스처 뒤로가기 → 스튜디오 홈을 확인한다. 끝나면 `adb -s R3CX10PCWCW reverse --remove tcp:4199`.
- [ ] **Step 4: 문서** — `docs/COLLECTIBLE_CREATOR.md`의 화면 구성 설명을 새 배치(단계별 펼침/접음, 하단 바, ⋯ 메뉴, 뒤로가기, 두께 3단계, 파형)로 고친다. README의 제작기 줄, TEST_STATUS 첫 항목(명령·결과·스크린샷 경로·NOT_RUN), PROJECT_STATE 맨 위 절, HANDOFF 맨 위 절(기준 커밋·브랜치·다음 작업), AI_USAGE 맨 위 행을 더한다.
- [ ] **Step 5: 커밋 + PR**

```bash
git add docs apps tests README.md
git commit -m "제작기 폰 개편의 화면 검수·실기 결과와 문서를 남긴다 (#329)" -m "Confidence: medium
Scope-risk: narrow
Tested: tools/gate.sh, 360·390·412px·데스크톱 라이트·다크 화면, Samsung 폰 Chrome"
git push -u origin feat/329-creator-wizard-mobile
```
PR 본문은 `.github/pull_request_template.md` 절을 따르고 `Closes #329`, 실행 전 `bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"`로 검사한다. 독립 리뷰(구현과 다른 컨텍스트) 🔴 0 + CI PASS 뒤 병합한다.
- [ ] **Step 6: 배포는 별도 결정** — 점주 웹은 운영(`www.masscom.kr/merchant/`)에만 있다. 병합 뒤 `scripts/deploy-lightsail.sh`로 운영 웹을 배포할지는 이 계획 밖이며, 사이클 보고에서 소유자에게 묻는다.
