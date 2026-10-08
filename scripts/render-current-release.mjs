#!/usr/bin/env node
// 현재 배포 상태를 손으로 고치는 기준 파일 docs/CURRENT_RELEASE.json에서 docs/open.html의 생성 블록을 만든다(모든 문서를 대신하지는 않는다: 아래 3번의 범위만 검사한다).
//   node scripts/render-current-release.mjs            생성 블록을 다시 쓴다
//   node scripts/render-current-release.mjs --check    다시 쓰지 않고 어긋남만 찾는다(어긋나면 종료 코드 1)
// --check가 보는 것:
//   1. CURRENT_RELEASE.json이 evidence 파일(태그·APK 이름·SHA-256·소스)과 같다.
//   2. open.html의 생성 블록이 JSON에서 다시 만든 것과 같다.
//   3. open.html(블록 밖), README.md의 '바로 체험' 절, docs/DEMO_RUNBOOK.md, docs/SUBMISSION_CHECKLIST.md가 JSON에 없는 태그·버전·APK 이름·해시를 적지 않았다.
// 3번의 규칙: 문장 단위로 보고, 토큰 바로 앞에 '이전'이나 '옛'이 있을 때(그 사이는 12자 이하 낱말 하나와 토큰에 붙은 기호까지)만 옛 설치본 설명으로 보고 넘어간다.
// 같은 문장의 다른 토큰은 계속 본다. 7~40자 해시는 백틱이나 <code> 안에 있고 문장에 설치본·API·/play/ 같은 배포 낱말이 있을 때만 본다(옛 배포 날짜 문장을 건드리지 않으려는 것).
// ponytail: 범위는 현재 상태를 말하는 네 곳(open.html 블록 밖·README 바로 체험·DEMO_RUNBOOK·SUBMISSION_CHECKLIST)이다. docs/ANDROID_DOWNLOADS.md는 날짜별 이력 표라 옛 태그가 정상이므로 검사 밖이다.
// ponytail: 해시가 어느 역할(운영 API·시연 API·/play/)의 것인지는 가리지 않는다. 역할이 뒤바뀐 해시는 못 잡는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_URL = 'https://github.com/2026-KW-HACKATHON/27_MassCOM';
const START = '<!-- current-release:start -->';
const END = '<!-- current-release:end -->';
const HISTORY_BEFORE = /(?:이전|옛)\s*(?:\S{1,12}\s+)?\S{0,12}$/;
// 제출 체크리스트에 정당하게 남는 옛 언급(정확히 이 토큰만): 원장을 올린 운영 배포 `09dfceb0`의 증거 링크 이름, 대체 시연 영상 demo-flow-390.webm의 SHA-256.
const HISTORICAL_MENTIONS = {
  'docs/SUBMISSION_CHECKLIST.md': ['09dfceb0', 'd05301abb9857a9f330d4fa440f323228851109f14417781df95719d29a095ae'],
};
const RELEASE_WORDS = /Preview \d|test\.\d|preview\.\d|\/play\/|시연 API|운영 API|APK|설치본|번들/;

/** @param {string} root */
export function readRelease(root) {
  const release = JSON.parse(readFileSync(join(root, 'docs/CURRENT_RELEASE.json'), 'utf8'));
  const fail = (message) => { throw new Error(`CURRENT_RELEASE.json: ${message}`); };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.recordedAt ?? '')) fail('recordedAt은 YYYY-MM-DD여야 한다');
  const kinds = {
    operating: { tag: /^android-v\d+\.\d+\.\d+-test\.\d+$/, apk: /^MassCOM-operating-android-[0-9a-f]{7,}\.apk$/ },
    showcase: { tag: /^showcase-android-v\d+\.\d+\.\d+-preview\.\d+$/, apk: /^MassCOM-showcase-android-[0-9a-f]{7,}\.apk$/ },
  };
  for (const [name, rule] of Object.entries(kinds)) {
    const app = release[name] ?? fail(`${name}가 없다`);
    if (!rule.tag.test(app.tag ?? '')) fail(`${name}.tag 형식이 틀렸다`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(app.date ?? '')) fail(`${name}.date는 YYYY-MM-DD여야 한다`);
    if (!rule.apk.test(app.apk ?? '')) fail(`${name}.apk 형식이 틀렸다`);
    if (!/^[0-9a-f]{64}$/.test(app.sha256 ?? '')) fail(`${name}.sha256은 소문자 16진 64자여야 한다`);
    if (!Number.isInteger(app.bytes) || app.bytes <= 0) fail(`${name}.bytes는 양의 정수여야 한다`);
    if (!/^[0-9a-f]{40}$/.test(app.source ?? '')) fail(`${name}.source는 40자 커밋이어야 한다`);
    if (!existsSync(join(root, app.evidence ?? ''))) fail(`${name}.evidence 파일이 없다: ${app.evidence}`);
  }
  for (const name of ['production', 'showcaseApi', 'playBundle']) {
    if (!/^[0-9a-f]{40}$/.test(release[name]?.sha ?? '')) fail(`${name}.sha는 40자 커밋이어야 한다`);
  }
  return release;
}

