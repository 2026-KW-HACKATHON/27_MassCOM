import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { check, readRelease, renderOpen } from '../../scripts/render-current-release.mjs';

const repo = resolve(import.meta.dirname, '../..');
const script = join(repo, 'scripts/render-current-release.mjs');
const release = readRelease(repo);
const tmpRoots = [];
after(() => { for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true }); });

// 검사에 필요한 파일만 임시 폴더로 복사한다. 원본은 건드리지 않는다.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'current-release-'));
  tmpRoots.push(root);
  for (const path of ['docs/CURRENT_RELEASE.json', 'docs/open.html', 'docs/DEMO_RUNBOOK.md', 'docs/SUBMISSION_CHECKLIST.md', 'README.md', release.operating.evidence, release.showcase.evidence]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(repo, path), join(root, path));
  }
  return root;
}
function edit(root, path, change) {
  const file = join(root, path);
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  assert.notEqual(after, before, `${path}: 시험용 수정이 아무것도 바꾸지 못했다`);
  writeFileSync(file, after);
}
const withProblem = (problems, text) => problems.some((problem) => problem.includes(text));

test('저장소의 현재 상태는 evidence·open.html·README 바로 체험·DEMO_RUNBOOK·SUBMISSION_CHECKLIST와 일치한다', () => {
  assert.deepEqual(check(repo), []);
  const run = spawnSync(process.execPath, [script, '--check'], { cwd: repo, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('생성 블록은 JSON에서 다시 만들어도 그대로이고, 옛 Preview 3 문단은 없다', () => {
  const html = readFileSync(join(repo, 'docs/open.html'), 'utf8');
  assert.equal(renderOpen(html, release), html);
  assert.doesNotMatch(html, /preview\.3(?!\d)|Preview 3(?!\d)/);
  for (const app of [release.operating, release.showcase]) {
    assert.ok(html.includes(`releases/tag/${app.tag}"`), app.tag);
    assert.ok(html.includes(`<code>${app.sha256.slice(0, 12)}…</code>`), app.tag);
  }
});

test('JSON을 고치면 --check는 open.html이 낡았다고 하고 렌더가 고친다', () => {
  const root = fixture();
  edit(root, 'docs/CURRENT_RELEASE.json', (text) => text.replace(String(release.operating.bytes), '400000000'));
  assert.ok(withProblem(check(root), '생성 블록이 CURRENT_RELEASE.json과 다르다'));
  const stale = spawnSync(process.execPath, [script, '--check', root], { encoding: 'utf8' });
  assert.equal(stale.status, 1);
  assert.equal(spawnSync(process.execPath, [script, root], { encoding: 'utf8' }).status, 0);
  assert.match(readFileSync(join(root, 'docs/open.html'), 'utf8'), /약 400MB/);
  assert.deepEqual(check(root), []);
});

test('JSON이 evidence 파일의 태그·APK·SHA-256과 다르면 잡는다', () => {
  const root = fixture();
  edit(root, 'docs/CURRENT_RELEASE.json', (text) => text.replace(release.operating.sha256, 'a'.repeat(64)));
  assert.ok(withProblem(check(root), 'operating.sha256'));
});

test('README 바로 체험의 옛 버전 번호와 태그를 잡고, 그 절 밖은 보지 않는다', () => {
  const root = fixture();
  edit(root, 'README.md', (text) => text.replace('[Preview 24 APK]', '[Preview 23 APK]'));
  assert.ok(withProblem(check(root), 'README.md:'));
  const second = fixture();
  edit(second, 'README.md', (text) => text.replace('[test.14 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.14)', '[test.14 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.13)'));
  assert.ok(withProblem(check(second), 'android-v0.1.0-test.13'));
  const outside = fixture();
  edit(outside, 'README.md', (text) => `${text}\n## 다른 절\n\n옛 설치본이 아닌 문장: Preview 3과 test.5와 \`1234567\` 설치본.\n`);
  assert.deepEqual(check(outside), []);
});

test('DEMO_RUNBOOK의 옛 시연 API 해시와 APK 이름을 잡는다', () => {
  const root = fixture();
  edit(root, 'docs/DEMO_RUNBOOK.md', (text) => text.replace('시연 API는 `dbcc4403`', '시연 API는 `1234567`'));
  assert.ok(withProblem(check(root), '해시 1234567'));
  const apk = fixture();
  edit(apk, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n설치본은 MassCOM-showcase-android-9f5ebfa.apk 입니다.\n`);
  assert.ok(withProblem(check(apk), 'MassCOM-showcase-android-9f5ebfa.apk'));
});

test('"이전·옛" 바로 뒤에 오는 토큰만 옛 설치본 설명으로 보고 넘어간다', () => {
  const root = fixture();
  edit(root, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n이전 Preview 21 설치본은 이전 \`9f5ebfa6\` 번들입니다.\n옛 test.10/Preview 19 설치본도 같습니다.\n`);
  assert.deepEqual(check(root), []);
});

test('같은 문장에 이전·옛이 있어도 그 바로 뒤가 아닌 낡은 토큰은 잡고, 당시는 면제가 아니다', () => {
  const sameSentence = fixture();
  edit(sameSentence, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n이전 설치본은 Preview 21이었고 현재 설치본은 Preview 20입니다.\n`);
  const problems = check(sameSentence);
  assert.ok(withProblem(problems, 'Preview 20'), '이전 뒤가 아닌 낡은 Preview 20을 놓쳤다');
  assert.ok(!withProblem(problems, 'Preview 21'), '이전 바로 뒤의 Preview 21은 넘어가야 한다');
  const far = fixture();
  edit(far, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n이전 문서를 보지 않아도 되는 설치본 test.5 입니다.\n`);
  assert.ok(withProblem(check(far), 'test.5'), '이전과 멀리 떨어진 test.5를 놓쳤다');
  const then = fixture();
  edit(then, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n당시 설치본은 Preview 21 입니다.\n`);
  assert.ok(withProblem(check(then), 'Preview 21'), '당시는 더 이상 면제가 아니다');
});

test('SUBMISSION_CHECKLIST도 본다: 낡은 태그·해시는 잡고, 정해 둔 이전 해시만 허용한다', () => {
  const stale = fixture();
  edit(stale, 'docs/SUBMISSION_CHECKLIST.md', (text) => text.replace('showcase-android-v0.1.0-preview.24', 'showcase-android-v0.1.0-preview.23'));
  assert.ok(withProblem(check(stale), 'docs/SUBMISSION_CHECKLIST.md:'));
  const hash = fixture();
  edit(hash, 'docs/SUBMISSION_CHECKLIST.md', (text) => `${text}\n공개 운영 API는 \`1234567\` 입니다.\n`);
  assert.ok(withProblem(check(hash), '해시 1234567'));
  assert.deepEqual(check(fixture()), []);
  const other = fixture();
  edit(other, 'docs/SUBMISSION_CHECKLIST.md', (text) => `${text}\n운영 API 배포 \`09dfceb1\` 도 있었습니다.\n`);
  assert.ok(withProblem(check(other), '해시 09dfceb1'), '허용은 정확히 09dfceb0 하나다');
  // 같은 허용 토큰이 다른 문서에서는 면제가 아니다
  const elsewhere = fixture();
  edit(elsewhere, 'docs/DEMO_RUNBOOK.md', (text) => `${text}\n운영 API 배포 \`09dfceb0\` 입니다.\n`);
  assert.ok(withProblem(check(elsewhere), '해시 09dfceb0'));
});

test('JSON에는 검사하지 않는 migrations 같은 주장을 두지 않는다', () => {
  assert.equal(JSON.stringify(release).includes('migrations'), false);
});

test('open.html 블록 밖에 옛 태그가 남으면 잡는다', () => {
  const root = fixture();
  edit(root, 'docs/open.html', (text) => text.replace('<h2>안전 경계</h2>', '<p><a href="https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3">시연 Preview 3</a></p>\n      <h2>안전 경계</h2>'));
  const problems = check(root);
  assert.ok(withProblem(problems, 'showcase-android-v0.1.0-preview.3'));
  assert.ok(withProblem(problems, 'Preview 3'));
});

test('JSON 형식이 틀리면 읽는 단계에서 막는다', () => {
  const root = fixture();
  edit(root, 'docs/CURRENT_RELEASE.json', (text) => text.replace(release.showcase.sha256, release.showcase.sha256.toUpperCase()));
  assert.throws(() => readRelease(root), /showcase\.sha256/);
});
