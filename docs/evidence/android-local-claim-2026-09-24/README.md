# 로컬 가상 방문 수령 · Android 실기

이 기록은 Samsung SM-S928N(Android 16)의 `kr.masscom.wolgye.dev` 개발 앱과 별도 `masscom_showcase_test` PostgreSQL에서 수행한 시연입니다. Metro JavaScript는 `f177c0a`(PR #147 병합 코드), API는 `main 723e8f5` 기준입니다. `.env.local`이 없는 격리 checkout에서 개발 DEMO 계정을 사용했고, `adb reverse`로 기기 8081→Metro, 3000→`127.0.0.1` API만 연결했습니다. 운영 앱·API·DB와 실제 영업점에는 요청하지 않았습니다.

| 단계 | 상태 | 실제 확인 |
| --- | --- | --- |
| 가상 STAFF 권한 | PASS | 로컬 점포 `가상 점포 A`의 STAFF·`CONFIRM_VISIT` 표시 |
| 1회 코드 발급 | PASS | 로컬 고객 데모 계정용 QR/43자 코드 발급. 원문·QR 사진은 저장소에 넣지 않음 |
| 고객 수동 입력·미리보기 | PASS | 동일 폰 고객 화면에서 점포·캠페인·수령 가능 상태 확인 |
| 방문 수령 확정 | PASS | `방문 인증 완료`, `체험 방문 도감 진행 1회`, `새 보상권 1개`, `NFT 발행은 아직 요청하지 않음` 표시 (`redeemed.png`) |
| 도감 | PASS | 방문 1, 앱 수집품 1, 실제 NFT 0 및 `발행하지 않음` 표시 (`collection.png`) |
| 동일 코드 재확인 | PASS | 고객 화면에서 이미 사용한 코드 안내, 확정 행동 없음. 재확인 전후 DB 건수 모두 방문 1·보상권 1·mint job 0·`CLAIMED` 슬롯 1 |
| 다음 가게 추천 | PASS | 한 가상 점포만 있는 상태에서 해당 점포의 다음 3회 고정 보상까지 2회 남음을 안내 (`recommendations.png`) |
| 실제 QR 카메라 촬영 | NOT_RUN | 같은 폰에서 발급 QR을 카메라로 읽지 않았음 |
| 외부 지갑·실제 NFT·운영/시연 release APK | NOT_RUN | Reown 프로젝트·지갑 서명·Worker/체인·외부 HTTPS를 사용하지 않았음 |

DB 확인 명령(시험 DB 전용):

```sql
SELECT (SELECT count(*) FROM visit_events),
       (SELECT count(*) FROM reward_entitlements),
       (SELECT count(*) FROM mint_jobs),
       (SELECT count(*) FROM claim_slots WHERE status='CLAIMED');
-- 1|1|0|1 (수령 후와 동일 코드 재확인 후 모두 동일)
```

이전 USB 연결에서 수령 직전 끊긴 시도는 [Issue #146 실기 기록](../android-dev-ui-2026-09-24/README.md)에 `BLOCKED`로 그대로 남겼습니다. 이번에는 다른 USB 포트로 재연결해 새 일회용 코드를 발급·수령한 별도 실행입니다. 실증 범위는 로컬 개발 DEMO의 수동 코드 흐름이며 실제 식사·협약 점포·NFT 발행이나 공개 시연 성과가 아닙니다.
