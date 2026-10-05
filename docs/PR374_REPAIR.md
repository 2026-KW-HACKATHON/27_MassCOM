# PR #374 병합 복구 상태

2026-10-06 기준, `fix/pr374-review`는 PR #374 소스 `dbe8f09e0ac347d0aa08fde80817078648674cd2`와 `origin/main` `57e7746ff8586c60bc5555f731b93ddc789dcbc6`을 통합했다. PR #375와의 11개 충돌을 모두 해결하고 양쪽 변경을 보존했다. 아래 결과는 로컬 자동 검사와 합성 계정 CUA 검증이다. 원격 PR CI·병합은 PR의 최신 기록으로 확인하며 공개 배포·Play는 별도다.

## 수정 수용 기준

| 우선순위 | 재현 조건 | 통과 조건 |
| --- | --- | --- |
| P1 | A 세션에서 시작한 401이 B 로그인 뒤 늦게 도착한다. | 오래된 A 응답은 B의 push generation, listeners, token refresh 또는 진행 중 registration을 해제하지 않는다. |
| P2 | 양쪽 친구에게 새로고침 전에 pending 선물이 있다. | 수신 대기 선물을 우선 표시하고, 수령 후에는 발신 대기 선물에 접근할 수 있다. 수신 선물의 `canReceive`와 ID를 보존해 수령 동작이 사라지지 않는다. 두 방향을 동시에 표시하는 요구는 아니다. |
| P2 | 구매 POST는 커밋됐지만 응답이 유실된다. 이후 잔액이 부족하거나 마지막 보유 대상이 바뀐다. | 같은 request ID로 기존 결과를 조회·복구한다. 새 구매 가능 조건으로 기존 요청을 막지 않고 중복 차감하지 않는다. |
| P2 | 식사 초대를 수락하거나 재시도한 뒤 답장을 표시한다. | 인증된 응답자 기준 SENT 관점을 반환하고 초대를 보존한다. 원래 발신자의 INBOX 관점으로 바꾸지 않는다. |
| P3 | `2026-99-99` 또는 윤년이 아닌 2월 29일을 입력한다. | DB 날짜 변환 전에 HTTP 400으로 거절한다. 유효한 윤년 날짜는 허용한다. |

친구 관계 제거 뒤 push는 authorization 거래가 commit되기 전에 차단한다. 이미 authorization을 통과해 전송이 시작된 일반 push는 회수할 수 없으며, 우편은 보존한다.

## PR #375와의 충돌 통합

병합 시뮬레이션에서 확인된 11개 충돌을 해결했다. 일곱 코드/시험 경로는 `apps/mobile/src/screens/merchant-list/index.tsx`, `apps/mobile/src/screens/shop/gacha-machine.tsx`, `apps/mobile/src/screens/shop/index.tsx`, `apps/mobile/src/screens/studio/index.tsx`, `apps/mobile/src/studio/studio-scene.tsx`, `apps/mobile/src/ui/companion.tsx`, `apps/mobile/src/ui/components.test.ts`다. 나머지 네 문서(HANDOFF·PROJECT_STATE·TEST_STATUS·AI_USAGE)는 #374와 #375의 역사 기록을 모두 남겼다. 세 소유권·자산 흐름은 통합된 상태다.

## 현재 검증 상태

- **자동 검사 PASS:** API 513개·typecheck·build, 모바일 1,673개·typecheck·lint, 사이트 508개. 신선한 PostgreSQL 전체 실행은 497개 중 494 PASS·3 SKIP·0 FAIL(183초); focused social 46개와 friend/play 6개는 별도 RED→GREEN 확인이며 full-suite 수치에 더하지 않는다.
- 독립 CodeReviewer는 필수 수정 0건, TypeScript Language Service는 75개 파일에서 진단 0건, Architect는 집중 경계 29개를 검토해 blocker 0건으로 결론냈다.
- 390px 합성 계정 CUA에서 일반 구매 6회(브론즈 3·실버 3)를 수행했다([첫 뽑기](evidence/pr374-repair-2026-10-06/first-draw.png)). 마지막 실버 책방 부엉이 요청의 서버 commit 뒤 TCP 응답을 끊었고 `afterServerCommit=true`인 최종 시도에서 클라이언트가 캐시된 기존 결과를 자동 복구했다. 첫 fault 경로는 활성화되지 않아 성공 근거로 세지 않았다. 재고 3/3으로 새 구매가 불가한 상태에서도 결과를 회수했다. 별도 수동 재시도 버튼은 검증하지 않았다. 원장에는 정확히 6건의 차감, 총 900 사용, 잔액 246, 획득 1,146이 남았고 중복 차감은 없었다([복구 화면](evidence/pr374-repair-2026-10-06/lost-response-recovered.png), [요청 증거](evidence/pr374-repair-2026-10-06/lost-response-proof.json), [원장 증거](evidence/pr374-repair-2026-10-06/recovery-ledger-proof.json)).
- 책방 부엉이·후드·금화 그림의 내 공간과 합성 친구의 빈 공간 화면이 같은 캐릭터·의상으로 표현됐고 웹 PNG 1,482,228바이트를 저장했다([내 공간](evidence/pr374-repair-2026-10-06/hoodie-studio.png), [친구 공간](evidence/pr374-repair-2026-10-06/hoodie-friend-studio.png), [공유 이미지](evidence/pr374-repair-2026-10-06/hoodie-feed.png)). 세 의상은 문자 표식 대신 래스터 의상 atlas와 출처 기록으로 표현한다.
- CUA는 localhost 전용 private fixture(mode 0600)로 수행했으며 실제 Google 로그인은 쓰지 않았다. 실기기·Expo FCM receipt·실제 오디오/진동 체감·production APK는 `NOT_RUN`이다. 공통 회귀 원장 36개 ID의 `31 PASS / 2 BLOCKED / 3 NOT_RUN` 상태는 그대로 둔다.
- 로컬 통합·검증은 끝났다. PR commit/push, 원격 CI, 병합 상태는 PR의 최신 기록을 따른다. 운영 공개 및 Google Play는 `NOT_RUN`이다.

이 보고서는 PR #374의 독립 코드·설계 검토에서 보고한 재현 조건과 복구 결과를 요약했다. 원격 PR CI·병합 및 외부 배포 상태는 이 로컬 검증의 범위에 포함하지 않는다.
