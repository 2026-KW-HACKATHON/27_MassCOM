const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { createRequire } = require('module');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '../../..');
const mobileRoot = path.join(repoRoot, 'apps/mobile');
const fixtureRoot = __dirname;
const evidenceRoot = path.join(repoRoot, 'docs/evidence/gacha-stamp-2026-10-09');
const screenshotDir = path.join(evidenceRoot, 'screens');
const videoDir = path.join(evidenceRoot, 'videos');
const reportPath = path.join(evidenceRoot, 'browser-qa-report.json');
const bundlePath = path.join(fixtureRoot, 'bundle.js');
const runtimeRequire = createRequire(path.join(repoRoot, 'package.json'));
const mobileRequire = createRequire(path.join(mobileRoot, 'package.json'));
const esbuild = mobileRequire('esbuild');
const babel = mobileRequire('@babel/core');

function fromFixture(...parts) {
  return path.join(fixtureRoot, ...parts);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const alias = {
  '@react-native-async-storage/async-storage': fromFixture('src/mocks/async-storage.ts'),
  'expo-application': fromFixture('src/mocks/expo-application.ts'),
  'expo-audio': fromFixture('src/mocks/expo-audio.ts'),
  'expo-constants': fromFixture('src/mocks/expo-constants.ts'),
  'expo-haptics': fromFixture('src/mocks/expo-haptics.ts'),
  'expo-router': fromFixture('src/mocks/expo-router.ts'),
  'expo-sharing': fromFixture('src/mocks/expo-sharing.ts'),
  'html2canvas': fromFixture('src/mocks/html2canvas.ts'),
  react: mobileRequire.resolve('react'),
  'react-native-web': mobileRequire.resolve('react-native-web'),
  'react/jsx-runtime': mobileRequire.resolve('react/jsx-runtime'),
  'react-dom': mobileRequire.resolve('react-dom'),
  'react-dom/client': mobileRequire.resolve('react-dom/client'),
  'react-native': fromFixture('src/mocks/react-native.ts'),
  'react-native-reanimated': path.join(mobileRoot, 'node_modules/react-native-reanimated/src/index.ts'),
  'react-native-safe-area-context': fromFixture('src/mocks/safe-area-context.tsx'),
  'react-native-svg': path.join(mobileRoot, 'node_modules/react-native-svg/src/index.ts'),
  'react-native-view-shot': fromFixture('src/mocks/react-native-view-shot.ts'),
  'react-native-worklets': path.join(mobileRoot, 'node_modules/react-native-worklets/src/index.ts'),
};

function resolveSource(base) {
  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.jsx'),
    path.join(base, 'index.js'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return found || base;
}

const aliasPlugin = {
  name: 'reward-album-alias',
  setup(build) {
    build.onResolve({ filter: /^@\/sound\/ui-sounds$/ }, () => ({
      path: fromFixture('src/mocks/ui-sounds.ts'),
    }));
    build.onResolve({ filter: /^@\/motion\/use-motion$/ }, () => ({
      path: fromFixture('src/mocks/use-motion.ts'),
    }));
    build.onResolve({ filter: /^@\/assets\// }, (args) => ({
      path: resolveSource(path.join(mobileRoot, 'assets', args.path.slice('@/assets/'.length))),
    }));
    build.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveSource(path.join(mobileRoot, 'src', args.path.slice(2))),
    }));
    build.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom|react-dom\/client|react-native|react-native-web|react-native-reanimated|react-native-safe-area-context|react-native-svg|react-native-worklets|expo-router|expo-application|expo-audio|expo-constants|expo-haptics|expo-sharing|html2canvas|react-native-view-shot|@react-native-async-storage\/async-storage)$/ }, (args) => {
      const target = alias[args.path];
      return target ? { path: target } : undefined;
    });
  },
};

