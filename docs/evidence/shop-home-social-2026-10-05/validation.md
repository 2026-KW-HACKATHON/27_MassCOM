# Issue #367 검증 출처

이 문서는 `feat/shop-home-social`의 cycle8 현재 구현 증거와 과거 checkpoint 검증 출처를 구분해 요약합니다. 이 브랜치는 아직 공개 운영 test.10·시연 Preview 19 APK, 운영/시연 서버, `/open`, GitHub Release에 반영하지 않았습니다.

## Git 추적 화면 증거

| 파일 | 확인한 내용 | 한계 |
| --- | --- | --- |
| `home-top-cycle8.png` | fresh cycle8 홈 상단, 가게권 1장과 1/9 배지 상태 | 로컬 웹/개발 API 기준 화면입니다. 공개 APK 증거가 아닙니다. |
| `shop-silver.png` | fresh cycle8 실버 재뽑기권 직접 상세, 200P 초록 구매 버튼, 10~50P/옷 0~1개 확률, 실제 구매 뒤 잔액 100,150→99,973·+23P·하늘 후드·빵집 다람쥐·upstream 빵집 골목 모자 bonus | 로컬 웹/개발 API 기준 화면입니다. 공개 APK 증거가 아닙니다. |
| `home-test-ticket.png` | 새 게스트 동의 뒤 홈 빈 상태 0개, 테스트 방문 뒤 홈에 가게 뽑기권 1장 표시 | 실제 매장 방문·원격 서버 증거가 아닙니다. |
| `meal-response.png` | A 가게의 2026-10-06 12~14시 초대에 B가 12:40을 선택했고, 보낸 사람 우편 상세에 확정 시간이 표시됨 | Android push 수신 증거가 아닙니다. |
| `sound-settings.png` | BGM/SE OFF, 비활성 슬라이더, reset 뒤 ON 30%, 진동 3선택 | 실제 기기 청음·무음 모드·진동 체감은 `NOT_RUN`입니다. |

## cycle8 현재 구현 검증 출처

| 영역 | 현재 문서화 상태 | 출처 |
| --- | --- | --- |
| API | 502/502 PASS, 0 fail/0 skip, typecheck·build PASS | `.omx/api-post-cleaner-cycle7.log`. |
| PostgreSQL | 190/190 PASS, 0 fail/0 skip. Earlier 189/190은 root wrong cwd였고 correct cwd retention 16 PASS 뒤 full rerun PASS | `.omx/postgres-post-cleaner-cycle7.log`. |
| Migration | upstream `0043_campaign_extended_audit.sql`과 0044~0049 보존, Issue #367 migration 0050~0055. 55개 migration from-scratch·rerun idempotent 두 owned DB PASS | `.omx/plans/main-0ce-integration-cycle7.md`, root cycle7 증거. |
| Mobile | owner/root post-cleaner mobile 1633/1633 PASS, 0 fail/0 skip, typecheck·lint PASS | `.omx/mobile-post-cleaner-cycle8.log`, `.omx/mobile-typecheck-final-cycle8.log`, `.omx/mobile-lint-final-cycle8.log`. |
| Site / web | 340/340 PASS, 0 fail/0 skip. cycle8 source 변경 없음 | `.omx/site-cycle7.log`. |
| Exports / variant guard | cycle8 운영 Android·시연 Android·개발 web export PASS, variant asset/API origin/accessibility/privacy guard PASS | `.omx/production-export-final.log`, `.omx/showcase-export-final.log`, `.omx/web-export-final.log`, `.omx/variant-assets-cycle8.log`, `.omx/variant-origins-cycle8.log`, `.omx/accessibility-cycle8.log`, `.omx/privacy-cycle8.log`. |
| Cold-response coverage | prefixed mounted race 두 건 FAIL→PASS, independent coverage 64 PASS, adequate | `.omx/reviews/cold-response-coverage-cycle8.md`. |
| Cleaner | cycle8 product no-op PASS | `.omx/cleanup-cycle8-final-report.md`. |
| Final reviews | CodeReviewer APPROVE 0 issues, Architect CLEAR 0 blockers, final review gate clean | `.omx/reviews/code-review-final-cycle8.md`, `.omx/reviews/architect-final-cycle8.md`, `.omx/reviews/code-review-final-gate-cycle8.json`. |
| Live QA / UltraQA | baseline 14 PASS·0 findings·cleanup remainingTotal 0; UltraQA 15 PASS·1 NOT_RUN·0 findings·cleanup 0. NOT_RUN은 unsupported runtime cancel/resume/hung CLI class | `.omx/qa-ultraqa-report-cycle8.md`. |
| Final gate | `tools/gate.sh` exit 0 PASS. Legacy public status rows 31 PASS / 2 BLOCKED / 3 NOT_RUN preserved | `.omx/gate-final-cycle8.log`. |
| Browser smoke | fresh cycle8: new guest consent, empty home 0, test visit A, home 1/9 and 1 ticket, QR hidden tabs/Home back, direct silver buy result, search/filter/map A visited and B/C unvisited, friend empty/list code/add UI and remaining 5/reward 25 display, media-less ticket skip with 1 unopened retained, settings back Home | `.omx/qa-browser-final.md`. |
| Visual review | PASS 88/100, no blockers. Non-blocking note: green button prominence; sound/vibration scroll cutoff is capture-only | `.omx/reviews/visual-final-cycle8.md`. |
| Audit | 현재 35건(12 moderate, 23 high, critical 0). package-lock은 origin/main `0ce3114c`와 byte-equal, branch 신규 dependency advisory 0 | root cycle7 증거. |

## cycle6 checkpoint 보존 출처

