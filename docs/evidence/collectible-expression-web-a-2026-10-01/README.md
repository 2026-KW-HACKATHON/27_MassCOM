# 사진 수집품 제작기 WP2(Issue #284) 화면 확인 · 로컬 QA fixture

2026-10-01 KST, `tests/fixtures/collectible-qa-server.mjs`(로컬 합성 fixture, 실제 API·DB·외부 계정 없음)를
`COLLECTIBLE_QA_PORT=4199`로 띄우고 Playwright로 점주 웹 제작기를 확인한 기록입니다. 이 폴더의 화면은 로컬
개발 환경의 것이며 운영·시연 공개 서버와 무관합니다.

## 환경

| 항목 | 내용 |
| --- | --- |
| 브랜치 | `feat/284-web-expression-a`, base `8d77f1f` + 마스코트 눈 깜빡임 프레임 병합(`d982059`) 위 |
| 서버 | `node tests/fixtures/collectible-qa-server.mjs`(합성 점주 1명, 캠페인 1개), 포트 4199 |
| 브라우저 | Playwright(Chromium), `http://localhost:4199/merchant/` |

## 찾은 문제와 고침

처음 제작기를 열었을 때 `/app/assets/mascot/stamp.png`가 404였다. 운영 서버(`apps/production-web/server.mjs`)의
허용 목록은 이번 PR에서 고쳤지만, 이 QA fixture 서버(`tests/fixtures/collectible-qa-server.mjs`)는 `assets/`
바로 아래 파일만 서빙하는 별도의 단순 정적 파일 정규식을 갖고 있어 `assets/mascot/<pose>.png`처럼 한 단계
더 들어간 경로를 받지 못했다. 정규식을 고쳐(`assets/(하위폴더/)?파일명`) 두 경로 모두 서빙하게 했다
(`tests/fixtures/collectible-qa-server.mjs`). 자동 시험(`tests/site/collectible-mascot-assets.test.mjs`)은
운영 server.mjs만 확인하므로 이 QA fixture 전용 결함은 실제 브라우저로 열어 보기 전까지 보이지 않았다.

## 이미지

| 파일 | 내용 |
| --- | --- |
| [01-stickers-panel.png](01-stickers-panel.png) | "앞면·뒷면 스티커" 패널 기본 모습(앞면·텍스트 종류, 최대 4줄 textarea, 정렬 select) |
| [02-mascot-kind.png](02-mascot-kind.png) | 종류를 "마스코트"로 바꾸면 자유 텍스트 칸 대신 마스코트 포즈 select("만세" 등 12종)가 나온다 |
| [03-mascot-sticker-preview.png](03-mascot-sticker-preview.png) | "만세" 포즈 마스코트 스티커를 추가한 뒤 완성 미리보기(펭귄이 동전 가운데 작게 그려진다) |
| [04-back-default.png](04-back-default.png) | 회전 180°에서 본 기본 뒷면: 안쪽 테두리, 가게 이름("로컬 검수 가게"), 수집품 이름, 등급("브론즈"), 마스코트 도장 |
| [05-motion-confetti-particle.png](05-motion-confetti-particle.png) | "움직임과 두께"에서 "작은 축하 입자(confetti)" 템플릿을 고르면 재생 방식(반복/한 번만) 라디오와 파티클 종류(색종이 등) select가 나온다 |
| [06-back-custom.png](06-back-custom.png) | 뒷면 모드를 "커스텀"으로 바꾸고 바탕색과 텍스트 스티커("고마워요!")를 더한 뒤 회전 180°에서 본 모습 |

## 같은 확인에서 봤지만 캡처하지 않은 것

- "효과 대상" select에 추가한 마스코트 스티커가 "스티커 · 마스코트 · 만세"로 나와 앞면 스티커가 효과 대상이 될 수 있음을 확인했다(스크린샷 없음, 접근성 스냅샷으로 확인).
- 스티커 종류·편집 폼의 disabled/활성 전환(스티커를 고르기 전엔 위치·크기 칸이 잠겨 있다)이 기대대로 동작했다.
- 콘솔 오류 없음(수정한 404 제외하고는 전 과정에서 0건).

## `NOT_RUN`

"이 등급만 따로 배치" 토글·"공통으로 되돌리기"·인사말 규칙 추가/삭제·once 재생 뷰어 자동/수동 재생의 실제 화면
캡처(미니 DOM 시험으로는 확인했으나 이 QA 라운드에서 스크린샷을 추가로 찍지는 않았다), 실제 게시·발행 흐름
(사진 업로드가 필요해 이번 QA fixture 라운드에서는 생략), 모바일 폭·다크 모드·TalkBack, 실제 AWS/운영 배포 환경.