const reanimatedBabelPlugin = {
  name: 'reward-album-reanimated-babel',
  setup(build) {
    const includeRoot = `${mobileRoot}${path.sep}src${path.sep}`;
    const includeFixture = `${fixtureRoot}${path.sep}src${path.sep}`;
    build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
      if (!args.path.startsWith(includeRoot) && !args.path.startsWith(includeFixture)) return undefined;
      const source = await fs.promises.readFile(args.path, 'utf8');
      const result = await babel.transformAsync(source, {
        filename: args.path,
        babelrc: false,
        configFile: false,
        presets: [[mobileRequire.resolve('@babel/preset-typescript'), {
          isTSX: args.path.endsWith('.tsx') || args.path.endsWith('.jsx'),
          allExtensions: true,
        }]],
        plugins: [
          [mobileRequire.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }],
          mobileRequire.resolve('react-native-reanimated/plugin'),
        ],
        sourceMaps: false,
      });
      return {
        contents: result?.code || source,
        loader: 'js',
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

const videoAssetPlugin = {
  name: 'reward-album-video-assets',
  setup(build) {
    build.onLoad({ filter: /\.mp4$/ }, async (args) => {
      const targetName = path.basename(args.path);
      return {
        contents: `module.exports = ${JSON.stringify(`/qa-video-assets/${targetName}`)};`,
        loader: 'js',
      };
    });
  },
};

async function buildBundle() {
  await esbuild.build({
    entryPoints: [fromFixture('src/main.tsx')],
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    sourcemap: false,
    absWorkingDir: fixtureRoot,
    define: {
      'process.env.NODE_ENV': '"development"',
      'process.env.JEST_WORKER_ID': 'undefined',
      __DEV__: 'true',
    },
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.webp': 'dataurl',
      '.wav': 'dataurl',
      '.mp3': 'dataurl',
      '.svg': 'dataurl',
    },
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
    banner: { js: 'var global = globalThis; var process = globalThis.process || { env: { NODE_ENV: "development" } };' },
    plugins: [aliasPlugin, reanimatedBabelPlugin, videoAssetPlugin],
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function serveFixture() {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (requestPath === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (requestPath.startsWith('/qa-video-assets/')) {
      const localVideo = path.normalize(path.join(mobileRoot, 'assets/videos', path.basename(requestPath)));
      if (!localVideo.startsWith(path.join(mobileRoot, 'assets/videos'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.stat(localVideo, (error, stat) => {
        if (error) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const range = req.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (match) {
            const start = match[1] ? Number.parseInt(match[1], 10) : 0;
            const end = match[2] ? Number.parseInt(match[2], 10) : stat.size - 1;
            if (Number.isFinite(start) && Number.isFinite(end) && start <= end && end < stat.size) {
              res.writeHead(206, {
                'accept-ranges': 'bytes',
                'content-type': contentType(localVideo),
                'content-length': String(end - start + 1),
                'content-range': `bytes ${start}-${end}/${stat.size}`,
              });
              fs.createReadStream(localVideo, { start, end }).pipe(res);
              return;
            }
          }
          res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
          res.end();
          return;
        }
        res.writeHead(200, {
          'accept-ranges': 'bytes',
          'content-type': contentType(localVideo),
          'content-length': String(stat.size),
        });
        fs.createReadStream(localVideo).pipe(res);
      });
      return;
    }
    const normalized = requestPath === '/' ? '/index.html' : requestPath;
    const local = path.normalize(path.join(fixtureRoot, normalized));
    if (!local.startsWith(fixtureRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(local, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(local) });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function openPage(browser, baseUrl, scenario, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 390, height: 844 },
    colorScheme: options.colorScheme || 'light',
    reducedMotion: options.reducedMotion || 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const params = new URLSearchParams({ scenario });
  if (options.fontScale) params.set('fontScale', String(options.fontScale));
  if (options.sound) params.set('sound', options.sound);
  if (options.strict) params.set('strict', '1');
  await page.goto(`${baseUrl}/?${params.toString()}`, { waitUntil: 'networkidle' });
  if (options.largeText) {
    await page.evaluate(() => {
      document.querySelectorAll('.css-text-146c3p1, h1, [dir="auto"]').forEach((node) => {
        const element = node;
        const fontSize = Number.parseFloat(element.style.fontSize || getComputedStyle(element).fontSize);
        const lineHeight = Number.parseFloat(element.style.lineHeight || getComputedStyle(element).lineHeight);
        if (Number.isFinite(fontSize)) element.style.fontSize = `${fontSize * 2}px`;
        if (Number.isFinite(lineHeight)) element.style.lineHeight = `${lineHeight * 2}px`;
      });
    });
  }
  return { context, page, errors };
}

async function stampVideos(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('video')).map((video, index) => ({
    index,
    src: video.currentSrc || video.src,
    poster: video.poster.startsWith('data:') ? 'data-url-poster' : video.poster,
    loop: video.loop,
    muted: video.muted,
    volume: video.volume,
    paused: video.paused,
    ended: video.ended,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    readyState: video.readyState,
    networkState: video.networkState,
    rect: (() => {
      const rect = video.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
    })(),
  })));
}

async function pageLayoutHealth(page) {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('[role="button"], button')).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') || element.textContent?.trim() || '',
        disabled: element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled'),
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      };
    });
    return {
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      unreachableButtons: buttons.filter((button) => button.rect.width > 0 && button.rect.height > 0 && (
        button.rect.right < 0 || button.rect.left > window.innerWidth || button.rect.bottom < 0 || button.rect.top > document.documentElement.scrollHeight
      )),
      visibleButtons: buttons.filter((button) => button.rect.width > 0 && button.rect.height > 0).length,
    };
  });
}

function pushVideoAssertion(report, name, videos, predicate) {
  report.assertions.push({ name, passed: predicate(videos), videos });
}


