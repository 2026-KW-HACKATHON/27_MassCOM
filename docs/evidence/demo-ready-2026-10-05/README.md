# 시연 준비와 점포 운영 보완 화면 근거

대상: [Issue #365](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/365), `feat/365-demo-ready`, 기준 main `f1013b7f`, 문서 수정 전 HEAD `fb5d8c54`, 2026-10-05 KST. 자동 시험·독립 검토·남은 확인은 [TEST_STATUS](../../TEST_STATUS.md)를 따른다.

## 검증 환경

Android 에뮬레이터는 720×1280 개발 빌드에서 로컬 API와 로컬 시연 DB를 사용했다. 공개 서버에 연결한 확인이 아니다. 글자 크기는 파일명의 100/200에 따라 100%/200%다. 웹 캡처는 저장소 밖 일회용 harness의 로컬 mock API에 연결한 브라우저이며 실제 점주·운영자 Google 로그인 세션이 아니다. 웹 글자 배율·브라우저 빌드 번호는 제공된 기록에 없어 기재하지 않는다.

추가 공개 설치본 검증(2026-10-05 KST, Issue #369): main `db28003`에서 만든 정확한 Preview 19 APK를 공개 시연 서버에 연결한 에뮬레이터(720×1280, 글꼴 100%)에서 확인했다. 아래 기존 개발 빌드·로컬 mock 근거와 구분한다. [릴리스 증거](../showcase-preview19-release-2026-10-05.json).

## 화면 파일

| 파일 | 보여 주는 내용·환경 |
| --- | --- |
| [emulator-100-collection-grid-and-home.jpg](emulator-100-collection-grid-and-home.jpg) | 개발 빌드·글자 100%: 도감 두 열 배치와 홈 화면 |
| [emulator-100-guest-trial-entry-consent-home.jpg](emulator-100-guest-trial-entry-consent-home.jpg) | 개발 빌드·글자 100%: 임시 체험 진입·동의·새 임시 계정 홈 |
| [emulator-200-collection-cards.jpg](emulator-200-collection-cards.jpg) | 개발 빌드·글자 200%: 도감 한 열 카드, 등급 우선·한국 시간 날짜·NFT 상태 세로 배치 |
| [emulator-200-coupon-expiry-notice-and-store-list.jpg](emulator-200-coupon-expiry-notice-and-store-list.jpg) | 개발 빌드·글자 200%: 쿠폰 만료 안내와 가게 목록 주소·“실제 방문 불가” 표시 |
| [emulator-200-coupon-reveal-scrolls.jpg](emulator-200-coupon-reveal-scrolls.jpg) | 개발 빌드·글자 200%: 쿠폰 공개 모달 스크롤 |
| [emulator-200-prism-detail-and-store-c.jpg](emulator-200-prism-detail-and-store-c.jpg) | 개발 빌드·글자 200%: 점포 C 5회 프리즘 상세 무지개 재질·가게 미리보기 “5번 방문 · 프리즘” |
| [emulator-200-visit-celebration-primary-first.jpg](emulator-200-visit-celebration-primary-first.jpg) | 개발 빌드·글자 200%: 방문 축하 제목 바로 아래 주요 행동 |
| [web-admin-campaign-extend-list.jpg](web-admin-campaign-extend-list.jpg) | 로컬 mock API 웹: 운영자 캠페인 남은 일수·30일 연장 요청/응답 반영 확인의 목록 화면(글자 배율 미기록) |
| [web-merchant-store-info-editor.jpg](web-merchant-store-info-editor.jpg) | 로컬 mock API 웹: 점주 소개·영업시간·메뉴 편집기(글자 배율 미기록) |
| [web-store-poster-print-preview.jpg](web-store-poster-print-preview.jpg) | 로컬 mock API 웹: 설치 QR 포스터 A4 한 페이지 인쇄 레이아웃(글자 배율 미기록) |
| [emulator-preview19-guest-trial-on-showcase-server.jpg](emulator-preview19-guest-trial-on-showcase-server.jpg) | 공개 Preview 19·공개 시연 서버·글꼴 100%: Google 로그인·로그인 없이 바로 체험 버튼/설명·임시 체험 시작·사용자 동의 화면·동의 거절 후 정상 로그아웃(동의 수락 이후 NOT_RUN) |
| [README.md](README.md) | 이 색인: 검증 환경·각 화면 설명·PASS/NOT_RUN 경계 |

## 확인 범위와 제한

**PASS:** 위 로컬 에뮬레이터·브라우저 화면 확인. 점포 C의 기존 발급 보상은 바뀌지 않으며 프리즘은 C를 아직 완료하지 않은 계정으로 확인해야 한다. “체험 처음부터 다시”는 확인창과 로컬 세션 회수 불가 사유·로그아웃·새 체험 안내까지 확인했고, 로그아웃→새 체험 순서는 단위 시험으로 검증했다.

**NOT_RUN:** 이 빌드의 Samsung 실폰·TalkBack·물리 기울임, 실제 시연 서버의 다시 시작 성공, 기기의 점주 현황 캠페인 안내·점주 홈, 운영 로그인·실제 QR·지갑, 새 기능의 실제 점주/운영자 Google 웹 세션·종이 인쇄, 공개 Preview 19 동의 수락 이후 홈·테스트 방문·C 프리즘·체험 처음부터 다시·체험 점포 점주 화면, 재빌드 이후 브라우저 웹 체험, DB 복원 훈련. 공개 서버 배포·새 APK 게시·시연 웹 번들 재빌드·일일 seed 설치 검증은 이후 db28003 배포로 완료했다([배포 근거](../deployment-db28003-2026-10-05.json)).
