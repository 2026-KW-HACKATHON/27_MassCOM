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

`apps/api/src/postgres/migrate.ts`는 파일명 전체를 정렬하고 `schema_migrations.filename`을 기본키로 사용한다. 다음은 실제 디렉터리에서 계산한 27개 추가 파일의 적용 순서다. `0050_quality_game_records.sql`과 `0050_social_mail.sql` 모두 적용하며 번호를 바꾸지 않는다.

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
26. `0068_campaign_purposes.sql`(D-092, 새 API 이미지보다 먼저 적용)
27. `0075_nft_series_uncapped.sql`

적용 후 예상 원장 수는 **43 + 27 = 70건**이다(최대 번호 0075과 파일 수는 다름). 실행 전후 `SELECT count(*), max(filename) FROM schema_migrations;`와 `SELECT filename FROM schema_migrations ORDER BY filename;`를 기록하고 70건·마지막 `0075_nft_series_uncapped.sql`·두 0050을 확인한다. 소스 변경으로 파일 목록이 달라지면 이 예상값도 다시 계산한다. migrator는 파일마다 트랜잭션을 사용하므로 중간 실패 때 앞선 파일은 이미 commit될 수 있다. 원장 확인 없이 전체 실패로 판단하거나 적용 파일을 수정하지 않는다. 2026-10-08에 배포한 운영·시연 DB는 0067까지 68건이며, 0075(NFT 시리즈 발행 수량 상한 해제, D-095)은 아직 적용 전이다.

**NFT 시리즈 0075 호환·전환(D-095):** 새 API는 `max_ever_minted`를 읽지 않아 옛 스키마에서도 동작한다. 0075는 옛 API를 위해 열을 남기고 NOT NULL만 푼다. 옛 API는 NULL 상한 행을 `CAPACITY_UNAVAILABLE`로 거절하므로 **새 API를 모든 인스턴스에 배포한 뒤에만 NULL 상한 시리즈를 삽입**한다. 옛 API로 롤백해야 한다면 원래 `integer`인 열을 `numeric(20,0)`으로 넓히고 모든 NULL 행의 `max_ever_minted`를 uint64 최댓값 `18446744073709551615`로 채운 뒤 `SET NOT NULL`을 적용한다. Base Sepolia에 배포된 기존 계약에서는 새 시리즈를 `createSeries(bytes32 seriesId, string baseTokenURI, uint64 maxEverMinted)`로 만들고 세 번째 인자에 `18446744073709551615`를 넣는다. 기존 상한 1 실증 시리즈에는 운영 발행을 보내지 않는다. 새 계약에서는 2인자 `createSeries(bytes32 seriesId, string baseTokenURI)`를 쓴다. 두 계약의 `series(bytes32)` getter 반환값도 각각 `(string,uint64,uint64,bool)`과 `(string,uint64,bool)`로 다르다. 배포·발행 전 계약 주소와 시리즈 ID가 가리키는 버전을 확인한다.

옛 API 롤백이 필요한 경우 쓰기를 멈추고 DB 백업을 확인한 뒤 다음 순서로 적용한다(`integer` 열에는 uint64 최댓값을 바로 저장할 수 없다).

```sql
BEGIN;
ALTER TABLE nft_series ALTER COLUMN max_ever_minted TYPE numeric(20,0);
UPDATE nft_series SET max_ever_minted = 18446744073709551615 WHERE max_ever_minted IS NULL;
ALTER TABLE nft_series ALTER COLUMN max_ever_minted SET NOT NULL;
COMMIT;
```

### 개인정보 재동의·설치본 관문

새 API의 `privacy-2026-10-07`은 구 test.10/Preview 19의 개인정보04 문구와 다르다. `apps/mobile/src/privacy/consent-flow.ts`가 `outdated`로 동의를 막으므로 **API만 먼저 공개하면 기존 설치본이 잠긴다**. 옛 APK 재설치로 해결되지 않는다. 최신 약관·공개 개인정보 안내, API, 같은 소스의 `/play/` 웹 번들, 새 APK와 `/open`을 하나의 유지보수 창에서 전환한다. APK 서명·package·API origin·내장 동의 버전·SHA-256과 실제 다운로드 파일을 대조하고 기존 서명 키를 만들거나 덮어쓰지 않는다.

Preview 20과 test.11은 게시됐다. `/open`의 두 링크는 환경별로 독립 검증한다. 운영 API 전환 전 새 공개 문구와 구 운영 API의 동의 버전이 다르면 구 API가 제공하는 개인정보04 동의 안내를 그대로 유지하고, 서버가 반환하는 안내·정책 링크·버전이 맞는지 검증한다. 맞는 구 안내를 제공할 수 없다면 전환을 중단한다. 공개 문서 변경만으로 운영 API의 정책 버전을 바꾸지 않는다.

