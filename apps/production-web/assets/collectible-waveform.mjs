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
  return { samples: decoded.getChannelData(0), duration: decoded.duration };
}

/** decode는 표본 배열 또는 { samples, duration }을 돌려준다. MediaRecorder 녹음은 audio.duration이 Infinity일 수 있어 디코딩한 길이로 진행률을 센다. */
export function attachWaveform(audio, canvas, { decode = decodeSamples, signal } = {}) {
  let values = [], decodedSeconds = 0, shownSource = null, sequence = 0;
  const redraw = () => {
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : decodedSeconds;
    drawWaveform(canvas, values, total > 0 ? audio.currentTime / total : 0);
  };
  audio.addEventListener('timeupdate', redraw, { signal });
  audio.addEventListener('ended', redraw, { signal });
  return {
    async refresh() {
      const current = ++sequence;
      const source = audio.getAttribute('src') || audio.src || '';
      if (source && source === shownSource) { redraw(); return; }
      values = []; decodedSeconds = 0; shownSource = null; canvas.hidden = true;
      try {
        const buffer = dataUrlBytes(source);
        if (!buffer) return;
        const decoded = await decode(buffer);
        if (current !== sequence) return;
        values = peaks(decoded?.samples ?? decoded, BARS); decodedSeconds = Number(decoded?.duration) || 0;
        canvas.hidden = values.length === 0; shownSource = values.length ? source : null; redraw();
      } catch {
        if (current === sequence) canvas.hidden = true;
      }
    },
  };
}
