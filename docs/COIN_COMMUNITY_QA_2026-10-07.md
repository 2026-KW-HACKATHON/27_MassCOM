# 가게 코인·방 탐험·시연 역할 전환 — 2026-10-07

[Issue #391](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/391). UI PR #390은 최종 HEAD1943556d의 CI37561996001 PASS 후 main09b485cb로 병합했다. 이 작업은 별도 `feat/coin-community-loop`이며 [설계](superpowers/specs/2026-10-07-coin-community-loop-design.md)·[실행 계획](superpowers/plans/2026-10-07-coin-community-loop.md)을 따른다.

## 채택·조정

- 가게별 브론즈/실버/골드/플래티넘 소비권을 캐릭터 꾸미기 뽑기와 구분한다. 구매는 티켓만 지급하며 사용 시 고정 풀에서 코인 한 개를 얻고 중복은 수량으로 남는다. 이벤트 코인도 해당 발행본의 가중치로 공개한다.
- 기존 코인/NFT 권리를 삭제하거나 새 뽑기에 가짜 방문/NFT 발행권을 붙이지 않는다. 기존 방문 수집품도 시리즈 진척에 합산한다. 결과는 다음 입력을 기다린다.
- 공개 방은 기본 비공개. 현재 동의·공개 철회·양방향 차단·계정 삭제를 재검사하고 공개 응답의 계정/수령권 ID와 개인 목표를 제외한다. 임의 공개 글 대신 칭찬 도장과 삭제/숨기기/신고/차단을 먼저 제공한다.
- 실제 집계되는 방문 이력이 있는 고객만 한국 날짜 첫 다섯 다른 방에 2P씩 받는다. 반복 방문/자기 방에는 지급하지 않으며 방 삭제도 원장에 기록한 일일 상한을 초기화하지 않는다.
- 시리즈당 한 장, 수령 당시 가능한 최고 혜택을 준다. 프리즘 상한 소진 시 기본으로 자동 강등하지 않는다. 기본 수령 후 프리즘 추가/변경 불가를 화면에서 확인한다. 코인은 소모하지 않는다.
- 사용자 예시의 실제 가게·1000원 쿠폰을 운영 데이터로 만들지 않았다. 동의 문서 참조·비용/기간/상한/중복 정책 확인과 명시한 발행 상한이 없으면 쿠폰 조건을 등록할 수 없다.
- 시연 점주 체험의 마지막 뒤로가기/메뉴는 역할 선택으로 돌아가고 고객 내 정보에서도 다시 선택한다. 점주 조회의 로딩/오류/거부에도 적용한다. 내부 화면 종료와 실제 점주 권한 검사는 보존한다.

## 코드와 단순화

| 범위 | 구현 |
|---|---|
| 가게 소비권·시리즈 | API `coin-economy.ts`, `postgres/coin-economy.ts`, migration0059; 기존 발행본 참조·원장·계정 잠금·crypto 난수 |
| 방 탐험 | `room-community.ts`, `postgres/room-community.ts`, migration0060; 기존 방 공개 projection와 마일리지 원장 |
| 통합 | `server.ts`의 기존 ExperienceServices/동의/관리자 CSRF; 기존 badge 직원 QR 사용·mileage 잔액·계정 삭제 |
| 앱 | `coin-shop`, `coin-collection`, `room-explore` 라우트/API; 상점·도감·받은 권리·놀이·내 방 링크 |
| 시연 왕복·결과 | 기존 showcase entry 상태/context·점주 뒤로가기 조건; gacha rewardTimer와 미사용 delay helper 제거 |

새 의존성·샘플 운영 점포·별도 지갑/환전·자유 글 시스템을 추가하지 않았다. 유효 티켓/쿠폰은 최근 이력100개 제한으로 숨기지 않고, 사용/만료 이력만 제한한다. 공개 방 랜덤 정렬은 현재 작은 동의 인구에 맞춘 기존 PG 기능이며 규모가 커지면 표본 추출 방식과 목록 페이지네이션을 따로 검토한다.

## 검사

| 검사 | 결과 | 범위 |
|---|---|---|
| API 전체 단위·HTTP | PASS 556/556 | 로그인/현재 동의/원치 않는 입력/웹 관리자 CSRF·actor 위조 거절 포함 |
| 모바일 전체 | PASS 1790/1790 | 구매 재확인·QR blur/background·웹 확인·역할 왕복·수동 결과 포함 |
| PG 전체 | PASS 506, SKIP3 / 총509 | 새 전용 `_test` DB·직렬 실행. 3개 hosted seed 시험은 별도55435 disposable container가 필요하며 CI의 해당 격리 단계에서 검사함 |
| 신규 PG 핵심 | PASS 8/8 | 동시 상한·멱등·실제 미사용 티켓 만료 무발행·101장 티켓/쿠폰·미디어 철회·직원 쿠폰 사용·삭제·방 보상/차단 |
| 타입·빌드·린트 | PASS | API 타입/build, 모바일 타입/lint |
| 접근성·비밀/개인정보 | PASS | 접근성 semantics, private QA 파일을 제외한 전체 소스 snapshot |
| 독립 검토 | PASS | API/모바일 필수 수정 완료. 도구의 기존 URL 진단과 프로젝트 타입 검사를 구분하며 신규 source 검사에는 Node URL 명시 |
| Android 비공개 APK | PASS | 정상 두 지도 공개 ID·서버 Secret 없음·기존 dev 서명·ZIP16KiB·32개 native library가 기존 검증본과 동일 |
| 실제 폰 기본 화면/왕복 | 부분 PASS | 최종 APK install-r 후 고객 내 정보→선택창, 점주 오류 화면 hardwareBack→선택창, 새 코인 두 빈 상태, 방 기본 비공개→동의/공개→철회→랜덤 빈 상태 확인 |

[기기/검사 증거](evidence/coin-community-2026-10-07/verification.json), [실기 사진](evidence/coin-community-2026-10-07/shipping-role-button.png), [APK 검사](evidence/coin-community-2026-10-07/private-apk.json), [빌드 당시 소스 해시](evidence/coin-community-2026-10-07/mobile-source-hashes.json)를 따른다. 시각 비교는 기존 상점/놀이의 스타일 기준을 사용해 새 기본 화면92점/PASS를 기록했다. 자동 영문 Stack 제목줄 중복을 실제 폰에서 발견해 세 라우트에 headerShown:false를 적용하고 다시 검사했다. 구매/발행/사용·허용된 점주의 전체 화면·다크/대형 글씨/진동 수용으로 확대하지 않는다.

PG 첫 실패는 새 시험이 시리즈 표시 순서를 가정하고 이전 시험의 FK 없는 원장을 남긴 fixture 문제였다. 대상 ID로 확인하고 전용 DB의 fixture 정리를 수정한 뒤 신규 8개와 전체509개를 다시 실행했다. 앱 첫 전체 실패의 기존 문구/고정 개수/허용된 이미지 목록은 새 동작에 맞추고 이미지 검증/동의/상태바 여백 조건은 유지했다.

최종 비공개 APK SHA256 `d0a8b58dc687a15845e6839081bd12e4eafa5a629816b44483516043e5ca7abb`, package `kr.masscom.wolgye.dev`. 인증서 SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. APK·지도 키·토큰·원시 로그는 Git에 넣지 않는다. 기존 night no·밀도450/size1080×2340 nooverride·font1.0을 다시 읽어 확인했고 방 공개도 비공개로 원복했다.

## 운영 연결

API에 migration0059·0060을 먼저 적용한 다음 API/앱을 함께 반영한다. 기존 캐릭터 구매의 잔액도 티켓 지출을 뺀 값을 사용한다. 신규 표에는 운영 seed가 없다.

고객 API: `GET /coin-shop`, `POST /coin-shop/purchases {poolId,requestId}`, `POST /coin-tickets/:id/use {}`, `GET /me/coins`, `POST /coin-series/:id/claim {}`. 구매 응답 유실 시 같은 요청 ID를 재전송하며 티켓 사용/시리즈 수령은 해당 권리 ID로 멱등 처리한다.

방 API: `GET/PUT /me/room-publication`, `GET /rooms/random`, `GET /rooms/:id`, `POST /rooms/:id/visits`, `POST /rooms/:id/stamps {kind}`, `DELETE /room-stamps/:id`, `POST /room-stamps/:id/reports`, `POST /rooms/:id/block`. 공개 철회 `{visible:false}`는 업데이트된 동의 수락 전에 가능하다.

관리자 API는 기존 웹 세션/동일 출처 JSON/플랫폼 관리자 검사를 사용한다. `POST /api/web/admin/coin-pools`, `POST /api/web/admin/coin-pools/:id/pause`, `POST /api/web/admin/coin-tickets/grant`, `POST /api/web/admin/coin-series`, `GET /api/web/admin/room-reports`, `POST /api/web/admin/room-stamps/:id/hide`. 풀 입력은 실제 merchantId/eventName/grade/price/구매 시작·끝/사용 만료/perAccountLimit/issuanceCap/발행본·grade 가중치 목록이다. 시리즈 입력은 실제 같은 publication별 기본/프리즘 목록, 점주의 기본·프리즘 혜택/validDays/issuanceCap, consentDocumentRef와 benefit/ownerPaysCost/validity/issuanceCap/duplicateUse 모두 true인 동의 확인이다. 동의 원문/개인정보는 참조 번호로 대체한다. 관리자는 풀을 사후 수정하지 않고 새 풀을 발행하며 판매 중단과 기존 티켓 사용 권리를 구분한다.

## 수용 경계

격리 합성 DB·계정·동의·권한의 자동/실기 QA를 실제 Google 계정·점주 동의·쿠폰 비용 부담·실사용으로 바꾸지 않는다. Loopback QA의 개발 헤더 매핑은 ignored harness에만 있으며 운영 인증 해석기는 바꾸지 않았다. 실제 쿠폰 등록/발행·공개 서버/Play·모든 글씨/다크/TalkBack·진동 체감은 별도다. 앞선 소리 청음 PASS와 진동 체감 미해결을 코드 검사로 바꾸지 않는다. 최종 공개 배포는 수행하지 않는다.