async function captureRevealBurstPeak(page, fileName) {
  const state = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return { found: false };
    const targetTime = 2.417;
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        const timeout = window.setTimeout(resolve, 1200);
        video.addEventListener('loadedmetadata', () => {
          window.clearTimeout(timeout);
          resolve(undefined);
        }, { once: true });
      });
    }
    video.autoplay = false;
    video.removeAttribute('autoplay');
    video.pause();
    let seekError = null;
    try {
      if (typeof video.fastSeek === 'function') {
        video.fastSeek(targetTime);
      } else {
        video.currentTime = targetTime;
      }
    } catch (error) {
      seekError = error instanceof Error ? error.message : 'seek-error';
    }
    const start = performance.now();
    let reachedTarget = false;
    while (performance.now() - start < 2200) {
      if (Math.abs(video.currentTime - targetTime) <= 0.22) {
        reachedTarget = true;
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      video.autoplay = false;
      video.removeAttribute('autoplay');
      video.pause();
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      if (video.paused) break;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      found: true,
      targetTime,
      reachedTarget,
      seekError,
      currentTime: video.currentTime,
      paused: video.paused,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      src: video.currentSrc || video.src,
    };
  });
  await page.screenshot({ path: path.join(screenshotDir, fileName), fullPage: true });
  return state;
}

function videoAssetManifest() {
  return ['gacha-stamp-idle.mp4', 'gacha-stamp-reveal.mp4'].map((name) => {
    const file = path.join(mobileRoot, 'assets/videos', name);
    const data = fs.readFileSync(file);
    return {
      name,
      path: path.relative(repoRoot, file).replace(/\\/g, '/'),
      bytes: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
    };
  });
}

async function visibleRegistrationSlots(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('section[role="region"]')).filter((element) => {
    const opacity = Number.parseFloat(getComputedStyle(element).opacity || '1');
    const rect = element.getBoundingClientRect();
    return opacity > 0.05 && rect.width > 0 && rect.height > 0;
  }).length);
}

