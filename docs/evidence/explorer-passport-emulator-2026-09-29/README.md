# 탐험 여권 · Android 에뮬레이터 로컬 실측 (Issue #216)

2026-09-29 KST, 이 Mac의 Android 에뮬레이터 `MassCOM_Design_QA`(720×1280, 360dp)에 새 네이티브 모듈(`expo-haptics`·`expo-sharing`·`react-native-view-shot`)을 포함해 다시 빌드한 개발 앱 `kr.masscom.wolgye.dev`로 확인했습니다. API는 같은 브랜치 코드를 `127.0.0.1:3000`에서 개발 DEMO 계정 헤더로 실행했고, DB는 일회용 Docker PostgreSQL 16.10의 `masscom_showcase_test`(시연 seed: 가상 점포 A·B·C와 체험 혜택 3건)입니다. 운영·시연 공개 API/DB, 실제 점포, 실제 휴대전화에는 요청하지 않았습니다.

| 단계 | 상태 | 확인 내용 | 화면 |
| --- | --- | --- | --- |
| 빈 도감 | PASS | 새내기 탐험가·배지 0/9, 잠긴 메달 3개(회색 마스코트·점선), 잠긴 상자 3개와 등록된 체험 혜택 미리보기 | [02](02-medals-empty.png) |
| 방문 A·B·C 인증 축하 | PASS | 코드 확인→수령 뒤 "가상 점포 X 도장 쾅!", 도장 낙하·전체 화면 색종이, 동네 탐험가 브론즈→실버→골드 칩 | [04](04-visit-celebration-confetti.png) · [05](05-gold-and-box-unlocked.png) |
| 상자 열림 안내 | PASS | 골드 달성 시 "첫 번째 상자를 열 수 있어요", 여권의 열기 버튼이 상자 영역으로 이동 | [01](01-passport-ready-box.png) · [03](03-reward-boxes.png) |
| 상자 열기→쿠폰 | PASS | 흔들림 뒤 "쿠폰이 나왔어요!", 체험 음료 1잔·~10월 29일까지 티켓 | [07](07-coupon-reveal.png) |
| 매장 사용 QR | PASS | 2분 식별 QR·확인 코드·남은 시간·안내 문구가 640dp 높이에서 스크롤로 모두 보임(토큰이 담긴 QR 화면은 저장소에 넣지 않음) | — |
| 점원 사용 처리 | PASS | 점원 계정 API로 조회→사용 처리, 같은 요청 `replayed:true`, 다른 점포는 `CUSTOMER_IDENTITY_UNAVAILABLE`; 앱이 3초 확인으로 "사용 완료!" 도장 표시 | [08](08-coupon-redeemed.png) |
| 사용한 쿠폰·스탬프판 | PASS | 사용 완료 도장이 글자를 가리지 않음, 방문한 점포 스탬프와 짧은 다음 목표 | [09](09-used-ticket-stamps.png) |
| 이미지 공유 | PASS | Android 공유창에 4:5 카드(마스코트·골드 메달·"서로 다른 가게 3곳을 발견했어요"·masscom.kr), 계정·날짜·점포 목록·QR 없음 | [06](06-share-card-sheet.png) |
| 라이트 모드 | PASS | 메달·상자 대비 확인 | [10](10-light-medals.png) |
| 글자 200% | PASS | 메달·상자·요약이 세로로 쌓이고 잘림 없음 | [11](11-font-200-strip.png) |
| 운영 웹 도감 | PASS | 같은 로컬 API를 대리한 `apps/production-web`에서 메달 3종·상자 상태·사용한 쿠폰을 글자로 표시 | — |
| 시연 점원 화면(`.demo` STAFF) 쿠폰 카드 | NOT_RUN | 시연 전용 OAuth 빌드가 필요해 단위 시험만 수행 | — |
| 실제 휴대전화·TalkBack 낭독·실제 점포 쿠폰·공개 서버 배포 | NOT_RUN | 이번 실측 범위 밖 | — |

검수 중 발견해 같은 브랜치에서 고친 결함: 점포가 있으면 개발 빌드 도감 탭이 `Link asChild` 스타일 배열로 렌더 오류(기존 main에도 존재), 축하 모달이 하단 탭을 덮지 못함(`navigationBarTranslucent` 제거), 공유 카드 투명 영역이 검은 띠로 캡처됨, 좁은 화면의 메달·상자 글자 줄바꿈, 사용 완료 도장의 글자 가림.
