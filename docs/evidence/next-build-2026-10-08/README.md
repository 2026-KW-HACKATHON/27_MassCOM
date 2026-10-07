# 다음 빌드 공개 시연 웹 확인 측정 (2026-10-08)

[이전 재측정](../submission-2026-10-08-recheck/README.md)이 남긴 낮은 결함 4건(이웃 방 탭 바 두 벌, 웹 뒤로 가기 이탈, 다크 대표 수집 코인 칩, 탭 바 아래 틈)을 고친 소스 `5ca98955`가 공개 `/play/`에 올라갔는지 빠르게 확인했다. 요청한 항목 전부 PASS였고 새 결함은 없었다.

## 측정 조건

| 항목 | 값 |
| --- | --- |
| 대상 | `https://demo-api.masscom.kr/play/` (390×844, deviceScaleFactor 2, 라이트·다크) |
| 웹 번들 | 소스 `5ca98955`(소유자 제공), entry `entry-858be2c61591f08ea88654ceed5f67ec.js` |
| 도구 | Playwright(Chrome, headless) |
| 계정 | 로그인 없는 임시 체험 계정. 시연 서버에만 만들었다. 운영(`api.masscom.kr`, `www.masscom.kr/app/`)에는 접속하지 않았다. |
| 원자료 | [next-build-check.json](next-build-check.json) (항목별 판정은 `verdicts`) |
| 이전 측정 | [submission-2026-10-08-recheck](../submission-2026-10-08-recheck/README.md) |

공개 HTML에는 소스 커밋이 없고 entry 해시만 있다. 소스 `5ca98955`와의 대응은 entry 해시가 소유자 안내와 같다는 데서만 확인했다.

## 항목별 판정

| # | 확인 | 판정 | 근거 | 캡처 |
| --- | --- | --- | --- | --- |
| 1 | 공개 HTML이 위 entry를 서빙 | PASS | HTML의 `<script>`가 `entry-858be2c6…js`를 참조, 실제 로드됐고 HTTP 200. | `flow-01-role.png` |
| 2 | 이웃 방 하단 tablist 1개, '탐색' 선택 | PASS | `/room-explore`에서 `[role=tablist]` 전체 1개, 화면에 보이는 것 1개, `aria-selected=true`는 "탐색" 하나. 라이트·다크 모두 같았다. (이전: 2개) | `neighbors-light-tablist.png`, `neighbors-dark-tablist.png` |
| 3 | 이웃 방 → 탐색 탭 → 뒤로 가기 | PASS | 새 컨텍스트(기록: about:blank, `/play/`, `/play/room-explore`)에서 탐색 탭(`/search`) 뒤 뒤로 가기 → `/play/room-explore`, about:blank 이탈 없음, tablist 1개·"탐색" 선택 유지. 놀이 탭(`/play-tab`) 뒤 뒤로 가기도 `/play/room-explore`. 라이트·다크 모두 같았다. (이전: about:blank로 이탈) | `back-after-explore-tab-light.png` |
| 4 | 다크 꾸미기 '대표 수집 코인' 칩 색 | PASS | 칩 2개 모두 배경 rgb(29, 52, 49)(밝기 47), 글자 rgb(243, 245, 249). 흰색 아님. (이전: 흰색) | `dark-studio-chip.png` |
| 5 | 떠 있는 탭 바 아래 띠(바 bottom 836 → 뷰포트 844, 8px)가 배경으로 덮임 | PASS | 홈·탐색·도감·상점·놀이 5개 탭 × 스크롤 0·50·100% 3지점에서 띠 픽셀이 3지점 모두 동일해 뒤 콘텐츠가 비치지 않았다. 다크는 8px 전체가 rgb(20, 42, 38) 한 색(화면 배경과 같음). 라이트는 탭 바 그림자로 행 평균이 rgb(228,234,226)에서 rgb(235,240,232)로 번지는 완만한 단색 계열이고, 화면 배경 rgb(241,245,237)과 최대 13 차이다(비침 아님). (이전: 틈으로 콘텐츠가 비침) | `strip-light-album-mid.png`, `dark-strip-album-mid.png` |
| 6a | 하위 화면 놀이 탭 → 허브 | PASS | 마이룸 꾸미기·내 코인·이웃 방·내 정보·친구 5곳 모두 `/play-tab` 허브, 404 없음. | `reg-a-play-hub-from-neighbors.png` |
| 6b | "도장 쾅!" 불투명 | PASS | 라이트·다크 모두 모서리 4점과 중앙의 최상단 요소가 대화 상자 안이고 불투명 배경(라이트 rgb(247,251,255), 다크 rgb(24,33,49)). 중복 버튼 0, 글자 겹침 0. 라이트 모서리 픽셀은 이전 측정과 같다. | `flow-07-stamp-celebration.png`, `dark-stamp-celebration.png` |
| 6c | 내 정보·친구 탭 이동 | PASS | 두 화면 모두 탐색 `/search`, 도감 `/collection`, 홈 `/`, 상점 `/shop`, 놀이 `/play-tab`. 10/10. | JSON `items.regC` |
| 6d | 다크 하단 흰 띠 없음 | PASS | 마이룸·꾸미기·내 정보·내 코인 모두 탭 바 아래 띠의 최대 밝기 38, 탭 바 영역 밖 하단 40px 최대 밝기 38(흰색이면 약 250). | `dark-myroom-bottom.png`, `dark-my-info-bottom.png`, `dark-my-coins-bottom.png`, JSON `items.regDDark` |