async function albumLayoutHealth(page) {
  return page.evaluate(() => {
    const tolerance = 1.5;
    const cards = Array.from(document.querySelectorAll('section[role="region"]'))
      .map((element, index) => ({ element, index, rect: element.getBoundingClientRect(), opacity: Number.parseFloat(getComputedStyle(element).opacity || '1') }))
      .filter((entry) => entry.opacity > 0.05 && entry.rect.width > 0 && entry.rect.height > 0);
    const textOverflows = cards.flatMap(({ element, index, rect }) => Array.from(element.querySelectorAll('[dir="auto"]'))
      .filter((text) => (text.textContent || '').trim().length > 0)
      .map((text) => ({ text: (text.textContent || '').trim().slice(0, 60), rect: text.getBoundingClientRect() }))
      .filter((entry) => entry.rect.bottom > rect.bottom + tolerance || entry.rect.right > rect.right + tolerance || entry.rect.left < rect.left - tolerance)
      .map((entry) => ({ cardIndex: index, text: entry.text, textBottom: entry.rect.bottom, cardBottom: rect.bottom, textRight: entry.rect.right, cardRight: rect.right })));
    const overlaps = [];
    for (let i = 0; i < cards.length; i += 1) {
      for (let j = i + 1; j < cards.length; j += 1) {
        const a = cards[i].rect;
        const b = cards[j].rect;
        const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (xOverlap > tolerance && yOverlap > tolerance) overlaps.push({ first: cards[i].index, second: cards[j].index, xOverlap, yOverlap });
      }
    }
    return {
      cardCount: cards.length,
      textOverflows,
      overlaps,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

function pushAlbumLayoutAssertion(report, name, health) {
  report.assertions.push({
    name,
    passed: health.cardCount > 0 && health.textOverflows.length === 0 && health.overlaps.length === 0 && health.horizontalOverflow <= 1,
    ...health,
  });
}

async function startRegistrationAnimationSampler(page) {
  await page.evaluate(() => {
    window.__rewardAlbumRegistrationSamples = [];
    window.__rewardAlbumRegistrationSamplePromise = new Promise((resolve) => {
      const start = performance.now();
      const sample = () => {
        const elapsedMs = performance.now() - start;
        const cards = Array.from(document.querySelectorAll('section[role="region"]')).map((element, index) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          let scale = 1;
          const matrix = style.transform.match(/^matrix\(([^)]+)\)$/);
          if (matrix) {
            const parts = matrix[1].split(',').map((part) => Number.parseFloat(part.trim()));
            if (Number.isFinite(parts[0]) && Number.isFinite(parts[1])) scale = Math.sqrt(parts[0] * parts[0] + parts[1] * parts[1]);
          }
          return { index, opacity: Number.parseFloat(style.opacity || '1'), scale, top: rect.top, width: rect.width, height: rect.height };
        }).filter((card) => card.width > 0 && card.height > 0);
        window.__rewardAlbumRegistrationSamples.push({ elapsedMs, cards });
        if (elapsedMs >= 1000) {
          resolve(window.__rewardAlbumRegistrationSamples);
        } else {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });
  });
}

async function finishRegistrationAnimationSampler(page) {
  const samples = await page.evaluate(() => window.__rewardAlbumRegistrationSamplePromise);
  const cardSamples = samples.flatMap((sample) => sample.cards.map((card) => ({ elapsedMs: sample.elapsedMs, ...card })));
  const targetIndex = cardSamples.reduce((best, current) => {
    if (!best) return current.index;
    const bestCount = cardSamples.filter((entry) => entry.index === best).length;
    const currentCount = cardSamples.filter((entry) => entry.index === current.index).length;
    return currentCount > bestCount ? current.index : best;
  }, undefined);
  const target = cardSamples.filter((entry) => entry.index === targetIndex);
  const roundedScales = new Set(target.map((entry) => Math.round(entry.scale * 100) / 100));
  const roundedOpacities = new Set(target.map((entry) => Math.round(entry.opacity * 100) / 100));
  const final = target[target.length - 1];
  return {
    sampleCount: samples.length,
    cardSampleCount: target.length,
    distinctScaleCount: roundedScales.size,
    distinctOpacityCount: roundedOpacities.size,
    minScale: target.length ? Math.min(...target.map((entry) => entry.scale)) : null,
    maxScale: target.length ? Math.max(...target.map((entry) => entry.scale)) : null,
    minOpacity: target.length ? Math.min(...target.map((entry) => entry.opacity)) : null,
    maxOpacity: target.length ? Math.max(...target.map((entry) => entry.opacity)) : null,
    finalOpacity: final?.opacity ?? null,
    finalScale: final?.scale ?? null,
  };
}

async function albumCases(browser, baseUrl, report) {
  const entry = await openPage(browser, baseUrl, 'album');
  await entry.page.getByText('도감 등록 확인').waitFor();
  await entry.page.waitForTimeout(90);
  await entry.page.screenshot({ path: path.join(screenshotDir, 'album-390-after-mount.png'), fullPage: true });
  await entry.page.waitForTimeout(650);
  await entry.page.screenshot({ path: path.join(screenshotDir, 'album-390-settled.png'), fullPage: true });
  const settledSlots = await visibleRegistrationSlots(entry.page);
  report.assertions.push({ name: 'album settled frame has visible registration slots', passed: settledSlots >= 3, visibleSlots: settledSlots });
  await entry.page.getByRole('button', { name: '연출 건너뛰기' }).click();
  await entry.page.getByText('도감 등록 확인').waitFor();
  const stillVisible = await entry.page.getByText('도감 등록 확인').isVisible();
  await entry.page.screenshot({ path: path.join(screenshotDir, 'album-390-skip-holds.png'), fullPage: true });
  report.assertions.push({ name: 'album skip keeps registration screen visible', passed: stillVisible });
  await entry.context.close();
  report.consoleErrors.push(...entry.errors);

  const narrow = await openPage(browser, baseUrl, 'album', { viewport: { width: 320, height: 844 } });
  await narrow.page.getByText('도감 등록 확인').waitFor();
  await narrow.page.waitForTimeout(800);
  await narrow.page.screenshot({ path: path.join(screenshotDir, 'album-320-narrow.png'), fullPage: true });
  pushAlbumLayoutAssertion(report, '320 narrow album cards do not overlap or overflow', await albumLayoutHealth(narrow.page));
  await narrow.context.close();
  report.consoleErrors.push(...narrow.errors);

  const dark = await openPage(browser, baseUrl, 'album', { colorScheme: 'dark' });
  await dark.page.getByText('도감 등록 확인').waitFor();
  await dark.page.waitForTimeout(800);
  await dark.page.screenshot({ path: path.join(screenshotDir, 'album-390-dark.png'), fullPage: true });
  await dark.context.close();
  report.consoleErrors.push(...dark.errors);

  const largeText = await openPage(browser, baseUrl, 'album', { largeText: true, fontScale: 2 });
  await largeText.page.getByText('도감 등록 확인').waitFor();
  await largeText.page.waitForTimeout(800);
  const largeScrollHeight = await largeText.page.evaluate(() => document.documentElement.scrollHeight);
  await largeText.page.screenshot({ path: path.join(screenshotDir, 'album-390-font-200.png'), fullPage: false });
  report.assertions.push({ name: '200 percent font page remains scrollable', passed: largeScrollHeight > 844, scrollHeight: largeScrollHeight });
  pushAlbumLayoutAssertion(report, '200 percent font album cards do not overlap or overflow', await albumLayoutHealth(largeText.page));
  await largeText.context.close();
  report.consoleErrors.push(...largeText.errors);

  const reduced = await openPage(browser, baseUrl, 'album', { reducedMotion: 'reduce' });
  await reduced.page.getByText('도감 등록 확인').waitFor();
  await reduced.page.waitForTimeout(120);
  await reduced.page.screenshot({ path: path.join(screenshotDir, 'album-390-reduced-motion.png'), fullPage: true });
  await reduced.context.close();
  report.consoleErrors.push(...reduced.errors);
}

async function gradeCase(browser, baseUrl, report) {
  const grade = await openPage(browser, baseUrl, 'grade');
  await grade.page.getByText(/우표를 여는 중|이번 뽑기 결과/).waitFor({ timeout: 5000 });
  if (await grade.page.getByRole('button', { name: '연출 건너뛰기' }).isVisible().catch(() => false)) {
    await grade.page.getByRole('button', { name: '연출 건너뛰기' }).click();
  }
  await grade.page.getByText('이번 뽑기 결과').waitFor({ timeout: 5000 });
  await grade.page.screenshot({ path: path.join(screenshotDir, 'grade-result.png'), fullPage: true });
  await startRegistrationAnimationSampler(grade.page);
  await grade.page.getByRole('button', { name: '도감 등록 확인' }).click();
  await grade.page.getByText('도감 등록 확인').waitFor();
  await grade.page.waitForTimeout(500);
  await grade.page.screenshot({ path: path.join(screenshotDir, 'grade-registration.png'), fullPage: true });
  const animationSample = await finishRegistrationAnimationSampler(grade.page);
  report.assertions.push({
    name: 'grade registration animates from hidden/small to settled',
    passed: animationSample.cardSampleCount > 2 && animationSample.distinctScaleCount > 1 && animationSample.distinctOpacityCount > 1 && animationSample.finalOpacity !== null && animationSample.finalOpacity >= 0.99,
    ...animationSample,
  });
  const visibleGradeSlots = await visibleRegistrationSlots(grade.page);
  report.assertions.push({ name: 'grade registration settled frame has visible slot', passed: visibleGradeSlots >= 1, visibleSlots: visibleGradeSlots });
  await grade.page.getByRole('button', { name: '연출 건너뛰기' }).click();
  const held = await grade.page.getByText('도감 등록 확인').isVisible();
  await grade.page.screenshot({ path: path.join(screenshotDir, 'grade-skip-holds.png'), fullPage: true });
  report.assertions.push({ name: 'grade skip keeps registration screen visible', passed: held });
  await grade.context.close();
  report.consoleErrors.push(...grade.errors);
}

async function gradeDelayedCase(browser, baseUrl, report) {
  const grade = await openPage(browser, baseUrl, 'grade-delayed');
  await grade.page.getByText('골드 전체 랜덤').waitFor({ timeout: 5000 });
  await grade.page.waitForTimeout(350);
  const idleVideos = await stampVideos(grade.page);
  pushVideoAssertion(report, 'grade detail uses a real muted looping idle stamp mp4', idleVideos, (videos) => (
    videos.length === 1 && videos[0].src.includes('.mp4') && videos[0].loop && videos[0].muted && videos[0].rect.width > 250 && videos[0].rect.height >= 250
  ));
  await grade.page.screenshot({ path: path.join(screenshotDir, 'stamp-grade-idle-video.png'), fullPage: true });
  await grade.page.getByRole('button', { name: '500 마일리지로 뽑기' }).first().click();
  await grade.page.getByText('뽑기 결과 확인 중…').waitFor({ timeout: 3000 });
  const pendingState = await grade.page.evaluate(() => ({ drawCalls: window.__qaDrawCalls ?? 0, hasResult: document.body.textContent?.includes('이번 뽑기 결과') ?? false }));
  report.assertions.push({ name: 'grade draw calls purchase once and stays pending until the delayed result arrives', passed: pendingState.drawCalls === 1 && !pendingState.hasResult, ...pendingState });
  await grade.page.getByText('우표를 여는 중…').waitFor({ timeout: 5000 });
  const openingVideos = await stampVideos(grade.page);
  pushVideoAssertion(report, 'grade opening swaps to a non-looping reveal stamp mp4 with sound enabled', openingVideos, (videos) => (
    videos.length === 1 && videos[0].src.includes('.mp4') && !videos[0].loop && !videos[0].muted && videos[0].volume > 0.5
  ));
  await grade.page.screenshot({ path: path.join(screenshotDir, 'stamp-grade-opening-video.png'), fullPage: true });
  await grade.page.getByRole('button', { name: '연출 건너뛰기' }).click();
  await grade.page.getByText('이번 뽑기 결과').waitFor({ timeout: 5000 });
  await grade.page.screenshot({ path: path.join(screenshotDir, 'stamp-grade-result-after-opening.png'), fullPage: true });
  await grade.page.getByRole('button', { name: '도감 등록 확인' }).click();
  await grade.page.getByText('도감 등록 확인').waitFor();
  const registered = await visibleRegistrationSlots(grade.page);
  report.assertions.push({ name: 'grade stamp result still opens registration album', passed: registered >= 1, visibleSlots: registered });
  await grade.context.close();
  report.consoleErrors.push(...grade.errors);
}

async function gachaCase(browser, baseUrl, report) {
  const gacha = await openPage(browser, baseUrl, 'gacha');
  await gacha.page.getByText('다음 보상 보기').waitFor({ timeout: 7000 });
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'gacha-reward-1-mileage.png'), fullPage: true });
  await gacha.page.getByRole('button', { name: '다음 보상 보기' }).click();
  await gacha.page.getByText('아바타 옷').waitFor();
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'gacha-reward-2-clothing.png'), fullPage: true });
  await gacha.page.getByRole('button', { name: '다음 보상 보기' }).click();
  await gacha.page.getByText('새 친구').waitFor();
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'gacha-reward-3-character.png'), fullPage: true });
  await gacha.page.getByRole('button', { name: '최종 결과 보기' }).click();
  await gacha.page.getByText('최종 결과').waitFor();
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'gacha-result-summary.png'), fullPage: true });
  await gacha.page.getByRole('button', { name: '도감 등록 확인' }).click();
  await gacha.page.getByText('도감 등록 확인').waitFor();
  await gacha.page.waitForTimeout(500);
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'gacha-registration.png'), fullPage: true });
  const visibleGachaSlots = await visibleRegistrationSlots(gacha.page);
  report.assertions.push({ name: 'gacha registration settled frame has visible slots', passed: visibleGachaSlots >= 2, visibleSlots: visibleGachaSlots });
  await gacha.context.close();
  report.consoleErrors.push(...gacha.errors);
}