| 영역 | 보존 상태 | 출처 |
| --- | --- | --- |
| Cycle6 automated baseline | API 491/491, PostgreSQL 104/104, 모바일 1611/1611, 사이트 339/339 PASS | checkpoint `d5b76f85`. |
| Cycle6 gate | `tools/gate.sh` PASS | `.omx/gate-cycle6-aae.log`. |
| G007 ACK revision fence | repair 완료. runtime pre-fix 3 FAIL → 26 PASS, actual module reload/fresh A9, paired PG existing-server semantics 확인 | `.omx/reviews/current-cleanup-coverage-cycle6.md`. |
| Cycle6 Code review | APPROVE, 0 issues | `.omx/reviews/code-review-shop-home-social-cycle6.md`. |
| Cycle6 Architect review | CLEAR, independently 26 tests | `.omx/reviews/architecture-review-shop-home-social-cycle6.md`. |
| Cycle6 UltraQA | 14 recorded claims: 13 PASS + 1 NOT_RUN. NOT_RUN은 ADV-CLI-002(runtime cancel/resume/stale state/hung CLI unsupported) | `.omx/qa-ultraqa-report-final.md`, root cycle7 지시. |
| Provider restart harness | 2 tests PASS. deferred push cleanup 직렬화와 server delete 503 뒤 durable old push cleanup intent 유지를 확인 | `.omx/reviews/mobile-main-integration-coverage-cycle5.md`. |
| Cycle6 cleaner / post-cleaner rerun | cycle6 product no-op PASS, source 변경 없음. PG test separator format만 정리했고 post-cleaner 모바일 49건·PG 1건·API typecheck PASS | `.omx/cleanup-cycle6-final-report.md`, `.omx/mobile-post-cleaner-cycle6.log`, `.omx/postgres-post-cleaner-cycle6.log`. |
| Mounted shop focus | focused idle 동안 shop GET 4328→4328 약 62초, 재포커스 때 bounded +2 | `.omx/qa-shop-focus-after.jsonl` 확인. |
| Audit | baseline 33건과 동일(12 moderate, 21 high, critical 0), newly listed 0 | dependency upgrade 없음. |

## 브라우저 확인

- 새 게스트 동의 뒤 홈 빈 상태 0개 확인.
- 실버 상점 직접 상세 모달에서 가격과 확률 확인.
- 실제 구매 뒤 잔액 100,150→99,973, +23P, 하늘 후드, 빵집 다람쥐, upstream 빵집 골목 모자 bonus 순서 결과 확인.
- BGM/SE OFF와 비활성 슬라이더→reset ON 30%, 진동 3선택, 검색/필터/지도(A visited, B/C unvisited)→홈 확인.
- Cycle6 web export 뒤 역할 선택 → 기존 owned guest 홈의 가게권 1장·배지 1/9·하단 5탭 확인.
- 200P 초록 구매 버튼과 마일리지 → 옷 → 최종 캐릭터 순서 확인.
- 테스트 방문 A 뒤 홈 가게권 1개 추가 확인.
- 홈 QR·친구·미션, 설정 스위치·초기화·뒤로가기 확인.
- Fresh cycle8에서는 친구 빈 목록·코드·추가 UI와 remaining 5/reward 25 표시를 확인했다. 실제 친구 추가 → 프로필 → 우정 5P 보내기, 하루 남은 보내기 4/5와 보상 20P, pending 수신 전 재전송 차단은 historical cycle6 증거로 보존한다.
- A 가게 2026-10-06 12~14시 식사 초대에 B가 12:40을 선택했고 보낸 사람 우편 상세에 확정 시간이 표시되는 것 확인.

## 독립 리뷰 상태

Cycle3 code review APPROVE와 architecture review `BLOCK — REQUEST CHANGES`의 HIGH 5건은 보정 입력으로 보존합니다. Cycle6에서 G007 ACK revision fence repair를 완료해 current-binding logout ACK가 최신 device revision fence 없이 local state를 지우던 gap을 닫았습니다. Cycle6 CodeReviewer는 APPROVE(0 issues), Architect는 CLEAR입니다. UltraQA는 14개 기록 claim 중 13 PASS·1 NOT_RUN으로 보존합니다. NOT_RUN은 ADV-CLI-002(runtime cancel/resume/stale state/hung CLI unsupported)이며 native audio/haptics/hardwareBack/remote push와 media-less seed의 실제 display ACK도 계속 `NOT_RUN`입니다. Cycle7 final review의 Code REQUEST CHANGES와 Architect BLOCK/HIGH는 cold-response fence repair로 해결된 역사입니다. Cycle8 owner/root mobile·coverage·cleaner·post-cleaner full rerun·세 export/guard·final reviews·live QA/UltraQA·final gate·browser smoke·vision review는 PASS입니다. Draft PR #374 생성과 현재 PR body/SHA-linked body 한국어 checker PASS는 완료됐습니다. Production deployment와 merge는 아직 `NOT_RUN`입니다.

## Remaining PR state

Cycle8 source repair는 frozen 상태입니다. Final CodeReviewer/Architect, live QA/UltraQA, 최신 gate와 fresh search/filter/map/friends browser smoke는 PASS입니다. Draft PR #374가 생성됐고 현재 PR body/SHA-linked body 한국어 checker는 `.omx/pr-korean-final.log` 기준 PASS입니다.

## NOT_RUN

Remote push delivery, 실제 Android BGM/SE 청음, haptic/무음 모드, hardware back 실기, 공개 서버 배포, 새 공개 APK/Release, merge는 아직 실행하지 않았습니다. Store ticket 브라우저 QA는 fixture media fallback 때문에 실제 표시/ACK 증거가 없으며, API 시험이 ACK authorization을 덮고 UI는 티켓 유지까지만 확인했습니다.
