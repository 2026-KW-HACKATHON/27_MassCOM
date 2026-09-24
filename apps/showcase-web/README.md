# 월계 마스코트 체험 웹

상태: `STATIC_DEMO` · 기본 Vercel HTTPS `VERIFIED`; `demo.masscom.kr` DNS `BLOCKED`

현재 열리는 시연 웹: [https://masscom-showcase-web.vercel.app](https://masscom-showcase-web.vercel.app). `demo.masscom.kr` 맞춤 주소는 가비아 DNS가 아직 연결되지 않아 열리지 않습니다.

GitHub에서 버전·원본을 확인하려면 [시연 웹 전용 `showcase-web-v0.1.0-preview.1` 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1)를 보세요. ZIP에는 HTML·CSS만 있으며 Android APK가 아닙니다. 웹은 위 공개 주소에서 설치 없이 바로 볼 수 있습니다.

가상 점포 세 곳과 A점포 방문을 가정한 예시 기록·앱 수집품을 보여주는 읽기 전용 정적 페이지입니다. 모든 점포·방문·수집품은 기능 설명용 가상 데이터이며 실제 영업점, 방문 실적 또는 NFT 발행 결과가 아닙니다. `DEMO` 배지에만 의존하지 않고 화면 상단과 각 내용에 이 경계를 한국어로 적습니다.

## 로컬 미리보기와 검사

저장소 루트에서 다음 명령을 실행합니다.

```bash
python3 -m http.server 4174 --directory apps/showcase-web --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:4174/`을 엽니다. 별도 터미널에서 검사를 실행합니다.

```bash
node --test tests/site/verify_showcase_site_test.mjs
node --test tests/site/verify_showcase_theme_test.mjs
python3 scripts/verify-showcase-site.py
```

테마 검사는 로컬 Google Chrome에서 라이트·다크 계산 색, 본문·고지·태그 대비, 360px/1440px 화면과 200% 글씨, 키보드 초점, HTML/CSS 요청 경로를 확인합니다. Linux CI에서는 설치된 Chrome/Chromium 경로를 `CHROME_PATH`로 전달해 같은 검사를 실행합니다.

페이지에는 JavaScript·양식·쓰기 버튼·원격 자산을 넣지 않았습니다. 운영 API·DB와 연결되지 않으며 앱의 체험 진행 결과와 자동 동기화되지 않습니다. QR 촬영·방문 코드·지갑 연결·NFT 발행 요청은 웹에서 제공하지 않습니다.

[로컬 브라우저 검사 기록](../../docs/evidence/showcase-web-local-2026-09-23.json)은 당시 자동 시험 결과입니다. 후속 Vercel 배포 `dpl_46Ug4QohG2bfoMEdxnT7WuJ6g5UC`는 별도 프로젝트에서 READY이며 위 기본 HTTPS 주소의 HTML·CSS 200과 A·B·C 표기를 확인했습니다. 앱과의 진행 동기화, Android 시연 APK, `demo.masscom.kr` 맞춤 도메인은 별개로 미완료입니다.