### 같은 배포 창의 순서

1. **사전 준비:** 최종 선택 SHA에서 API 이미지·`/play/` export·Preview 20·test.11·공개 안내·`/open` 후보를 준비한다. 현재 공개 SHA/원장/링크/해시와 rollback 포인터를 기록한다. 시연·운영의 비밀·DB·OAuth·package·서명·가상 데이터 격리를 확인한다. 이 worktree 수정 중에는 배포하지 않고 메인 스레드 통합 후 선택 SHA를 고정한다.
2. **시연 먼저:** 시연 DB 백업과 실제 scratch 복원을 수행하고, 고객·점주 변경 요청과 seed/retention 작업을 잠시 중단한다. API 쓰기와 신규 웹 체험을 차단한 유지보수 창 안에서 27 migration을 적용해 원장 70건을 대조한다. 시연 API를 새 이미지로 교체하고 아직 입구를 열지 않는다.
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

위 절차를 한 번에 연습하는 스크립트가 있습니다. dump → `<DB 이름>_restore_test` 복원 → 테이블별 행 수와 migration 목록 대조 → scratch DB 삭제까지 하며 원본은 읽기만 합니다. scratch DB 이름에는 프로세스 번호가 들어가 기존 DB를 이름으로 지우지 않고, 백업 파일 경로를 주지 않으면 dump는 임시 파일로 만들어져 끝날 때 삭제됩니다(실제 데이터가 들어 있으므로 경로를 줬다면 암호화 보관 절차를 따릅니다). 경로를 준 dump는 `umask 077`로 같은 폴더의 임시 파일에 쓰고 dump가 성공했을 때만 그 경로로 옮기므로 새 파일은 항상 mode 600이고, dump가 실패하면 그 경로의 이전 백업은 그대로 남습니다(Issue #263). 이미 있는 경로와 `/opt/masscom*/backups`의 `*.dump`에는 `--overwrite`를 주지 않으면 DB에 접속하기 전에 거절합니다(`--restore-only`를 빼먹고 진짜 백업을 새 dump로 덮는 사고를 막으려는 것, Issue #412). 그리고 `/opt/masscom*/backups` 안에 **이미 있는 파일은 `--overwrite`를 줘도 바꾸지 않고** 종료 코드 1로 거절합니다(이름과 상관없이, 상대 경로나 심볼릭 링크로 가리켜도 같습니다). `--overwrite`가 되는 곳은 그 밖의 경로와, 그 폴더에 새 `*.dump`를 쓰는 경우뿐입니다. 쓰기가 조용할 때 실행하세요(행 수를 실행 시점의 원본과 비교합니다).

```bash
read -s PGPASSWORD && export PGPASSWORD
DRILL_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom' scripts/db-restore-drill.sh [--overwrite] [백업 파일 경로]
# 클라이언트 도구가 컨테이너 안에만 있으면: PG_EXEC='docker exec -i -e PGPASSWORD <컨테이너>' (URL은 컨테이너 안에서 보이는 주소)
```

복원 DB 이름은 반드시 `_test`로 끝나야 하며 운영 DB에 통합 시험을 실행하지 않습니다. 복원 뒤 `max(CHAIN_FROM_BLOCK, chain_cursors.next_block - CHAIN_REORG_MARGIN)`부터 먼저 이벤트를 재수집하고, 각 mint job의 reward key를 체인에서 확인합니다. 빠른 범위에서 못 찾으면 `CHAIN_FROM_BLOCK`까지 fallback하며, 기존 NFT를 찾으면 새 발행 키나 새 거래를 만들지 않습니다.

## 장애별 중지 기준

| 장애 | 즉시 조치 | 복구 확인 |
| --- | --- | --- |
| RPC chain/contract 불일치 | Worker `PAUSED/MANUAL_REVIEW`, 전송 금지. code는 있지만 인터페이스가 다른 계약은 `CONTRACT_INTERFACE_MISMATCH` | chain ID·contract code·MINTER role·계약 주소 재검증 |
| RPC 연결 불가 | 조치 불필요. Worker가 `RPC_UNAVAILABLE`로 물러나 작업은 `RETRYABLE`, 전송 시도 소모 없음 | `SELECT status, last_error_code, attempt_count FROM mint_jobs WHERE status = 'RETRYABLE'`로 확인, RPC 복구 뒤 다음 실행에서 자동 재개 |
| 옛 계약 시리즈 상한 도달 | 제출 전 gas 추정에서 `SeriesSupplyExceeded`가 확인되면 `SERIES_SUPPLY_EXCEEDED`로 분류해 재시도 없이 즉시 `MANUAL_REVIEW`(추정 뒤 경합으로 채굴된 revert는 기존 `MINT_TRANSACTION_REVERTED` 재확인 경로). 권리는 `MINT_REQUESTED`에 남는다 | 계약 주소·시리즈 키와 온체인 상한을 확인한다. 기존 상한 1 실증 시리즈에는 운영 발행을 보내지 않고, 새 시리즈의 안전한 연결·기존 reward key를 대조한 뒤 운영자가 후속 처리한다 |
| 서비스 민터 설정 오류 | `MINTER_KEYSTORE_DECRYPT_FAILED`·`MINTER_ADDRESS_MISMATCH`·`MINTER_ROLE_MISSING`으로 기동·발행 중지. signed transaction의 recovered sender 불일치는 `MINTER_SIGNER_MISMATCH`로 기록 전 차단 | keystore 파일과 전체 상위 경로의 소유자·권한, 비밀번호 파일, 민터 주소, 계약 역할을 확인. 비밀번호나 키를 로그·티켓에 붙이지 않음 |
| 상시 Worker 컨테이너(`mint-worker`)가 unhealthy이거나 접수가 쌓임 | `docker compose … --profile nft-live ps mint-worker`가 unhealthy, 하트비트(`/tmp/mint-worker.heartbeat`)가 3분 넘게 갱신되지 않음, 로그에 `MINT_WORKER_ITERATION_FAILED`(오류 이름·코드와 `retryInMs`)가 반복됨. **하트비트·healthy는 루프가 살아 있다는 뜻이지 발행이 성공한다는 뜻이 아니다.** 작업 단위 실패(RPC 중단, `MINT_PAUSED`, `MINTER_BALANCE_LOW`)는 작업을 재시도 대기로 돌리고 반복은 정상으로 끝나므로, 아무것도 발행되지 않는 동안에도 healthy일 수 있다. 실제 신호는 대기열이다: `SELECT count(*), min(available_at) FROM outbox_events WHERE status IN ('PENDING', 'LEASED')`가 줄지 않고 `min(available_at)`이 계속 과거로 벌어지면 막힌 것이다(로그의 `MINT_WORKER_JOB_HANDLED`도 처리했거나 재시도 대기로 돌렸다는 뜻일 뿐이다) | 오류 코드에 맞는 이 표의 다른 행을 따른다(DB·RPC 장애는 복구되면 컨테이너가 알아서 재시도하므로 재시작이 필요 없다). `MINT_WORKER_LOOP_FAILED`는 설정·keystore 오류(`MINTER_KEYSTORE_*`, 환경변수 누락)로 컨테이너가 종료 코드 1로 멈춘 것이고, `MINT_WORKER_CRASHED`는 잡히지 않은 예외로 종료한 것이다. **compose가 `restart: unless-stopped`라서 설정 오류는 Docker 백오프로 계속 다시 떠 크래시 루프가 된다.** 원인을 고치기 전에 멈추려면 `docker compose … --profile nft-live stop mint-worker`를 쓴다(최대 60초, 처리 중인 한 건을 끝내려 시도하며 못 끝내면 임대 만료로 복구). 원인을 고친 뒤 다시 켠다. 켜는 절차와 조건은 [Lightsail 문서](../infra/lightsail/README.md)의 "NFT 발행 Worker" |
| 같은 민터의 발행이 모두 멈춤 | 여러 작업의 `last_error_code`가 `MINTER_NONCE_BLOCKED`로 이어짐. Worker 오류 로그에 막고 있는 거래 hash가 남음 | 그 hash를 explorer에서 확인. 채굴됐으면 다음 주기에 풀림. 수수료 부족 등으로 영영 전송될 수 없으면 그 작업이 `RECEIPT_TIMEOUT`으로 닫힐 때까지 기다리거나 운영자가 해당 작업을 검토 상태로 닫는다. 새 nonce로 덮어쓰는 거래를 수동으로 보내지 않는다 |
| 보낸 거래의 receipt가 오래 안 나옴 | 작업의 `last_error_code`가 `RECEIPT_NOT_READY`(조회는 됐지만 영수증이나 확인 깊이가 아직 없음)이면 체인이 아직 거기까지 안 온 것이고, `RECEIPT_LOOKUP_FAILED`(마지막 조회가 RPC 오류, 요청 하나는 10초에서 끊김)이면 RPC 쪽 문제다. 둘 다 같은 재시도 경로이고 코드는 원인 구분용 기록이다. 전송 5회 상한과 별개로 결과 확인을 계속하다가 제출 뒤 `receiptTimeoutMs`가 지나면 `MANUAL_REVIEW`(`RECEIPT_TIMEOUT`). 기본은 24시간(`start:once`)이지만 상시 Worker 컨테이너는 `CHAIN_RECEIPT_TIMEOUT_MS=600000`, 즉 **10분**이다 | 거래 hash를 explorer에서 확인. 성공이면 Worker가 재임대 시 추가 전송 없이 확정, 누락·대체됐으면 운영자가 판단 |
| 전송 직후 중지로 거래 revert | Worker가 중지·잔액·RPC를 다시 확인해 일시 조건이면 revert된 거래 hash를 지우고 `RETRYABLE`. 조건이 이미 풀렸으면 `MINT_TRANSACTION_REVERTED`로 `MANUAL_REVIEW` | 수동 검토 작업은 reward key가 체인에 없음을 확인한 뒤 재대기열 여부를 결정 |
| 발행 중지(pause) | PAUSER가 계약을 중지하면 Worker는 `MINT_PAUSED`로 물러남. 이미 제출된 거래의 확인·완료는 계속됨 | 원인 해소 뒤 admin이 `unpause`, 다음 실행에서 각 작업이 정확히 1개 발행 |
| 민터 잔액 부족 | 잔액이 `MINTER_MIN_BALANCE_WEI` 이하이면 `MINTER_BALANCE_LOW`로 물러남. 보상권·Outbox 유지, 전송 시도 소모 없음 | 승인된 예산·시험 faucet으로 충전 뒤 다음 실행에서 자동 재개, 기존 reward key부터 조회 |
| DB 장애 | API 변경 요청 실패, 완료 화면 금지. Worker는 체인에 아무것도 전송하지 않고 오류로 종료 | DB 일관성·migration·Outbox lease 확인 뒤 Worker 재실행 |
| 전송 응답 유실 | 새 키 발급 금지 | reward key·기존 transaction·event 대조 |
| 확정 전 재조직 | 완료 처리 금지 | 필요한 confirmation과 canonical block hash 확인 |

### 상시 Worker(`nft-live`)를 켜기 전에 배포 절차를 보강할 것(후속, `NOT_RUN`)

`scripts/deploy-lightsail.sh`는 `mint-worker`를 멈추거나 다시 빌드하지 않는다(배포 스크립트 동작은 이번에 바꾸지 않았다). `nft-live`를 켜기 전에 다음을 먼저 정한다.

1. **migration 전에 `mint-worker`를 멈춘다.** 이전 스키마를 기대하는 Worker가 migrate 중에 DB를 쓰지 않게 `docker compose … --profile nft-live stop mint-worker`를 migrate 앞에 넣고, 배포가 끝난 뒤 다시 켠다.
2. **배포 때 `mint-worker` 이미지를 다시 빌드한다.** 스크립트는 `build api production-web`만 하므로 Worker 이미지가 새 릴리스 코드와 어긋난다.
3. `COMPOSE_PROFILES=nft-live`는 `runtime.env`에 넣지 않는다(모든 compose 명령이 발행을 켠다). 프로파일은 명령마다 `--profile nft-live`로만 켠다.

## 감시·매일 백업·복원 드릴·큰 파일 가드·현재 배포 원본 (Issue #412)

이 절의 변경은 배포하지 않았습니다(소유자 결정 A). 공개 서버·설치본은 그대로이고, 호스트에는 아무것도 설치하지 않았습니다.

### 가동 점검 (`.github/workflows/uptime.yml`, `scripts/uptime-probe.sh`)

- 15분마다(cron `*/15 * * * *`, GitHub 최선 노력이라 몇 분 밀리거나 건너뛸 수 있음)와 수동 실행으로 돕니다. 예약 실행은 기본 브랜치(main)에 있는 이 파일로만 돕니다. 서드파티 액션 없이 러너의 `curl`·`jq`·`openssl`·`gh`만 쓰고 권한은 `contents: read`·`issues: write`, 실행은 하나씩(`concurrency: uptime`), 제한 5분입니다. 저장소에 60일 동안 활동이 없으면 GitHub가 예약 실행을 끕니다. 가끔 커밋이 없던 기간에는 Actions 탭에서 Uptime이 살아 있는지 보고, 꺼졌으면 수동 실행이나 커밋으로 다시 켭니다.
- 1단계(읽기 전용, 매번): 운영 `api.masscom.kr`의 `/health`·`/merchants`, 시연 `demo-api.masscom.kr`의 `/health`·`/merchants`(가상 점포 3곳 이상, 전부 `demo:true`), 첫 시연 점포의 `/v1/discovery/merchants/<id>`·`/merchants/<id>/collectible-preview`, 시연 `/play/` HTML이 이름을 부른 진입 JS가 200과 JavaScript content-type으로 오는지, 운영 `masscom.kr/app/`·`/merchant/`의 `<title>`. 운영 `/merchants`는 지금 빈 목록이라 `merchants` 배열이 있는지만 봅니다.
- 경고(이슈 없음): TLS 인증서 만료까지 14일 미만, 응답 3초 초과. 실행 로그의 주석과 요약에만 남습니다.
- 일시적인 끊김은 세지 않습니다. 1단계에서 실패한 항목이 있으면 약 30초 뒤 1단계를 한 번 더 돌려 그 결과로만 판정하고(읽기 전용이라 부작용이 없습니다), 그래도 실패한 것만 이슈 대상입니다. 요청 시간 예산(200초)을 넘기면 남은 요청은 하지 않고 실패로 세며 TLS 점검은 건너뜁니다. `gh` 호출은 `timeout 30`으로 감싸 멈춘 `gh`가 job을 5분 제한까지 붙잡지 않습니다.
- 상태는 `uptime` 라벨이 붙은 열린 이슈 하나입니다. 실패가 있고 열린 이슈가 없으면 한국어 제목 `[장애 감지] …`와 실패 항목 목록으로 이슈를 만들고(라벨이 없으면 만듭니다), 열린 이슈가 있으면 중복해서 만들지 않으며, 모두 통과하면 복구 댓글과 함께 닫습니다. 단, 쓰기 점검까지 돈 실행에서 쓰기 점검이 실패했으면 "모두 통과"가 아니므로 열린 이슈를 닫지 않습니다. 실패한 실행은 빨갛게 끝나 GitHub 기본 알림도 함께 갑니다.
- 2단계 쓰기 점검(시연 게스트 체험 시작 → `/me/consent` → `/collection` → 로그아웃)은 **수동 전용**입니다. Actions의 Uptime에서 Run workflow의 `write_probe`를 켜야 돌고 예약되지 않습니다. **로그아웃은 세션만 폐기하고 체험 자리를 돌려주지 않습니다.** 한 번 실행이 체험 자리를 전역 300 중 1, 같은 클라이언트(IP)당 30 중 1 잡은 채 24시간 뒤 만료까지 놓지 않고, 체험 계정·체험 가게·캠페인 사본도 남깁니다. 15분마다 예약하면 24시간 동안 늘 96자리가 잡혀 전역 상한 300의 약 3분의 1을 점검이 차지하므로 예약하지 않습니다(`--retry 0`이라 시작 요청이 자동 재시도로 자리를 두 번 잡지도 않습니다). 예약 여부는 소유자가 정합니다. 이 단계의 실패는 이슈를 열지 않고 실행만 빨갛게 만듭니다. 이 단계는 실제 시연 서버에 대해 아직 한 번도 돌리지 않았습니다(`NOT_RUN`, 가짜 curl 시험만 통과).

### 매일 DB 백업 (`masscom-backup`, 호스트에 아직 설치하지 않음)

- 파일: `infra/lightsail/host-jobs/masscom-backup.{sh,service,timer}`(운영, 매일 18:50 UTC), `infra/showcase-host/host-jobs/masscom-backup.sh`와 `masscom-showcase-backup.{service,timer}`(시연, 매일 19:05 UTC). 정리 작업(`masscom-retention`)과 같은 방식으로 compose 레이블로 Postgres 컨테이너를 고르고 같은 유닛 보안 설정을 씁니다.
- 동작: 정리 작업과 나누는 잠금(백업 폴더 자체를 읽기로 열어 그 위에 거는 `flock`, 잠금 파일 없음; 최대 20분=1200초 기다리며 유닛의 `TimeoutStartSec=30min`보다 짧습니다)을 잡고, `pg_isready`로 Postgres가 연결을 받을 때까지 기다린 뒤(5초 간격 12번), 직전 `daily-*.dump` 크기의 2배 이상 디스크가 남았는지 봅니다(직전 백업이 없으면 건너뜀). `umask 077`과 `noclobber`로 `daily-<UTC 시각>.dump.part`에 `pg_dump --format=custom`으로 받고, `pg_restore -f /dev/null`로 아카이브를 끝까지 읽어 보고(목차와 모든 데이터 블록을 풀므로 잘린·깨진 덤프가 걸립니다), `daily-<UTC 시각>.dump.sha256`을 쓴 뒤 `daily-<UTC 시각>.dump`로 한 번에 `mv`합니다. 이 확인은 "읽을 수 있다"이지 "복원된다"가 아닙니다: 복원은 아래 복원 전용 드릴로 따로 시험합니다. 실패하면 절반짜리 파일을 남기지 않고 종료 코드 1이며, 유닛은 10분 뒤 다시 시도합니다(2시간 안에 처음 실행을 포함해 3번까지, `Restart=on-failure`·`RestartSec=10min`, oneshot에서 `Restart=on-failure`는 systemd 244 이상). 이름이 정리 작업의 삭제 범위(`*.dump`·`*.dump.*`)에 들어가 30일 뒤 함께 지워지되, 정리 작업은 가장 최근 `daily-*.dump` 3개와 그 sha256을 나이와 상관없이 남깁니다(백업이 한동안 실패해도 마지막 좋은 백업이 지워지지 않게 하는 하한). 두 작업이 같은 잠금을 쓰므로 정리가 도는 동안 백업이 쓰지 않고 그 반대도 같습니다. 쓸 수 있는 곳은 백업 폴더뿐입니다.
- 크기 급감 확인: 덤프가 끝난 뒤 새 파일이 직전 `daily-*.dump`(새로 만들기 전의 가장 최근 것)의 **50% 미만**이면 두 파일을 모두 그대로 두고(지우지 않습니다) stderr에 `BACKUP_SIZE_DROP<TAB><새 바이트><TAB><직전 바이트>`를 쓰고 종료 코드 3으로 끝납니다. 데이터가 갑자기 빠진 백업이 조용히 성공으로 보이지 않게 하려는 것이라, 유닛은 `RestartPreventExitStatus=3`으로 이 코드를 다시 시도하지 않고 `failed`로 남깁니다(다시 받으면 방금의 작은 파일과 비교되어 통과하고 실패가 가려집니다). 정확히 50%는 통과하고, 직전 백업이 없으면(첫 실행) 건너뜁니다. 원인을 확인한 뒤(정상적인 대량 삭제였는지) `sudo systemctl reset-failed masscom-backup.service`로 실패 표시를 지웁니다. 한계: 다음 실행은 이 작은 파일과 비교하므로 기준이 낮아집니다.
- 시작 횟수 제한: 수동 `sudo systemctl start masscom-backup.service`도 `StartLimitBurst=3`(`StartLimitIntervalSec=2h`)의 시작 횟수에 들어갑니다. 설치 직후 시험 삼아 여러 번 시작하거나 자동 재시도와 겹치면 2시간 안의 네 번째 시작이 `start request repeated too quickly`로 거절됩니다. 이때는 `sudo systemctl reset-failed masscom-backup.service`(시연은 `masscom-showcase-backup.service`)로 횟수를 지운 뒤 다시 시작하거나 2시간을 기다립니다.
- 설치는 소유자 승인 뒤에 합니다. 운영: `sudo bash infra/lightsail/host-jobs/install.sh masscom-backup`, 시연: `sudo bash infra/showcase-host/host-jobs/install.sh masscom-showcase-backup`. 이어서 `sudo systemctl start masscom-backup.service`(시연은 `masscom-showcase-backup.service`)로 한 번 돌리고 같은 install.sh에 같은 이름과 `--verify`를 붙여 확인합니다. `install.sh`는 이름과 동작(`install`·`--uninstall`·`--verify`)을 순서와 상관없이 받고, 모르는 인자나 같은 종류의 중복은 아무것도 하지 않고 종료 코드 2로 멈춥니다(`--uninstall masscom-backup`이 정리 작업을 지우는 일이 없도록). 이름이 없는 `install.sh`는 지금처럼 정리 작업만 설치합니다(운영 배포 스크립트가 인자 없이 부릅니다).
- 후속: `scripts/deploy-lightsail.sh`의 배포 후 관문은 아직 백업 작업의 첫 실행 성공을 요구하지 않습니다(위험이 크고 시험이 무거워 이 변경에서 바꾸지 않았습니다).
- 한계: 같은 디스크의 백업이라 서버를 잃으면 함께 사라집니다. 서버 밖 사본(암호화 후 보관 위치·비용)은 소유자 결정 사항입니다.
- 배포가 설치본을 다시 맞추지 않습니다(유닛 드리프트). `deploy-lightsail.sh`는 정리 작업만 다시 설치하므로, 저장소의 `masscom-backup.{sh,service,timer}`를 고쳐도 호스트의 설치본은 그대로입니다. 고친 뒤에는 같은 `install.sh <이름>`을 다시 실행하고 `--verify`로 호스트 파일이 저장소와 같은지 확인합니다.
- 백업 실패 알림이 아직 없습니다(소유자 결정 대기). 백업이 실패해도 유닛이 `failed`가 될 뿐 아무도 받지 않습니다. 설치 뒤에는 `systemctl status masscom-backup.service`나 `ls /opt/masscom/backups/daily-*.dump`로 직접 확인해야 하고, 알림 수단(healthchecks.io·Telegram·세분화된 PAT 등)은 소유자가 고른 뒤 호스트 점검 타이머로 더합니다.

### 복원 전용 드릴 (`scripts/db-restore-drill.sh --restore-only`)

```bash
read -s PGPASSWORD && export PGPASSWORD
# 운영 서버: Postgres 포트를 호스트에 열어 두지 않았으므로 클라이언트 도구를 컨테이너 안에서 실행합니다(URL은 컨테이너 안에서 보이는 주소, <container>는 `docker ps`로 찾은 postgres 컨테이너).
PG_EXEC='docker exec -i -e PGPASSWORD <container>' \
DRILL_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom' scripts/db-restore-drill.sh --restore-only /opt/masscom/backups/daily-<시각>.dump
```

`PG_EXEC` 없이 쓰는 형식(`DRILL_DATABASE_URL=... scripts/db-restore-drill.sh --restore-only <파일>`)은 호스트에서 `psql`·`pg_restore`가 URL에 닿을 때(로컬 개발 DB 등)만 됩니다.

- 옵션은 맨 앞에 정확히 `--restore-only <파일>` 하나로 줍니다. 파일 뒤에 인자가 더 있거나(`--restore-only <파일> 추가`), `--restore-only=<파일>`처럼 모르는 `-` 옵션이면 DB에 접속하기 전에 종료 코드 2로 거절합니다. `--restore-only`를 빼고 기존 백업 경로만 주면 덮어쓰지 않고 거절합니다(위 `--overwrite` 규칙).
- 있는 백업 파일만 읽습니다(원본 DB는 덤프하지 않고 파일은 건드리지 않음). 끝나면 scratch DB의 남은 연결만 끊고(`pg_terminate_backend`, 그 `datname`만) 지웁니다. 같은 이름의 DB가 이미 있어 만들기에 실패하면 아무것도 지우지 않고 실패합니다. scratch DB에 복원하고 `pg_restore` 종료 0, 비어 있지 않은 `schema_migrations`, 원본과 같은 테이블 집합을 확인한 뒤 scratch DB를 지웁니다. 출력의 마지막 줄이 걸린 시간(RTO 측정값)입니다: `restore-only drill passed: <N> tables match the live database, <M> migrations, restored in <S> seconds`.
- 여유 공간: scratch DB를 **만들기 전에** 서버의 데이터 디렉터리(`SHOW data_directory`)가 있는 파일시스템에 백업 파일 크기의 **3배 이상**이 남았는지 `df -Pk`로 봅니다(복원은 덤프 내용의 전체 사본에 인덱스·WAL이 더해져 파일보다 훨씬 커집니다). 모자라면 `restore drill FAILED: not enough free space …`로 종료 코드 1이고 DB에는 아무것도 만들지 않습니다. `df`는 PostgreSQL 도구가 도는 곳에서 돕니다: `PG_EXEC`를 쓰면 컨테이너 안에서, 안 쓰면 URL이 이 PC(호스트가 비었거나 `localhost`·`127.0.0.1`·`::1`)일 때만 이 PC에서 잽니다(공개 포트로 로컬에 열린 컨테이너 DB는 `PG_EXEC`를 쓰세요. 안 쓰면 같은 이름의 이 PC 경로를 잴 수 있습니다). 원격 서버를 `PG_EXEC` 없이 가리키거나 `SHOW data_directory`(슈퍼유저 또는 `pg_read_all_settings` 필요)·`df`가 실패하면 잴 수 없으므로 stderr에 `free-space check skipped: …`를 남기고 건너뜁니다(복원은 계속). 건너뛴 실행은 여유 공간을 확인한 것이 아니니 직접 `df -h`로 봅니다.
- 행 수는 비교하지 않습니다(백업은 원본보다 오래됐습니다). 배포로 테이블이 늘면 다음 백업이 생길 때까지 직전 백업은 테이블 집합 확인에서 실패합니다.
- 일회용 로컬 Postgres 16.10 컨테이너에서만 실행했습니다(`S`는 0초, 작은 데이터). 서버의 실제 백업으로 잰 RTO는 없습니다(`NOT_RUN`).

### 큰 파일 가드 (`scripts/check-large-files.sh`)

- `<base-ref>...HEAD`에서 추가·수정된 파일만 봅니다. `docs/evidence/**` 바이너리가 1 MiB 초과이거나 어떤 파일이든 3 MiB 초과이면 실패합니다. CI(비밀값 검사 바로 뒤, PR 기준 커밋이나 push 직전 커밋과 비교)와 `tools/gate.sh`(`origin/main` 기준)가 실행합니다. 커밋하지 않은 파일은 보지 않습니다.
- 증거 영상·원본 크기 이미지는 저장소가 아니라 GitHub Release의 자산(`evidence-YYYY-MM-DD-<주제>`)에 올리고, 증거 JSON에 자산 이름과 SHA-256을 적습니다. Git LFS와 이력 다시 쓰기는 쓰지 않습니다.
- 예외는 `scripts/large-files-allowlist.txt`에 `경로<TAB>이유<TAB>최대 바이트`로 한 줄씩 적습니다(경로는 정확히 일치, 이유는 필수, 세 번째 칸은 선택이지만 지금 크기 + 10%를 적는 것이 기본입니다). 최대 바이트가 있으면 예외 파일도 그 크기까지만 허용해 조용히 더 커지지 않습니다. 지금은 가드 도입 전부터 있던 `demo-flow-390.webm`과 `draw-loop.mp3` 두 개뿐입니다.
- 이름 바꾸기·옮기기는 감지하지 않고 새 파일로 셉니다. 큰 파일을 옮기면 새 경로를 예외 목록에 올려야 걸리지 않습니다.
- 이미 저장소에 있는 `docs/evidence/**` 바이너리 가운데 1~3 MiB인 파일은 고쳐서 커밋하면(수정도 대상) 1 MiB 규칙에 걸립니다. 그런 파일을 고칠 때는 예외 목록에 올리거나 줄인 사본으로 바꿉니다.

### 현재 배포 상태의 기준 파일 (`docs/CURRENT_RELEASE.json`)

- 설치본 태그·날짜·APK 이름·SHA-256·크기·소스 커밋과 운영 API·시연 API·`/play/` 번들 커밋을 **손으로 고치는 기준 파일**입니다. `docs/open.html`의 생성 블록은 여기서 만듭니다. 이 파일 하나로 모든 문서가 정해지는 것은 아닙니다: 아래 "검사 범위" 밖의 문서와 세 군데의 고정 문자열은 사람이 맞춥니다.
- 검사 범위(`--check`가 JSON에 없는 태그·APK 이름·해시를 현재처럼 적었는지 보는 곳): `docs/open.html`(생성 블록 밖), `README.md`의 "바로 체험" 절, `docs/DEMO_RUNBOOK.md`, `docs/SUBMISSION_CHECKLIST.md`. `이전`·`옛` 바로 뒤에 오는 토큰은 옛 설치본 설명으로 보고 넘어가고, 체크리스트에는 정당한 옛 언급 두 개(`09dfceb0` 운영 배포 증거 링크 이름, 대체 시연 영상의 SHA-256)만 정확히 허용합니다.
- 검사 밖: `docs/ANDROID_DOWNLOADS.md`는 날짜별 이력 표라 옛 태그가 정상이라 보지 않습니다. `README.md`의 "바로 체험" 밖, `docs/PROJECT_STATE.md`·`docs/HANDOFF.md`·`docs/TEST_STATUS.md`의 서술도 사람이 맞춥니다.
- 새 설치본이 나왔을 때의 갱신 순서:
  1. 새 evidence JSON을 두고 `docs/CURRENT_RELEASE.json`을 고칩니다.
  2. `node scripts/render-current-release.mjs`로 `open.html` 생성 블록을 다시 만듭니다.
  3. `node scripts/render-current-release.mjs --check`로 위 검사 범위의 어긋남을 찾아 고칩니다.
  4. 고정 문자열 세 군데를 직접 새 태그로 고칩니다: `scripts/verify-project-site.sh`(58~59줄 근처), `tests/site/public-entry.test.mjs`(26줄 근처), `tests/site/verify_project_site_test.sh`(82~83줄 근처). 안 고치면 세 검사가 새 `open.html`에서 옛 태그를 찾지 못해 실패하므로 놓치지는 않지만, 고쳐야 통과합니다.
- `--check`는 JSON이 evidence 파일(태그·APK 이름·SHA-256·소스)과 같은지도 봅니다. `tools/gate.sh`와 CI(`tests/site/current_release_test.mjs`)가 실행합니다. 마이그레이션 수는 이 파일에 두지 않습니다(`apps/api/migrations`의 파일 수가 기준이고 서술은 문서가 맞춥니다).

### 커버리지와 설치본 용량

- CI는 API 단위 시험(`npm run test:cov --prefix apps/api`)의 커버리지를 실행 요약에 보고합니다(보고용, 기준선 없음). 실측은 줄 약 58.5%·분기 88.4%·함수 60.1%입니다(실행마다 줄 비율이 0.1%p 안팎으로 달라집니다). PostgreSQL 통합 시험의 커버리지는 로컬에서 한 번 쟀습니다(`npm run test:postgres:cov --prefix apps/api`, 줄 91.3%·분기 81.9%·함수 86.6%, 약 24분). CI의 제한 25분에 맞지 않아 CI에는 넣지 않았습니다.
- Android 설치본 용량(운영 약 324MB, 시연 약 330MB)은 [APK 용량 분석](APK_SIZE_ANALYSIS.md)에 측정값과 가설을 나눠 적었습니다. 원인은 단정하지 않았고 공개 APK를 직접 열어 보는 일은 남아 있습니다.

## 목표와 실제

RPO 1시간·RTO 4시간은 v3 제안값일 뿐 실제 백업/복원 시간 측정 전에는 보장하지 않습니다. 외부 저장소 비용·암호화 키·복원 담당자·알림 채널은 운영 승인 뒤 확정합니다.
