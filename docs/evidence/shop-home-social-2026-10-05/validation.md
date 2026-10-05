# Issue #367 검증 출처

이 문서는 `feat/shop-home-social`의 cycle4 push-only repair 전 기준선을 요약합니다. 아래 수치는 최종 승인·UltraQA clean·PR 상태가 아니며, push repair와 최종 리뷰 뒤 root가 갱신합니다.

## Git 추적 화면 증거

| 파일 | 확인한 내용 | 한계 |
| --- | --- | --- |
| `shop-silver.png` | 실버 재뽑기권 상세, 보상 범위·확률, 초록 200P 구매 버튼 | 로컬 웹/개발 API 기준 화면입니다. 공개 APK 증거가 아닙니다. |
| `home-test-ticket.png` | 테스트 방문 뒤 홈에 가게 뽑기권 1장 표시 | 실제 매장 방문·원격 서버 증거가 아닙니다. |
| `meal-response.png` | A 가게의 2026-10-06 12~14시 초대에 B가 12:40을 선택했고, 보낸 사람 우편 상세에 확정 시간이 표시됨 | Android push 수신 증거가 아닙니다. |
| `sound-settings.png` | BGM·SE·진동 설정 UI | 실제 기기 청음·무음 모드·진동 체감은 `NOT_RUN`입니다. |

## 로컬 검증 출처

| 영역 | cycle4 전 기준선 | 출처 |
| --- | --- | --- |
| API | 463/463 PASS, build PASS | root 제공 로그 기준. preflight concurrency coverage와 absent-install logout tombstone fix 추가 중이라 최종 API 증거는 대기입니다. |
| 모바일 | 1532/1532 PASS, typecheck PASS, lint PASS | root 제공 로그 기준. |
| PostgreSQL targeted | 49/49 PASS | cycle3 architecture review가 확인한 baseline. |
| Android export | production + showcase fresh PASS, run marker 97284 | asset separation과 Hermes origin assertion도 PASS. |
| Variant boundary | production/showcase asset separation PASS, Hermes origin PASS | `.omx/variant-assets-final.log`, `.omx/variant-origins-final.log` 확인. 이 `.omx` 로그는 로컬 출처이며 GitHub 단독 증거로 쓰지 않습니다. |
| Mounted shop focus | focused idle 동안 shop GET 4328→4328 약 62초, 재포커스 때 bounded +2 | `.omx/qa-shop-focus-after.jsonl` 확인. |
| Web final | fresh run 98375 진행 중 | 아직 최종 PASS로 기록하지 않습니다. |
| Audit | baseline 33건과 동일, newly listed 0 | dependency upgrade 없음. |

## 독립 리뷰 상태

Cycle3 code review는 approve였지만 architecture review는 `BLOCK — REQUEST CHANGES`입니다. 남은 HIGH 5건은 older registration ACK overwrite, legacy registration token tombstone bypass, receipt/dead-token atomicity gap, aggregate update clearing a new dispatch lease, retry stealing an unexpired parent lease입니다. 이 항목들은 cycle4 push-only repair의 입력이며 최종 clean 상태가 아닙니다.

## NOT_RUN

Remote push delivery, 실제 Android BGM/SE 청음, haptic/무음 모드, hardware back 실기, 공개 서버 배포, 새 공개 APK/Release, merge는 아직 실행하지 않았습니다.
