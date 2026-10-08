import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Run the actual native wrapper with a deferred Expo asset download, without an Android runtime.
function nativeVideoHarness(localUri: string | null = null) {
  let finishDownload!: (asset: { localUri: string | null; uri: string }) => void;
  const download = new Promise<{ localUri: string | null; uri: string }>((resolve) => { finishDownload = resolve; });
  const asset = { uri: 'gacha_stamp_reveal', localUri, downloadAsync: () => download };
  const states: unknown[] = [];
  let cursor = 0;
  const effects: (() => void)[] = [];
  const errors: unknown[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (value: unknown) => { states[index] = value; }];
    },
    useEffect(effect: () => void, deps: unknown[]) {
      const index = cursor++;
      const previous = states[index] as unknown[] | undefined;
      if (previous && deps.every((value, i) => value === previous[i])) return;
      states[index] = deps;
      effects.push(effect);
    },
  };
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const modules: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-asset': { Asset: { fromModule: () => asset } },
    'expo-modules-core': {
      requireOptionalNativeModule: () => ({ supportsPlayback: true }),
      requireNativeViewManager: () => 'NativeStampVideo',
    },
    'react-native': { View: 'View', Image: 'Image', StyleSheet: { create: (styles: unknown) => styles } },
  };
  const exports = {} as { StampVideo: (props: unknown) => ReturnType<typeof jsx> };
  const source = readFileSync(new URL('./stamp-video.native.tsx', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => modules[name] });
  const props = { source: 1, posterSource: 2, playing: true, loop: false, muted: true, volume: 0,
    onError: (error: unknown) => errors.push(error) };
  return {
    render() {
      cursor = 0;
      const tree = exports.StampVideo(props);
      effects.splice(0).forEach((effect) => effect());
      return tree;
    },
    finishDownload, errors,
  };
}

test('native stamp keeps the poster until download supplies a local file URI', async () => {
  const video = nativeVideoHarness();
  const waiting = video.render();
  assert.equal(waiting.type, 'View');
  assert.equal(waiting.props.children.type, 'Image');
  assert.equal(waiting.props.children.props.source, 2);
  assert.equal(video.errors.length, 0, 'waiting for the asset must not complete the reveal');
  video.finishDownload({ uri: 'gacha_stamp_reveal', localUri: 'file:///cache/reveal.mp4' });
  await Promise.resolve();
  const playing = video.render();
  assert.equal(playing.type, 'NativeStampVideo');
  assert.equal(playing.props.uri, 'file:///cache/reveal.mp4');
  const error = { code: 'PLAYBACK_FAILED' };
  playing.props.onError({ nativeEvent: error });
  assert.deepEqual(video.errors, [error], 'errors after readiness still allow recovery');
});

test('a download without localUri keeps the poster rather than preparing a bare resource name', async () => {
  const video = nativeVideoHarness();
  video.render();
  video.finishDownload({ uri: 'gacha_stamp_reveal', localUri: null });
  await Promise.resolve();
  assert.equal(video.render().type, 'View');
  assert.equal(video.errors.length, 0);
});

test('a cached local asset can mount the native stamp player immediately', () => {
  const video = nativeVideoHarness('file:///cache/reveal.mp4');
  assert.equal(video.render().type, 'NativeStampVideo');
});