const sizeLabel = (bytes) => `약 ${Math.round(bytes / 1e6)}MB`;

/** @param {ReturnType<typeof readRelease>} r */
function blockLines(r) {
  const tagUrl = (app) => `${REPO_URL}/releases/tag/${app.tag}`;
  const line = (label, app) => `<li><strong>${label}</strong> <code>${app.tag}</code> · ${app.date} · SHA-256 <code>${app.sha256.slice(0, 12)}…</code> · ${sizeLabel(app.bytes)} · <a href="${REPO_URL}/blob/main/${app.evidence}">검증 범위</a></li>`;
  return [
    '<div class="overview-actions open-actions">',
    `  <a class="primary-action" href="${tagUrl(r.operating)}">운영 APK 받기</a>`,
    `  <a class="secondary-action" href="${tagUrl(r.showcase)}">시연 APK 받기</a>`,
    '</div>',
    '<ul>',
    `  ${line('운영', r.operating)}`,
    `  ${line('시연', r.showcase)}`,
    '</ul>',
  ];
}

/** 생성 블록의 위치. 표지가 없거나 순서가 틀리면 던진다. */
function blockSpan(html) {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < start) throw new Error(`open.html에 ${START} … ${END} 표지가 없거나 순서가 틀렸다`);
  return [start, end + END.length];
}

/** open.html에서 생성 블록만 JSON으로 다시 만든 html. */
export function renderOpen(html, release) {
  const [start, end] = blockSpan(html);
  const indent = html.slice(html.lastIndexOf('\n', start) + 1, start);
  if (indent.trim() !== '') throw new Error('open.html의 시작 표지는 줄 맨 앞(들여쓰기만)에 있어야 한다');
  const body = blockLines(release).map((text) => indent + text).join('\n');
  return `${html.slice(0, start)}${START}\n${body}\n${indent}${END}${html.slice(end)}`;
}

const evidenceFields = {
  operating: (e) => ({ tag: e.githubRelease?.tag, apk: e.acceptedArtifact?.apk, sha256: e.acceptedArtifact?.apkSha256, source: e.sourceCommit }),
  showcase: (e) => ({ tag: e.release?.split('/').pop(), apk: e.artifact?.name, sha256: e.artifact?.sha256, source: e.sourceCommit }),
};

function* sentences(text, firstLine) {
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const sentence of line.split(/(?<=[.!?])\s+(?=\S)/)) yield { line: firstLine + index, sentence };
  }
}

