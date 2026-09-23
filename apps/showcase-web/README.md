# 월계 마스코트 체험 웹

상태: `STATIC_DEMO` · `NOT_DEPLOYED`

가상 점포 한 곳과 예시 방문·앱 수집품을 보여주는 읽기 전용 정적 페이지입니다. 모든 점포·방문·수집품은 기능 설명용 가상 데이터이며 실제 영업점, 방문 실적 또는 NFT 발행 결과가 아닙니다. `DEMO` 배지에만 의존하지 않고 화면 상단과 각 내용에 이 경계를 한국어로 적습니다.

## 로컬 미리보기와 검사

저장소 루트에서 다음 명령을 실행합니다.

```bash
python3 -m http.server 4174 --directory apps/showcase-web --bind 127.0.0.1
```

브라우저에서 `http://127.0.0.1:4174/`을 엽니다. 별도 터미널에서 검사를 실행합니다.

```bash
node --test tests/site/verify_showcase_site_test.mjs
python3 scripts/verify-showcase-site.py
```

페이지에는 JavaScript·양식·쓰기 버튼·원격 자산을 넣지 않았습니다. 운영 API·DB와 연결되지 않으며 앱의 체험 진행 결과와 자동 동기화되지 않습니다. QR 촬영·방문 코드·지갑 연결·NFT 발행 요청은 웹에서 제공하지 않습니다.

[로컬 브라우저 검사 기록](../../docs/evidence/showcase-web-local-2026-09-23.json)은 자동 시험, 화면 크기·200% 글씨, 접근성 트리, 요청 경로와 외부 HTTPS `NOT_RUN`을 구분합니다. 시연 Android 앱·격리 API/DB와 실제 운영 웹의 개인 도감 로그인은 [분리 설계](../../docs/superpowers/specs/2026-09-23-showcase-production-separation-design.md)의 후속 범위입니다. 공개 도메인·호스팅·앱 배포는 아직 하지 않았습니다.
