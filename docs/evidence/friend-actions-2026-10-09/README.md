# 친구 그림 버튼·날짜 선택기·글 방명록 검증

2026-10-09 KST, [Issue #436](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/436), 결정 [D-104](../../DECISIONS.md). 작업 브랜치 `feat/friend-actions-guestbook`은 PR #433 반영 `c7632b35`에서 시작했다. 후속 fetch의 PR #434 반영 `origin/main` `3645c4c7` 통합과 최종 PR 전달은 진행 중이다. 이 기록은 공개 서버에 적용된 기능이나 제출 기준선을 선언하지 않는다.

## 화면과 동작

로컬 Expo 웹 출력과 합성 계정·API 응답으로 320×844/360×844/390×844, 밝은/어두운 테마를 각각 실행했다. Windows11 Home10.0.26200 x64·Chrome154.0.8037.98에서 친구/선택기6/6·방6/6 조건이 PASS다. 브라우저 화면48장과 요청 기록은 실제 DB 통합 시험과 분리한다. 실제 Google 로그인·운영 사용자 정보는 사용하지 않았고 브라우저 외부 요청은 막아 loopback만 허용했다.

| 화면 | 대표 이미지 | 확인 내용 |
| --- | --- | --- |
| 친구 오른쪽 버튼 | [친구390 밝은 화면](friends-390-light.png) | 하트·편지·숟가락·집48px 버튼, 긴 이름, 분홍→회색·금색→회색과 요청 |
| 날짜·시간 | [날짜320 어두운 화면](date-picker-320-dark.png), [시간390 밝은 화면](time-picker-390-light.png) | 숫자 휠·확인/취소·시간 범위, 연도 입력·추천 버튼 없음, 과도한 빈 공간 수정 |
| 방문 방명록 | [방명록390 밝은 화면](guestbook-390-light.png) | 글 작성5P·같은 방 재작성0P·목록, 방 화면 위 작은 창 |
| 작성자 정보 | [작성자320 어두운 화면](guestbook-profile-320-dark.png) | 이름·프로필·달성도·업적·친구 추가, 팝업 중 방 URL 유지 |
| 새 글 표시 | [홈390 밝은 화면](home-unread-390-light.png), [마이룸390 밝은 화면](myroom-unread-390-light.png) | 홈 꾸미기와 마이룸 방명록 표시, 실제 목록 확인 후 빨간 점 해제 |
| 공개 선택 | [공개 설정320 밝은 화면](visibility-320-light.png) | 모두에게 공개·친구에게만 공개·나만 보기 |

[친구·날짜/시간 실행 기록](browser-results.json), [방·방명록 실행 기록](room-browser-results.json)에 각 폭·테마의 확인과 요청을 남겼다. 선택기의 빈 공간·ARIA 개선 뒤 같은 조건을 재검사했다. 공개 설정 실제 변경과 보상 후 헤더 갱신의 후속 확인 결과는 최종 기록 대기다. 브라우저 JS 오류는0건이었다. 웹 스크롤·접근성 속성 확인은 Android 손가락 드래그나 TalkBack 시험을 대신하지 않는다. 로컬 재현 도구는 ignored `.omx/friend-actions-fixture.mjs`, `.omx/friend-actions-browser.cjs`, `.omx/friend-actions-room-browser.cjs`이며 `QA_FULL=1`로 전체 조건을 실행한다.

## 자동 시험과 재현

Windows에서 동일 작업 트리로 실행했다. API·모바일 의존성은 lockfile이 같은 기존 설치를 사용했으며 새 패키지를 추가하지 않았다. 전체 명령·한계는 [TEST_STATUS](../../TEST_STATUS.md)의 Issue #436 절을 따른다.

| 범위 | 판정·결과 | 재현 명령/조건 |
| --- | --- | --- |
| API 단위 | PASS 677/677 | `npm test --prefix apps/api` |
| 모바일 단위 | PASS 2182/2182 | `npm test --prefix apps/mobile`; 이후 보상·친구 수 갱신 대상31/31·44/44, 독립 검토 대상20/20 PASS |
| 타입·빌드 | PASS | API/모바일 `npm run typecheck`, API `npm run build` |
| 모바일 lint | PASS | `npm run lint --prefix apps/mobile`; 기존 무관한 미사용 변수 경고1, 오류0 |
| 우정 PostgreSQL | PASS 53/53 | 전용 로컬 테스트 DB에서 `social.postgres.integration.ts` |
| 방·친구·계정 삭제 대상 | PASS 57/57 | HTTP·단위·PostgreSQL 대상. KST 첫 글/별도25P·반복 작성·재시도·동시 요청·동의·차단·공개 범위·읽음 경합·신고/숨김·삭제 |
| 관련 웹·동의 | PASS 웹173/173·모바일8/8 | 공개 처리방침·운영 웹 복구/동의·앱 동의 버전 계약 |
| Android 운영 export | PASS | `APP_VARIANT=production`, 운영 API URL, `expo export --platform android --output-dir ../../.omx/android-production` |
| Android 시연 export | PASS | `APP_VARIANT=showcase`, 시연 API URL·합성 OAuth 설정, `expo export --platform android --output-dir ../../.omx/android-showcase` |
| 비밀·CI 연결 | PASS | `bash scripts/check-secrets.sh`, `bash tests/ci/ci_wiring_test.sh`(103개 시험 파일) |

두 Android export는 `EXPO_NO_DOTENV=1`, `CI=1`, 유효한 소스 SHA로 각각 컴파일했다. 시연 OAuth 값은 컴파일용 합성 값이며 인증 성공을 시험하지 않았다. 번들 출력은 APK 빌드·서명·설치 결과가 아니다.

PostgreSQL 검증은 다른 작업과 분리한 로컬 클러스터(127.0.0.1:55447)와 테스트 전용 DB에서 실제 migration·트랜잭션·권한·경합을 실행한다. 기본 시간대는 UTC이며 KST 보상 경계는 서비스 시험에서 확인한다. 전체 `npm run test:postgres --prefix apps/api`는 실행 중으로 최종 판정 대기다. 합성 브라우저의5P 표시는 지급의 DB 증명이 아니며 실제 지급·중복 방지는 PostgreSQL 결과로 확인한다.

## API와 적용 순서

- 우정: `POST /me/friendship-gifts/:giftId/receive-and-reply`가 받기와 가능한 답장을 한 거래로 처리한다. 기존 받기 API는 유지한다.
- 방명록 목록/작성: `GET|POST /rooms/:roomId/guestbook`, `GET /me/room-guestbook`.
- 읽음: `POST /me/room-guestbook/read`에 실제 표시된 `entryIds`를 보낸다. 새로 도착한 다른 글을 함께 읽음으로 만들지 않는다.
- 작성자/친구: `GET /room-guestbook/:entryId/author`, `POST /room-guestbook/:entryId/friendship`.
- 삭제/신고: `DELETE /room-guestbook/:entryId`, `POST /room-guestbook/:entryId/reports`.
- 관리자: `GET /api/web/admin/room-guestbook-reports`, `POST /api/web/admin/room-guestbook/:entryId/hide`.

`0076_room_guestbook_actions.sql`을 새 API보다 먼저 적용해야 한다. API·앱·운영 웹·공개 처리방침은 `privacy-2026-10-09`로 함께 맞추며 현재 동의를 다시 확인한다. `PUBLIC`은 로그인과 현재 동의를 마친 사용자에게 공개한다. 기존 `NEIGHBORS`는 기존 제한을 유지하고 소유자가 바꾸기 전 자동으로 모두 공개하지 않는다. 기존 칭찬 스탬프는 새 글 입력과 별개로 이력·조회·신고/숨김을 보존한다.

이전 앱/API로 되돌릴 때에도 migration을 역실행하거나 방명록·보상 원장을 지우지 않는다. 새 `PUBLIC`·`ROOM_GUESTBOOK` 값을 이전 코드가 모두 지원한다고 간주하지 말고 기능 접근을 제한한 호환 수정으로 복구한다. 지급 이력과 중복 방지 키를 보존하며, 새 동의 버전과 공개 범위를 과거 값으로 강제로 낮추지 않는다. 이번 작업에서 운영 DB나 배포는 변경하지 않았다.

## 미실행·최종 기록 대기

**NOT_RUN:** 운영/시연 배포, 운영 데이터 확인, 새 APK·서명·설치, 실제 Android 드래그·TalkBack, 실제 Google 로그인, Play 게시. 기존 제출 기준선과 공개 설치본을 변경하지 않았다.

**최종 기록 대기:** 전체 PostgreSQL 결과, 최신 main `3645c4c7` 통합 후 필요한 재검사, 공개 설정/헤더 갱신 후속 브라우저 확인, 독립 검토 최종 판정, 실제 PR 한국어 검사와 PR URL. 진행 중 항목은 완료로 기록하지 않는다.
