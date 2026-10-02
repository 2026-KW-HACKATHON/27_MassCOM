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
