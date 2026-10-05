import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { gradeMaterialPresets } from '@/screens/collection/grade-material';

export type VideoLayers = {
  backgroundUri: string;
  avatarUri?: string;
  coinUri?: string;
  coinColors?: readonly string[];
  width: number;
  height: number;
  sceneHeight: number;
  sceneTop?: number;
  coinSizeRatio?: number;
};

export async function saveStudioImage(uri: string): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  let module: typeof import('../../modules/studio-video');
  try { module = await import('../../modules/studio-video'); }
  catch { return false; }
  // Keep the existing sharing path for development clients built before image saving was added.
  if (typeof module.studioVideo.saveImageAsync !== 'function') return false;
  return module.studioVideo.saveImageAsync(uri);
}

export async function cancelStudioVideo(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const { studioVideo } = await import('../../modules/studio-video');
    await studioVideo.cancelAsync();
  } catch {
    // The old development client may not contain the local module yet.
  }
}

export async function exportStudioVideo(layers: VideoLayers, isAlive: () => boolean,
  onShareOpen?: () => void): Promise<'saved' | 'cancelled' | 'unavailable'> {
  if (!isAlive()) return 'cancelled';
  if (Platform.OS === 'web') return exportWebStudioVideo(layers, isAlive);
  if (Platform.OS !== 'android') return 'unavailable';
  const { studioVideo } = await import('../../modules/studio-video');
  const uri = await studioVideo.encodeAsync({
    backgroundUri: layers.backgroundUri, width: layers.width, height: layers.height, sceneHeight: layers.sceneHeight,
    ...(layers.avatarUri ? { avatarUri: layers.avatarUri } : {}),
    ...(layers.coinUri ? { coinUri: layers.coinUri } : {}),
    ...(layers.coinColors ? { coinColors: [...layers.coinColors] } : {}),
    ...(layers.sceneTop !== undefined ? { sceneTop: layers.sceneTop } : {}),
    ...(layers.coinSizeRatio !== undefined ? { coinSizeRatio: layers.coinSizeRatio } : {}),
  });
  if (!isAlive()) return 'cancelled';
  const saved = await studioVideo.saveAsync(uri);
  if (!isAlive()) return 'cancelled';
  if (!(await Sharing.isAvailableAsync())) return saved ? 'saved' : 'unavailable';
  if (!isAlive()) return 'cancelled';
  onShareOpen?.();
  await Sharing.shareAsync(uri, { mimeType: 'video/mp4', dialogTitle: '나의 공간 영상 공유', UTI: 'public.mpeg-4' });
  // Android reports sheet dismissal, including cancellation, without a posting result.
  return saved ? 'saved' : 'cancelled';
}

async function exportWebStudioVideo(layers: VideoLayers, isAlive: () => boolean): Promise<'saved' | 'cancelled' | 'unavailable'> {
  const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']
    .find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream) return 'unavailable';
  const image = async (uri?: string): Promise<HTMLImageElement | undefined> => {
    if (!uri) return undefined;
    const bitmap = new window.Image();
    bitmap.src = uri;
    await bitmap.decode();
    return bitmap;
  };
  const [background, avatar, coin] = await Promise.all([
    image(layers.backgroundUri), image(layers.avatarUri), image(layers.coinUri),
  ]);
  if (!background || !isAlive()) return 'cancelled';
  const canvas = document.createElement('canvas');
  canvas.width = layers.width;
  canvas.height = layers.height;
  const context = canvas.getContext('2d');
  if (!context) return 'unavailable';
  const stream = canvas.captureStream(20);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 });
  const chunks: BlobPart[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error('VIDEO_RECORD_FAILED'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
  });
  recorder.start();
  const started = performance.now();
  while (performance.now() - started < 4000 && isAlive()) {
    const progress = (performance.now() - started) / 4000;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(background, 0, 0, layers.width, layers.height);
    context.save();
    context.translate(0, layers.sceneTop ?? 0);
    if (avatar) {
      const size = Math.min(layers.width * .43, layers.sceneHeight * .46);
      context.drawImage(avatar, layers.width * .285, layers.sceneHeight * .83 - size + Math.sin(progress * Math.PI * 4) * 19, size, size);
    }
    if (coin) {
      const colors = layers.coinColors && layers.coinColors.length >= 2 ? layers.coinColors : gradeMaterialPresets.bronze.colors;
      const radius = layers.width * (layers.coinSizeRatio ?? .30) / 2;
      context.save();
      context.translate(layers.width * .235 + Math.sin(progress * Math.PI * 4) * 15, layers.sceneHeight * .23);
      context.scale(Math.max(.12, Math.abs(Math.cos(progress * Math.PI * 4))), 1);
      context.fillStyle = colors[colors.length - 1];
      context.beginPath(); context.arc(5, 7, radius + 8, 0, Math.PI * 2); context.fill();
      const rim = context.createLinearGradient(-radius, -radius, radius, radius);
      colors.forEach((color, index) => rim.addColorStop(index / (colors.length - 1), color));
      context.fillStyle = rim; context.beginPath(); context.arc(0, 0, radius + 4, 0, Math.PI * 2); context.fill();
      context.save(); context.beginPath(); context.arc(0, 0, radius - 9, 0, Math.PI * 2); context.clip();
      context.drawImage(coin, -radius + 9, -radius + 9, (radius - 9) * 2, (radius - 9) * 2);
      const gleam = context.createLinearGradient(-radius * 2 + progress * radius * 5, -radius, -radius + progress * radius * 5, radius);
      gleam.addColorStop(0, '#ffffff00'); gleam.addColorStop(.5, '#ffffffaa'); gleam.addColorStop(1, '#ffffff00');
      context.fillStyle = gleam; context.fillRect(-radius, -radius, radius * 2, radius * 2);
      context.restore(); context.restore();
    }
    context.restore();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  const video = await finished;
  if (!isAlive()) return 'cancelled';
  if (video.size === 0) throw new Error('VIDEO_EMPTY');
  const objectUrl = URL.createObjectURL(video);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `masscom-studio.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return 'saved';
}
