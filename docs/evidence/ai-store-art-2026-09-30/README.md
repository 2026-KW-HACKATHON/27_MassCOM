# 사장님 AI 가게 그림 · 실제 휴대전화 로컬 실측 (Issue #236)

2026-09-30 KST, Samsung 휴대전화(SM-S928N)에서 [사장님 AI 가게 그림](../../superpowers/specs/2026-09-29-ai-store-art-design.md)(D-048)의 점주 흐름과 고객 화면 표시를 확인한 기록입니다. **실제 OpenAI API는 부르지 않았습니다.** 그림은 로컬 가짜 이미지 서버(`scripts/fake-openai-images.mjs`)가 돌려준 단색 이미지라 실제 AI 그림의 모양·품질·크기와 다릅니다. 이 폴더의 화면은 로컬 개발 환경의 것이며 운영·시연 공개 서버, 공개 APK, 실제 점포와 무관합니다.

## 환경

| 항목 | 내용 |
| --- | --- |
| 기기 | Samsung SM-S928N 실제 휴대전화, 화면 폭 411dp. 캡처는 540×1055이며 위쪽 상태 표시줄과 아래 시스템 버튼 줄은 잘라냈다. 라이트 모드·기본 글자 크기 |
| 앱 | 개발 앱 `kr.masscom.wolgye.dev`, Metro 개발 서버로 이 브랜치(`feat/236-ai-store-art`, 리뷰 반영 `82c1d54`) 소스를 불러옴. 가게 그림 화면은 `masscom-dev://merchant-art?merchantId=showcase-local-merchant`로 열었다(개발 빌드는 로컬 확인용으로 이 경로를 열 수 있고 운영 앱은 열 수 없다) |
| API·DB | 같은 브랜치의 로컬 API(`82c1d54` 코드로 다시 띄움, migration 0029. 최종 시도 표지 `final_spend_id`가 들어간 `f18cb01`보다 앞이다), 일회용 로컬 PostgreSQL, `OPENAI_API_KEY`는 가짜 값, `AI_ART_OPENAI_BASE_URL=http://127.0.0.1:4010`, `AI_ART_STAFF_MAY_MANAGE=true`(시연 서버와 같은 설정) |
| 권한 | 폰 계정 `android-device-phase1`에 가상 점포 A의 STAFF를 **로컬 DB에만** 줬다. 다른 계정의 같은 요청은 403 |
| 가짜 이미지 서버 | 시안은 스타일마다 다른 단색, 최종은 고른 시안 색을 조금 밝게. 03을 찍을 때만 고급 그림 요청을 서버 오류로 실패하게 했다(`FAKE_OPENAI_FAIL=server_error`, `FAKE_OPENAI_FAIL_PATH=edits`) |
| 화면의 톱니 버튼 | 오른쪽 위의 회색 톱니 둥근 버튼은 Expo 개발 클라이언트의 도구 버튼이지 앱 화면이 아니다 |

## 이미지

| 파일 | 내용 |
| --- | --- |
| [01-generating.png](01-generating.png) | "AI 시안 받기"를 누른 뒤. 지금 가게 그림(글자 도장), 오늘 남은 횟수, "AI로 만든 그림이에요. 가게 이름과 메뉴 이름만 사용해요." 안내, 돋보기 마스코트와 "AI 시안을 그리는 중이에요 / 1~2분 걸려요. 화면을 떠나도 계속 만들어요." |
| [02-drafts-selected.png](02-drafts-selected.png) | 시안 4장(도장·스티커·수채화·판화). 고른 시안은 두꺼운 테두리·체크·"스티커 · 선택됨" 글자로 표시(색만으로 구분하지 않음) |
| [03-final-failed-repick.png](03-final-failed-repick.png) | 고급 그림 요청이 실패한 뒤. 실패 안내와 "시안은 그대로 남아 있어요" 설명, 같은 시안 4장, "이 시안으로 고급 그림 다시 만들기", "AI 시안 받기". 새 시안 라운드 없이 다시 고를 수 있다 |
| [04-final-ready.png](04-final-ready.png) | 다른 시안(수채화)으로 다시 만든 고급 그림 완성. "가게 그림으로 쓰기"·"새 시안 받기". 고급 그림 남은 횟수가 실패 1회와 성공 1회만큼 줄었다 |
| [05-applied.png](05-applied.png) | 확인 창을 거쳐 적용한 뒤. 지금 가게 그림이 바뀌고 "사장님이 고른 AI 그림을 고객 앱에 보여 주고 있어요", "기본 그림으로 되돌리기" |
| [06-customer-list.png](06-customer-list.png) | 고객 탐색 목록. 가상 점포 A의 둥근 문장이 새 그림, B는 글자 도장 그대로 |
| [07-customer-detail.png](07-customer-detail.png) | 가상 점포 A 상세. 머리 그림이 새 그림이고 "사장님이 고른 AI 그림" 표시 |
| [08-customer-map.png](08-customer-map.png) | 동네 지도의 A 핀이 새 그림 |
| [09-customer-stamps.png](09-customer-stamps.png) | 도감 도장판의 A 도장이 새 그림 |

## 같은 실측에서 확인했지만 캡처하지 않은 것

- 확인 창을 여는 버튼을 빠르게 두 번 눌러도 확인 창은 하나만 열린다.
- "기본 그림으로 되돌리기" 뒤 고객 목록의 그림 주소가 사라지고, 옛 공개 그림 주소는 404(리뷰 반영 전 `9932e4d`에서 확인).
- 권한 없는 다른 계정의 가게 그림 요청은 403.
- 리뷰 반영 전 `9932e4d`에서 찾은 "AI 시안을 그리는 중이에요" 제목 잘림은 고친 뒤 01처럼 한 줄로 보인다.

## `NOT_RUN`

실제 OpenAI 호출(그림 품질·비용·지연), 실제 1024² 이미지 크기의 전송·표시, 정책 차단·키 없음·예산 소진·하루 한도 화면의 실기, 다크 모드·큰 글자·TalkBack, 시연 APK(Preview)에서의 점주 모드 진입, 시연·운영 서버 배포.
