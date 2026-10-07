# 수정본 공개 시연 웹 재측정 (2026-10-08)

[이전 측정](../submission-2026-10-08/README.md)이 찾은 결함 4건을 [PR #405](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/405)(`9f5ebfa6`)에서 고친 뒤, 수정본이 올라간 공개 `/play/`를 같은 방식으로 다시 측정했다. 4건 모두 수정 확인(FIXED)이고, 5분 시연 15단계는 전부 PASS였다. 새로 본 낮은 결함 4건은 아직 고치지 않았다.

## 측정 조건

| 항목 | 값 |
| --- | --- |
| 대상 | `https://demo-api.masscom.kr/play/` (390×844) |
| 웹 번들 | 소스 `9f5ebfa6`, entry `entry-bf096d15e2c9fd7c9a6b8bc41de15c48.js`. 공개 HTML이 이 entry를 참조하고 HTTP 200 |
| 시연 API | `2d483ed`(migration 68건) |
| 측정 시각 | 2026-10-08 KST 새벽 |
| 도구 | Playwright |
| 계정 | 로그인 없는 임시 체험 계정. 시연 서버에만 만들었다. |
| 원자료 | [flow-recheck.json](flow-recheck.json) |
| 이전 측정 | [submission-2026-10-08](../submission-2026-10-08/README.md) (수정 전 번들 소스 `74e47887`, 17단계) |

이 번들에는 [PR #402](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/402)(`a742e32d`, 뽑기 중 동의 필요 오류를 "동의 확인하기"로 연결)가 들어 있지 않다. 그 변경은 다음 빌드에서 공개본에 반영한다.

## 결함 4건 재측정

| 결함 | 판정 | 확인한 내용 | 근거 |
| --- | --- | --- | --- |
| (a) 하위 화면의 하단 "놀이" 탭이 `/play/-tab` 404로 이동 | FIXED | 하위 화면 5곳(마이룸 꾸미기 `/studio`, 내 코인·시리즈 `/coin-collection`, 가게 이웃 방 `/room-explore`, 내 정보 `/settings`, 친구 `/friends`)에서 놀이 탭이 모두 놀이 허브 `/play-tab`으로 이동했다. 직접 URL 10곳(`studio`, `profile`, `coin-shop`, `coin-collection`, `friends`, `home/exhibit`, `home/missions`, `room-explore`, `settings`, `search`)도 모두 `/play-tab`으로 갔고 404는 없었다. | `fix-a-studio-after-play-tab.png`, `fix-a-my-coins-after-play-tab.png`, `fix-a-neighbors-after-play-tab.png`, `fix-a-my-info-after-play-tab.png`, `fix-a-friends-after-play-tab.png` (수정 전 모습은 같은 이름의 `-before.png`), 흐름 13단계 |
| (b) "도장 쾅!" 방문 완료 화면이 투명해 뒤 화면과 겹침 | FIXED | 대화 상자가 화면 전체를 덮었다. 중복 버튼 0, 글자 겹침 0. 네 모서리 픽셀이 좌상·우상 rgb(192,227,255), 좌하·우하 rgb(247,251,255)로 뒤 화면이 비치지 않았다. | `fix-b-stamp-celebration.png`, `fix-b-stamp-celebration-bottom.png`, `fix-d-dark-stamp-celebration.png`, `flow-07b-stamp-celebration.png` |
| (c) 내 정보·친구에서 하단 탭이 이동하지 않음 | FIXED | 두 화면 모두 탐색→`/search`, 도감→`/collection`, 홈→`/`, 상점→`/shop`, 놀이→`/play-tab`로 5개 탭 모두 이동했다(10/10). | `fix-c-my-info-{홈,탐색,도감,상점,놀이}.png`, `fix-c-friends-{홈,탐색,도감,상점,놀이}.png` (수정 전 모습은 `fix-c-my-info-before.png`, `fix-c-friends-before.png`) |
| (d) 다크 모드 하단 흰 띠와 흰색 마이룸 코인 카드 | FIXED | 다크 390에서 마이룸·꾸미기·내 정보·내 코인 화면의 하단 40px 최대 밝기가 모두 65였다(흰색이면 약 250). 마이룸 코인 카드 배경은 rgb(29,52,49)(밝기 47)였다. 단, 꾸미기의 "대표 수집 코인" 칩은 다크에서도 흰색이다(아래 새 결함 3). | `fix-d-dark-myroom.png`, `fix-d-dark-myroom-bottom.png`, `fix-d-dark-studio.png`, `fix-d-dark-studio-bottom.png`, `fix-d-dark-my-info.png`, `fix-d-dark-my-info-bottom.png`, `fix-d-dark-my-coins.png`, `fix-d-dark-my-coins-bottom.png`, `fix-d-dark-studio-coin-exhibit.png`, `fix-d-dark-studio-coin-pick.png`, `fix-d-dark-studio-coin-saved.png`, `fix-d-dark-album.png` |

## 5분 시연 흐름 (390×844 라이트, 15단계 전부 PASS)

이전 17단계에서 "놀이 허브"와 "게임 1판"을 한 단계(13)로 합쳤고, "내 코인·뽑기권" 화면은 흐름 대신 결함 (a)·(d) 확인에서 봤다. 영상 시작 시각은 [flow-recheck.json](flow-recheck.json)의 `videoStartSec`이다.

| 단계 | 화면 | 결과 | 캡처 | 영상 시작 |
| --- | --- | --- | --- | --- |
| 01 | 역할 선택 | 가치 한 줄·3단계 안내·역할 2개 표시 | `flow-01-role.png` | 0:00 |
| 02 | 로그인 없이 체험 | 임시 계정 안내 확인 뒤 체험 시작 | `flow-02-guest.png` | 0:09 |
| 03 | 약관 동의 | 필수 동의 → 시작 버튼 활성 → 홈 진입 | `flow-03-terms.png` | 0:18 |
| 04 | 신규 홈 | 신규 상태 문구, 마일리지 100,000 | `flow-04-home.png` | 0:29 |
| 05 | 탐색 | 목록의 가게 3곳, 위치 미확인 3곳 | `flow-05-explore.png` | 0:38 |
| 06 | 가게 상세 | `/merchants/showcase-local-merchant` | `flow-06-store-detail.png` | 0:43 |
| 07 | 테스트 방문 | "도장 쾅!" +150 마일리지, `POST /showcase/test-visits` 201, 중복 버튼 0, 글자 겹침 0, 화면 전체를 덮음 | `flow-07a-claim.png`, `flow-07b-stamp-celebration.png` | 0:50 |
| 08 | 봉투 공개 | 봉투 → 카드 → 도감 보관 안내 | `flow-08a-envelope.png`, `flow-08b-reveal-card.png`, `flow-08c-reveal-stored.png` | 1:04 |
| 09 | 도감 | `/collection`, 배지 1/9 | `flow-09-album.png` | 1:25 |
| 10 | 상점·뽑기 | 브론즈 1회(100P) 결과 표시, 남은 100,050P, 브론즈·가게 코인 | `flow-10a-shop.png`, `flow-10b-gacha-confirm.png`, `flow-10c-gacha-result.png` | 1:32 |
| 11 | 마이룸 전시 | 코인 전시 선택 → 저장 알림, 1/6개 전시 | `flow-11a-myroom-studio.png`, `flow-11b-exhibit-pick.png`, `flow-11c-exhibit-saved.png` | 1:57 |
| 12 | 가게 이웃 방 | 랜덤 방 결과 "지금 둘러볼 공개 방이 없어요. 나중에 다시 찾아보세요." (`/room-explore`) | `flow-12a-neighbors.png`, `flow-12b-neighbors-random.png` | 2:15 |
| 13 | 놀이 허브·게임 | 이웃 방에서 놀이 탭 → `/play-tab` 허브, 주문표(연습 그림 2 두 장, 연습 그림 4 한 장)를 채워 배달, 결과 저장 | `flow-13a-play-hub.png`~`flow-13f-game-result.png` (6장) | 2:31 |
| 14 | 내 정보 | 임시 체험 계정 표시, 하단 탭 이동: 탐색 `/search`, 도감 `/collection`, 홈 `/`, 상점 `/shop` | `flow-14-my-info.png` | 3:02 |
| 15 | 점주 역할 전환 | "나의 체험 가게" 진입(`/appearance`), 탭 오늘·현황·가게 꾸미기 | `flow-15a-role-again.png`, `flow-15b-owner.png`, `flow-15-owner-today.png`, `flow-15-owner-decorate.png` | 3:41 |

## 오류

- `console.error`, `pageerror`, HTTP 4xx/5xx, 요청 실패가 모두 0건이었다. 중단된 미디어 요청도 없었다.
- 가게 이웃 방은 시연 데이터가 없어 랜덤 방 결과가 빈 상태 안내였다. 가구 가격·리롤권 지급량은 소유자 판단 대기라 이 측정 범위 밖이다.

## 대체 시연 영상

| 항목 | 값 |
| --- | --- |
| 파일 | [demo-flow-390.webm](demo-flow-390.webm) |
| 크기 | 10,053,739바이트(9.59MB) |
| 길이·해상도 | 4분 8초(248.3초), 390×844 |
| SHA-256 | `d05301abb9857a9f330d4fa440f323228851109f14417781df95719d29a095ae` |
| 내용 | 위 15단계를 한 번에 녹화한 시연 서버 웹 체험. 발표 중 네트워크가 막힐 때의 대체용이다. |

설치본 실기 영상이 아니다. 실제 설치·TalkBack·점주 현장 실증은 이 측정에 포함되지 않는다.

## 새로 본 낮은 결함 (미수정)

| # | 심각도 | 내용 | 근거 |
| --- | --- | --- | --- |
| 1 | 낮음 | 가게 이웃 방(`/room-explore`)에서 하단 탭이 두 벌 렌더링된다. 홈에서 들어왔는데 두 번째 벌만 "탐색"이 선택(`aria-selected=true`)으로 표시된다. | `flow-12a-neighbors.png`, `flow-12b-neighbors-random.png` |
| 2 | 낮음~중간 | 게스트 시작 → 가게 이웃 만나기 → 탐색 탭(`/play/search`) 뒤 브라우저 뒤로 가기가 앱 안 이전 화면이 아니라 앱 밖(`about:blank`)으로 나간다. 측정은 새 탭에서 시작한 조건이다. 웹 체험에서 뒤로 가기를 누르면 체험이 끊긴다. | `flow-recheck.json`의 `extraProbes.backNav` |
| 3 | 낮음 | 다크 모드 마이룸 꾸미기의 "대표 수집 코인" 칩이 흰색 그대로다. | `fix-d-dark-studio-coin-saved.png`, `fix-d-dark-studio-coin-pick.png` |
| 4 | 낮음 | 떠 있는 하단 탭 바(y=772~836, 뷰포트 844) 아래 8px 틈과 모서리로 스크롤 콘텐츠가 비친다. 라이트·다크 공통이다. | `fix-d-dark-album.png`, `fix-d-dark-myroom.png`, `flow-04-home.png` |

## 파일 목록 (70개, 이 README 제외)

| 묶음 | 개수 | 내용 |
| --- | --- | --- |
| `demo-flow-390.webm` | 1 | 대체 시연 영상 |
| `flow-recheck.json` | 1 | 원자료(단계별 결과·영상 시각·결함 판정·새 결함·측정 번들 확인) |
| `fix-a-*.png` | 10 | (a) 하위 화면 5곳의 놀이 탭 이동 전·후 |
| `fix-b-*.png` | 2 | (b) 도장 축하 화면 전체·하단 |
| `fix-c-*.png` | 12 | (c) 내 정보·친구의 수정 전 모습 각 1장과 탭 5개 이동 결과 |
| `fix-d-*.png` | 13 | (d) 다크 마이룸·꾸미기·내 정보·내 코인·도감·축하 화면과 하단, 대표 수집 코인 칩 |
| `flow-*.png` | 31 | 5분 시연 흐름 순서대로 찍은 라이트 화면 |
