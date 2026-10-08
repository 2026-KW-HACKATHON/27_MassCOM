const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '../../..');
const mobileRoot = path.join(repoRoot, 'apps/mobile');
const fixtureRoot = __dirname;
const evidenceRoot = path.join(repoRoot, 'docs/evidence/reward-album-2026-10-09');
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
  'expo-router/tabs': fromFixture('src/mocks/expo-router-tabs.ts'),
  'expo-crypto': fromFixture('src/mocks/expo-crypto.ts'),
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
    build.onResolve({ filter: /^@\/auth\/auth-provider$/ }, () => ({ path: fromFixture('src/mocks/auth-provider.ts') }));
    build.onResolve({ filter: /^(expo-router\/tabs|expo-crypto)$/ }, (args) => ({ path: alias[args.path] }));
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
      'process.env': '{}',
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
    banner: { js: 'var global = globalThis;' },
    plugins: [aliasPlugin, reanimatedBabelPlugin],
  });
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.png')) return 'image/png';
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

async function main() {
  if (process.argv.includes('--build-only')) { await buildBundle(); return; }
  if (process.argv.includes('--serve-only')) {
    await buildBundle();
    const server = await serveFixture();
    console.log(`QA fixture: http://127.0.0.1:${server.address().port}`);
    return;
  }
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
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
  report.screenshots = fs.readdirSync(screenshotDir).filter((name) => name.endsWith('.png')).sort().map((name) => path.join(screenshotDir, name));
  report.videos = report.videos.filter(Boolean);
  report.passed = report.assertions.every((entry) => entry.passed) && report.consoleErrors.length === 0;
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
