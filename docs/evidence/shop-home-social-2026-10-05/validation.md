# Issue #367 검증 출처

이 문서는 `feat/shop-home-social`의 현재 문서화된 검증 출처와 남은 대기 상태를 요약합니다. 이 브랜치는 아직 공개 운영 test.10·시연 Preview 19 APK, 운영/시연 서버, `/open`, GitHub Release에 반영하지 않았습니다.

## Git 추적 화면 증거

| 파일 | 확인한 내용 | 한계 |
| --- | --- | --- |
| `shop-silver.png` | 실버 재뽑기권 직접 상세, 200P 초록 구매 버튼, 보상 범위·확률, 실제 구매 뒤 잔액 99,968·+18 마일리지·옷 없음·책방 부엉이 결과 | 로컬 웹/개발 API 기준 화면입니다. 공개 APK 증거가 아닙니다. |
| `home-test-ticket.png` | 새 게스트 동의 뒤 홈 빈 상태 0개, 테스트 방문 뒤 홈에 가게 뽑기권 1장 표시 | 실제 매장 방문·원격 서버 증거가 아닙니다. |
| `meal-response.png` | A 가게의 2026-10-06 12~14시 초대에 B가 12:40을 선택했고, 보낸 사람 우편 상세에 확정 시간이 표시됨 | Android push 수신 증거가 아닙니다. |
| `sound-settings.png` | BGM·SE·진동 설정 UI | 실제 기기 청음·무음 모드·진동 체감은 `NOT_RUN`입니다. |

## 통합 검증 출처

| 영역 | 현재 문서화 상태 | 출처 |
| --- | --- | --- |
| API | 491/491 PASS, typecheck·build PASS | root 제공 최종 통합 증거. |
| PostgreSQL | 104/104 PASS, 10개 파일, social 39와 upstream campaign/merchant/admin 포함, 0 skip | root 제공 cycle6 최종 PG 증거. |
| Migration | upstream `0043_campaign_extended_audit.sql` 보존, Issue #367 migration 0044~0049. migration 0049 포함 from-scratch·rerun idempotent를 두 owned DB에서 PASS | `.omx/integrated-migrations.log`. |
| Mobile | 1611/1611 PASS, typecheck·lint PASS | root 제공 최종 통합 증거. |
| Site / web | 339/339 PASS, privacy/accessibility PASS | root 제공 최종 통합 증거. |
| Exports / variant guard | 운영 Android, 시연 Android, 개발 web export PASS. production/showcase asset separation과 Hermes origin assertion PASS | root 제공 최종 통합 증거. |
| G007 ACK revision fence | repair 완료. runtime pre-fix 3 FAIL → 26 PASS, actual module reload/fresh A9, paired PG existing-server semantics 확인 | `.omx/reviews/current-cleanup-coverage-cycle6.md`. |
| Cycle6 Code review | APPROVE, 0 issues | `.omx/reviews/code-review-shop-home-social-cycle6.md`. |
| Cycle6 Architect review | CLEAR, independently 26 tests | `.omx/reviews/architecture-review-shop-home-social-cycle6.md`. |
| Final UltraQA | baseline PASS/0 findings, matrix 15 recorded claims: 14 PASS + 1 NOT_RUN, 0 findings, owned prefix remainingTotal 0 | `.omx/qa-ultraqa-report-final.md`. |
| Provider restart harness | 2 tests PASS. deferred push cleanup 직렬화와 server delete 503 뒤 durable old push cleanup intent 유지를 확인 | `.omx/reviews/mobile-main-integration-coverage-cycle5.md`. |
| Integrated cleaner / post-cleaner rerun | cycle6 product no-op PASS, source 변경 없음. PG test separator format만 정리했고 post-cleaner 모바일 49건·PG 1건·API typecheck PASS | `.omx/cleanup-cycle6-final-report.md`, `.omx/mobile-post-cleaner-cycle6.log`, `.omx/postgres-post-cleaner-cycle6.log`. |
| Mounted shop focus | focused idle 동안 shop GET 4328→4328 약 62초, 재포커스 때 bounded +2 | `.omx/qa-shop-focus-after.jsonl` 확인. |
| Audit | baseline 33건과 동일(12 moderate, 21 high, critical 0), newly listed 0 | dependency upgrade 없음. |

## 브라우저 확인

- 새 게스트 동의 뒤 홈 빈 상태 0개 확인.
- 실버 상점 직접 상세 모달에서 가격과 확률 확인.
- 실제 구매 뒤 잔액 99,968, +18 마일리지, 옷 없음, 책방 부엉이 순서 결과 확인.
- BGM/SE OFF→reset과 검색 분리 확인.
- Cycle6 web export 뒤 역할 선택 → 기존 owned guest 홈의 가게권 1장·배지 1/9·하단 5탭 확인.
- 200P 초록 구매 버튼과 마일리지 → 옷 → 최종 캐릭터 순서 확인.
- 테스트 방문 A 뒤 홈 가게권 1개 추가 확인.
- 홈 QR·친구·미션, 설정 스위치·초기화·뒤로가기 확인.
- 친구 추가 → 프로필 → 우정 5P 보내기, 하루 남은 보내기 4/5와 보상 20P, pending 수신 전 재전송 차단 확인.
- A 가게 2026-10-06 12~14시 식사 초대에 B가 12:40을 선택했고 보낸 사람 우편 상세에 확정 시간이 표시되는 것 확인.

## 독립 리뷰 상태

Cycle3 code review APPROVE와 architecture review `BLOCK — REQUEST CHANGES`의 HIGH 5건은 보정 입력으로 보존합니다. Cycle6에서 G007 ACK revision fence repair를 완료해 current-binding logout ACK가 최신 device revision fence 없이 local state를 지우던 gap을 닫았습니다. Cycle6 CodeReviewer는 APPROVE(0 issues), Architect는 CLEAR입니다. UltraQA는 baseline PASS/0 findings와 matrix 15 recorded claims 중 14 PASS·1 NOT_RUN, 0 findings로 끝났습니다. NOT_RUN은 ADV-CLI-002(runtime cancel/resume/stale state/hung CLI unsupported)이며 native audio/haptics/hardwareBack/remote push와 media-less seed의 실제 display ACK도 계속 `NOT_RUN`입니다. PR 생성, production deployment, merge, `tools/gate.sh` PASS는 아직 root final gate 이후 기록해야 합니다. 실제 PR 한국어 검사는 PASS입니다.

## NOT_RUN

Remote push delivery, 실제 Android BGM/SE 청음, haptic/무음 모드, hardware back 실기, 공개 서버 배포, 새 공개 APK/Release, merge는 아직 실행하지 않았습니다. Store ticket 브라우저 QA는 fixture media fallback 때문에 실제 표시/ACK 증거가 없으며, API 시험이 ACK authorization을 덮고 UI는 티켓 유지까지만 확인했습니다.
