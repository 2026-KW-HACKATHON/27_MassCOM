import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/showcase-web');
const expected = {
  light: { '--paper': '#ffffff', '--surface': '#f5f7fa', '--ink': '#192331', '--muted': '#58677d', '--stream': '#2456d6', '--moon': '#ebf1ff', '--night': '#2456d6', '--focus': '#2456d6' },
  dark: { '--paper': '#14171d', '--surface': '#20252f', '--ink': '#f3f5f9', '--muted': '#a6b0c0', '--stream': '#9bb8ff', '--moon': '#25334f', '--night': '#25334f', '--focus': '#9bb8ff' },
};

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

test('시연 웹의 실제 라이트·다크 계산 색과 주요 글자 대비', async () => {
  assert.ok(existsSync(chromePath), `Chrome 실행 파일 필요: ${chromePath}`);
  const profile = mkdtempSync(join(tmpdir(), 'masscom-showcase-chrome-'));
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    const asset = request.url === '/' ? 'index.html' : request.url === '/assets/showcase.css?v=20260924' ? 'assets/showcase.css' : null;
    if (!asset) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', asset.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    response.end(readFileSync(join(siteRoot, asset)));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pageUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeExit;
  let chromeSpawnError;
  let chromeStderr = '';
  chrome.on('exit', (code, signal) => { chromeExit = { code, signal }; });
  chrome.on('error', (error) => { chromeSpawnError = error; });
  chrome.stderr?.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-2048); });
  let socket;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile) && !chromeExit && !chromeSpawnError; i++) await delay(100);
    const startupDetails = [
      chromeSpawnError?.message,
      chromeExit ? `exit=${chromeExit.code} signal=${chromeExit.signal}` : 'process still running',
      chromeStderr.trim() ? `stderr=${chromeStderr.trim()}` : '',
    ].filter(Boolean).join('; ');
    assert.ok(existsSync(portFile), `Chrome DevTools 시작 실패: ${startupDetails}`);
    const port = readFileSync(portFile, 'utf8').split('\n')[0];
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = pages.find((entry) => entry.type === 'page');
    assert.ok(page, 'Chrome 페이지 없음');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (!pending.has(message.id)) return;
      const { done, fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message)); else done(message.result);
    });
    const send = (method, params = {}) => new Promise((done, fail) => {
      const nextId = ++id;
      pending.set(nextId, { done, fail });
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
    let loaded = false;
    for (let i = 0; i < 100 && !loaded; i++) {
      const result = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('.demo-ribbon') && !!getComputedStyle(document.documentElement).getPropertyValue('--ink')", returnByValue: true });
      loaded = result.result.value === true;
      if (!loaded) await delay(100);
    }
    assert.ok(loaded, '시연 웹 스타일시트 로드 실패');
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await send('Runtime.evaluate', { expression: 'document.activeElement.blur()' });
      const result = await send('Runtime.evaluate', {
        expression: `JSON.stringify({variables: Object.fromEntries(${JSON.stringify(Object.keys(expected[scheme]))}.map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim().toLowerCase()])), body: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor, ribbon: {color: getComputedStyle(document.querySelector('.demo-ribbon')).color, background: getComputedStyle(document.querySelector('.demo-ribbon')).backgroundColor}, tag: {color: getComputedStyle(document.querySelector('.tag')).color, background: getComputedStyle(document.querySelector('.tag')).backgroundColor}})`,
        returnByValue: true,
      });
      const actual = JSON.parse(result.result.value);
      assert.deepEqual(actual.variables, expected[scheme], `${scheme} 계산된 CSS 변수`);
      const rgb = (hex) => hex.match(/[a-f0-9]{2}/g).map((value) => parseInt(value, 16));
      const luminance = (hex) => rgb(hex).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
      for (const [foreground, background] of [['--ink', '--paper'], ['--ink', '--moon'], ['--muted', '--surface'], ['--stream', '--paper'], ['--stream', '--moon']]) {
        assert.ok(contrast(actual.variables[foreground], actual.variables[background]) >= 4.5, `${scheme} ${foreground} on ${background} 대비 부족`);
      }
      assert.equal(actual.body, `rgb(${rgb(expected[scheme]['--ink']).join(', ')})`);
      assert.equal(actual.background, `rgb(${rgb(expected[scheme]['--paper']).join(', ')})`);
      const fromRgb = (value) => `#${value.match(/\d+/g).slice(0, 3).map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
      assert.ok(contrast(fromRgb(actual.ribbon.color), fromRgb(actual.ribbon.background)) >= 4.5, `${scheme} 고지 대비 부족`);
      assert.ok(contrast(fromRgb(actual.tag.color), fromRgb(actual.tag.background)) >= 4.5, `${scheme} 가상 점포 태그 대비 부족`);
      for (const [width, height] of [[360, 800], [1440, 900]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width === 360 });
        for (const fontSize of ['100%', '200%']) {
          const layout = await send('Runtime.evaluate', {
            expression: `document.documentElement.style.fontSize = '${fontSize}'; JSON.stringify({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, ribbon: document.querySelector('.demo-ribbon').getBoundingClientRect().height, rootFontPx: getComputedStyle(document.documentElement).fontSize})`,
            returnByValue: true,
          });
          const metrics = JSON.parse(layout.result.value);
          assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${scheme} ${width}px ${fontSize} 가로 넘침: ${JSON.stringify(metrics)}`);
          assert.ok(metrics.ribbon > 0, `${scheme} ${width}px ${fontSize} 고지 숨김`);
          if (fontSize === '200%') assert.equal(metrics.rootFontPx, '32px');
          if (process.env.SHOWCASE_CAPTURE_DIR && (fontSize === '100%' || width === 360)) {
            const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
            writeFileSync(join(process.env.SHOWCASE_CAPTURE_DIR, `${scheme}-${width}-${fontSize === '200%' ? 'large' : 'normal'}.png`), Buffer.from(screenshot.data, 'base64'));
          }
        }
      }
      await send('Runtime.evaluate', { expression: "document.documentElement.style.fontSize = ''; document.activeElement.blur()" });
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const focus = await send('Runtime.evaluate', { expression: "JSON.stringify({text: document.activeElement.textContent.trim(), outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth})", returnByValue: true });
      const focused = JSON.parse(focus.result.value);
      assert.ok(['본문으로 건너뛰기', '가상 점포', '예시 도감'].includes(focused.text), `${scheme} 키보드 초점 대상: ${focused.text}`);
      assert.equal(focused.outline, 'solid');
      assert.notEqual(focused.width, '0px');
      if (process.env.SHOWCASE_CAPTURE_DIR) {
        const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        writeFileSync(join(process.env.SHOWCASE_CAPTURE_DIR, `${scheme}-focus.png`), Buffer.from(screenshot.data, 'base64'));
      }
    }
    assert.deepEqual([...new Set(requests)].sort(), ['/', '/assets/showcase.css?v=20260924']);
  } finally {
    socket?.close();
    chrome.kill();
    await new Promise((done) => { if (chrome.exitCode !== null || chrome.signalCode !== null || chromeSpawnError) done(); else chrome.once('exit', done); });
    rmSync(profile, { recursive: true, force: true });
    await new Promise((done) => server.close(done));
  }
});
