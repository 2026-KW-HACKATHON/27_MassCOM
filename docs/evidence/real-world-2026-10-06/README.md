# 실사용 연결 전면 개편의 격리 QA 증거

Issue #381, `feat/real-world-experience`, 시작 기준 `b69ebc62`. 소스/PR/네이티브 artifact의 최종 식별자는 [수용 보고서](../../REAL_WORLD_STATUS_2026-10-06.md)를 따른다. 모든 점포·계정·사진·좌표는 **명시적으로 표시한 검증용 합성 데이터**다. 실제 Google 로그인·점주 동의·제휴·현장 방문이나 공급자 성공 응답을 생성하지 않았다.

## 실제 웹 조작

Chrome/CUA, 390×844, 로컬 Expo 실제 export와 기존 production-web 자산, 실제 PostgreSQL 서비스. 전용 `masscom_realworld_ui_test`와 기존 보호 조건을 만족하는 `masscom_showcase_ci_20261006_test`만 사용한다. 공개 서버를 바꾸지 않으며 웹 세션/체험 계정은 합성 검증용이다. Caddy Host/Origin 정규화는 private loopback proxy이며 실제 HTTPS 배포/OAuth 검증이 아니다.

- 미공개 PAUSED 점포의 층·호수·입구·메뉴·시간표·비공개 사진을 고객 미리보기로 확인했다. 공개 detail/photo는 여전히 404다. [미리보기](owner-unpublished-preview.png).
- 메뉴 가격만 7,000원으로 바꿔 저장했다. DB JSONB 필드/요일 순서가 다르다는 이유로 영업시간 재확인을 요구하던 오류를 재현·수정한 뒤 저장 및 미리보기 반영을 확인했다. [저장 후](owner-menu-save-preview-390.png).
- 공개된 합성 점포 5곳, 같은 이름/건물의 1층과 2층, 임시 영업·야간 영업·위치 미확인 1곳을 탐색 목록에서 구분했다. 출발지 없는 GPS 대신 수동 기준을 사용했다. SDK 키 미설정 시 주소 목록 대안을 명시한다. [첫 화면](explore-list-missing-key-390.png).
- 지도 컴포넌트가 비어 실행 화면이 사라지는 Metro 플랫폼 해석 오류와 수동 출발지에 camera.zoom이 섞인 요청 오류를 실제 화면에서 찾고 수정했다. 보행 요청은 missing-key 상태를 보여 주며 자동차/직선 가짜 경로를 만들지 않는다.
- 점주/admin 초안·사진·버전과 권한을 실제 HTTP로 확인했다: private 사진 200, public draft 404, 직원 쓰기 403, 잘못된 Origin 403, 오래된 version 409. 이 HTTP 결과는 사람의 Google 인증이나 실제 점주 가입을 대신하지 않는다.

## 네 게임의 조작·결과

정상 `/auth/guest-trial`과 실제 PG collection/play/studio/shop으로 새 합성 체험 계정을 열었다. 테스트용 동의 fixture는 사람의 약관 수락을 뜻하지 않는다. 보유 수집품이 없으므로 화면이 명시한 연습 자산으로 플레이했다. 전부 부분 진행 결과이며 완주·배지 지급이나 실제 가게 콘텐츠 플레이 수용을 주장하지 않는다.

| 게임 | 실제 조작 후 결과 | 서버 저장 표시 |
| --- | --- | --- |
| 쌓기 | 3/6층, 폭 14%, 195점 | PASS, [화면](practice-stack-result-390.png) |
| 기억 | 카드 4개 뒤집기, 틀린 짝 2회, 0/6쌍, 0점 | PASS, [화면](practice-memory-result-390.png) |
| 배달 | 왼/가운데 이동, 11/12구간에서 3회 충돌, 8구간 안전 통과, 625점 | PASS, [화면](practice-delivery-result-390.png) |
| 주문 | 물건 9개 조합, 3/4주문 전달, 연속 9개, 810점 | PASS, [화면](practice-orders-result-390.png) |

[실제 PG 원장 대조](browser-game-ledger-summary.json)에서 해당 합성 계정의 방문·보상·쿠폰·마일리지 거래는 모두 0건이다. raw action/mismatch 횟수는 DB가 보관하지 않으므로 null/unmeasured로 남겼다.

각 결과에 `이번 도전 결과 저장 완료`와 재도전/다른 게임 동작을 확인했다. 연습을 실제 방문·쿠폰·매출로 해석하지 않는다.

## 측정과 미실행

[Chrome 결과 화면 유휴 측정](web-result-idle-metrics.json): 443.72초 동안 TaskDuration 0.520644초, ScriptDuration 0.427438초, JS heap 22,265,072→21,974,556 bytes, LayoutCount 0. 목표는 종료된 게임 화면 평균 task 시간 1% 미만·heap 증가 5MiB 미만이며 이 조건에서 통과했다. Map key가 없고 데스크톱 Chrome인 측정이므로 지도 SDK/GPS/GPU·Android 배터리·실기 FPS 목표로 확대하지 않는다.

실제 지도 타일·POI·보행·GPS, 현장 QR/쿠폰·권한 변경, 새 APK 실기 설치, 실제 소리·진동·TalkBack/글자 200%·네이티브 공유/센서·성능은 NOT_RUN이다. 과거 진동 체감 FAIL은 해결된 것으로 바꾸지 않는다. 실제 merchant 동의/권한·SDK 공개 배포 조건·외부 키를 별도 충족해야 한다.
