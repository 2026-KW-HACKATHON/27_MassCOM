# 사진 수집품 제작기 WP3(Issue #284, PR #310 리뷰 수정) 화면 확인 · 로컬 QA fixture

2026-10-02 KST, `tests/fixtures/collectible-qa-server.mjs`(로컬 합성 fixture, 실제 API·DB·외부 계정 없음)를
`COLLECTIBLE_QA_PORT=4199`로 띄우고 chrome-devtools MCP(실제 Chromium)로 점주 제작기와 고객 뷰어를 확인한
기록입니다. 이 폴더의 화면은 로컬 개발 환경의 것이며 운영·시연 공개 서버와 무관합니다. 계정 식별자·QR은
포함하지 않았습니다.

## 환경

| 항목 | 내용 |
| --- | --- |
| 브랜치 | `feat/284-web-expression-b`, `origin/main` 병합 + PR #310 리뷰 수정(P1 2건 + P2 8건) 커밋 위 |
| 서버 | `node tests/fixtures/collectible-qa-server.mjs`(합성 점주 1명, 캠페인 1개), 포트 4199 |
| 브라우저 | chrome-devtools MCP(Chromium), `http://127.0.0.1:4199/merchant/`, `http://127.0.0.1:4199/app/` |
| 사진 | `sample.png` — 검수용으로 Pillow로 생성한 400×300 단색 PNG(개인정보 없음) |

## 확인한 흐름

1. 점주 제작기에서 사진을 올리고 패럴랙스 브러시(빨강 틴트)와 살아 있는 그림 영역(파랑 틴트)을 칠해, 브러시
   대상별 틴트 오버레이가 실제 캔버스에서 올바르게 구분되어 그려지는지 확인했다.
2. 홀로그램 효과(전체 표면, 강도 45%)를 추가하고 브론즈 등급에 연결, 살아 있는 그림(sway, 칠한 영역)도
   브론즈 등급에 연결한 뒤 "로컬 방문 캠페인"에 1회 방문 보상으로 연결해 게시했다.
3. 고객용 `/app/` 페이지를 열었다. 이 QA fixture는 `/api/web/consent`를 구현하지 않아("로컬 화면 검수
   전용" 주석대로 인증·동의 검증은 실제 API/DB 시험의 몫) 내 도감 화면이 "동의 상태를 확인하지 못했습니다"로
   막힌다. 이 막힘은 PR #310 변경과 무관한 fixture 범위 밖 제약이라, 우회로 `collectible-viewer.mjs`의
   실제 공개 함수(`openCollectible`)를 fixture의 `/api/web/collection` 응답으로 직접 호출해 같은 렌더러·같은
   DOM 뷰어를 열었다. 즉 미니 DOM이 아니라 실제 Chromium에서 `renderPublishedCollectible` 전체 경로를
   그대로 실행한 결과다.
4. 뷰어에서 회전 각도 0°/45°/90°를 라이트·다크 모드로 각각 캡처했다(angleFrames 크로스페이드 확인).
5. "움직임 줄이기"를 켜면 "기울여서 보기" 버튼이 바로 `disabled`로 바뀌는 것을 접근성 스냅샷으로 확인했다
   (PR #310 P2 #8 수정 사항의 실제 브라우저 재현).

## 이미지

| 파일 | 내용 |
| --- | --- |
| [01-parallax-brush-tint.png](01-parallax-brush-tint.png) | 패럴랙스 브러시로 칠한 스트로크가 빨강 틴트 오버레이로 표시됨 |
| [02-living-region-brush-tint.png](02-living-region-brush-tint.png) | 살아 있는 그림(영역) 항목의 스트로크가 파랑 틴트 오버레이로 표시됨 |
| [03-editor-preview-published.png](03-editor-preview-published.png) | 게시 직후 제작기 미리보기(브론즈, 홀로그램 전체 표면) |
| [04-viewer-light-angle0.png](04-viewer-light-angle0.png) | 고객 뷰어, 라이트 모드, 회전 0° |
| [05-viewer-light-angle90.png](05-viewer-light-angle90.png) | 고객 뷰어, 라이트 모드, 회전 90°(옆면 두께 angle-frame) |
| [06-viewer-light-angle45.png](06-viewer-light-angle45.png) | 고객 뷰어, 라이트 모드, 회전 45° |
| [07-viewer-dark-angle45.png](07-viewer-dark-angle45.png) | 고객 뷰어, 다크 모드, 회전 45° |
| [08-viewer-dark-angle0.png](08-viewer-dark-angle0.png) | 고객 뷰어, 다크 모드, 회전 0° |

## 같은 확인에서 봤지만 캡처하지 않은 것

- "움직임 줄이기" 체크 시 "기울여서 보기" 버튼이 `disabled`로 바뀌고, 해제하면 다시 눌릴 수 있는 상태로
  돌아오는 것을 접근성 스냅샷(스크린샷 없음)으로 확인했다.
- 뷰어의 "동작 재생"/"동작 정지" 토글과 회전 슬라이더 조작 시 콘솔 오류 없음.
- 살아 있는 그림(sway) 애니메이션 자체는 정지 스크린샷으로는 움직임을 보여줄 수 없어 별도 캡처하지 않았다
  (코드 경로는 `tests/site/collectible-pr310-p2.test.mjs`의 미니 DOM 회귀 시험으로 확인됨).

## `NOT_RUN`

iOS 기울임 권한 요청 플로우의 실기기 확인(미니 DOM 시험으로만 확인), 실제 운영/시연 배포 환경, 모바일 폭
뷰포트, 스크린리더(TalkBack/VoiceOver) 확인.