async function gachaDelayedCase(browser, baseUrl, report) {
  const gacha = await openPage(browser, baseUrl, 'gacha-delayed', { viewport: { width: 390, height: 844 } });
  await gacha.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
  const idleVideos = await stampVideos(gacha.page);
  pushVideoAssertion(report, 'legacy gacha detail uses a real muted looping idle stamp mp4', idleVideos, (videos) => (
    videos.length === 1 && videos[0].src.includes('.mp4') && videos[0].loop && videos[0].muted
  ));
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'stamp-gacha-idle-video.png'), fullPage: true });
  await gacha.page.getByRole('button', { name: '500 마일리지', exact: true }).click();
  await gacha.page.getByText('친구를 만나러 가는 중…').waitFor({ timeout: 3000 });
  const pendingState = await gacha.page.evaluate(() => ({ drawCalls: window.__qaDrawCalls ?? 0, hasReward: document.body.textContent?.includes('보상을 하나씩 열어요') ?? false }));
  report.assertions.push({ name: 'legacy gacha purchase calls draw once and holds pending before result', passed: pendingState.drawCalls === 1 && !pendingState.hasReward, ...pendingState });
  await gacha.page.getByText('두근두근, 누가 나올까요?').waitFor({ timeout: 5000 });
  const openingVideos = await stampVideos(gacha.page);
  pushVideoAssertion(report, 'legacy gacha opening uses a non-looping reveal stamp mp4 with sound enabled', openingVideos, (videos) => (
    videos.length === 1 && videos[0].src.includes('.mp4') && !videos[0].loop && !videos[0].muted && videos[0].volume > 0.5
  ));
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'stamp-gacha-opening-video.png'), fullPage: true });
  const burstPeak = await captureRevealBurstPeak(gacha.page, 'stamp-gacha-opening-burst-peak.png');
  report.assertions.push({
    name: 'legacy gacha reveal burst peak can be captured by seeking the real mp4 without completing the flow',
    passed: burstPeak.found === true && burstPeak.paused === true && burstPeak.reachedTarget === true,
    note: 'Visual capture only: this seek/pause screenshot is separate from the real playback completion path.',
    ...burstPeak,
  });
  await gacha.page.getByRole('button', { name: '건너뛰기' }).click();
  await gacha.page.getByText('보상을 하나씩 열어요').waitFor({ timeout: 5000 });
  await gacha.page.screenshot({ path: path.join(screenshotDir, 'stamp-gacha-reward-after-opening.png'), fullPage: true });
  await gacha.context.close();
  report.consoleErrors.push(...gacha.errors);
}