측정 중 바로잡은 것 두 가지. (1) 처음 쓴 "하단 40px 최대 밝기"는 탭 바 안의 글자·아이콘(밝기 207)이 섞여 들어가 6d를 잘못 FAIL로 냈다. 탭 바 아래 띠와 탭 바 밖 영역으로 다시 쟀다. (2) 처음 쓴 "띠가 한 색인가"는 라이트의 탭 바 그림자 때문에 FAIL로 나왔다. 스크롤 3지점 해시 비교로 바꿔 비침 여부를 가렸다. 두 보충 측정 결과는 JSON에 합쳤다.

## 짧은 흐름 (라이트, 12단계 전부 PASS)

| 단계 | 화면 | 결과 | 캡처 |
| --- | --- | --- | --- |
| 01 | 역할 선택 | entry 일치, 가치 한 줄·역할 2개 표시 | `flow-01-role.png` |
| 02 | 로그인 없이 체험 | 체험 시작 | |
| 03 | 약관 동의 | 필수 동의 → 시작 활성 → 홈 진입 | |
| 04 | 홈 | 신규 홈 문구, 마일리지 100,000 | `flow-04-home.png` |
| 05 | 탐색 | 가게 3곳 | `flow-05-explore.png` |
| 06 | 가게 상세 | `/merchants/showcase-local-merchant` | |
| 07 | 테스트 방문 | "도장 쾅!" +150, `POST /showcase/test-visits` 201, 불투명 | `flow-07-stamp-celebration.png` |
| 08 | 봉투 | 봉투 → 카드 → 도감 보관 안내 | `flow-08-envelope.png` |
| 09 | 도감 | `/collection`, 배지 1/9 | `flow-09-album.png` |
| 10 | 상점 등급 뽑기 1회 | 브론즈 100P, 남은 100,050P | `flow-10-gacha-result.png` |
| 11 | 마이룸 | 코인 전시 선택 → 저장, 1/6개 전시 | `flow-11-exhibit-saved.png` |
| 12 | 놀이 1판 | 이웃 방에서 놀이 탭 → `/play-tab`, 주문 맞추기 1/4 전달, 결과 저장 | `flow-12-game-result.png`, `reg-a-play-hub-from-neighbors.png` |

## 오류

| 종류 | 건수 |
| --- | --- |
| `console.error` | 0 |
| `pageerror` | 0 |
| HTTP 4xx/5xx, 요청 실패 | 0 |
| 중단된 오디오 요청(`draw-loop.mp3`, `ERR_ABORTED`) | 21 (오류 아님) |

중단된 오디오는 측정이 화면을 `page.goto`로 바꿀 때 뽑기 소리 파일 내려받기가 끊긴 것이다. 흐름 1~12단계에서는 0건이었고 재생 오류도 없었다.

## 새 결함

없음. 이전 낮은 결함 4건은 모두 고쳐졌다(위 2·3·4·5).

## 한계

- 항목 3은 새 컨텍스트(기록 3칸)에서만 쟀다. 앱 안에서 오래 돌아다닌 뒤의 뒤로 가기 깊이는 이 측정 범위 밖이다.
- 게스트 체험 흐름이며 설치본 실기·TalkBack·점주 현장 실증은 포함하지 않는다.
- 캡처는 20장으로 제한해, 다크 이웃 방 뒤로 가기 직후 화면은 저장하지 않고 URL·tablist 값만 JSON에 남겼다.

## 파일 목록 (이 README 제외 21개)

| 묶음 | 개수 | 내용 |
| --- | --- | --- |
| `next-build-check.json` | 1 | 원자료(항목별 판정, 흐름, 띠 행별 색, 오류) |
| `flow-*.png` | 9 | 흐름 캡처 |
| `neighbors-*`, `back-after-*`, `reg-a-*` | 4 | 이웃 방 tablist(라이트·다크), 뒤로 가기 직후, 하위 화면 놀이 탭 |
| `strip-*`, `dark-*` | 7 | 탭 바 아래 띠, 다크 칩·도장·하단 |
