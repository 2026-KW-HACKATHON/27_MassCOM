import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachWaveform, dataUrlBytes, peaks } from '../../apps/production-web/assets/collectible-waveform.mjs';
import { mountCollectibleEditor } from '../../apps/production-web/assets/collectible-editor.mjs';
import { createFakeApi } from '../fixtures/collectible-fake-api.mjs';
import { installMiniDom, settle } from '../fixtures/mini-dom.mjs';

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

test('audio.duration이 Infinity여도 디코딩한 길이로 재생 진행을 그린다', async () => {
  const canvas = fakeCanvas(); const listeners = {};
  const audio = { ...fakeAudio('data:audio/webm;base64,AQID'), duration: Infinity, addEventListener: (type, handler) => { listeners[type] = handler; } };
  await attachWaveform(audio, canvas, { decode: async () => ({ samples: new Float32Array([0.2, 0.8, 0.5, 0.3]), duration: 2 }) }).refresh();
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.calls.filter(call => call === '#075ee5').length, 0, '재생 전에는 지나간 막대가 없다');
  canvas.calls.length = 0; audio.currentTime = 1; listeners.timeupdate();
  assert.ok(canvas.calls.filter(call => call === '#075ee5').length > 0, '재생이 진행되면 지나간 막대가 생긴다');
});

test('base64가 깨진 data URL이어도 refresh는 거절되지 않고 파형만 숨긴다', async () => {
  const canvas = fakeCanvas(); canvas.hidden = false; let decoded = 0;
  await attachWaveform(fakeAudio('data:audio/mpeg;base64,@@@'), canvas, { decode: async () => { decoded++; return new Float32Array([1]); } }).refresh();
  assert.equal(canvas.hidden, true);
  assert.equal(decoded, 0);
});

test('같은 음성으로 다시 refresh하면 다시 디코딩하거나 깜빡이지 않는다', async () => {
  const canvas = fakeCanvas(); let decoded = 0;
  const audio = fakeAudio('data:audio/mpeg;base64,AQID');
  const waveform = attachWaveform(audio, canvas, { decode: async () => { decoded++; return new Float32Array([0.5, 0.9]); } });
  await waveform.refresh();
  const again = waveform.refresh();
  assert.equal(canvas.hidden, false, '같은 음성이면 숨기지 않는다');
  await again;
  assert.equal(decoded, 1);
  audio.src = 'data:audio/mpeg;base64,BAUG'; audio.getAttribute = () => audio.src;
  await waveform.refresh();
  assert.equal(decoded, 2, '다른 음성이면 다시 디코딩한다');
});

test('편집기는 MP3를 불러오면 파형을 보이고 음성을 지우면 숨긴다', async () => {
  const dom = installMiniDom();
  const globals = { Audio: Object.getOwnPropertyDescriptor(globalThis, 'Audio'), OfflineAudioContext: Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext') };
  const stub = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  stub('Audio', class { set src(value) { this._src = value; if (value) setTimeout(() => { this.duration = 2; this.onloadedmetadata?.(); }, 0); } get src() { return this._src; } });
  stub('OfflineAudioContext', class { async decodeAudioData() { return { getChannelData: () => new Float32Array([0.5, 0.9]), duration: 1 }; } });
  let cleanup;
  try {
    const api = createFakeApi(), container = document.createElement('div');
    cleanup = mountCollectibleEditor(container, { merchantId: 'm1', merchantName: '월계 식당', request: api.request, loadCampaigns: api.listCampaigns, onNotice() {}, confirm: () => true });
    await settle();
    const waveform = container.querySelector('[data-view="waveform"]');
    assert.equal(waveform.hidden, true, '음성이 없으면 파형이 숨어 있다');
    const input = container.querySelector('[data-control="audio"]');
    input.files = [{ name: 'hello.mp3', type: 'audio/mpeg', size: 1000, dataUrl: 'data:audio/mpeg;base64,AQID' }];
    input.dispatchEvent({ type: 'change' }); await settle();
    assert.equal(waveform.hidden, false, 'MP3를 불러오면 파형이 보인다');
    container.querySelector('[data-action="audio-delete"]').dispatchEvent({ type: 'click' }); await settle();
    assert.equal(waveform.hidden, true, '음성을 지우면 파형이 숨는다');
  } finally {
    cleanup?.();
    for (const [name, descriptor] of Object.entries(globals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    dom.restore();
  }
});