async function stampStrictModeGachaDelayedCase(browser, baseUrl, report) {
  const entry = await openPage(browser, baseUrl, 'gacha-delayed', { strict: true });
  await entry.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
  await entry.page.getByRole('button', { name: '500 마일리지', exact: true }).click();
  await entry.page.getByText('두근두근, 누가 나올까요?').waitFor({ timeout: 5000 });
  await entry.page.waitForTimeout(450);
  const state = await entry.page.evaluate(() => ({
    drawCalls: window.__qaDrawCalls ?? 0,
    hasOpeningCopy: document.body.textContent?.includes('두근두근, 누가 나올까요?') ?? false,
    hasReward: document.body.textContent?.includes('보상을 하나씩 열어요') ?? false,
    videos: Array.from(document.querySelectorAll('video')).map((video) => ({
      src: video.currentSrc || video.src,
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      loop: video.loop,
    })),
  }));
  report.assertions.push({
    name: 'StrictMode effect replay does not skip the gacha reveal video immediately after the delayed result arrives',
    passed: state.drawCalls === 1 && state.hasOpeningCopy && !state.hasReward && state.videos.length === 1 && !state.videos[0].loop,
    ...state,
  });
  await entry.context.close();
  report.consoleErrors.push(...entry.errors);
}

async function stampStrictModeGradeDelayedCase(browser, baseUrl, report) {
  const entry = await openPage(browser, baseUrl, 'grade-delayed', { strict: true });
  await entry.page.getByText('골드 전체 랜덤').waitFor({ timeout: 5000 });
  await entry.page.getByRole('button', { name: '500 마일리지로 뽑기' }).first().click();
  await entry.page.getByText('우표를 여는 중…').waitFor({ timeout: 5000 });
  await entry.page.waitForTimeout(450);
  const state = await entry.page.evaluate(() => ({
    drawCalls: window.__qaDrawCalls ?? 0,
    hasOpeningCopy: document.body.textContent?.includes('우표를 여는 중') ?? false,
    hasResult: document.body.textContent?.includes('이번 뽑기 결과') ?? false,
    videos: Array.from(document.querySelectorAll('video')).map((video) => ({
      src: video.currentSrc || video.src,
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      loop: video.loop,
    })),
  }));
  report.assertions.push({
    name: 'StrictMode effect replay does not skip the grade reveal video immediately after the delayed result arrives',
    passed: state.drawCalls === 1 && state.hasOpeningCopy && !state.hasResult && state.videos.length === 1 && !state.videos[0].loop,
    ...state,
  });
  await entry.context.close();
  report.consoleErrors.push(...entry.errors);
}