/** @returns {string[]} 어긋난 곳 목록. 비어 있으면 일치한다. */
export function check(root) {
  const r = readRelease(root);
  const problems = [];

  for (const name of Object.keys(evidenceFields)) {
    const app = r[name];
    const evidence = evidenceFields[name](JSON.parse(readFileSync(join(root, app.evidence), 'utf8')));
    for (const key of ['tag', 'apk', 'sha256', 'source']) {
      if (evidence[key] !== app[key]) problems.push(`CURRENT_RELEASE.json ${name}.${key}=${app[key]} 이지만 ${app.evidence}는 ${evidence[key]}`);
    }
  }

  const open = readFileSync(join(root, 'docs/open.html'), 'utf8');
  if (renderOpen(open, r) !== open) problems.push('docs/open.html 생성 블록이 CURRENT_RELEASE.json과 다르다: node scripts/render-current-release.mjs 를 실행한다');

  const [blockStart, blockEnd] = blockSpan(open);
  const outsideBlock = open.slice(0, blockStart) + open.slice(blockStart, blockEnd).replace(/[^\n]/g, '') + open.slice(blockEnd);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const heading = readme.match(/^## 바로 체험\s*$/m);
  if (!heading) problems.push("README.md에 '## 바로 체험' 절이 없다");
  const sectionStart = heading ? heading.index : 0;
  const sectionEnd = heading ? readme.indexOf('\n## ', sectionStart + 1) : 0;
  const readmeSection = heading ? readme.slice(sectionStart, sectionEnd < 0 ? undefined : sectionEnd) : '';
  const scopes = [
    ['docs/open.html', outsideBlock, 1],
    ['README.md', readmeSection, readme.slice(0, sectionStart).split('\n').length],
    ['docs/DEMO_RUNBOOK.md', readFileSync(join(root, 'docs/DEMO_RUNBOOK.md'), 'utf8'), 1],
    ['docs/SUBMISSION_CHECKLIST.md', readFileSync(join(root, 'docs/SUBMISSION_CHECKLIST.md'), 'utf8'), 1],
  ];

  const current = { test: Number(r.operating.tag.match(/\d+$/)[0]), preview: Number(r.showcase.tag.match(/\d+$/)[0]) };
  const hashes = [r.operating.sha256, r.showcase.sha256, r.operating.source, r.showcase.source, r.production.sha, r.showcaseApi.sha, r.playBundle.sha];
  const apks = { operating: r.operating.apk, showcase: r.showcase.apk };
  for (const [file, text, firstLine] of scopes) {
    for (const { line, sentence } of sentences(text, firstLine)) {
      // 토큰 하나가 옛 설명인지: 바로 앞이 이전·옛이거나, 이 파일에 허용된 옛 해시 그대로일 때만 넘어간다.
      const bad = (m, what, expected) => {
        if (HISTORY_BEFORE.test(sentence.slice(0, m.index)) || (HISTORICAL_MENTIONS[file] ?? []).includes(m[0])) return;
        problems.push(`${file}:${line}: ${what} (현재는 ${expected})`);
      };
      for (const m of sentence.matchAll(/(showcase-)?android-v\d+\.\d+\.\d+-(?:test|preview)\.\d+/g)) {
        const expected = m[1] ? r.showcase.tag : r.operating.tag;
        if (m[0] !== expected) bad(m, m[0], expected);
      }
      for (const m of sentence.matchAll(/(?<![\w.-])test\.(\d+)/g)) {
        if (Number(m[1]) !== current.test) bad(m, m[0], `test.${current.test}`);
      }
      for (const m of sentence.matchAll(/(?<![\w.-])[Pp]review[ .](\d+)/g)) {
        if (Number(m[1]) !== current.preview) bad(m, m[0], `Preview ${current.preview}`);
      }
      for (const m of sentence.matchAll(/MassCOM-(operating|showcase)-android-[0-9a-f]+\.apk/g)) {
        if (m[0] !== apks[m[1]]) bad(m, m[0], apks[m[1]]);
      }
      for (const m of sentence.matchAll(/\b[0-9a-f]{64}\b/g)) {
        if (!hashes.includes(m[0])) bad(m, `SHA-256 ${m[0].slice(0, 12)}…`, `${r.operating.sha256.slice(0, 12)}… 또는 ${r.showcase.sha256.slice(0, 12)}…`);
      }
      if (!RELEASE_WORDS.test(sentence)) continue;
      for (const m of sentence.matchAll(/(?<=`|<code>)[0-9a-f]{7,40}(?=`|<\/code>)/g)) {
        if (!hashes.some((hash) => hash.startsWith(m[0]))) bad(m, `해시 ${m[0]}`, `${[r.operating.source, r.production.sha, r.showcaseApi.sha].map((h) => h.slice(0, 8)).join('·')} 중 하나`);
      }
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const root = resolve(args.find((arg) => !arg.startsWith('--')) ?? join(import.meta.dirname, '..'));
  if (args.includes('--check')) {
    const problems = check(root);
    if (problems.length > 0) {
      console.error(`현재 배포 상태 불일치 ${problems.length}건:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      process.exit(1);
    }
    console.log('현재 배포 상태 일치: CURRENT_RELEASE.json = evidence = open.html = README 바로 체험 = DEMO_RUNBOOK = SUBMISSION_CHECKLIST');
    return;
  }
  const path = join(root, 'docs/open.html');
  const html = readFileSync(path, 'utf8');
  const next = renderOpen(html, readRelease(root));
  if (next === html) console.log('docs/open.html 생성 블록은 이미 최신이다');
  else { writeFileSync(path, next); console.log('docs/open.html 생성 블록을 갱신했다'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
