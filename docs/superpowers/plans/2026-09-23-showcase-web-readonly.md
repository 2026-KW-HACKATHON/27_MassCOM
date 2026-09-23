# 시연 웹 읽기 전용 도감 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 점포·계정·NFT를 사용하지 않고 한 가상 점포와 예시 도감을 한국어로 명확히 보여주는 독립 정적 시연 웹을 만든다.

**Architecture:** `apps/showcase-web/`을 기존 `docs/` 포털·운영 API에서 분리된 정적 산출물로 둔다. HTML/CSS에는 고정 가상 데이터만 넣고 JavaScript, 로그인, QR·수령·지갑·민팅 동작은 넣지 않는다. Node 내장 시험과 CI가 표시 문구·비쓰기 경계·가짜 NFT 주장을 검사한다.

**Tech Stack:** HTML5, CSS, Python 3 표준 라이브러리 `html.parser`, Node.js 24 내장 `node:test`·`node:fs`·`node:child_process`; 신규 패키지 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-23-showcase-production-separation-design.md`의 사용자 의도, 시연 데이터·화면 문구, 웹 읽기 전용 경계. 이 계획은 첫 독립 수직 단위이며 별도 Android 시연 variant/API·DB와 운영 개인 도감 웹 인증은 후속 구현 계획의 대상이다.

## Global Constraints

- 시연 데이터는 실제 음식점 이름·사진·주소·주문번호·개인 주소·거래 해시를 포함하지 않는다.
- 화면 상단과 점포·방문·수집품마다 `가상 점포`, `예시 방문 기록`, `실제 NFT가 아닙니다`를 문맥에 맞게 표시한다.
- 초기 시연 웹은 고정 데이터만 읽고 앱 이용자의 시연 진행 결과와 동기화하지 않는다. 웹에는 QR, 방문 수령, 지갑 연결·서명, NFT 발행 요청을 두지 않는다.
- 기존 `docs/` 운영 포털, `api.masscom.kr`, PostgreSQL, Android package, Issue #136의 미병합 모바일 UI를 수정하지 않는다.
- `demo.masscom.kr` DNS·Vercel 신규 프로젝트·유료 자원·Google Play·메인넷·공개 저장소 변경은 이 로컬 구현 단위에서 수행하지 않는다.
- 사용자 문서·Issue·PR은 한국어로 작성하고 실제 로컬/외부 검증 상태를 구분한다.

## File Structure

- `apps/showcase-web/index.html`: 한국어 시연 고지, 가상 점포 1곳, 예시 방문·앱 수집품 도감, 앱과 실제 운영 포털의 경계 안내. HTML 안에는 개인 계정 상태를 넣지 않는다.
- `apps/showcase-web/assets/showcase.css`: 모바일 우선 레이아웃, 키보드 포커스, 충분한 텍스트 대비, 좁은 화면·200% 글꼴 대응.
- `apps/showcase-web/README.md`: 로컬 미리보기·검사 명령, `NOT_DEPLOYED`/`STATIC_DEMO` 상태와 운영 데이터 분리 설명.
- `scripts/verify-showcase-site.py`: 허용 HTML 태그·속성·URL과 CSS 참조를 검사하고, 실제 텍스트 노드에서 필수 표기를 확인하는 CLI.
- `tests/site/verify_showcase_site_test.mjs`: verifier의 정상·변이 fixture를 Node 내장 테스트로 검증.
- `docs/evidence/showcase-web-local-2026-09-23.json`: 로컬 브라우저의 화면 크기·접근성·요청 경로·미실행 외부 검증을 기록.
- `.github/workflows/ci.yml`: 기존 portal 검사 옆에서 새 verifier 시험을 실행.
- `README.md`: 공개 링크를 만들지 않고 로컬 시연 웹의 실제 상태와 미배포 경계를 한 줄 추가.

## Review Focus

1. 점포 이름만 `DEMO`이고 실제 영업점이 아님을 본문에 쓰지 않은 HTML → Task 1 변이 시험이 실패해야 한다.
2. `FINALIZED`나 `발행 완료`를 가짜 수집품에 붙인 HTML → Task 1 변이 시험이 실패해야 한다.
3. 시연 페이지에 `<form>`, `<button>`, 원격 `<script>`, `fetch(`, `onclick`, `javascript:` URL, `meta refresh`, CSS `@import` 중 하나가 들어온 경우 → Task 1 각각의 변이 시험이 해당 오류 사유로 실패해야 한다.
4. 고지가 HTML 주석·숨김 속성에만 있거나 좁은 화면·큰 글씨에서 잘리는 경우 → Task 1의 텍스트 노드 검사 또는 Task 2의 접근성 트리·시각 검사가 불합격이어야 한다.
5. 실제 사이트에 배포되지 않았는데 README에 `https://demo.masscom.kr`을 운영 중이라고 적은 경우 → Task 3 문서 검사가 실패해야 한다.

---

### Task 1: 시연 사이트의 사실성·읽기 전용 검증기를 먼저 고정

**Files:**
- Create: `tests/site/verify_showcase_site_test.mjs`
- Create: `scripts/verify-showcase-site.py`

**Interfaces:**
- Consumes: `apps/showcase-web/index.html`, `apps/showcase-web/assets/showcase.css` 파일 경로.
- Produces: `python3 scripts/verify-showcase-site.py [사이트 디렉터리]` exit 0/1과 설명 가능한 오류 문구. Task 3의 CI가 이를 사용하는 Node 변이 시험을 실행한다.

- [ ] **Step 1: 실패하는 검증기 시험을 작성한다.** `tests/site/verify_showcase_site_test.mjs`에서 저장소 경로와 격리 fixture를 만들고 아래의 정상 시험과 독립 변이 시험을 작성한다. 변이마다 원본의 필수 문구를 유지하며, 자기 임시 디렉터리만 `finally`에서 지운다. 종료 코드뿐 아니라 예상 오류 범주도 확인한다.

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(repo, 'apps/showcase-web');
const verifier = join(repo, 'scripts/verify-showcase-site.py');
const run = (root) => spawnSync('python3', [verifier, root], { encoding: 'utf8' });

test('시연 사이트 원본은 필수 고지와 비쓰기 경계를 통과한다', () => {
  assert.equal(run(source).status, 0);
});

for (const [name, oldText, replacement, expectedError, file = 'index.html'] of [
  ['가상 점포 고지 제거', '가상 점포 · 실제 방문할 수 없습니다', '방문할 수 있습니다', '필수 문구 없음'],
  ['가짜 NFT 상태 추가', '</main>', '<p>FINALIZED</p></main>', '금지 문구'],
  ['가짜 발행 완료 추가', '</main>', '<p>발행 완료</p></main>', '금지 문구'],
  ['가짜 거래 해시 추가', '</main>', `<p>0x${'a'.repeat(40)}</p></main>`, '금지 문구'],
  ['쓰기 버튼 삽입', '</main>', '<button>방문 수령</button></main>', '허용되지 않은 태그'],
  ['쓰기 양식 삽입', '</main>', '<form action="/claim"></form></main>', '허용되지 않은 태그'],
  ['원격 스크립트 삽입', '</main>', '<script src="https://example.com/x.js"></script></main>', '허용되지 않은 태그'],
  ['이벤트 핸들러 삽입', '<main id="main">', '<main id="main" onclick="navigator.sendBeacon(\'/claim\')">', '허용되지 않은 속성'],
  ['실행 URL 삽입', '</main>', '<a href="javascript:alert(1)">보기</a></main>', '허용되지 않은 URL'],
  ['숨긴 고지', '가상 점포 · 실제 방문할 수 없습니다', '<span hidden>가상 점포 · 실제 방문할 수 없습니다</span>', '허용되지 않은 속성'],
  ['주석 고지', '가상 점포 · 실제 방문할 수 없습니다', '<!-- 가상 점포 · 실제 방문할 수 없습니다 -->', '필수 문구 없음'],
  ['외부 CSS 참조', '</main>', '</main>\n<link rel="stylesheet" href="https://example.com/x.css">', '허용되지 않은 URL'],
  ['외부 이동 meta refresh', '</head>', '<meta http-equiv="refresh" content="0; url=https://example.com/claim"></head>', '허용되지 않은 meta'],
  ['CSS import', 'body {', '@import url(https://example.com/x.css);\nbody {', '허용되지 않은 CSS', 'assets/showcase.css'],
  ['CSS 외부 이미지', 'body {', 'body { background-image: url(https://example.com/x.png);', '허용되지 않은 CSS', 'assets/showcase.css'],
]) {
  test(name, () => {
    const root = mkdtempSync(join(tmpdir(), 'masscom-showcase-'));
    try {
      cpSync(source, root, { recursive: true });
      const target = join(root, file);
      const original = readFileSync(target, 'utf8');
      assert.ok(original.includes(oldText), `fixture 원문 없음: ${name}`);
      writeFileSync(target, original.replace(oldText, replacement));
      const result = run(root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(expectedError));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
```

- [ ] **Step 2: RED를 확인한다.** 실행: `node --test tests/site/verify_showcase_site_test.mjs`. 예상: verifier 또는 사이트 파일이 아직 없어 원본 시험이 FAIL. 변이 시험만 우연히 통과해도 전체는 실패해야 한다.
- [ ] **Step 3: 허용 목록 기반 검증기를 작성한다.** `scripts/verify-showcase-site.py`는 HTML을 Python 표준 `HTMLParser`로 읽고 실제 `<body>` 텍스트 노드에 고지가 있는지 검사한다. 허용하지 않은 태그·속성·URL은 기본 거절한다. CSS는 외부 참조와 숨김 규칙을 거절한다. 아래 골격의 오류 범주·허용 집합을 그대로 사용하고 외부 패키지를 추가하지 않는다.

```python
from html.parser import HTMLParser
from pathlib import Path
import re
import sys

def fail(reason):
    raise SystemExit(f"showcase site verification failed: {reason}")

class ReadOnlyPage(HTMLParser):
    tags = {'html', 'head', 'meta', 'title', 'link', 'body', 'a', 'header',
            'main', 'section', 'h1', 'h2', 'p', 'span', 'div', 'footer',
            'strong', 'small', 'nav', 'ul', 'li'}
    common = {'class', 'id', 'aria-label', 'aria-labelledby', 'role'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.visible = []
        self.merchants = 0
        self.main = False
        self.korean = False
        self.local_css = False
        self.csp = False

    def handle_starttag(self, tag, attrs):
        if tag not in self.tags:
            fail(f'허용되지 않은 태그: {tag}')
        attrs = dict(attrs)
        allowed = set(self.common)
        if tag == 'html': allowed.add('lang')
        if tag == 'meta': allowed = {'charset', 'name', 'content', 'http-equiv'}
        if tag == 'a': allowed.add('href')
        if tag == 'link': allowed.update({'rel', 'href'})
        if tag == 'section': allowed.add('data-demo-merchant')
        if set(attrs) - allowed:
            fail(f'허용되지 않은 속성: {tag}')
        if tag == 'a' and not attrs.get('href', '').startswith('#'):
            fail('허용되지 않은 URL')
        if tag == 'link':
            if attrs.get('rel') != 'stylesheet' or attrs.get('href') != 'assets/showcase.css':
                fail('허용되지 않은 URL')
            self.local_css = True
        if tag == 'meta':
            if set(attrs) == {'charset'} and (attrs.get('charset') or '').lower() == 'utf-8':
                pass
            elif set(attrs) == {'name', 'content'} and attrs['name'] == 'viewport' and attrs['content'] == 'width=device-width, initial-scale=1':
                pass
            elif set(attrs) == {'name', 'content'} and attrs['name'] == 'description' and (attrs.get('content') or '').strip():
                pass
            elif set(attrs) == {'http-equiv', 'content'} and (attrs.get('http-equiv') or '').lower() == 'content-security-policy' and attrs['content'] == "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'":
                self.csp = True
            else:
                fail('허용되지 않은 meta')
        if tag == 'html': self.korean = attrs.get('lang') == 'ko'
        if tag == 'body': self.in_body = True
        if tag == 'main': self.main = True
        if tag == 'section' and 'data-demo-merchant' in attrs: self.merchants += 1

    def handle_endtag(self, tag):
        if tag == 'body': self.in_body = False

    def handle_data(self, data):
        if self.in_body: self.visible.append(data)

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'apps/showcase-web')
html_file, css_file = root / 'index.html', root / 'assets/showcase.css'
if not html_file.is_file() or not css_file.is_file(): fail('정적 페이지 또는 CSS 없음')
page = ReadOnlyPage()
page.feed(html_file.read_text(encoding='utf-8'))
if not (page.korean and page.main and page.local_css and page.csp):
    fail('한국어·본문·로컬 CSS·CSP 중 하나가 없음')
if page.merchants != 1: fail('가상 점포 수가 1이 아님')
visible = ' '.join(page.visible)
for copy in ('체험용 가상 데이터로 서비스 흐름을 보여드립니다',
             '가상 점포 · 실제 방문할 수 없습니다', '예시 방문 기록',
             '앱 안의 예시 수집품 · 실제 NFT가 아닙니다',
             '앱의 체험 진행 결과와 자동으로 동기화되지 않습니다',
             '실제 운영 성과가 아닙니다'):
    if copy not in visible: fail(f'필수 문구 없음: {copy}')
if re.search(r'FINALIZED|발행 완료|0x[a-fA-F0-9]{40}', visible):
    fail('금지 문구')
css = css_file.read_text(encoding='utf-8')
if re.search(r'@import|url\s*\(|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;}])', css, re.I):
    fail('허용되지 않은 CSS')
print('showcase site verified')
```

- [ ] **Step 4: 아직 사이트가 없어 FAIL임을 확인한다.** `node --test tests/site/verify_showcase_site_test.mjs`가 Task 2 이전에는 성공해서는 안 된다.

### Task 2: 가상 점포 한 곳과 예시 도감을 보여주는 독립 정적 페이지

**Files:**
- Create: `apps/showcase-web/index.html`
- Create: `apps/showcase-web/assets/showcase.css`

**Interfaces:**
- Consumes: Task 1의 필수 문구와 `data-demo-merchant` 한 곳 계약.
- Produces: 정적 서버에서 `/`로 열리는 HTML/CSS만 있는 공개 가능 *로컬* 시연 사이트. 개인 API나 지갑 세션은 읽지 않는다.

- [ ] **Step 1: HTML의 작은 실제 구조를 만든다.** `index.html`은 한국어·viewport·설명 메타데이터, 로컬 CSS와 아래 CSP, 본문 건너뛰기, `<main id="main">`, 고정 시연 고지, 가상 점포 카드 한 곳, 예시 방문 1건, 앱 수집품 1건, 실제 NFT가 아님을 담는다. 점포명은 `가상 점포 A`, 위치는 `시연용 가상 위치 · 실제 방문 불가`로 쓰고 실제 도로명·사진·금액·거래 해시를 만들지 않는다. 아래 필수 표현을 그대로 포함한다.

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'">
<link rel="stylesheet" href="assets/showcase.css">
<a class="skip-link" href="#main">본문으로 건너뛰기</a>
<p class="demo-ribbon">체험용 가상 데이터로 서비스 흐름을 보여드립니다. 실제 영업점이나 방문 혜택과 연결되지 않습니다.</p>
<main id="main">
  <section class="merchant-card" data-demo-merchant aria-labelledby="merchant-title">
    <p class="tag">가상 점포 · 실제 방문할 수 없습니다</p>
    <h2 id="merchant-title">가상 점포 A</h2>
    <p>시연용 가상 위치 · 실제 방문 불가</p>
  </section>
  <section aria-labelledby="collection-title">
    <h2 id="collection-title">체험 도감</h2>
    <p>예시 방문 기록</p>
    <p>앱 안의 예시 수집품 · 실제 NFT가 아닙니다</p>
    <p>이 고정 예시는 앱의 체험 진행 결과와 자동으로 동기화되지 않습니다.</p>
  </section>
</main>
<footer><p>이 화면의 점포·방문·수집품은 기능 설명을 위한 가상 예시이며 실제 운영 성과가 아닙니다.</p></footer>
```

- [ ] **Step 2: CSS를 작성한다.** `:root`의 기존 `docs/assets/project.css` 청록·잎색 의미를 참고하되 파일은 독립적으로 둔다. 아래 최소 레이아웃을 적용하고 360px·200% 글꼴에서 수평 스크롤 여부를 직접 확인한다. 색상만으로 시연 여부를 나타내지 않는다.

```css
:root { color-scheme: light; font-family: Pretendard, system-ui, sans-serif; --ink:#102833; --paper:#f4f9fa; --surface:#fff; --focus:#0a6dad; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); line-height: 1.6; overflow-wrap: anywhere; }
main { width: min(74rem, calc(100% - 2rem)); margin: 2rem auto; display: grid; gap: 1.5rem; }
.demo-ribbon { margin: 0; padding: 1rem max(1rem, calc((100vw - 74rem) / 2)); background: #12303d; color: #fff; font-weight: 700; }
.merchant-card, main section { min-width: 0; padding: clamp(1rem, 3vw, 2rem); border-radius: 1.1rem; background: var(--surface); }
a:focus-visible { outline: .2rem solid var(--focus); outline-offset: .2rem; }
@media (min-width: 56rem) { main { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
```
- [ ] **Step 3: GREEN을 확인한다.** `node --test tests/site/verify_showcase_site_test.mjs`와 `python3 scripts/verify-showcase-site.py` 모두 PASS. 독립 변이들은 각각 기대한 오류 범주로 종료 코드 1을 반환해야 한다.
- [ ] **Step 4: 브라우저에서 화면과 실행 경계를 직접 확인한다.** `python3 -m http.server 4174 --directory apps/showcase-web --bind 127.0.0.1`로 열어 1440×900, 390×844, 360×800 및 200% 글꼴을 확인한다. 상단 고지·가상 점포·도감이 실제로 보이고 접근성 트리에서도 읽히며, skip link가 `main`으로 이동하고 본문 대비가 4.5:1 이상이어야 한다. 수평 스크롤·잘림이 없어야 한다. 브라우저 네트워크 기록에서 외부 도메인·API 요청·실행 스크립트가 없어야 한다(브라우저의 자동 favicon 요청은 분리 기록). `docs/evidence/showcase-web-local-2026-09-23.json`에 검사 viewport·수치·요청 경로·실제 결과를 기록하고 외부 HTTPS는 `NOT_RUN`으로 둔다. 실패하면 이 Task 안에서 HTML/CSS만 고치고 검사를 반복한다.
- [ ] **Step 5: 기능·시험만 의미 있는 한 커밋으로 기록한다.** 한국어 의도형 제목과 `Tested:`/`Not-tested:` Lore trailer를 쓰고 점포·방문을 실적이라 쓰지 않는다.

### Task 3: README·CI에 로컬 시연 범위와 재현 명령 연결

**Files:**
- Create: `apps/showcase-web/README.md`
- Modify: `README.md`의 데모·배포 상태 절
- Modify: `.github/workflows/ci.yml`의 포털 검사 직후
- Create: `docs/evidence/showcase-web-local-2026-09-23.json` (Task 2 실측값·미검증 상태)
- Test: `tests/site/verify_showcase_site_test.mjs`

**Interfaces:**
- Consumes: Task 1 CLI, Task 2의 자체 완결 정적 디렉터리.
- Produces: clean checkout에서 같은 검사를 재현하는 문서·CI. 시연 URL을 실제 배포 전 만들어 내지 않는다.

- [ ] **Step 1: 문서 상태 검사를 추가한다.** `tests/site/verify_showcase_site_test.mjs`에 다음 시험을 더하고 RED를 확인한다. 외부 주소가 실제 배포되기 전에는 루트 README에 URL을 쓰지 않는다.

```js
test('README는 로컬 시연 웹만 안내하고 배포를 주장하지 않는다', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8');
  assert.ok(readme.includes('apps/showcase-web'));
  assert.ok(readme.includes('NOT_DEPLOYED'));
  assert.equal(readme.includes('https://demo.masscom.kr'), false);
});
```
- [ ] **Step 2: 두 README를 갱신한다.** `apps/showcase-web/README.md`에 목적, 정확한 미리보기·시험 명령, 고정 가상 데이터, 운영 API·DB 미연결, `NOT_DEPLOYED`, 다음 단계의 외부 HTTPS·Android 시연 앱 분리를 기록한다. 루트 `README.md`에는 `apps/showcase-web`의 로컬 웹 상태만 링크하고 공개 시연 주소나 방문 실적을 주장하지 않는다.
- [ ] **Step 3: CI를 연결한다.** `.github/workflows/ci.yml`의 `Verify project portal structure` 다음에 아래 한 단계를 추가한다.

```yaml
      - name: 시연 웹 사실성·읽기 전용 검사
        run: node --test tests/site/verify_showcase_site_test.mjs
```

- [ ] **Step 4: 범위에 맞는 검사를 실행한다.** `node --test tests/site/verify_showcase_site_test.mjs`, `python3 scripts/verify-showcase-site.py`, `bash tests/site/verify_project_site_test.sh`, `bash tests/bootstrap/verify_bootstrap_test.sh`, `bash tests/bootstrap/check_secrets_test.sh`, `git diff --check`를 실행해 전부 PASS를 기록한다. 이번 Task는 모바일·API 코드를 변경하지 않으므로 해당 전체 시험을 로컬에서 반복하지 않되 PR CI 전체 결과는 기다린다.
- [ ] **Step 5: 한국어 PR 하나로 제출한다.** 목적·요구사항·실제 시험·시각 증거·보안/DB 영향 없음·외부 미배포·rollback과 `Refs #137`을 본문에 적는다(`Closes #137`은 후속 앱·운영 웹이 남아 있으므로 쓰지 않음). 예: `PR_TITLE='시연 웹의 가상 점포와 읽기 전용 도감을 분리한다'`, `PR_BODY="$(< /tmp/masscom-pr-137.md)"`, `bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"`. 필수 CI·리뷰 후에만 merge하며 저장소를 public으로 바꾸거나 Vercel 프로젝트·DNS를 생성하지 않는다.

## 후속 독립 계획 경계

- **시연 Android·API·DB:** 다른 계획에서 `APP_VARIANT=showcase`, `kr.masscom.wolgye.demo`/`masscom-demo`, 별도 인증·DB·HMAC/체인 키, 가상 점포 seed와 QR→앱 도감 실기를 다룬다. 이 계획의 고정 웹 예시는 앱 데이터와 동기화하지 않는다.
- **운영 웹 개인 도감:** 다른 계획에서 Google Web 로그인, 서버 측 웹 세션, 본인만 읽는 `GET /collection`, 캐시·CSRF·계정 전환/탈퇴, 공개 점포 목록과 기존 포털 경로 보존을 다룬다. 이 계획의 정적 시연 HTML에 Bearer token을 넣지 않는다.
- **외부 공개:** `demo.masscom.kr` 및 새 Vercel/Cloud 리소스의 계약·요금·DNS·보안은 실제 배포 전에 공식 근거와 사용자 승인 범위를 다시 확인한다. 로컬 PASS를 외부 시연 PASS로 쓰지 않는다.