async function stampStrictModeInitialGradeCase(browser, baseUrl, report) {
  const entry = await openPage(browser, baseUrl, 'grade', { strict: true });
  await entry.page.getByText(/우표를 여는 중|이번 뽑기 결과/).waitFor({ timeout: 5000 });
  await entry.page.waitForTimeout(450);
  const state = await entry.page.evaluate(() => ({
    hasOpeningCopy: document.body.textContent?.includes('우표를 여는 중') ?? false,
    hasResult: document.body.textContent?.includes('이번 뽑기 결과') ?? false,
    videos: Array.from(document.querySelectorAll('video')).map((video) => ({
      src: video.currentSrc || video.src,
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      loop: video.loop,
    })),
  }));
  report.assertions.push({
    name: 'StrictMode initial grade result enters reveal video instead of skipping straight to result',
    passed: state.hasOpeningCopy && !state.hasResult && state.videos.length === 1 && !state.videos[0].loop,
    ...state,
  });
  await entry.context.close();
  report.consoleErrors.push(...entry.errors);
}

async function stampReducedMotionCase(browser, baseUrl, report) {
  const reduced = await openPage(browser, baseUrl, 'gacha-delayed', { reducedMotion: 'reduce' });
  await reduced.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
  const idleVideos = await stampVideos(reduced.page);
  report.assertions.push({ name: 'reduced motion detail renders poster instead of autoplaying idle video', passed: idleVideos.length === 0, videoCount: idleVideos.length });
  await reduced.page.getByRole('button', { name: '500 마일리지', exact: true }).click();
  await reduced.page.getByText('보상을 하나씩 열어요').waitFor({ timeout: 5000 });
  const openingVideos = await stampVideos(reduced.page);
  report.assertions.push({ name: 'reduced motion skips opening video and advances after result', passed: openingVideos.length === 0, videoCount: openingVideos.length });
  await reduced.page.screenshot({ path: path.join(screenshotDir, 'stamp-gacha-reduced-motion.png'), fullPage: true });
  await reduced.context.close();
  report.consoleErrors.push(...reduced.errors);
}

async function stampMutedCase(browser, baseUrl, report) {
  const muted = await openPage(browser, baseUrl, 'gacha-delayed', { sound: 'off' });
  await muted.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
  await muted.page.getByRole('button', { name: '500 마일리지', exact: true }).click();
  await muted.page.getByText('두근두근, 누가 나올까요?').waitFor({ timeout: 5000 });
  const videos = await stampVideos(muted.page);
  const soundEvents = await muted.page.evaluate(() => window.__qaSoundEvents ?? []);
  report.assertions.push({ name: 'sound-off setting keeps reveal video muted and records no UI sound calls before reveal reward', passed: videos.length === 1 && videos[0].muted && videos[0].volume === 0 && soundEvents.length === 0, videos, soundEvents });
  await muted.context.close();
  report.consoleErrors.push(...muted.errors);
}

async function stampFallbackCase(browser, baseUrl, report) {
  const failed = await openPage(browser, baseUrl, 'grade-error');
  await failed.page.getByText('골드 전체 랜덤').waitFor({ timeout: 5000 });
  await failed.page.getByRole('button', { name: '500 마일리지로 뽑기' }).first().click();
  await failed.page.getByText('골드 전체 랜덤').waitFor({ timeout: 5000 });
  const state = await failed.page.evaluate(() => ({ drawCalls: window.__qaDrawCalls ?? 0, hasPending: document.body.textContent?.includes('뽑기 결과 확인 중') ?? false }));
  report.assertions.push({ name: 'failed draw returns to detail without hanging pending', passed: state.drawCalls === 1 && !state.hasPending, ...state });
  await failed.context.close();
  report.consoleErrors.push(...failed.errors);
}

async function stampUnmountCase(browser, baseUrl, report) {
  const entry = await openPage(browser, baseUrl, 'gacha-delayed');
  await entry.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
  await entry.page.getByRole('button', { name: '500 마일리지', exact: true }).click();
  await entry.page.getByText('두근두근, 누가 나올까요?').waitFor({ timeout: 5000 });
  await entry.page.evaluate(() => {
    window.__qaDetachedVideo = document.querySelector('video');
    window.dispatchEvent(new CustomEvent('qa:set-scenario', { detail: 'album' }));
  });
  await entry.page.getByText('도감 등록 확인').waitFor({ timeout: 5000 });
  const state = await entry.page.evaluate(() => ({
    videoCount: document.querySelectorAll('video').length,
    detachedExists: Boolean(window.__qaDetachedVideo),
    detachedConnected: window.__qaDetachedVideo?.isConnected ?? null,
    detachedPaused: window.__qaDetachedVideo?.paused ?? null,
    detachedCurrentTime: window.__qaDetachedVideo?.currentTime ?? null,
  }));
  report.assertions.push({
    name: 'leaving the draw screen unmounts and pauses the detached stamp video element',
    passed: state.videoCount === 0 && state.detachedExists && state.detachedConnected === false && state.detachedPaused === true,
    ...state,
  });
  await entry.context.close();
  report.consoleErrors.push(...entry.errors);
}

