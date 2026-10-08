# 로컬 백업·복원·장애 대응 Runbook

이 문서는 실행 절차와 확인된 복원 기록입니다. RPC·발행 중지·민터 잔액·DB 장애의 Worker 동작은 Local Anvil과 Docker PostgreSQL에서 검증해 O02를 `PASS`로 기록했습니다(Issue #77). 2026-10-08 운영 DB의 서버 안 실제 복원 리허설은 P03 첫 `PASS` 증거이며, 외부 백업 저장소와 운영 RPC 제공자의 실제 장애는 검증하지 않았습니다.


## 푸시·소리 운영 메모 (Issue #367 당시 기록)

- Expo push 전송 토큰은 API 컨테이너의 `EXPO_PUSH_ACCESS_TOKEN`으로만 주입한다. 운영 runtime.env는 `EXPO_PUSH_ACCESS_TOKEN`, 시연 runtime.env는 별도 `SHOWCASE_EXPO_PUSH_ACCESS_TOKEN`을 사용하며 Compose가 시연 값도 API 내부의 `EXPO_PUSH_ACCESS_TOKEN`으로 전달한다. 값이 비어 있으면 기존 무토큰 동작을 유지한다. 토큰 값은 문서, 로그, 커밋, PR 본문에 쓰지 않는다.
- 모바일 빌드의 `MASSCOM_NOTIFICATION_PROJECT_ID`는 Expo project UUID일 때만 앱 설정의 `extra.eas.projectId`로 들어간다. `MASSCOM_FIREBASE_ANDROID_CONFIG`는 Android Firebase 설정 파일 경로이며 파일 내용은 Git에 넣지 않는다.
- 앱 variant는 push token DB에서 `ANDROID`와 `SHOWCASE_APP`만 허용한다. 운영/시연 토큰을 섞어 재사용하지 않는다.
- 알림 outbox는 우편·식사 초대 응답 알림을 재시도/영수증 상태로 추적하기 위한 로컬 큐다. `0053_social_notification_deliveries.sql` 적용 뒤에는 social outbox 1건에 token별 `social_notification_deliveries`가 생기고 `lease_generation`으로 stale gateway/receipt 완료를 막는다. `0054_push_token_binding_revision.sql` 적용 뒤에는 deviceId별 active binding과 `binding_revision`으로 늦은 register/unregister가 새 계정 binding을 지우지 못하게 한다. `0055_notification_delivery_token_version.sql` 적용 뒤에는 social delivery가 dispatch 때 authorization된 push token id와 binding revision을 저장해 receipt 효과를 그 binding으로만 제한한다. Upstream `notification_deliveries`는 collection/FCM 알림함 경로로 보존한다.
- Issue #367 당시 migration·cycle 검증은 이력이다. 현재 배포 명세는 아래 Issue #401 절의 실제 파일 목록과 릴리스 관문을 따른다. 이미 적용한 파일의 이름·내용을 고치거나 재번호화하지 않는다.
- 운영 판단 경계: dispatch authorization transaction commit이 외부 Expo gateway 호출을 시작해도 되는 시점이다. commit 전 revoke/삭제/동의 철회는 발송 0건이어야 한다. commit 뒤 이미 authorization된 generic push는 회수할 수 없으므로 receipt와 retry 상태로 추적한다. Expo receipt OK는 gateway 처리 근거이지 실제 기기 수신 증명이 아니다. receipt 처리는 0055의 token-version fence를 통과한 `social_notification_deliveries` row에만 반영한다.
- cycle3 architecture review의 push HIGH 5건과 cycle7 Code/Architect blocker는 보정 입력으로 보존한다. cycle8 cold-response fence repair 뒤 CodeReviewer는 APPROVE 0 issues, Architect는 CLEAR 0 blockers다. Live QA는 baseline 14 PASS·0 findings·cleanup 0, UltraQA 15 PASS·1 NOT_RUN·0 findings·cleanup 0이고 final `tools/gate.sh`는 exit 0 PASS다. Native audio/haptics/hardwareBack/remote push, media-less seed의 실제 display ACK, unsupported runtime cancel/resume/hung CLI class는 계속 `NOT_RUN`이다. 당시 Draft PR #374와 한국어 checker PASS 기록이다. #374는 이후 병합됐으며 공개 배포 근거는 별도로 확인한다.
- 실제 Android 기기 push delivery와 수신 UX, hardware back은 아직 `NOT_RUN`이므로 공개 배포 전 FCM/EAS credential과 실제 기기로 확인해야 한다.
- BGM 자산은 사용자 제공 `draw-intro.mp3`·`draw-loop.mp3`, SE 자산은 Kenney CC0 WAV다. 실제 기기 청음, Android 무음 모드, 진동 체감은 ADB/기기 검증이 없어 아직 `NOT_RUN`이다.

## 최신 배포 명세·동시 전환 관문 (Issue #401, 2026-10-08)

**현재 기록:** 시연 서버는 main `2d483ed8645151b502253ac35860b3546e3473c5`로 배포 완료했다. 시연 서버 안 실제 복원 리허설 PASS 뒤 migration 43→68건(마지막 `0067_room_guestbook.sql`), API·`/play/` 공개 확인과 retention 검증을 마쳤다([시연 배포](evidence/showcase-deployment-2d483ed-2026-10-08.json)). 시연 Preview 20·운영 test.11 APK도 게시하고 익명 다운로드 해시를 확인했다([시연](evidence/showcase-preview20-release-2026-10-08.json), [운영](evidence/operating-android-test11-2026-10-08.json)). 운영 DB의 첫 실제 복원과 복제본 migration 리허설은 PASS다([P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)). 운영 API·DB 배포는 이 문서 PR 병합 직후 진행 예정이며 결과는 후속 기록한다. 아래 순서는 시연 배포 당시 절차와 남은 운영 전환 관문이다. 시연 fixture를 운영에 복사하지 않는다.

### migration 파일·원장 대조

`apps/api/src/postgres/migrate.ts`는 파일명 전체를 정렬하고 `schema_migrations.filename`을 기본키로 사용한다. 다음은 실제 디렉터리에서 계산한 25개 추가 파일의 적용 순서다. `0050_quality_game_records.sql`과 `0050_social_mail.sql` 모두 적용하며 번호를 바꾸지 않는다.

1. `0044_collection_experience.sql`
2. `0045_notifications.sql`
3. `0046_merchant_operations.sql`
4. `0047_durable_game_achievements.sql`
5. `0048_mileage_cosmetic_bonus.sql`
6. `0049_notification_sources.sql`
7. `0050_quality_game_records.sql`
8. `0050_social_mail.sql`
9. `0051_shop_draw_rewards.sql`
10. `0052_store_ticket_openings.sql`
11. `0053_social_notification_deliveries.sql`
12. `0054_push_token_binding_revision.sql`
13. `0055_notification_delivery_token_version.sql`
14. `0056_real_world_profiles.sql`
15. `0057_merchant_photos_reports.sql`
16. `0058_discovery_events.sql`
17. `0059_coin_economy.sql`
18. `0060_room_community.sql`
19. `0061_grade_draws.sql`
20. `0062_room_furniture.sql`
21. `0063_coin_rerolls.sql`
22. `0064_profile_intro.sql`
23. `0065_representative_coin_sources.sql`
24. `0066_coin_reroll_revocation.sql`
25. `0067_room_guestbook.sql`

적용 후 예상 원장 수는 **43 + 25 = 68건**이다(최대 번호 0067과 파일 수는 다름). 실행 전후 `SELECT count(*), max(filename) FROM schema_migrations;`와 `SELECT filename FROM schema_migrations ORDER BY filename;`를 기록하고 68건·마지막 `0067_room_guestbook.sql`·두 0050을 확인한다. 소스 변경으로 파일 목록이 달라지면 이 예상값도 다시 계산한다. migrator는 파일마다 트랜잭션을 사용하므로 중간 실패 때 앞선 파일은 이미 commit될 수 있다. 원장 확인 없이 전체 실패로 판단하거나 적용 파일을 수정하지 않는다.

### 개인정보 재동의·설치본 관문

새 API의 `privacy-2026-10-07`은 구 test.10/Preview 19의 개인정보04 문구와 다르다. `apps/mobile/src/privacy/consent-flow.ts`가 `outdated`로 동의를 막으므로 **API만 먼저 공개하면 기존 설치본이 잠긴다**. 옛 APK 재설치로 해결되지 않는다. 최신 약관·공개 개인정보 안내, API, 같은 소스의 `/play/` 웹 번들, 새 APK와 `/open`을 하나의 유지보수 창에서 전환한다. APK 서명·package·API origin·내장 동의 버전·SHA-256과 실제 다운로드 파일을 대조하고 기존 서명 키를 만들거나 덮어쓰지 않는다.

Preview 20과 test.11은 게시됐다. `/open`의 두 링크는 환경별로 독립 검증한다. 운영 API 전환 전 새 공개 문구와 구 운영 API의 동의 버전이 다르면 구 API가 제공하는 개인정보04 동의 안내를 그대로 유지하고, 서버가 반환하는 안내·정책 링크·버전이 맞는지 검증한다. 맞는 구 안내를 제공할 수 없다면 전환을 중단한다. 공개 문서 변경만으로 운영 API의 정책 버전을 바꾸지 않는다.

### 같은 배포 창의 순서

1. **사전 준비:** 최종 선택 SHA에서 API 이미지·`/play/` export·Preview 20·test.11·공개 안내·`/open` 후보를 준비한다. 현재 공개 SHA/원장/링크/해시와 rollback 포인터를 기록한다. 시연·운영의 비밀·DB·OAuth·package·서명·가상 데이터 격리를 확인한다. 이 worktree 수정 중에는 배포하지 않고 메인 스레드 통합 후 선택 SHA를 고정한다.
2. **시연 먼저:** 시연 DB 백업과 실제 scratch 복원을 수행하고, 고객·점주 변경 요청과 seed/retention 작업을 잠시 중단한다. API 쓰기와 신규 웹 체험을 차단한 유지보수 창 안에서 25 migration을 적용해 원장 68건을 대조한다. 시연 API를 새 이미지로 교체하고 아직 입구를 열지 않는다.
3. **시연 묶음 전환:** 같은 소스의 `/play/` 번들을 새 불변 release 디렉터리에 두고 웹 포인터·edge mount를 갱신한다. 새 개인정보 안내·Preview 20 APK·시연 `/open` 링크를 전환한다. 운영 API·운영 APK 링크·운영 동의 안내는 기존 조합을 유지한다. 구 캐시가 새 API를 호출하지 않도록 웹 entry/자산 해시와 정책 버전을 대조한다. 구 시연 설치본에는 새 APK로 업데이트하도록 안내한다.
4. **시연 재개 관문:** 유지보수 접근에서 새 임시 체험, 개인정보04 동의 기존 계정의 재동의 수락, 거절/철회 뒤 보호 API 차단, 로그아웃·재로그인 후 동의 상태, 테스트 방문·봉투·도감·뽑기·마이룸·이웃·점주 역할의 실제 서버 권한을 확인한다. `health` 200만으로 이 관문을 통과시키지 않는다. 정확한 Preview 20 APK와 웹을 각각 확인한 후 시연 입구/쓰기를 열고 타이머를 재개한다([5분 정본](DEMO_RUNBOOK.md)).
5. **운영 조건 — 리허설 PASS:** 운영 서버 안 실제 복원 리허설에서 107개 테이블 일치를 확인했다. 임시 dump 186,604바이트·SHA-256 `1360fdf8c3a5db62214b36f4541ad66e57515c093e46a9a7ff55a47a8c19cdd5`는 종료 시 삭제됐다. 같은 클러스터의 `masscom_rehearsal_test` 복제본에 같은 API 코드의 migration 43→68건을 1.8초에 적용했고 `account_consents` 5=5·공개 점포 0을 확인한 뒤 DB와 dump를 삭제했다. 이는 P03의 첫 실제 복원 증거다. 새 운영 배포와 배포 전 백업은 별도 관문이다.
6. **운영 묶음 전환 — 진행 중:** 이 문서 PR 병합 커밋을 고정하고 운영 쓰기를 중단해 새 백업을 검증한 뒤 `backward_compatible=no` 증거로 `scripts/deploy-lightsail.sh --deploy`를 실행한다. migration→API/웹/공개 안내→test.11 APK와 운영 `/open` 링크를 같은 창 안에서 맞춘다. 배포 스크립트는 새 릴리스에서 retention 타이머를 설치·활성화하고 정리 작업을 즉시 한 번 실행해 성공을 확인한다. 이 첫 실행은 만료 세션·오래된 일회용 토큰·보관 기간이 지난 감사/시연 기록을 DB에서 지우고, 수정 시각이 30일을 넘은 DB dump 파일을 삭제한다([DB 보관 조건](../apps/api/src/postgres/retention.ts), [호스트 작업](../infra/lightsail/host-jobs/masscom-retention.sh)). 배포 직전에 만든 롤백용 dump는 30일 미만이므로 보존된다. 정리 전 DB 상태가 필요하면 이 백업과 아래 전진 복구 기준을 따르며 구 API로 자동 복귀하지 않는다. API 배포 스크립트는 APK 제작·발행과 시연 `/play/` export를 하지 않으므로 준비/게시를 별도 작업으로 완료해야 한다. `deploy-lightsail-web.sh`로 웹만 올려서 API·APK 전환을 대신하지 않는다.
7. **운영 재개:** retention은 6단계에서 이미 실행되며, 이 단계의 수용 결과를 기다렸다가 켜는 작업이 아니다. 새 APK의 실제 Google 로그인·기존 계정 재동의/거절/재로그인·고객 탐색·오류 복구·환경 격리와 `/open` 다운로드 해시를 확인한다. 운영에서 가상 방문·구매·자산 발행을 만들지 않는다. 관문 통과 전 쓰기를 열지 않는다. 결과는 서버 배포·웹·APK 빌드/서명·설치·실기 수용을 분리해 PASS/FAIL/BLOCKED/NOT_RUN으로 남긴다. Play·메인넷·최종 대회 제출은 이 계획에 포함하지 않는다.

### 하위 비호환 릴리스 실패·전진 복구 (A01)

문서 규칙만으로는 부족했다. 기존 `deploy-lightsail.sh`는 `backward_compatible=yes`만 받아 `no`를 거절하고, migration 이후에도 자동으로 구 API를 재기동했다. 이번 수정은 `yes|no`를 허용하며 `no`를 원격 실패 처리까지 전달한다. 이번 0044~0067 릴리스는 새 지출·가구·리롤·방명록 및 삭제 대상 원장을 구 API가 모르므로 **`backward_compatible=no`를 필수로 기록**한다. 새 쓰기를 받기 전이라도 이 릴리스는 migration 시작부터 보수적으로 자동 복귀를 금지한다. 실백업 복원으로 안전성이 입증되지 않은 `yes`를 쓰지 않는다.

호환성 파일은 mode 400/600으로 준비한다. `from`은 실제 라이브 40자리 SHA, `to`는 선택 배포 SHA다(현재 공개 기준 예시는 아래와 같고 실행 때 다시 확인한다).

```text
from=db280032a97eee1d9cd50b504d84bc66e2beafda
to=<선택한 배포 커밋의 40자리 SHA>
backward_compatible=no
```

- migration 시작 **전** build/백업/설정 실패: 스키마가 바뀌지 않은 경우 기존 env·서비스·포인터 복귀를 허용한다. 중단 전 실제 원장 상태를 확인한다.
- `no` 릴리스는 migration 전에 API를 멈춘다. migration 시작 **후** 적용·API 시작·HTTPS probe 실패: API를 다시 멈추고 `FORWARD_RECOVERY_REQUIRED`로 실패 종료한다. 새 env·DB와 백업을 보존하며 구 API/웹/Caddy를 자동 재기동하거나 포인터/DEPLOYED_COMMIT을 완료로 갱신하지 않는다. 기존 포인터가 남아 있어도 실제 컨테이너 완료 상태라고 믿지 않는다. API 중단 자체가 실패하면 `API_WRITE_STOP_FAILED`를 보고 API 트래픽부터 차단한다.
- 새 API가 뽑기·가구·리롤·방명록 쓰기를 받은 뒤: 쓰기와 관련 작업을 중단하고 최신 원장의 지출·소유·취소·삭제 계약을 이해하는 호환 API로 전진 복구한다. 옛 API `db280032`를 재기동하거나 신규 쓰기를 덮는 백업 복원을 자동 수행하지 않는다. 원장·백업·컨테이너·웹/정책/APK 조합을 확인하고 재동의와 구매 응답 유실/같은 요청 재확인을 다시 검증한다.
- 완료 표시 뒤 시연 probe·retention 실패: 기존 스크립트는 새 운영 릴리스를 보존하고 실패를 알린다. 이 경우에도 구 버전으로 복귀하지 않고 해당 서비스/작업을 복구한다. 동일 SHA 재배포는 `RELEASE_ALREADY_EXISTS`로 막히므로 불변 디렉터리를 덮지 말고 새 커밋 또는 명시적 수동 복구 기록을 사용한다.
- `/play/`·APK·`/open` 전환 실패: 유지보수 입구를 닫은 채 환경별 정상 조합을 완성한다. 새 개인정보07 API에 옛 APK 링크만 되돌리는 방식은 금지한다. 시연 실패가 운영 DB·API를 변경할 이유는 아니며 운영 전환 조건은 계속 유지한다.

## PostgreSQL 백업

1. 신규 발행 요청을 중지하고 Worker의 활성 lease를 확인합니다.
2. 배포 전 백업과 일일 백업을 같은 VM 밖의 승인된 저장소에 암호화해 보관합니다.
3. 접속 비밀번호를 명령행·로그·파일명에 넣지 않고 런타임 비밀 주입을 사용합니다.
4. custom format 백업과 SHA-256, PostgreSQL 버전, schema migration commit을 함께 기록합니다.

```bash
read -s PGPASSWORD && export PGPASSWORD
pg_dump --format=custom --no-owner --file masscom.backup "$DATABASE_URL"
shasum -a 256 masscom.backup
```

## 빈 `_test` DB 복원 연습

```bash
createdb masscom_restore_test
pg_restore --no-owner --clean --if-exists --dbname masscom_restore_test masscom.backup
TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_restore_test' \
  npm run test:postgres --prefix apps/api
```

위 절차를 한 번에 연습하는 스크립트가 있습니다. dump → `<DB 이름>_restore_test` 복원 → 테이블별 행 수와 migration 목록 대조 → scratch DB 삭제까지 하며 원본은 읽기만 합니다. scratch DB 이름에는 프로세스 번호가 들어가 기존 DB를 이름으로 지우지 않고, 백업 파일 경로를 주지 않으면 dump는 임시 파일로 만들어져 끝날 때 삭제됩니다(실제 데이터가 들어 있으므로 경로를 줬다면 암호화 보관 절차를 따릅니다). 경로를 준 dump는 `umask 077`로 같은 폴더의 임시 파일에 쓰고 dump가 성공했을 때만 그 경로로 옮기므로 새 파일은 항상 mode 600이고, dump가 실패하면 그 경로의 이전 백업은 그대로 남습니다(Issue #263). 쓰기가 조용할 때 실행하세요(행 수를 실행 시점의 원본과 비교합니다).

```bash
read -s PGPASSWORD && export PGPASSWORD
DRILL_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom' scripts/db-restore-drill.sh [백업 파일 경로]
# 클라이언트 도구가 컨테이너 안에만 있으면: PG_EXEC='docker exec -i -e PGPASSWORD <컨테이너>' (URL은 컨테이너 안에서 보이는 주소)
```

복원 DB 이름은 반드시 `_test`로 끝나야 하며 운영 DB에 통합 시험을 실행하지 않습니다. 복원 뒤 `max(CHAIN_FROM_BLOCK, chain_cursors.next_block - CHAIN_REORG_MARGIN)`부터 먼저 이벤트를 재수집하고, 각 mint job의 reward key를 체인에서 확인합니다. 빠른 범위에서 못 찾으면 `CHAIN_FROM_BLOCK`까지 fallback하며, 기존 NFT를 찾으면 새 발행 키나 새 거래를 만들지 않습니다.

## 장애별 중지 기준

| 장애 | 즉시 조치 | 복구 확인 |
| --- | --- | --- |
| RPC chain/contract 불일치 | Worker `PAUSED/MANUAL_REVIEW`, 전송 금지. code는 있지만 인터페이스가 다른 계약은 `CONTRACT_INTERFACE_MISMATCH` | chain ID·contract code·MINTER role·계약 주소 재검증 |
| RPC 연결 불가 | 조치 불필요. Worker가 `RPC_UNAVAILABLE`로 물러나 작업은 `RETRYABLE`, 전송 시도 소모 없음 | `SELECT status, last_error_code, attempt_count FROM mint_jobs WHERE status = 'RETRYABLE'`로 확인, RPC 복구 뒤 다음 실행에서 자동 재개 |
| 서비스 민터 설정 오류 | `MINTER_KEYSTORE_DECRYPT_FAILED`·`MINTER_ADDRESS_MISMATCH`·`MINTER_ROLE_MISSING`으로 기동·발행 중지. signed transaction의 recovered sender 불일치는 `MINTER_SIGNER_MISMATCH`로 기록 전 차단 | keystore 파일과 전체 상위 경로의 소유자·권한, 비밀번호 파일, 민터 주소, 계약 역할을 확인. 비밀번호나 키를 로그·티켓에 붙이지 않음 |
| 상시 Worker 컨테이너(`mint-worker`)가 unhealthy이거나 접수가 쌓임 | `docker compose … --profile nft-live ps mint-worker`가 unhealthy, 하트비트(`/tmp/mint-worker.heartbeat`)가 3분 넘게 갱신되지 않음, 로그에 `MINT_WORKER_ITERATION_FAILED`(오류 이름·코드와 `retryInMs`)가 반복됨. 대기열은 `SELECT count(*), min(available_at) FROM outbox_events WHERE status IN ('PENDING', 'LEASED')`로 본다 | 오류 코드에 맞는 이 표의 다른 행을 따른다(DB·RPC 장애는 복구되면 컨테이너가 알아서 재시도하므로 재시작이 필요 없다). `MINT_WORKER_LOOP_FAILED`는 설정·keystore 오류(`MINTER_KEYSTORE_*`, 환경변수 누락)로 컨테이너가 종료 코드 1로 멈춘 것이니 원인을 고친 뒤 다시 켠다. 멈출 때는 `stop mint-worker`(최대 60초, 처리 중인 한 건을 끝냄). 켜는 절차와 조건은 [Lightsail 문서](../infra/lightsail/README.md)의 "NFT 발행 Worker" |
| 같은 민터의 발행이 모두 멈춤 | 여러 작업의 `last_error_code`가 `MINTER_NONCE_BLOCKED`로 이어짐. Worker 오류 로그에 막고 있는 거래 hash가 남음 | 그 hash를 explorer에서 확인. 채굴됐으면 다음 주기에 풀림. 수수료 부족 등으로 영영 전송될 수 없으면 그 작업이 `RECEIPT_TIMEOUT`으로 닫힐 때까지 기다리거나 운영자가 해당 작업을 검토 상태로 닫는다. 새 nonce로 덮어쓰는 거래를 수동으로 보내지 않는다 |
| 보낸 거래의 receipt가 오래 안 나옴 | 전송 5회 상한과 별개로 결과 확인을 계속하다가 제출 뒤 24시간(`receiptTimeoutMs`)이 지나면 `MANUAL_REVIEW`(`RECEIPT_TIMEOUT`) | 거래 hash를 explorer에서 확인. 성공이면 Worker가 재임대 시 추가 전송 없이 확정, 누락·대체됐으면 운영자가 판단 |
| 전송 직후 중지로 거래 revert | Worker가 중지·잔액·RPC를 다시 확인해 일시 조건이면 revert된 거래 hash를 지우고 `RETRYABLE`. 조건이 이미 풀렸으면 `MINT_TRANSACTION_REVERTED`로 `MANUAL_REVIEW` | 수동 검토 작업은 reward key가 체인에 없음을 확인한 뒤 재대기열 여부를 결정 |
| 발행 중지(pause) | PAUSER가 계약을 중지하면 Worker는 `MINT_PAUSED`로 물러남. 이미 제출된 거래의 확인·완료는 계속됨 | 원인 해소 뒤 admin이 `unpause`, 다음 실행에서 각 작업이 정확히 1개 발행 |
| 민터 잔액 부족 | 잔액이 `MINTER_MIN_BALANCE_WEI` 이하이면 `MINTER_BALANCE_LOW`로 물러남. 보상권·Outbox 유지, 전송 시도 소모 없음 | 승인된 예산·시험 faucet으로 충전 뒤 다음 실행에서 자동 재개, 기존 reward key부터 조회 |
| DB 장애 | API 변경 요청 실패, 완료 화면 금지. Worker는 체인에 아무것도 전송하지 않고 오류로 종료 | DB 일관성·migration·Outbox lease 확인 뒤 Worker 재실행 |
| 전송 응답 유실 | 새 키 발급 금지 | reward key·기존 transaction·event 대조 |
| 확정 전 재조직 | 완료 처리 금지 | 필요한 confirmation과 canonical block hash 확인 |

## 목표와 실제

RPO 1시간·RTO 4시간은 v3 제안값일 뿐 실제 백업/복원 시간 측정 전에는 보장하지 않습니다. 외부 저장소 비용·암호화 키·복원 담당자·알림 채널은 운영 승인 뒤 확정합니다.