async function stampViewportCases(browser, baseUrl, report) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    const entry = await openPage(browser, baseUrl, 'gacha-delayed', { viewport });
    await entry.page.getByText('골드 재뽑기권').waitFor({ timeout: 5000 });
    await entry.page.waitForTimeout(150);
    const health = await pageLayoutHealth(entry.page);
    const videos = await stampVideos(entry.page);
    const purchase = entry.page.getByRole('button', { name: '500 마일리지', exact: true });
    await purchase.scrollIntoViewIfNeeded();
    const purchaseRect = await purchase.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    report.assertions.push({
      name: `${viewport.width}x${viewport.height} stamp draw detail has no horizontal overflow and reachable controls`,
      passed: health.horizontalOverflow <= 1 && health.visibleButtons > 0 && purchaseRect.top >= 0 && purchaseRect.bottom <= viewport.height + 1 && videos.length === 1 && videos[0].rect.right <= viewport.width + 1,
      viewport,
      health,
      purchaseRect,
      videos,
    });
    await entry.page.screenshot({ path: path.join(screenshotDir, `stamp-gacha-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await entry.context.close();
    report.consoleErrors.push(...entry.errors);
  }
}

async function main() {
  ensureDir(screenshotDir);
  for (const name of fs.readdirSync(screenshotDir)) if (name.endsWith('.png')) fs.rmSync(path.join(screenshotDir, name));
  ensureDir(videoDir);
  await buildBundle();
  const server = await serveFixture();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let playwright;
  try {
    playwright = runtimeRequire('playwright');
  } catch {
    playwright = require(path.join('C:/Users/hellt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules', 'playwright'));
  }
  const executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await playwright.chromium.launch({
    executablePath: fs.existsSync(executablePath) ? executablePath : undefined,
    headless: true,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: pathToFileURL(fixtureRoot).href,
    baseUrl,
    videoAssets: videoAssetManifest(),
    screenshots: [],
    videos: [],
    assertions: [],
    consoleErrors: [],
    aliases: Object.entries(alias).filter(([, value]) => value).map(([key, value]) => ({ module: key, target: value })).sort((a, b) => a.module.localeCompare(b.module)),
    mockedBoundaries: Object.entries(alias).filter(([, value]) => typeof value === 'string' && value.includes(`${path.sep}src${path.sep}mocks${path.sep}`))
      .map(([key]) => key).sort(),
    limits: [
      'Playwright video recording was skipped because the local sandbox lacks the ffmpeg sidecar; screenshot sequences cover the same flows.',
      'This run uses the real Reanimated, Worklets, and react-native-svg web-capable source paths with the local Reanimated Babel plugin.',
      'Large text uses a fixture React Native adapter that overrides only useWindowDimensions().fontScale from the query string, plus doubled web text styles for screenshot readability; Android OS font-scale behavior remains native QA.',
    ],
  };
  try {
    await albumCases(browser, baseUrl, report);
    await gradeCase(browser, baseUrl, report);
    await gachaCase(browser, baseUrl, report);
    await gradeDelayedCase(browser, baseUrl, report);
    await gachaDelayedCase(browser, baseUrl, report);
    await stampStrictModeGachaDelayedCase(browser, baseUrl, report);
    await stampStrictModeGradeDelayedCase(browser, baseUrl, report);
    await stampStrictModeInitialGradeCase(browser, baseUrl, report);
    await stampReducedMotionCase(browser, baseUrl, report);
    await stampMutedCase(browser, baseUrl, report);
    await stampFallbackCase(browser, baseUrl, report);
    await stampUnmountCase(browser, baseUrl, report);
    await stampViewportCases(browser, baseUrl, report);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
  report.screenshots = fs.readdirSync(screenshotDir).filter((name) => name.endsWith('.png')).sort().map((name) => path.join(screenshotDir, name));
  report.videos = report.videos.filter(Boolean);
  report.passed = report.assertions.every((entry) => entry.passed) && report.consoleErrors.length === 0;
  const visualVerdict = {
    generatedAt: report.generatedAt,
    target: 'gacha stamp browser QA',
    verdict: report.passed ? 'PASS' : 'FAIL',
    checkedScreenshots: report.screenshots,
    failedAssertions: report.assertions.filter((entry) => !entry.passed).map((entry) => entry.name),
    consoleErrors: report.consoleErrors,
  };
  fs.writeFileSync(path.join(evidenceRoot, 'visual-verdict.json'), `${JSON.stringify(visualVerdict, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
